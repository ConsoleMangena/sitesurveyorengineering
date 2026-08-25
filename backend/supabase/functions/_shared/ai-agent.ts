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
  /** The signed-in user's primary workspace — stamped onto business writes. */
  workspaceId?: string;
  /** Project the user has open in the CAD workspace, if any. */
  projectId?: string;
  /** Optional abort signal so callers can cancel an in-flight agent run. */
  signal?: AbortSignal;
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
  "project_cad_drawings",
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

const CAD_ENTITY_ARRAYS: Record<string, string> = {
  point: "points",
  linework: "linework",
  text: "texts",
  circle: "circles",
  arc: "arcs",
  ellipse: "ellipses",
  hatch: "hatches",
  dimension: "dimensions",
  surface: "surfaces",
};

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
  {
    type: "function",
    function: {
      name: "get_cad_drawing",
      description:
        "Fetch the full CAD drawing model for a project. Returns the JSONB model containing layers, points, linework, texts, circles, arcs, ellipses, hatches, dimensions, and surfaces arrays. Use this to understand what is currently drawn.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "UUID of the project." },
        },
        required: ["project_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_cad_layers",
      description:
        "List all layers in a project's CAD drawing with their colours, visibility, lock status, and entity counts per layer.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "UUID of the project." },
        },
        required: ["project_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "count_cad_entities",
      description:
        "Count entities in a project's CAD drawing, optionally filtered by layer and/or entity type. Returns a total plus per-type counts.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "UUID of the project." },
          layer_id: {
            type: "string",
            description: "Optional layer UUID — count only entities on this layer.",
          },
          entity_type: {
            type: "string",
            enum: [
              "point",
              "linework",
              "text",
              "circle",
              "arc",
              "ellipse",
              "hatch",
              "dimension",
              "surface",
            ],
            description: "Optional entity type to count.",
          },
        },
        required: ["project_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "inspect_cad_entity",
      description:
        "Fetch one entity from a project's CAD drawing by its UUID. Returns the entity type and its full properties.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "UUID of the project." },
          entity_id: { type: "string", description: "UUID of the entity to inspect." },
        },
        required: ["project_id", "entity_id"],
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
    "- Creating/updating records: quotes (+ quote_items lines), projects,",
    "  contacts, jobs, invoices, assets (e.g. status changes), and scheduling",
    "  via job_events entries.",
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
    "",
    "CAD INTEGRATION — READING:",
    "Use get_cad_drawing to fetch the full model for a project.",
    "Use list_cad_layers to see layers with entity counts.",
    "Use count_cad_entities for totals (filterable by layer/type).",
    "Use inspect_cad_entity for a single entity's full properties.",
    "Model arrays: points (pointNo, n, e, z, code, layerId), linework",
    "(kind=line|polyline|boundary, vertices[]), texts (text, n, e, height,",
    "rotation), circles (center{n,e}, radius), arcs (center, radius,",
    "startAngle°, endAngle°), ellipses (semiMajor/Minor, rotation), hatches",
    "(vertices, holes), dimensions (kind, defPoints), surfaces (points,",
    "triangles).",
    "",
    "CAD INTEGRATION — WRITING:",
    "When the user asks you to DRAW, CREATE, or ADD geometry, output commands",
    "inside a [CAD] ... [/CAD] block, one command per line:",
    "  POINT <n> <e> [z] [code=CODE] [layer=LAYER]",
    "  LINE <n1>,<e1> <n2>,<e2> ... [closed] [layer=LAYER]",
    "  (2 vertices = simple line)",
    '  TEXT <n> <e> "content" [h=height] [rot=degrees] [layer=LAYER]',
    "  CIRCLE <cn>,<ce> <radius> [layer=LAYER]",
    "  ARC <cn>,<ce> <radius> <start_deg> <end_deg> [layer=LAYER]",
    "  LAYER CREATE <name> [color=#hex]",
    "  ZOOM EXTENTS",
    "Coordinates are Northing,Eastings. Prefer existing layers; create new ones",
    "only when needed. Example: [CAD]",
    "POINT 501234 2845678 code=CP1 layer=CONTROL",
    "LINE 501234,2845678 501240,2845680",
    "[/CAD]",
  ].join("\n");
}

// ── Live schema awareness ─────────────────────────────────────────────────
// Fetched once per runtime from PostgREST's OpenAPI root so the model sees
// REAL column names for whitelisted tables instead of guessing. Cached
// module-level; a failed fetch simply omits the section.

interface TableSchemaInfo {
  columns: string[]; // column names
  required: string[];
  hasWorkspaceId: boolean;
}

