// Supabase Edge Function: ai-chat
// POST { Authorization: Bearer <user JWT> }  body: { conversation_id, message }
// Streams NDJSON agent events: {"type":"delta"|"final"|"error", ...}
//
// Primary runtime for the SiteSurveyor AI chat. Works even when the office PC
// is off; the host-server /api/chat route is the offline fallback with the
// same request/response contract.

import { runAgent, type ChatTurn } from "../_shared/ai-agent.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

interface AuthUser {
  id: string;
}

async function authenticate(req: Request): Promise<AuthUser | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string };
  return user.id ? { id: user.id } : null;
}

interface ConversationRow {
  id: string;
  user_id: string;
  title: string;
  session_key: string;
}

async function rest<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: T | null }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: T | null = null;
  try {
    json = text ? (JSON.parse(text) as T) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Use POST." });
  }

  const user = await authenticate(req);
  if (!user) return json(401, { error: "Sign in to use the AI chat." });

  let body: { conversation_id?: string; message?: string };
  try {
    body = (await req.json()) as { conversation_id?: string; message?: string };
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }
  const conversationId = String(body.conversation_id ?? "");
  const message = String(body.message ?? "").trim();
  if (!conversationId || !message) {
    return json(400, { error: "conversation_id and message are required." });
  }

  // Ownership check + conversation load.
  const convRes = await rest<ConversationRow[]>(
    "GET",
    `ai_conversations?id=eq.${conversationId}&select=id,user_id,title,session_key`,
  );
  const conversation = convRes.json?.[0];
  if (!convRes.ok || !conversation) {
    return json(convRes.status === 401 ? 401 : 404, {
      error: "Conversation not found.",
    });
  }
  if (conversation.user_id !== user.id) {
    return json(403, { error: "This chat belongs to another account." });
  }

  // Persist the user turn first so history survives any failure below.
  await rest("POST", "ai_messages", {
    conversation_id: conversation.id,
    user_id: user.id,
    role: "user",
    content: message,
  });

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (conversation.title === "New chat") {
    patch.title = message.slice(0, 60);
  }
  await rest("PATCH", `ai_conversations?id=eq.${conversation.id}`, patch);

  // Load prior turns for context.
  const historyRes = await rest<
    { role: "user" | "assistant"; content: string }[]
  >(
    "GET",
    `ai_messages?conversation_id=eq.${conversation.id}&select=role,content&order=created_at.asc&limit=30`,
  );
  const priorRows = historyRes.json ?? [];
  // Drop the row we just inserted from history (it is the live turn).
  const history: ChatTurn[] = priorRows
    .slice(0, -1)
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => ({ role: row.role, content: row.content }));

  // Stream agent events as NDJSON lines.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      let finalText = "";
      try {
        for await (const event of runAgent({
          history,
          userMessage: message,
          openrouterKey: OPENROUTER_API_KEY,
          supabaseUrl: SUPABASE_URL,
          serviceKey: SERVICE_ROLE_KEY,
        })) {
          if (event.type === "final") finalText = event.text;
          send(event);
        }
        if (finalText.trim()) {
          await rest("POST", "ai_messages", {
            conversation_id: conversation.id,
            user_id: user.id,
            role: "assistant",
            content: finalText,
          });
          await rest(
            "PATCH",
            `ai_conversations?id=eq.${conversation.id}`,
            { updated_at: new Date().toISOString() },
          );
        }
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
});
