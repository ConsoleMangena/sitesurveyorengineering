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
import { getCurrentUser } from "../../lib/auth/session.ts";
import type { User } from "@supabase/supabase-js";
import {
  createAiConversation,
  deleteAiConversation,
  insertAiMessage,
  insertAiMessages,
  listAiConversations,
  listAiMessages,
  renameAiConversation,
  touchAiConversation,
  type AiConversation,
} from "../../lib/repositories/aiChats.ts";
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

/** Gateway session keys are namespaced per signed-in account, so OpenClaw's
 *  transcripts and memory isolate between users automatically. */
function sessionPrefix(userId: string): string {
  return `agent:main:ssai-${userId.replace(/-/g, "").slice(0, 12)}-`;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
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
  const activeKeyRef = useRef<string | null>(null);
  /** sessionKey -> conversation id, for persisting runs on background chats. */
  const conversationIdByKeyRef = useRef<Map<string, string>>(new Map());
  /** Accumulated delta text per runId, used when a final arrives snapshot-less. */
  const runTextRef = useRef<Map<string, string>>(new Map());

  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
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
    // Persist finished runs for ANY of this account's chats — even ones
    // currently scrolled away in the sidebar.
    if (
      runEvent.state === "final" ||
      runEvent.state === "error" ||
      runEvent.state === "aborted"
    ) {
      const snapshot = messageText(runEvent.message).trim();
      const accumulated =
        runTextRef.current.get(runEvent.runId)?.trim() ?? "";
      const conversationId = conversationIdByKeyRef.current.get(
        runEvent.sessionKey,
      );
      if (conversationId && runEvent.state === "final") {
        const text = snapshot || accumulated;
        if (text)
          insertAiMessage(conversationId, "assistant", text).catch((err) =>
            console.error("Failed to save assistant reply", err),
          );
        void touchAiConversation(conversationId).catch(() => {});
      }
      if (runEvent.sessionKey !== activeKeyRef.current) return;
      runTextRef.current.delete(runEvent.runId);
      setSending(false);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === runEvent.runId
            ? {
                ...m,
                streaming: false,
                // Prefer the gateway's cumulative snapshot; keep deltas if absent.
                text: snapshot || m.text,
              }
            : m,
        ),
      );
      if (runEvent.state === "error") {
        setError(runEvent.errorMessage ?? "The assistant run failed.");
      }
      return;
    }

    if (!activeKeyRef.current || runEvent.sessionKey !== activeKeyRef.current)
      return;
    if (runEvent.state === "delta") {
      const delta = runEvent.deltaText ?? "";
      const existingEntry = runTextRef.current.get(runEvent.runId);
      runTextRef.current.set(
        runEvent.runId,
        runEvent.replace ? delta : (existingEntry ?? "") + delta,
      );
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
    }
  }, []);

  const loadConversations = useCallback(async (): Promise<AiConversation[]> => {
    try {
      const rows = await listAiConversations();
      setConversations(rows);
      conversationIdByKeyRef.current = new Map(
        rows.map((row) => [row.session_key, row.id]),
      );
      return rows;
    } catch (err) {
      console.error("Failed to load AI conversations", err);
      return [];
    }
  }, []);

  const loadHistory = useCallback(
    async (conversation: AiConversation) => {
      try {
        const dbMessages = await listAiMessages(conversation.id);
        if (dbMessages.length > 0) {
          setMessages(
            dbMessages.map((m) => ({
              id: nextId("h"),
              role: m.role,
              text: m.content,
            })),
          );
          scrollToBottom();
          return;
        }
        // First open since the DB mirror landed: pull the transcript from the
        // gateway and backfill the account storage.
        const result = await clientRef.current?.request<{
          messages?: unknown[];
        }>("chat.history", { sessionKey: conversation.session_key, limit: 50 });
        const entries = Array.isArray(result?.messages) ? result.messages : [];
        const normalized = entries
          .map(normalizeHistoryEntry)
          .filter(
            (e): e is { role: "user" | "assistant"; text: string } => e !== null,
          )
          .slice(-50);
        setMessages(
          normalized.map((entry) => ({
            id: nextId("h"),
            role: entry.role,
            text: entry.text,
          })),
        );
        scrollToBottom();
        if (normalized.length > 0) {
          insertAiMessages(conversation.id, normalized).catch(() => {});
        }
      } catch {
        setMessages([]);
      }
    },
    [scrollToBottom],
  );

  const selectConversation = useCallback(
    (conversation: AiConversation | null) => {
      setActiveKey(conversation?.session_key ?? null);
      activeKeyRef.current = conversation?.session_key ?? null;
      if (conversation) {
        void loadHistory(conversation);
      } else {
        setMessages([]);
      }
      setSidebarOpen(false);
    },
    [loadHistory],
  );

  const createConversation = useCallback(
    async (userId: string) => {
      const client = clientRef.current;
      const suffix =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID().slice(0, 8)
          : Math.random().toString(36).slice(2, 10);
      const key = `${sessionPrefix(userId)}${suffix}`;
      let conversation: AiConversation | null = null;
      try {
        conversation = await createAiConversation(key, "New chat");
      } catch (err) {
        console.error("Failed to create conversation row", err);
        setError("Failed to create the chat in your account.");
        return null;
      }
      // Mirror the session entry onto the gateway (best-effort; chat.send
      // materialises it anyway).
      void client?.request("sessions.create", { key }).catch(() => {});
      await loadConversations();
      selectConversation(conversation);
      return conversation;
    },
    [loadConversations, selectConversation],
  );

  const deleteConversation = useCallback(
    async (conversation: AiConversation) => {
      if (!window.confirm("Delete this chat? This cannot be undone.")) return;
      try {
        // Wipe the gateway transcript, then the account copy.
        await clientRef.current?.request("sessions.delete", {
          key: conversation.session_key,
          deleteTranscript: true,
        });
      } catch {
        // Transcript cleanup is best-effort; the account row must still go.
      }
      try {
        await deleteAiConversation(conversation.id);
      } catch {
        setError("Failed to delete the chat from your account.");
      }
      const remaining = await loadConversations();
      if (activeKeyRef.current === conversation.session_key) {
        selectConversation(remaining[0] ?? null);
      }
    },
    [loadConversations, selectConversation],
  );

  const renameConversation = useCallback(
    async (conversation: AiConversation, title: string, silent = false) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      setConversations((prev) =>
        prev.map((c) => (c.id === conversation.id ? { ...c, title: trimmed } : c)),
      );
      try {
        await renameAiConversation(conversation.id, trimmed);
      } catch (err) {
        console.error("Failed to rename chat", err);
        if (!silent) setError("Failed to rename the chat.");
      }
      setRenamingId(null);
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

          const user: User | null = await getCurrentUser();
          if (!user) {
            setError("Sign in to see your chats.");
            return;
          }
          const existing = await loadConversations();
          if (cancelled) return;
          if (existing.length > 0) {
            selectConversation(existing[0]);
          } else {
            await createConversation(user.id);
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
    const conversation = conversations.find((c) => c.session_key === sessionKey);
    setDraft("");
    setSending(true);
    setError(null);
    setMessages((prev) => [
      ...prev,
      { id: nextId("u"), role: "user", text },
    ]);
    scrollToBottom();
    try {
      if (conversation) {
        // Persist the user turn first so history survives anything.
        insertAiMessage(conversation.id, "user", text).catch((err) =>
          console.error("Failed to save message", err),
        );
        void touchAiConversation(conversation.id).catch(() => {});
        if (conversation.title === "New chat") {
          void renameConversation(conversation, text.slice(0, 60), true);
        }
        setConversations((prev) =>
          [...prev]
            .map((c) =>
              c.id === conversation.id
                ? { ...c, updated_at: new Date().toISOString() }
                : c,
            )
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
        );
      }
      await clientRef.current?.request("chat.send", {
        sessionKey,
        message: text,
        idempotencyKey: nextId("i"),
        deliver: false,
      });
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

  const startRename = useCallback((conversation: AiConversation) => {
    setRenamingId(conversation.id);
    setRenameDraft(conversation.title === "New chat" ? "" : conversation.title);
    setSidebarOpen(false);
  }, []);

  const submitRename = useCallback(() => {
    const conversation = conversations.find((c) => c.id === renamingId);
    if (conversation && renameDraft.trim())
      void renameConversation(conversation, renameDraft);
    else setRenamingId(null);
  }, [conversations, renamingId, renameDraft, renameConversation]);

  const conversationList = (
    <div className="flex h-full min-h-0 flex-col">
      <Button
        onClick={() => {
          setSidebarOpen(false);
          void getCurrentUser().then((user) => {
            if (user?.id) void createConversation(user.id);
          });
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
          const isActive = conversation.session_key === activeKey;
          const isRenaming = renamingId === conversation.id;
          return (
            <div
              key={conversation.id}
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
                      if (e.key === "Escape") setRenamingId(null);
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
                    onClick={() => setRenamingId(null)}
                  >
                    <X className="size-3.5" />
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => selectConversation(conversation)}
                    className="min-w-0 flex-1 truncate px-2 py-2 text-left text-sm"
                    title={conversation.title}
                  >
                    {conversation.title}
                  </button>
                  <span className="flex shrink-0 items-center gap-0.5 pr-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      type="button"
                      aria-label={`Rename "${conversation.title}"`}
                      className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                      onClick={() => startRename(conversation)}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete "${conversation.title}"`}
                      className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => void deleteConversation(conversation)}
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
                  The agent can query projects, invoices, quotes, assets and the
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
