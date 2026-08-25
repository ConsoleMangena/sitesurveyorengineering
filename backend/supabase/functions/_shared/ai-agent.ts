// SiteSurveyor AI agent core — shared by the `ai-chat` Edge Function (Deno)
// and the host-server fallback (Node). Zero external dependencies: talks to
// OpenRouter's OpenAI-compatible chat completions API with streaming +
// tool-calling, and executes tools against the platform's Supabase REST API
// with the service-role key. Never imported by browser code.
//
// Safety contract (enforced here, mirrored in the system prompt):
// - Reads are free against the whitelisted tables.
// - Writes (insert/update/delete) are whitelisted and REQUIRE the model to
//   have shown the change and received an affirmative user reply before it
//   may set confirmed=true.

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export type AgentEvent =
  | { type: "delta"; text: string }
  | { type: "final"; text: string }
  | { type: "error"; message: string }
  | { type: "status"; phase: string }
  | { type: "tool"; name: string };

export interface RunAgentOptions {
  history: ChatTurn[];
  userMessage: string;
  openrouterKey: string;
  supabaseUrl: string;
  serviceKey: string;
  maxToolRounds?: number;
}

const MODEL = "stealth/ox-alpha";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY_TURNS = 24;

/** Tables the agent may read. */
const READ_TABLES = new Set([
  "workspaces",
  "workspace_members",
  "profiles",
  "projects",
  "project_activities",
  "quotes",
  "quote_items",
  "invoices",
  "invoice_items",
  "contacts",
  "assets",
  "asset_calibrations",
  "asset_maintenance_events",
  "jobs",
  "job_events",
  "job_assignments",
  "time_entries",
  "expense_entries",
  "notifications",
  "marketplace_listings",
  "professionals",
  "market_firms",
  "market_events",
  "market_job_posts",
]);

/** Tables the agent may mutate. */
const WRITE_TABLES = new Set([
  "quotes",
  "projects",
  "contacts",
  "jobs",
  "invoices",
  "assets",
  "job_events",
]);

const FILTER_OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike"]);

interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

function filterSchema(): Record<string, unknown> {
  return {
    type: "array",
    description:
      "Optional equality/range filters combined with AND. Values are strings.",
    items: {
      type: "object",
      properties: {
        column: { type: "string" },
        op: {
          type: "string",
          enum: [...FILTER_OPS],
        },
        value: { type: "string" },
      },
      required: ["column", "op", "value"],
      additionalProperties: false,
    },
  };
}