const schemaCache = new Map<string, Promise<Map<string, TableSchemaInfo>>>();

function loadTableSchemas(
  supabaseUrl: string,
  serviceKey: string,
): Promise<Map<string, TableSchemaInfo>> {
  const cached = schemaCache.get(supabaseUrl);
  if (cached) return cached;
  const promise = (async () => {
    const map = new Map<string, TableSchemaInfo>();
    try {
      const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      if (!res.ok) return map;
      const api = (await res.json()) as {
        definitions?: Record<
          string,
          {
            properties?: Record<string, Record<string, unknown>>;
            required?: string[];
          }
        >;
      };
      for (const table of new Set([...READ_TABLES, ...WRITE_TABLES])) {
        const def = api.definitions?.[table];
        if (!def?.properties) continue;
        const columns = Object.keys(def.properties);
        map.set(table, {
          columns,
          required: def.required ?? [],
          hasWorkspaceId: columns.includes("workspace_id"),
        });
      }
    } catch {
      // Schema awareness is best-effort.
    }
    return map;
  })();
  schemaCache.set(supabaseUrl, promise);
  return promise;
}

function schemaSection(schemas: Map<string, TableSchemaInfo>): string {
  const lines: string[] = ["", "REAL TABLE COLUMNS (use exactly these names):"];
  for (const [table, info] of schemas) {
    const marker = WRITE_TABLES.has(table) ? " [writable]" : "";
    const req = info.required.filter((c) => c !== "id" && c !== "created_at" && c !== "updated_at");
    lines.push(
      `- ${table}${marker}: ${info.columns.join(", ")}` +
        (req.length ? ` | required: ${req.join(", ")}` : ""),
    );
  }
  return lines.join("\n");
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
  ctx: {
    supabaseUrl: string;
    serviceKey: string;
    workspaceId?: string;
    schemas: Map<string, TableSchemaInfo>;
  },
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

  if (
    name === "get_cad_drawing" ||
    name === "list_cad_layers" ||
    name === "count_cad_entities" ||
    name === "inspect_cad_entity"
  ) {
    const uuidRe = /^[0-9a-f-]{36}$/i;
    const projectId = str(args.project_id);
    if (!uuidRe.test(projectId))
      return JSON.stringify({ error: "A valid project_id UUID is required." });
    for (const key of ["layer_id", "entity_id"]) {
      const value = args[key];
      if (value != null && !uuidRe.test(str(value)))
        return JSON.stringify({ error: `A valid ${key} UUID is required.` });
    }
    const out = await supabaseFetch({
      ...ctx,
      method: "GET",
      path: `project_cad_drawings?project_id=eq.${projectId}&select=model`,
    });
    if (!out.ok) return JSON.stringify({ error: `HTTP ${out.status}`, details: out.json });
    const rows = Array.isArray(out.json) ? out.json : [];
    if (rows.length === 0)
      return JSON.stringify({ error: "No drawing found for this project." });
    const row = rows[0] as { model?: unknown };

    if (name === "get_cad_drawing") return JSON.stringify({ model: row.model });

    const model =
      row.model && typeof row.model === "object" ? (row.model as Record<string, unknown>) : {};
    const arr = (key: string): Record<string, unknown>[] =>
      Array.isArray(model[key]) ? (model[key] as Record<string, unknown>[]) : [];

    if (name === "list_cad_layers") {
      const counts = new Map<string, number>();
      for (const plural of Object.values(CAD_ENTITY_ARRAYS)) {
        for (const entity of arr(plural)) {
          const layerId = entity.layerId;
          if (typeof layerId === "string")
            counts.set(layerId, (counts.get(layerId) ?? 0) + 1);
        }
      }
      return JSON.stringify({
        layers: arr("layers").map((layer) => ({
          id: layer.id,
          name: layer.name,
          color: layer.color,
          visible: layer.visible,
          locked: layer.locked,
          entity_count:
            counts.get(typeof layer.id === "string" ? layer.id : "") ?? 0,
        })),
      });
    }

    if (name === "count_cad_entities") {
      const layerFilter = str(args.layer_id) || undefined;
      const typeFilter = str(args.entity_type) || undefined;
      if (typeFilter && !(typeFilter in CAD_ENTITY_ARRAYS))
        return JSON.stringify({
          error: `Unknown entity_type '${typeFilter}'. Valid types: ${Object.keys(CAD_ENTITY_ARRAYS).join(", ")}.`,
        });
      const byType: Record<string, number> = {};
      let total = 0;
      for (const [singular, plural] of Object.entries(CAD_ENTITY_ARRAYS)) {
        if (typeFilter && singular !== typeFilter) continue;
        const entities = arr(plural);
        const n = layerFilter
          ? entities.filter((e) => e.layerId === layerFilter).length
          : entities.length;
        byType[singular] = n;
        total += n;
      }
      return JSON.stringify({
        total,
        by_type: byType,
        layer_filter: layerFilter ?? null,
        type_filter: typeFilter ?? null,
      });
    }

    const entityId = str(args.entity_id);
    for (const [singular, plural] of Object.entries(CAD_ENTITY_ARRAYS)) {
      const found = arr(plural).find((e) => e.id === entityId);
      if (found) return JSON.stringify({ entity_type: singular, entity: found });
    }
    return JSON.stringify({ error: "Entity not found" });
  }

  const table = str(args.table);
  const confirmed = args.confirmed === true;

  if (!WRITE_TABLES.has(table)) return JSON.stringify({ error: `Table '${table}' is not writable.` });

  // Sanitise payloads against the live schema: drop unknown columns (the
  // model is told which were dropped) and stamp the caller's workspace.
  const schema = ctx.schemas.get(table);
  const sanitise = (
    payload: Record<string, unknown> | undefined,
  ): { clean: Record<string, unknown>; dropped: string[] } => {
    const input = { ...(payload ?? {}) };
    const dropped: string[] = [];
    let clean = input;
    if (schema) {
      clean = {};
      for (const [key, value] of Object.entries(input)) {
        if (key === "id" || key === "created_at" || key === "updated_at") continue;
        if (schema.columns.includes(key)) clean[key] = value;
        else dropped.push(key);
      }
    }
    if (ctx.workspaceId && (!schema || schema.hasWorkspaceId)) {
      if (clean.workspace_id == null) clean.workspace_id = ctx.workspaceId;
    }
    return { clean, dropped };
  };

  if (name === "insert_site_record") {
    const { clean, dropped } = sanitise(args.record as Record<string, unknown>);
    if (!confirmed)
      return JSON.stringify({
        status: "pending_confirmation",
        instruction:
          "Do NOT call again yet. Show this record to the user and ask for an explicit yes. Only set confirmed=true after they approve.",
        table,
        record: clean,
        ...(dropped.length ? { ignored_unknown_columns: dropped } : {}),
      });
    const out = await supabaseFetch({ ...ctx, method: "POST", path: table, body: clean });
    if (!out.ok)
      return JSON.stringify({
        error: `HTTP ${out.status}`,
        details: out.json,
        hint: schema
          ? `Valid columns for ${table}: ${schema.columns.join(", ")}`
          : undefined,
      });
    return JSON.stringify({ inserted: out.json });
  }

  const id = str(args.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return JSON.stringify({ error: "A valid UUID id is required." });

  if (name === "update_site_record") {
    const { clean, dropped } = sanitise(args.patch as Record<string, unknown>);
    if (!confirmed)
      return JSON.stringify({
        status: "pending_confirmation",
        instruction: "Show these exact changes and get an explicit yes before confirmed=true.",
        table,
        id,
        patch: clean,
        ...(dropped.length ? { ignored_unknown_columns: dropped } : {}),
      });
    const out = await supabaseFetch({
      ...ctx,
      method: "PATCH",
      path: `${table}?id=eq.${id}`,
      body: clean,
    });
    if (!out.ok)
      return JSON.stringify({
        error: `HTTP ${out.status}`,
        details: out.json,
        hint: schema
          ? `Valid columns for ${table}: ${schema.columns.join(", ")}`
          : undefined,
      });
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
  const supabaseUrl = opts.supabaseUrl.replace(/\/$/, "");
  const schemas = await loadTableSchemas(supabaseUrl, opts.serviceKey);
  const ctx = {
    supabaseUrl,
    serviceKey: opts.serviceKey,
    workspaceId: opts.workspaceId,
    schemas,
  };
  const system =
    systemPrompt(supabaseUrl) +
    "\n" +
    schemaSection(schemas) +
    (opts.workspaceId
      ? `\nWhen creating or updating business records, ALWAYS set workspace_id to "${opts.workspaceId}" unless the user explicitly names another workspace.`
      : "") +
    (opts.projectId
      ? `\nThe user currently has project ${opts.projectId} open in the CAD workspace.`
      : "");

  const outbound: OutboundMessage[] = [
    { role: "system", content: system },
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
    const toolCalls = new Map<
      number,
      { id: string; name: string; arguments: string; index: number }
    >();
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
          const slot =
            toolCalls.get(tc.index) ??
            { id: "", name: "", arguments: "", index: tc.index };
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
