import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, RefreshCw, SendHorizontal, Sparkles } from "lucide-react";

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

// Dedicated gateway session for this app — keeps assistant traffic isolated
// from the CLI / Control UI / heartbeat usage of the shared "main" session.
const ASSISTANT_SESSION_KEY = "agent:main:sitesurveyor-assistant";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
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

let messageIdCounter = 0;
function nextMessageId(): string {
  messageIdCounter += 1;
  return `m${Date.now()}-${messageIdCounter}`;
}

export default function AssistantPage() {
  const clientRef = useRef<GatewayClient | null>(null);
  const sessionKeyRef = useRef<string>("main");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
  }, []);

  /** Streams assistant output into a live message bubble keyed by runId. */
  const applyRunEvent = useCallback(
    (runEvent: ChatRunEvent) => {
      if (runEvent.sessionKey !== sessionKeyRef.current) return;
      if (runEvent.state === "delta") {
        const delta = runEvent.deltaText ?? "";
        setMessages((prev) => {
          const existing = prev.find((m) => m.id === runEvent.runId);
          if (!existing)
            return [
              ...prev,
              {
                id: runEvent.runId,
                role: "assistant",
                text: delta,
                streaming: true,
              },
            ];
          const text = runEvent.replace ? delta : existing.text + delta;
          return prev.map((m) =>
            m.id === runEvent.runId ? { ...m, text } : m,
          );
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
    },
    [],
  );

  const loadHistory = useCallback(async () => {
    try {
      const result = await clientRef.current?.request<{
        messages?: unknown[];
      }>("chat.history", {
        sessionKey: sessionKeyRef.current,
        limit: 50,
      });
      const entries = Array.isArray(result?.messages) ? result.messages : [];
      const normalized = entries
        .map(normalizeHistoryEntry)
        .filter((e): e is { role: "user" | "assistant"; text: string } => e !== null)
        .slice(-50)
        .map((entry) => ({
          id: nextMessageId(),
          role: entry.role,
          text: entry.text,
        }));
      setMessages(normalized);
      scrollToBottom();
    } catch {
      // History is best-effort; an empty transcript is fine.
    }
  }, [scrollToBottom]);

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

      const connect = async () => {
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
          sessionKeyRef.current = ASSISTANT_SESSION_KEY;
          // Visible assistant text streams on the "chat" event family
          // (deltaText + cumulative message snapshot); "agent" carries run
          // lifecycle. Subscribe to both.
          unsubEvents = client.onEvent((event, payload) => {
            if (event === "chat" || event === "agent")
              applyRunEvent(payload as ChatRunEvent);
          });
          await loadHistory();
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

      void connect();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(clear);
      unsubEvents?.();
    };
  }, [applyRunEvent, loadHistory]);

  useEffect(() => () => clientRef.current?.close(), []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || status !== "connected") return;
    setDraft("");
    setSending(true);
    setError(null);
    const userMessage: ChatMessage = {
      id: nextMessageId(),
      role: "user",
      text,
    };
    setMessages((prev) => [...prev, userMessage]);
    scrollToBottom();
    try {
      await clientRef.current?.request("chat.send", {
        sessionKey: sessionKeyRef.current,
        message: text,
        idempotencyKey: nextMessageId(),
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
  }, [draft, sending, status, scrollToBottom]);

  const connected = status === "connected";

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Bot className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-foreground">AI Assistant</h1>
            <p className="text-xs text-muted-foreground">
              OpenClaw agent — reads and acts on your workspace data
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
        className="min-h-[320px] flex-1 overflow-y-auto rounded-lg border border-border/60 bg-card p-4"
      >
        {messages.length === 0 && connected ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="size-6" />
            </span>
            <div className="max-w-sm space-y-1.5">
              <p className="font-medium text-card-foreground">
                Ask about anything in your workspace
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
              ? "Tell the agent what to do…"
              : "Waiting for the OpenClaw gateway…"
          }
          disabled={!connected}
          className="h-11 flex-1"
          aria-label="Message the AI assistant"
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
    </div>
  );
}