const TOOLS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "inspect_columns",
      description:
        "List the column names of a table (from one sample row). Use when unsure which columns exist before filtering or writing.",
      parameters: {
        type: "object",
        properties: {
          table: { type: "string", enum: [...READ_TABLES] },
        },
        required: ["table"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_site_data",
      description:
        "Read rows from the SiteSurveyor platform database. Always narrow broad tables with filters or a small limit.",
      parameters: {
        type: "object",
        properties: {
          table: {
            type: "string",
            enum: [...READ_TABLES],
            description: "Table to read.",
          },
          filters: filterSchema(),
          order_by: { type: "string", description: "Column to sort by." },
          order_dir: { type: "string", enum: ["asc", "desc"] },
          limit: {
            type: "integer",
            description: "Max rows to return (default 20, max 100).",
          },
        },
        required: ["table"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "count_site_data",
      description:
        "Count rows matching optional filters. Cheaper than fetching rows — prefer this for 'how many' questions.",
      parameters: {
        type: "object",
        properties: {
          table: { type: "string", enum: [...READ_TABLES] },
          filters: filterSchema(),
        },
        required: ["table"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "insert_site_record",
      description:
        "Create one record. You MUST describe the full record to the user and receive an explicit yes BEFORE calling with confirmed=true.",
      parameters: {
        type: "object",
        properties: {
          table: { type: "string", enum: [...WRITE_TABLES] },
          record: { type: "object", description: "Column/value pairs to insert." },
          confirmed: {
            type: "boolean",
            description: "True ONLY after the user explicitly approved this exact change.",
          },
        },
        required: ["table", "record", "confirmed"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_site_record",
      description:
        "Patch one record by id. You MUST describe the exact field changes and receive an explicit yes BEFORE confirmed=true.",
      parameters: {
        type: "object",
        properties: {
          table: { type: "string", enum: [...WRITE_TABLES] },
          id: { type: "string", description: "UUID of the row." },
          patch: { type: "object", description: "Column/value pairs to change." },
          confirmed: { type: "boolean" },
        },
        required: ["table", "id", "patch", "confirmed"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_site_record",
      description:
        "Delete one record permanently. Strongly prefer status/archived updates over deletes. Requires explicit yes BEFORE confirmed=true.",
      parameters: {
        type: "object",
        properties: {
          table: { type: "string", enum: [...WRITE_TABLES] },
          id: { type: "string" },
          confirmed: { type: "boolean" },
        },
        required: ["table", "id", "confirmed"],
        additionalProperties: false,
      },
    },
  },
];

function systemPrompt(supabaseUrl: string): string {
  return [
    "You are SiteSurveyor, the AI agent of the SiteSurveyor Engineering platform -",
    "a multi-tenant survey operations product (projects, dispatching, assets,",
    "quotes, invoicing, time tracking, public market). When asked who you are,",
    "say you are SiteSurveyor. Tagline: your surveying reference point.",
    "",
    "You interact with system functionality through your tools:",
    "- Reporting & analysis across projects, quotes, invoices, payments,",
    "  contacts, assets, calibrations, maintenance, jobs/dispatch, schedule",
    "  events (job_events), assignments, time & expense entries, notifications,",
    "  and the public market (listings, professionals, firms, training).",
    "- Creating/updating records: quotes, projects, contacts, jobs, invoices,",
    "  assets (e.g. status changes), and scheduling via job_events entries.",
    "Data lives in Supabase",
    `(REST base: ${supabaseUrl}).`,
    "",
    "Rules:",
    "1. Answer questions with real numbers from count/query tools - never guess.",
    "2. Cap exploratory queries (limit <= 20) unless the user asks for more.",
    "3. Use inspect_columns first when unsure which columns exist on a table.",
    "4. Money/date formatting follows what the data uses; never invent values.",
    "5. Writes: describe the exact change first and wait for an explicit yes;",
    "   only then call the write tool with confirmed=true. Deletes: remind the",
    "   user it is permanent and prefer archiving via update when possible.",
    "6. If a tool fails, report the error verbatim; do not retry blindly.",
    "7. Keep answers compact: headline number first, then notable exceptions.",
  ].join("\n");
}

interface OutboundMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

async function supabaseFetch(
  opts: {
    supabaseUrl: string;
    serviceKey: string;
    method: "GET" | "POST" | "PATCH" | "DELETE";
    path: string;
    body?: unknown;
    preferCount?: boolean;
  },
): Promise<{ ok: boolean; status: number; json: unknown; count: number | null }> {
  const headers: Record<string, string> = {
    apikey: opts.serviceKey,
    Authorization: `Bearer ${opts.serviceKey}`,
    "Content-Type": "application/json",
  };
  if (opts.preferCount) headers.Prefer = "count=exact";
  if (opts.method !== "GET") headers.Prefer = opts.preferCount ? headers.Prefer : "return=representation";
  const res = await fetch(`${opts.supabaseUrl}/rest/v1/${opts.path}`, {
    method: opts.method,
    headers,
    body: opts.body == null ? undefined : JSON.stringify(opts.body),
  });
  let json: unknown = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  const contentRange = res.headers.get("content-range");
  let count: number | null = null;
  if (contentRange) {
    const total = contentRange.split("/")[1];
    count = total && total !== "*" ? Number(total) : null;
  }
  return { ok: res.ok, status: res.status, json, count };
}

function buildQueryPath(
  table: string,
  filters: { column: string; op: string; value: string }[] | undefined,
  orderBy: string | undefined,
  orderDir: string | undefined,
  limit: number | undefined,
): string {
  const params = new URLSearchParams();
  params.set("select", "*");
  for (const f of filters ?? []) {
    params.set(f.column, `${f.op}.${f.value}`);
  }
  if (orderBy) params.set("order", `${orderBy}${orderDir ? "." + orderDir : ""}`);
  params.set("limit", String(Math.min(Math.max(limit ?? 20, 1), 100)));
  return `${table}?${params.toString()}`;
}

function truncateRows(rows: unknown): string {
  const text = JSON.stringify(rows);
  return text.length > 12_000 ? text.slice(0, 12_000) + "...[truncated]" : text;
}

async function executeTool(
  name: string,
  rawArgs: string,
  ctx: { supabaseUrl: string; serviceKey: string },
): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs || "{}") as Record<string, unknown>;
  } catch {
    return JSON.stringify({ error: "Invalid JSON arguments." });
  }

  const str = (v: unknown) => (typeof v === "string" ? v : "");

  if (name === "inspect_columns") {
    const table = str(args.table);
    if (!READ_TABLES.has(table)) return JSON.stringify({ error: `Table '${table}' is not readable.` });
    const out = await supabaseFetch({
      ...ctx,
      method: "GET",
      path: `${table}?select=*&limit=1`,
    });
    if (!out.ok) return JSON.stringify({ error: `HTTP ${out.status}`, details: out.json });
    const row = Array.isArray(out.json) ? out.json[0] : null;
    return JSON.stringify({ table, columns: row ? Object.keys(row) : [] });
  }

  if (name === "query_site_data" || name === "count_site_data") {
    const table = str(args.table);
    if (!READ_TABLES.has(table)) return JSON.stringify({ error: `Table '${table}' is not readable.` });
    const filters = Array.isArray(args.filters)
      ? (args.filters as { column?: unknown; op?: unknown; value?: unknown }[])
          .filter((f) => typeof f.column === "string" && typeof f.op === "string" && FILTER_OPS.has(String(f.op)))
          .map((f) => ({ column: String(f.column), op: String(f.op), value: String(f.value ?? "") }))
      : undefined;
    if (name === "count_site_data") {
      const path = buildQueryPath(table, filters, undefined, undefined, 1);
      const out = await supabaseFetch({ ...ctx, method: "GET", path, preferCount: true });
      if (!out.ok) return JSON.stringify({ error: `HTTP ${out.status}`, details: out.json });
      return JSON.stringify({ table, count: out.count });
    }
    const path = buildQueryPath(
      table,
      filters,
      args.order_by == null ? undefined : str(args.order_by),
      str(args.order_dir) || undefined,
      typeof args.limit === "number" ? args.limit : undefined,
    );
    const out = await supabaseFetch({ ...ctx, method: "GET", path });
    if (!out.ok) return JSON.stringify({ error: `HTTP ${out.status}`, details: out.json });
    return truncateRows(out.json);
  }

  const table = str(args.table);
  const confirmed = args.confirmed === true;

  if (!WRITE_TABLES.has(table)) return JSON.stringify({ error: `Table '${table}' is not writable.` });

  if (name === "insert_site_record") {
    if (!confirmed)
      return JSON.stringify({
        status: "pending_confirmation",
        instruction:
          "Do NOT call again yet. Show this record to the user and ask for an explicit yes. Only set confirmed=true after they approve.",
        table,
        record: args.record ?? {},
      });
    const out = await supabaseFetch({ ...ctx, method: "POST", path: table, body: args.record ?? {} });
    if (!out.ok) return JSON.stringify({ error: `HTTP ${out.status}`, details: out.json });
    return JSON.stringify({ inserted: out.json });
  }

  const id = str(args.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return JSON.stringify({ error: "A valid UUID id is required." });

  if (name === "update_site_record") {
    if (!confirmed)
      return JSON.stringify({
        status: "pending_confirmation",
        instruction: "Show these exact changes and get an explicit yes before confirmed=true.",
        table,
        id,
        patch: args.patch ?? {},
      });
    const out = await supabaseFetch({
      ...ctx,
      method: "PATCH",
      path: `${table}?id=eq.${id}`,
      body: args.patch ?? {},
    });
    if (!out.ok) return JSON.stringify({ error: `HTTP ${out.status}`, details: out.json });
    return JSON.stringify({ updated: out.json });
  }

  if (name === "delete_site_record") {
    if (!confirmed)
      return JSON.stringify({
        status: "pending_confirmation",
        instruction:
          "Deletes are permanent. Confirm scope with the user and suggest archiving instead when sensible. Only then confirmed=true.",
        table,
        id,
      });
    const out = await supabaseFetch({ ...ctx, method: "DELETE", path: `${table}?id=eq.${id}` });
    if (!out.ok) return JSON.stringify({ error: `HTTP ${out.status}`, details: out.json });
    return JSON.stringify({ deleted: true });
  }

  return JSON.stringify({ error: `Unknown tool '${name}'.` });
}

/** Minimal SSE line reader over a fetch body (works on Deno and Node 18+). */
async function* sseEvents(res: Response): AsyncGenerator<{ data: string }> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.startsWith("data:")) yield { data: line.slice(5).trim() };
    }
  }
}

interface UpstreamChoice {
  delta?: {
    content?: string | null;
    tool_calls?: {
      index: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }[];
  };
  finish_reason?: string | null;
}

/**
 * Runs the agent loop and yields delta/final/error events.
 * final always carries the complete reply text.
 */
export async function* runAgent(opts: RunAgentOptions): AsyncGenerator<AgentEvent> {
  const ctx = { supabaseUrl: opts.supabaseUrl.replace(/\/$/, ""), serviceKey: opts.serviceKey };
  const outbound: OutboundMessage[] = [
    { role: "system", content: systemPrompt(ctx.supabaseUrl) },
    ...opts.history.slice(-MAX_HISTORY_TURNS),
    { role: "user", content: opts.userMessage },
  ];

  let round = 0;
  while (round < (opts.maxToolRounds ?? MAX_TOOL_ROUNDS)) {
    round += 1;
    if (round === 1) yield { type: "status", phase: "thinking" };
    let res: Response;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: "POST",
        signal: opts.signal,
        headers: {
          Authorization: `Bearer ${opts.openrouterKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://sitesurveyor.app",
          "X-Title": "SiteSurveyor AI",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: outbound,
          tools: TOOLS,
          stream: true,
        }),
      });
    } catch (err) {
      yield { type: "error", message: `Could not reach OpenRouter: ${(err as Error).message}` };
      return;
    }

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      yield {
        type: "error",
        message: `OpenRouter error ${res.status}: ${detail.slice(0, 300) || "no response"}`,
      };
      return;
    }

    let content = "";
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    let finishReason: string | null = null;

    try {
      for await (const evt of sseEvents(res)) {
        if (evt.data === "[DONE]") break;
        let parsed: { choices?: UpstreamChoice[] };
        try {
          parsed = JSON.parse(evt.data) as { choices?: UpstreamChoice[] };
        } catch {
          continue;
        }
        const choice = parsed.choices?.[0];
        if (!choice) continue;
        if (choice.delta?.content) {
          content += choice.delta.content;
          yield { type: "delta", text: choice.delta.content };
        }
        for (const tc of choice.delta?.tool_calls ?? []) {
          const slot = toolCalls.get(tc.index) ?? { id: "", name: "", arguments: "" };
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name = tc.function.name;
          if (tc.function?.arguments) slot.arguments += tc.function.arguments;
          toolCalls.set(tc.index, slot);
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
    } catch (err) {
      yield { type: "error", message: `Stream failed: ${(err as Error).message}` };
      return;
    }

    if (finishReason === "tool_calls" && toolCalls.size > 0) {
      outbound.push({
        role: "assistant",
        content: content || null,
        ...(toolCalls.size > 0
          ? {
              tool_calls: [...toolCalls.values()].map((tc) => ({
                id: tc.id || `call_${tc.name}_${tc.index ?? 0}`,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.arguments || "{}" },
              })),
            }
          : {}),
      });
      for (const [, tc] of [...toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
        yield { type: "tool", name: tc.name };
        let result: string;
        try {
          result = await executeTool(tc.name, tc.arguments, ctx);
        } catch (err) {
          result = JSON.stringify({ error: `Tool crashed: ${(err as Error).message}` });
        }
        outbound.push({
          role: "tool",
          tool_call_id: tc.id || `call_${tc.name}_${tc.index ?? 0}`,
          content: result,
        });
      }
      continue; // next model round with tool results
    }

    // Plain final answer.
    yield { type: "final", text: content.trim() };
    return;
  }

  yield {
    type: "error",
    message: "The agent ran out of tool rounds before producing a final answer.",
  };
}
