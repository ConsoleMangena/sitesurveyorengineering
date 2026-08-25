import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  MessageSquarePlus,
  PanelLeft,
  Pencil,
  RefreshCw,
  SendHorizontal,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import PageLoader from "@/components/PageLoader.tsx";
import {
  GatewayClient,
  GatewayClientError,
  normalizeHistoryEntry,
  type ChatRunEvent,
} from "../../lib/openclaw/gatewayClient.ts";

// Default: same-origin /openclaw path (the Vite dev proxy forwards to
// ws://127.0.0.1:18789 and strips Origin so the gateway treats the app as a
// trusted loopback backend client).
const GATEWAY_URL =
  (import.meta.env.VITE_OPENCLAW_URL as string | undefined) ||
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/openclaw`;
const GATEWAY_TOKEN = import.meta.env.VITE_OPENCLAW_TOKEN as
  | string
  | undefined;

/** Every SiteSurveyor conversation lives under this key prefix, so the sidebar can
 *  pick them out of the gateway's global session index. */
const SESSION_PREFIX = "agent:main:sitesurveyor-assistant";
const LAST_SESSION_STORAGE_KEY = "sitesurveyor:last-ai-session";
// Gateway session labels must be unique across all sessions, so chat titles
// are stored locally and gateway labels are only best-effort mirrors.
const TITLES_STORAGE_KEY = "sitesurveyor:ai-titles";

function loadTitleMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(TITLES_STORAGE_KEY) ?? "{}") as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
}

function saveTitleMap(map: Record<string, string>) {
  localStorage.setItem(TITLES_STORAGE_KEY, JSON.stringify(map));
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
}

interface Conversation {
  key: string;
  label: string;
  updatedAt: number | null;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}${Date.now()}-${idCounter}`;
}

/** Extract displayable text from a cumulative message snapshot. */
function messageText(message?: Record<string, unknown>): string {
  const content = message?.content ?? message?.text;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) =>
        part &&
        typeof part === "object" &&
        (part as { type?: string }).type === "text"
          ? String((part as { text: unknown }).text ?? "")
          : "",
      )
      .join("");
  return "";
}

const SUGGESTIONS = [
  "Summarise overdue invoices across workspaces",
  "Which asset calibrations are due within the next 14 days?",
  "How many active projects do we have, by status?",
];

