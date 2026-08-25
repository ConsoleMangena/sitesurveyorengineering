// Minimal OpenClaw Gateway WebSocket client (protocol v4).
//
// Handshake per docs.openclaw.ai/gateway/protocol:
//   1. server -> {"type":"event","event":"connect.challenge","payload":{nonce,ts}}
//   2. client -> {"type":"req","method":"connect", params:{...,auth:{token}}}
//   3. server -> res carrying hello-ok (session defaults, policy, features)
// After that: request/response frames matched by id, plus broadcast events
// ("agent" run lifecycle: status | delta | final | aborted | error).

export interface HelloOk {
  type: "hello-ok";
  protocol: number;
  server: { version: string; connId: string };
  features?: { methods?: string[]; events?: string[] };
  snapshot?: {
    sessionDefaults?: {
      defaultAgentId?: string;
      mainKey?: string;
      mainSessionKey?: string;
    };
  };
  auth?: { role?: string; scopes?: string[] };
}

export interface ChatRunEvent {
  runId: string;
  sessionKey: string;
  seq: number;
  state: "status" | "delta" | "final" | "aborted" | "error";
  phase?: string;
  deltaText?: string;
  replace?: boolean;
  message?: Record<string, unknown>;
  errorMessage?: string;
  errorKind?: string;
}

type EventListener = (event: string, payload: unknown) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: number;
}

interface Frame {
  type?: string;
  id?: string;
  ok?: boolean;
  payload?: unknown;
  error?: { code?: string; message?: string };
  event?: string;
}