export default function AssistantPage() {
  const clientRef = useRef<GatewayClient | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeKeyRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const connected = status === "connected";

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
  }, []);

  /** Streams assistant output into a live bubble keyed by runId. */
  const applyRunEvent = useCallback((runEvent: ChatRunEvent) => {
    if (!activeKeyRef.current || runEvent.sessionKey !== activeKeyRef.current)
      return;
    if (runEvent.state === "delta") {
      const delta = runEvent.deltaText ?? "";
      setMessages((prev) => {
        const existing = prev.find((m) => m.id === runEvent.runId);
        if (!existing)
          return [
            ...prev,
            { id: runEvent.runId, role: "assistant", text: delta, streaming: true },
          ];
        const text = runEvent.replace ? delta : existing.text + delta;
        return prev.map((m) => (m.id === runEvent.runId ? { ...m, text } : m));
      });
      return;
    }
    if (
      runEvent.state === "final" ||
      runEvent.state === "aborted" ||
      runEvent.state === "error"
    ) {
      setSending(false);
      const snapshot = messageText(runEvent.message);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === runEvent.runId
            ? {
                ...m,
                streaming: false,
                // Prefer the gateway's cumulative snapshot; keep deltas if absent.
                text: snapshot.trim() ? snapshot : m.text,
              }
            : m,
        ),
      );
      if (runEvent.state === "error") {
        setError(runEvent.errorMessage ?? "The assistant run failed.");
      }
    }
  }, []);

  const sortConversations = (rows: Conversation[]) =>
    [...rows].sort(
      (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    );

  const loadConversations = useCallback(async (): Promise<Conversation[]> => {
    const client = clientRef.current;
    if (!client) return [];
    try {
      const result = await client.request<{
        sessions?: Record<string, unknown>[];
      }>("sessions.list", { limit: 200 });
      const rows = Array.isArray(result?.sessions) ? result.sessions : [];
      const titles = loadTitleMap();
      const mapped = rows
        .map((row) => ({
          key: String(row.key ?? ""),
          label:
            titles[String(row.key ?? "")] ??
            ((typeof row.label === "string" && row.label) ||
              (typeof row.displayName === "string" && row.displayName) ||
              (typeof row.derivedTitle === "string" && row.derivedTitle) ||
              "New chat"),
          updatedAt:
            typeof row.updatedAt === "number" ? row.updatedAt : null,
        }))
        .filter((row) => row.key.startsWith(SESSION_PREFIX));
      setConversations(sortConversations(mapped));
      return mapped;
    } catch {
      return [];
    }
  }, []);

  const loadHistory = useCallback(
    async (sessionKey: string) => {
      try {
        const result = await clientRef.current?.request<{
          messages?: unknown[];
        }>("chat.history", { sessionKey, limit: 50 });
        const entries = Array.isArray(result?.messages) ? result.messages : [];
        const normalized = entries
          .map(normalizeHistoryEntry)
          .filter(
            (e): e is { role: "user" | "assistant"; text: string } => e !== null,
          )
          .slice(-50)
          .map((entry) => ({
            id: nextId("h"),
            role: entry.role,
            text: entry.text,
          }));
        setMessages(normalized);
        scrollToBottom();
      } catch {
        // Unknown/new sessions simply have no transcript yet.
        setMessages([]);
      }
    },
    [scrollToBottom],
  );

  const selectConversation = useCallback(
    async (key: string | null) => {
      setActiveKey(key);
      activeKeyRef.current = key;
      if (key) {
        localStorage.setItem(LAST_SESSION_STORAGE_KEY, key);
        void loadHistory(key);
      } else {
        setMessages([]);
      }
      setSidebarOpen(false);
    },
    [loadHistory],
  );

  const createConversation = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return null;
    const suffix =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    const key = `${SESSION_PREFIX}-${suffix}`;
    try {
      // No label: gateway labels are globally unique, titles live locally.
      await client.request("sessions.create", { key });
    } catch {
      // Entry creation is best-effort; chat.send will materialise it anyway.
    }
    const titles = loadTitleMap();
    titles[key] = "New chat";
    saveTitleMap(titles);
    await loadConversations();
    await selectConversation(key);
    return key;
  }, [loadConversations, selectConversation]);

  const deleteConversation = useCallback(
    async (key: string) => {
      if (!window.confirm("Delete this chat? This cannot be undone.")) return;
      try {
        await clientRef.current?.request("sessions.delete", {
          key,
          deleteTranscript: true,
        });
      } catch {
        setError("Failed to delete the chat on the gateway.");
      }
      const titles = loadTitleMap();
      delete titles[key];
      saveTitleMap(titles);
      const remaining = await loadConversations();
      if (activeKeyRef.current === key) {
        await selectConversation(remaining[0]?.key ?? null);
      }
    },
    [loadConversations, selectConversation],
  );

  const renameConversation = useCallback(
    async (key: string, label: string, silent = false) => {
      const trimmed = label.trim();
      if (!trimmed) return;
      setConversations((prev) =>
        prev.map((c) => (c.key === key ? { ...c, label: trimmed } : c)),
      );
      const titles = loadTitleMap();
      titles[key] = trimmed;
      saveTitleMap(titles);
      try {
        await clientRef.current?.request("sessions.patch", { key, label: trimmed });
      } catch (err) {
        // Duplicate labels are rejected gateway-wide; the local title already
        // applied, so only surface explicit renames that failed.
        if (!silent)
          setError(
            err instanceof GatewayClientError
              ? err.message
              : "Failed to rename the chat.",
          );
      }
      setRenamingKey(null);
    },
    [],
  );

  useEffect(() => {
    // Deferred so the effect body never calls setState synchronously
    // (react-hooks/set-state-in-effect).
    let cancelled = false;
    let unsubEvents: (() => void) | undefined;
    const clear = window.setTimeout(() => {
      if (cancelled) return;
      if (!GATEWAY_TOKEN) {
        setStatus("disconnected");
        setError(
          "Missing VITE_OPENCLAW_TOKEN in frontend/.env — add your gateway token and reload.",
        );
        return;
      }

      const boot = async () => {
        setStatus("connecting");
        setError(null);
        try {
          const client =
            clientRef.current ??
            new GatewayClient(GATEWAY_URL, GATEWAY_TOKEN, (s) => {
              if (!cancelled) setStatus(s);
            });
          clientRef.current = client;
          await client.connect();
          if (cancelled) return;

          // Visible assistant text streams on the "chat" event family
          // (deltaText + cumulative message snapshot); "agent" carries run
          // lifecycle. Subscribe to both.
          unsubEvents = client.onEvent((event, payload) => {
            if (event === "chat" || event === "agent")
              applyRunEvent(payload as ChatRunEvent);
          });

          const stored = localStorage.getItem(LAST_SESSION_STORAGE_KEY);
          const existing = await loadConversations();
          if (cancelled) return;
          const initial =
            existing.find((c) => c.key === stored)?.key ??
            existing[0]?.key ??
            null;
          if (initial) {
            await selectConversation(initial);
          } else {
            await createConversation();
          }
        } catch (err) {
          if (cancelled) return;
          setStatus("disconnected");
          setError(
            err instanceof GatewayClientError
              ? `${err.message} (${err.code})`
              : "Unable to reach the OpenClaw gateway on this machine.",
          );
        }
      };

      void boot();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(clear);
      unsubEvents?.();
    };
    // Boot runs once; callbacks are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => clientRef.current?.close(), []);

  const send = useCallback(async () => {
    const text = draft.trim();
    const sessionKey = activeKeyRef.current;
    if (!text || sending || !connected || !sessionKey) return;
    setDraft("");
    setSending(true);
    setError(null);
    setMessages((prev) => [
      ...prev,
      { id: nextId("u"), role: "user", text },
    ]);
    scrollToBottom();
    try {
      await clientRef.current?.request("chat.send", {
        sessionKey,
        message: text,
        idempotencyKey: nextId("i"),
        deliver: false,
      });
      // Auto-title: first user message names an untouched chat.
      const conversation = conversations.find((c) => c.key === sessionKey);
      if (conversation && conversation.label === "New chat") {
        void renameConversation(sessionKey, text.slice(0, 60), true);
      }
      // Bump the conversation to the top of the recency list.
      setConversations((prev) =>
        sortConversations(
          prev.map((c) =>
            c.key === sessionKey ? { ...c, updatedAt: Date.now() } : c,
          ),
        ),
      );
    } catch (err) {
      setSending(false);
      setError(
        err instanceof GatewayClientError
          ? err.message
          : "Failed to send the message.",
      );
    }
  }, [
    draft,
    sending,
    connected,
    conversations,
    renameConversation,
    scrollToBottom,
  ]);

  const startRename = useCallback(
    (conversation: Conversation) => {
      setRenamingKey(conversation.key);
      setRenameDraft(
        conversation.label === "New chat" ? "" : conversation.label,
      );
      setSidebarOpen(false);
    },
    [],
  );

  const submitRename = useCallback(() => {
    if (renamingKey && renameDraft.trim())
      void renameConversation(renamingKey, renameDraft);
    else setRenamingKey(null);
  }, [renamingKey, renameDraft, renameConversation]);

  const conversationList = (
    <div className="flex h-full min-h-0 flex-col">
      <Button
        onClick={() => {
          setSidebarOpen(false);
          void createConversation();
        }}
        disabled={!connected}
        className="mx-3 mt-3 justify-start gap-2"
        variant="outline"
      >
        <MessageSquarePlus className="size-4" />
        New chat
      </Button>
      <nav
        aria-label="Chat history"
        className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-3"
      >
        {conversations.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No chats yet.
          </p>
        )}
        {conversations.map((conversation) => {
          const isActive = conversation.key === activeKey;
          const isRenaming = renamingKey === conversation.key;
          return (
            <div
              key={conversation.key}
              className={cnSidebarItem(isActive)}
            >
              {isRenaming ? (
                <form
                  className="flex items-center gap-1 p-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitRename();
                  }}
                >
                  <Input
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setRenamingKey(null);
                    }}
                    aria-label="Chat name"
                    className="h-7 text-xs"
                  />
                  <button
                    type="submit"
                    aria-label="Save name"
                    className="shrink-0 rounded-md p-1 text-emerald-600 hover:bg-muted"
                  >
                    <Check className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Cancel"
                    className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted"
                    onClick={() => setRenamingKey(null)}
                  >
                    <X className="size-3.5" />
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void selectConversation(conversation.key)}
                    className="min-w-0 flex-1 truncate px-2 py-2 text-left text-sm"
                    title={conversation.label}
                  >
                    {conversation.label}
                  </button>
                  <span className="flex shrink-0 items-center gap-0.5 pr-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      type="button"
                      aria-label={`Rename "${conversation.label}"`}
                      className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                      onClick={() => startRename(conversation)}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete "${conversation.label}"`}
                      className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => void deleteConversation(conversation.key)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </span>
                </>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 gap-4">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col rounded-lg border border-border/60 bg-card lg:flex">
        <p className="px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Chats
        </p>
        {conversationList}
      </aside>

      {/* Mobile sidebar drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
          <aside
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-card shadow-xl"
            role="dialog"
            aria-label="Chat history"
          >
            <div className="flex items-center justify-between px-4 pb-1 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Chats
              </p>
              <button
                type="button"
                aria-label="Close chat history"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                onClick={() => setSidebarOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>
            {conversationList}
          </aside>
        </div>
      )}

      {/* Chat column */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="icon"
              className="size-9 shrink-0 lg:hidden"
              aria-label="Open chat history"
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeft className="size-4" />
            </Button>
            <img
              src="/logo.svg"
              alt=""
              aria-hidden="true"
              className="app-logo size-9 shrink-0"
            />
            <div>
              <h1 className="flex items-baseline gap-2 text-lg font-semibold text-foreground">
                SiteSurveyor
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  AI agent
                </span>
              </h1>
              <p className="text-xs text-muted-foreground">
                Your surveying reference point — reads and acts on workspace data
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={connected ? "default" : "secondary"}>
              {status === "connecting"
                ? "Connecting…"
                : connected
                  ? "Online"
                  : "Offline"}
            </Badge>
            {!connected && !sending && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => window.location.reload()}
              >
                <RefreshCw className="size-3.5" />
                Retry
              </Button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            {error}
          </div>
        )}

        <div
          ref={scrollRef}
          className="min-h-[280px] flex-1 overflow-y-auto rounded-lg border border-border/60 bg-card p-4"
        >
          {messages.length === 0 && connected ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-12 text-center">
              <img
                src="/logo.svg"
                alt=""
                aria-hidden="true"
                className="app-logo size-14 shrink-0"
              />
              <div className="max-w-sm space-y-1.5">
                <p className="font-medium text-card-foreground">
                  Meet SiteSurveyor — every measurement needs a reference
                </p>
                <p className="text-sm text-muted-foreground">
                  SiteSurveyor can query projects, invoices, quotes, assets and the
                  market — then act on what you approve.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setDraft(suggestion)}
                    className="rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : messages.length === 0 ? (
            <PageLoader compact />
          ) : (
            <div className="space-y-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-sm leading-relaxed ${
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "border border-border/60 bg-muted/60 text-card-foreground"
                    }`}
                  >
                    {message.text}
                    {message.streaming && (
                      <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-current align-middle" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              connected
                ? "Tell SiteSurveyor what to do…"
                : "Waiting for the OpenClaw gateway…"
            }
            disabled={!connected}
            className="h-11 flex-1"
            aria-label="Message SiteSurveyor"
          />
          <Button
            type="submit"
            size="icon"
            className="size-11 shrink-0"
            disabled={!connected || !draft.trim() || sending}
            aria-label="Send message"
          >
            <SendHorizontal className="size-4" />
          </Button>
        </form>
      </section>
    </div>
  );
}

/** Sidebar item styling: highlight the active chat, reveal actions on hover. */
function cnSidebarItem(active: boolean): string {
  return [
    "group flex items-center rounded-md text-sm",
    active
      ? "bg-primary/10 text-foreground ring-1 ring-primary/20"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  ].join(" ");
}