export class GatewayClientError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const CONNECT_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 30_000;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private listeners = new Set<EventListener>();
  private nextId = 1;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private closedByUser = false;

  /** Resolved while a handshake is in flight; connect() awaits it. */
  private handshake: {
    resolve: (hello: HelloOk) => void;
    reject: (error: Error) => void;
    guard: number;
  } | null = null;
  private handshakePromise: Promise<HelloOk> | null = null;

  hello: HelloOk | null = null;

  private readonly url: string;
  private readonly token: string;
  private readonly onStatusChange?: (
    status: "connecting" | "connected" | "disconnected",
  ) => void;

  constructor(
    url: string,
    token: string,
    onStatusChange?: (
      status: "connecting" | "connected" | "disconnected",
    ) => void,
  ) {
    this.url = url;
    this.token = token;
    this.onStatusChange = onStatusChange;
  }

  connect(): Promise<HelloOk> {
    // Already connecting/connected on this socket — share that handshake.
    if (this.handshakePromise) return this.handshakePromise;

    this.closedByUser = false;
    this.onStatusChange?.("connecting");

    const promise = new Promise<HelloOk>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;

      const failHandshake = (error: Error) => {
        if (!this.handshake) return;
        window.clearTimeout(this.handshake.guard);
        const h = this.handshake;
        this.handshake = null;
        h.reject(error);
        reject(error);
      };

      // Total handshake budget.
      const guard = window.setTimeout(() => {
        ws.close();
        failHandshake(
          new GatewayClientError("TIMEOUT", "Gateway handshake timed out."),
        );
      }, CONNECT_TIMEOUT_MS);

      this.handshake = {
        resolve: (hello) => resolve(hello),
        reject,
        guard,
      };

      let connectReqId = "";

      ws.onmessage = (frame) => {
        let parsed: Frame;
        try {
          parsed = JSON.parse(String(frame.data)) as Frame;
        } catch {
          return;
        }

        // Pre-connect challenge: not used (backend clients skip device auth).
        if (parsed.type === "event" && parsed.event === "connect.challenge") {
          return;
        }

        // Handshake response.
        if (
          parsed.type === "res" &&
          parsed.id === connectReqId &&
          this.handshake
        ) {
          window.clearTimeout(this.handshake.guard);
          const h = this.handshake;
          this.handshake = null;
          if (parsed.ok && (parsed.payload as HelloOk)?.type === "hello-ok") {
            this.hello = parsed.payload as HelloOk;
            this.reconnectAttempts = 0;
            this.onStatusChange?.("connected");
            h.resolve(this.hello);
            resolve(this.hello);
          } else {
            const error = parsed.error as
              | { code?: string; message?: string }
              | undefined;
            h.reject(
              new GatewayClientError(
                error?.code ?? "AUTH_FAILED",
                error?.message ?? "Gateway rejected the connection.",
              ),
            );
            reject(
              new GatewayClientError(
                error?.code ?? "AUTH_FAILED",
                error?.message ?? "Gateway rejected the connection.",
              ),
            );
          }
          return;
        }

        // Normal traffic after (or during) handshake.
        if (parsed.type === "event") {
          for (const listener of this.listeners)
            listener(parsed.event ?? "", parsed.payload ?? {});
          return;
        }
        if (parsed.type === "res" && parsed.id != null) {
          const pending = this.pending.get(parsed.id);
          if (!pending) return;
          this.pending.delete(parsed.id);
          window.clearTimeout(pending.timer);
          if (parsed.ok) pending.resolve(parsed.payload ?? {});
          else
            pending.reject(
              new GatewayClientError(
                parsed.error?.code ?? "UNKNOWN",
                parsed.error?.message ?? "Gateway request failed.",
              ),
            );
        }
      };

      ws.onopen = () => {
        connectReqId = String(this.nextId++);
        ws.send(
          JSON.stringify({
            type: "req",
            id: connectReqId,
            method: "connect",
            params: {
              minProtocol: 4,
              maxProtocol: 4,
              // Trusted loopback backend clients (see gateway protocol docs)
              // may omit device identity when authenticating with the shared
              // token — required, because browsers cannot sign the challenge.
              // The Vite dev proxy strips the Origin header so the gateway
              // sees an ordinary loopback connection.
              client: {
                id: "gateway-client",
                version: "1.0.0",
                platform: "node",
                mode: "backend",
              },
              role: "operator",
              // Admin is required for session maintenance RPCs
              // (sessions.delete / sessions.reset); the loopback shared-token
              // path grants it.
              scopes: ["operator.read", "operator.write", "operator.admin"],
              caps: [],
              commands: [],
              permissions: {},
              auth: { token: this.token },
              locale:
                typeof navigator !== "undefined"
                  ? navigator.language
                  : "en-US",
              userAgent: "sitesurveyor-assistant/1.0.0",
            },
          }),
        );
      };

      ws.onerror = () =>
        failHandshake(
          new GatewayClientError(
            "CONNECT_FAILED",
            "Could not reach the OpenClaw gateway.",
          ),
        );

      ws.onclose = () => {
        this.ws = null;
        failHandshake(
          new GatewayClientError(
            "CLOSED",
            "Gateway closed the connection during handshake.",
          ),
        );
        this.onStatusChange?.("disconnected");
        this.scheduleReconnect();
      };
    });

    // The executor above ran synchronously, so the socket + guard are live.
    this.handshakePromise = promise;
    return promise;
  }

  private scheduleReconnect() {
    if (this.closedByUser || this.reconnectTimer != null) return;
    const delay = Math.min(15_000, 1_000 * 2 ** this.reconnectAttempts++);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        this.scheduleReconnect();
      });
    }, delay);
  }

  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.hello)
      throw new GatewayClientError("NOT_CONNECTED", "Gateway not connected.");
    const id = String(this.nextId++);
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new GatewayClientError("TIMEOUT", `${method} timed out.`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      ws.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    this.closedByUser = true;
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const [, pending] of this.pending) window.clearTimeout(pending.timer);
    this.pending.clear();
    this.listeners.clear();
    if (this.handshake) {
      window.clearTimeout(this.handshake.guard);
      this.handshake = null;
    }
    this.handshakePromise = null;
    this.ws?.close();
    this.ws = null;
  }
}

/** Session key for the agent's main conversation, from hello-ok snapshot. */
export function mainSessionKey(hello: HelloOk | null): string {
  const d = hello?.snapshot?.sessionDefaults;
  return d?.mainSessionKey ?? d?.mainKey ?? "main";
}

/** Tolerantly extract role + text from a chat.history transcript entry.
 *  Entries look like {role:"user"|"assistant"|"toolResult", content:[{type:"text",text}...]};
 *  thinking parts and tool results are dropped. */
export function normalizeHistoryEntry(entry: unknown): {
  role: "user" | "assistant";
  text: string;
} | null {
  if (entry == null || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const msg = e.message as Record<string, unknown> | undefined;
  const role = (typeof e.role === "string" && e.role) || msg?.role || "";
  if (role !== "user" && role !== "assistant") return null;

  const rawText = e.text ?? msg?.text ?? e.content ?? msg?.content ?? "";
  let text = "";
  if (typeof rawText === "string") {
    text = rawText;
  } else if (Array.isArray(rawText)) {
    // Content parts: keep plain-text blocks only (skip thinking/tool payloads).
    text = rawText
      .map((part) =>
        part &&
        typeof part === "object" &&
        (part as { type?: string }).type === "text"
          ? String((part as { text: unknown }).text ?? "")
          : "",
      )
      .join("");
  }
  if (!text.trim()) return null;
  return { role, text };
}
