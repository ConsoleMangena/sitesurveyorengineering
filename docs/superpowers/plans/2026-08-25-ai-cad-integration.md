# AI ↔ CAD Engine Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the SiteSurveyor AI agent to read the live CAD drawing state and execute drawing commands (points, linework, text, hatches, layers, zoom) with user confirmation before execution.

**Architecture:** Two-layer design. Server-side tools read the `project_cad_drawings` JSONB model from Supabase (works for any project, no client connection needed). Client-side executor parses structured `[CAD]` command blocks from AI responses and calls `UseCadModel` CRUD methods directly against the live drawing. User confirms each batch before execution.

**Tech Stack:** TypeScript, react-markdown (already installed), UseCadModel hook (React custom hook with useState/useRef), Supabase REST for DB reads.

## Global Constraints

- Lint baseline: 2 warnings (map.tsx:390, CadPlotDialog:164)
- Uncommitted files: ProfilePortfolioTemplate.tsx, CadPlotDialog.tsx, professionals.ts, opencode.json — do NOT touch
- ESLint `react-hooks/set-state-in-effect`: defer sync setState via `window.setTimeout(() => setState(...), 0)` + cancelled-flag cleanup
- ai-agent.ts is zero-dependency (Deno + Node compatible) — no npm imports
- Verify ritual: typecheck, lint, 320 tests, build, detector (`node "C:/Users/THINKPAD/.agents/skills/impeccable/scripts/detect.mjs" --json <paths>` — forward slashes)
- CAD workspace is desktop-only (`isCadPlatformSupported()`) and lives inside `ProjectHubPage` as a sub-view

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `backend/supabase/functions/_shared/ai-agent.ts` | Modify | Add 4 CAD read tools, update READ_TABLES, add CAD system prompt section |
| `frontend/src/features/projects/components/cad/cadAiExecutor.ts` | Create | Parse `[CAD]` command blocks and execute against UseCadModel |
| `frontend/src/features/projects/components/cad/cadAiExecutor.test.ts` | Create | Unit tests for command parser + executor |
| `frontend/src/features/projects/components/cad/CadCommandBridge.tsx` | Create | UI: watches AI messages for `[CAD]` blocks, shows preview, Execute button |
| `frontend/src/features/projects/components/cad/CadChatPanel.tsx` | Create | Wrapper: embeds AssistantPage inside CAD workspace with context |
| `frontend/src/features/projects/components/CadWorkspace.tsx` | Modify | Mount CadChatPanel when AI toggle is active |
| `frontend/src/features/projects/components/cad/CadRightPanel.tsx` | Modify | Add "AI Assistant" toggle button |
| `frontend/src/pages/shared/AssistantPage.tsx` | Modify | Accept optional `contextProjectId` prop, add CAD activity labels |
| `frontend/src/lib/repositories/aiChatApi.ts` | Modify | Pass `project_id` in request body when context is set |
| `backend/supabase/functions/ai-chat/index.ts` | Modify | Forward `project_id` to runAgent options |
| `server/ai-gateway-server.ts` | Modify | Forward `project_id` to runAgent options |

---

## Task 1: Server-Side CAD Read Tools

**Files:**
- Modify: `backend/supabase/functions/_shared/ai-agent.ts` (READ_TABLES at line 42, TOOLS array at line 112, executeTool at line 402, systemPrompt at line 233)

**Interfaces:**
- Consumes: existing `supabaseFetch()` helper, existing `ToolSchema` type
- Produces: 4 new tool schemas in TOOLS array, 4 new branches in executeTool, CAD system prompt section

### Steps

- [ ] **Step 1: Add `project_cad_drawings` to READ_TABLES**

In `ai-agent.ts`, add `"project_cad_drawings"` to the `READ_TABLES` Set (line 42-67).

- [ ] **Step 2: Add `get_cad_drawing` tool schema**

Append to the `TOOLS` array after the existing 6 tools:

```ts
{
  type: "function",
  function: {
    name: "get_cad_drawing",
    description:
      "Fetch the full CAD drawing model for a project. Returns the JSONB model containing layers, points, linework, texts, circles, arcs, ellipses, hatches, dimensions, and surfaces. Use this to understand what is currently drawn.",
    parameters: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "The project UUID" },
      },
      required: ["project_id"],
      additionalProperties: false,
    },
  },
},
```

- [ ] **Step 3: Add `list_cad_layers` tool schema**

```ts
{
  type: "function",
  function: {
    name: "list_cad_layers",
    description:
      "List all layers in a project's CAD drawing with their colours, visibility, lock status, and entity counts. Use this to understand the drawing structure.",
    parameters: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "The project UUID" },
      },
      required: ["project_id"],
      additionalProperties: false,
    },
  },
},
```

- [ ] **Step 4: Add `count_cad_entities` tool schema**

```ts
{
  type: "function",
  function: {
    name: "count_cad_entities",
    description:
      "Count CAD entities in a project drawing, optionally filtered by layer and/or entity type (point, linework, text, circle, arc, ellipse, hatch, dimension, surface). Returns total and per-type counts.",
    parameters: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "The project UUID" },
        layer_id: { type: "string", description: "Optional: filter to this layer id" },
        entity_type: {
          type: "string",
          enum: ["point", "linework", "text", "circle", "arc", "ellipse", "hatch", "dimension", "surface"],
          description: "Optional: filter to this entity type",
        },
      },
      required: ["project_id"],
      additionalProperties: false,
    },
  },
},
```

- [ ] **Step 5: Add `inspect_cad_entity` tool schema**

```ts
{
  type: "function",
  function: {
    name: "inspect_cad_entity",
    description:
      "Return the full properties of a single CAD entity by its UUID. Use this to inspect coordinates, layer, colour, and other attributes of a specific point, linework, text, circle, arc, ellipse, hatch, dimension, or surface.",
    parameters: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "The project UUID" },
        entity_id: { type: "string", description: "The entity UUID" },
      },
      required: ["project_id", "entity_id"],
      additionalProperties: false,
    },
  },
},
```

- [ ] **Step 6: Implement `get_cad_drawing` execution branch**

Inside `executeTool()`, before the final `return JSON.stringify({ error: ... })` at the end, add:

```ts
if (name === "get_cad_drawing") {
  const projectId = str(args.project_id);
  if (!/^[0-9a-f-]{36}$/i.test(projectId))
    return JSON.stringify({ error: "A valid project UUID is required." });
  const out = await supabaseFetch({
    ...ctx,
    method: "GET",
    path: `project_cad_drawings?project_id=eq.${projectId}&select=model`,
  });
  if (!out.ok) return JSON.stringify({ error: `HTTP ${out.status}`, details: out.json });
  const row = out.json?.[0];
  if (!row) return JSON.stringify({ error: "No drawing found for this project." });
  return JSON.stringify({ model: row.model });
}
```

- [ ] **Step 7: Implement `list_cad_layers` execution branch**

```ts
if (name === "list_cad_layers") {
  const projectId = str(args.project_id);
  if (!/^[0-9a-f-]{36}$/i.test(projectId))
    return JSON.stringify({ error: "A valid project UUID is required." });
  const out = await supabaseFetch({
    ...ctx,
    method: "GET",
    path: `project_cad_drawings?project_id=eq.${projectId}&select=model`,
  });
  if (!out.ok) return JSON.stringify({ error: `HTTP ${out.status}`, details: out.json });
  const row = out.json?.[0];
  if (!row) return JSON.stringify({ error: "No drawing found for this project." });
  const m = row.model as Record<string, unknown>;
  const layers = (m.layers ?? []) as { id: string; name: string; color: string; visible: boolean; locked: boolean }[];
  const counts: Record<string, number> = {};
  for (const arr of ["points", "linework", "texts", "circles", "arcs", "ellipses", "hatches", "dimensions", "surfaces"]) {
    for (const e of (m[arr] ?? []) as { layerId: string }[]) {
      counts[e.layerId] = (counts[e.layerId] ?? 0) + 1;
    }
  }
  const result = layers.map((l) => ({
    id: l.id, name: l.name, color: l.color, visible: l.visible, locked: l.locked,
    entity_count: counts[l.id] ?? 0,
  }));
  return JSON.stringify({ layers: result });
}
```

- [ ] **Step 8: Implement `count_cad_entities` execution branch**

```ts
if (name === "count_cad_entities") {
  const projectId = str(args.project_id);
  if (!/^[0-9a-f-]{36}$/i.test(projectId))
    return JSON.stringify({ error: "A valid project UUID is required." });
  const out = await supabaseFetch({
    ...ctx,
    method: "GET",
    path: `project_cad_drawings?project_id=eq.${projectId}&select=model`,
  });
  if (!out.ok) return JSON.stringify({ error: `HTTP ${out.status}`, details: out.json });
  const row = out.json?.[0];
  if (!row) return JSON.stringify({ error: "No drawing found for this project." });
  const m = row.model as Record<string, unknown>;
  const layerFilter = args.layer_id ? String(args.layer_id) : null;
  const typeFilter = args.entity_type ? String(args.entity_type) : null;
  const typeMap: Record<string, string> = {
    point: "points", linework: "linework", text: "texts", circle: "circles",
    arc: "arcs", ellipse: "ellipses", hatch: "hatches", dimension: "dimensions", surface: "surfaces",
  };
  const types = typeFilter ? [typeFilter] : Object.keys(typeMap);
  const result: Record<string, number> = {};
  let total = 0;
  for (const t of types) {
    const arr = (m[typeMap[t]] ?? []) as { layerId: string }[];
    const filtered = layerFilter ? arr.filter((e) => e.layerId === layerFilter) : arr;
    result[t] = filtered.length;
    total += filtered.length;
  }
  return JSON.stringify({ total, by_type: result, layer_filter: layerFilter, type_filter: typeFilter });
}
```

- [ ] **Step 9: Implement `inspect_cad_entity` execution branch**

```ts
if (name === "inspect_cad_entity") {
  const projectId = str(args.project_id);
  const entityId = str(args.entity_id);
  if (!/^[0-9a-f-]{36}$/i.test(projectId) || !/^[0-9a-f-]{36}$/i.test(entityId))
    return JSON.stringify({ error: "Valid project_id and entity_id UUIDs are required." });
  const out = await supabaseFetch({
    ...ctx,
    method: "GET",
    path: `project_cad_drawings?project_id=eq.${projectId}&select=model`,
  });
  if (!out.ok) return JSON.stringify({ error: `HTTP ${out.status}`, details: out.json });
  const row = out.json?.[0];
  if (!row) return JSON.stringify({ error: "No drawing found for this project." });
  const m = row.model as Record<string, unknown>;
  for (const arr of ["points", "linework", "texts", "circles", "arcs", "ellipses", "hatches", "dimensions", "surfaces"]) {
    const entities = (m[arr] ?? []) as { id: string }[];
    const found = entities.find((e) => e.id === entityId);
    if (found) return JSON.stringify({ entity_type: arr.replace(/s$/, ""), entity: found });
  }
  return JSON.stringify({ error: `Entity ${entityId} not found in any drawing layer.` });
}
```

- [ ] **Step 10: Add CAD system prompt section**

In the `systemPrompt()` function, append to the returned string array before the final `.join("\n")`:

```ts
"",
"CAD INTEGRATION:",
"When the user has a project open in the CAD workspace, you can read its drawing.",
"Use get_cad_drawing to fetch the full model, list_cad_layers for structure,",
"count_cad_entities for counts, and inspect_cad_entity for details.",
"Drawing data is JSONB with these arrays: points (SurveyPoint), linework",
"(SurveyLinework with kind=line|polyline|boundary), texts (SurveyText),",
"circles, arcs, ellipses, dimensions, hatches, surfaces.",
"When the user asks you to DRAW or CREATE geometry, output your commands in",
"a [CAD] fenced block. Each line is one command. Supported commands:",
"  POINT <n> <e> [z] [code=CODE] [layer=LAYER]",
"  LINE <n1>,<e1> <n2>,<e2> ... [layer=LAYER] [closed]",
"  TEXT <n> <e> \"content\" [h=height] [rot=degrees] [layer=LAYER]",
"  CIRCLE <cn>,<ce> <radius> [layer=LAYER]",
"  ARC <cn>,<ce> <radius> <start_deg> <end_deg> [layer=LAYER]",
"  LAYER CREATE <name> [color=#hex]",
"  ZOOM EXTENTS",
"Example: [CAD]\\nPOINT 501234 2845678 code=CP1\\nLINE 501234,2845678 501240,2845680\\n[/CAD]",
```

- [ ] **Step 11: Update activity labels in AssistantPage**

In `frontend/src/pages/shared/AssistantPage.tsx`, add to the `TOOL_LABELS` map (line 47-54):

```ts
get_cad_drawing: "Loading CAD drawing...",
list_cad_layers: "Reading drawing layers...",
count_cad_entities: "Counting drawing entities...",
inspect_cad_entity: "Inspecting entity...",
```

- [ ] **Step 12: Commit**

```bash
git add backend/supabase/functions/_shared/ai-agent.ts frontend/src/pages/shared/AssistantPage.tsx
git commit -m "Add CAD read tools and drawing awareness to AI agent"
```

---

## Task 2: Client-Side CAD Command Executor

**Files:**
- Create: `frontend/src/features/projects/components/cad/cadAiExecutor.ts`
- Create: `frontend/src/features/projects/components/cad/cadAiExecutor.test.ts`

**Interfaces:**
- Consumes: `UseCadModel` (from `useCadModel.ts` line 159), `CadLayer` types (from `cadModel.ts`)
- Produces: `executeAiCadCommands(raw: string, cad: UseCadModel): CadExecResult[]`

### Steps

- [ ] **Step 1: Create `cadAiExecutor.ts`**

```ts
import type { UseCadModel } from "./useCadModel.ts";
import type { LayerId } from "./cadModel.ts";

export interface CadExecResult {
  ok: boolean;
  command: string;
  detail: string;
}

function parseCoord(s: string): { n: number; e: number } | null {
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return { n: parseFloat(m[1]), e: parseFloat(m[2]) };
}

function parseParams(rest: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const token of rest) {
    const m = token.match(/^(\w+)=(.+)$/);
    if (m) params[m[1].toLowerCase()] = m[2];
  }
  return params;
}

function resolveLayer(params: Record<string, string>, cad: UseCadModel): LayerId | undefined {
  const raw = params["layer"];
  if (!raw) return undefined;
  cad.ensureLayerById(raw);
  return raw;
}

export function extractCadBlocks(text: string): string[] {
  const blocks: string[] = [];
  const regex = /\[CAD\]([\s\S]*?)\[\/CAD\]/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

export function parseCadCommands(block: string): string[] {
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

export function executeAiCadCommands(
  raw: string,
  cad: UseCadModel,
): CadExecResult[] {
  const results: CadExecResult[] = [];
  const commands = parseCadCommands(raw);

  cad.beginTransaction();
  try {
    for (const cmd of commands) {
      const upper = cmd.toUpperCase();
      const parts = cmd.split(/\s+/);
      const verb = parts[0].toUpperCase();

      try {
        if (verb === "POINT") {
          const n = parseFloat(parts[1]);
          const e = parseFloat(parts[2]);
          if (!Number.isFinite(n) || !Number.isFinite(e)) {
            results.push({ ok: false, command: cmd, detail: "Invalid coordinates." });
            continue;
          }
          const z = parts[3] && !parts[3].includes("=") ? parseFloat(parts[3]) : null;
          const params = parseParams(parts.slice(z != null ? 4 : 3));
          const layerId = resolveLayer(params, cad);
          const pointNo = cad.nextPointNo();
          const p = cad.addPoint({
            pointNo,
            n,
            e,
            z: z != null && Number.isFinite(z) ? z : null,
            code: params["code"] ?? "",
            ...(layerId ? { layerId } : {}),
          });
          results.push({ ok: true, command: cmd, detail: `Point ${p.pointNo} created.` });
        } else if (verb === "LINE" || verb === "POLYLINE" || verb === "PLINE") {
          const vertices: { n: number; e: number }[] = [];
          let i = 1;
          const params: Record<string, string> = {};
          while (i < parts.length) {
            const coord = parseCoord(parts[i]);
            if (coord) { vertices.push(coord); i++; }
            else { break; }
          }
          for (; i < parts.length; i++) {
            const m = parts[i].match(/^(\w+)=(.+)$/);
            if (m) params[m[1].toLowerCase()] = m[2];
          }
          if (vertices.length < 2) {
            results.push({ ok: false, command: cmd, detail: "LINE requires at least 2 coordinate pairs." });
            continue;
          }
          const layerId = resolveLayer(params, cad);
          const lw = cad.addLinework({
            kind: params["kind"] === "boundary" ? "boundary" : "polyline",
            vertices,
            closed: "closed" in params || params["closed"] === "true",
            label: params["label"] ?? undefined,
            ...(layerId ? { layerId } : {}),
          });
          results.push({ ok: true, command: cmd, detail: `Linework ${lw.id.slice(0, 8)} created (${vertices.length} vertices).` });
        } else if (verb === "TEXT" || verb === "DT") {
          const n = parseFloat(parts[1]);
          const e = parseFloat(parts[2]);
          // Find quoted text
          const textMatch = cmd.match(/"([^"]*)"/);
          if (!Number.isFinite(n) || !Number.isFinite(e) || !textMatch) {
            results.push({ ok: false, command: cmd, detail: "TEXT requires n, e, and quoted content." });
            continue;
          }
          const content = textMatch[1];
          const params = parseParams(parts.slice(3).filter((p) => !p.startsWith('"')));
          const layerId = resolveLayer(params, cad);
          const t = cad.addText({
            n,
            e,
            text: content,
            height: params["h"] ? parseFloat(params["h"]) : undefined,
            rotation: params["rot"] ? parseFloat(params["rot"]) : undefined,
            ...(layerId ? { layerId } : {}),
          });
          results.push({ ok: true, command: cmd, detail: `Text "${content}" created.` });
        } else if (verb === "CIRCLE") {
          const center = parseCoord(parts[1]);
          const radius = parseFloat(parts[2]);
          if (!center || !Number.isFinite(radius) || radius <= 0) {
            results.push({ ok: false, command: cmd, detail: "CIRCLE requires center n,e and positive radius." });
            continue;
          }
          const params = parseParams(parts.slice(3));
          const layerId = resolveLayer(params, cad);
          const c = cad.addCircle({ center, radius, ...(layerId ? { layerId } : {}) });
          results.push({ ok: true, command: cmd, detail: `Circle ${c.id.slice(0, 8)} created (r=${radius}).` });
        } else if (verb === "ARC") {
          const center = parseCoord(parts[1]);
          const radius = parseFloat(parts[2]);
          const startAngle = parseFloat(parts[3]);
          const endAngle = parseFloat(parts[4]);
          if (!center || ![radius, startAngle, endAngle].every(Number.isFinite)) {
            results.push({ ok: false, command: cmd, detail: "ARC requires center, radius, start/end angles." });
            continue;
          }
          const params = parseParams(parts.slice(5));
          const layerId = resolveLayer(params, cad);
          const a = cad.addArc({ center, radius, startAngle, endAngle, ...(layerId ? { layerId } : {}) });
          results.push({ ok: true, command: cmd, detail: `Arc ${a.id.slice(0, 8)} created.` });
        } else if (verb === "LAYER") {
          const sub = parts[1]?.toUpperCase();
          if (sub === "CREATE" || sub === "MAKE") {
            const name = parts[2];
            if (!name) {
              results.push({ ok: false, command: cmd, detail: "LAYER CREATE requires a name." });
              continue;
            }
            const params = parseParams(parts.slice(3));
            const layer = cad.addLayer(name, params["color"] ?? undefined);
            results.push({ ok: true, command: cmd, detail: `Layer "${layer.name}" created.` });
          } else {
            results.push({ ok: false, command: cmd, detail: "LAYER CREATE <name> [color=#hex]" });
          }
        } else if (verb === "ZOOM") {
          const sub = parts[1]?.toUpperCase();
          if (sub === "EXTENTS" || sub === "E") {
            // zoomExtents is called externally by the bridge — flag it
            results.push({ ok: true, command: cmd, detail: "Zoom extents (pending)." });
          } else {
            results.push({ ok: false, command: cmd, detail: "ZOOM EXTENTS is the only supported zoom command." });
          }
        } else {
          results.push({ ok: false, command: cmd, detail: `Unknown command: ${verb}` });
        }
      } catch (err) {
        results.push({ ok: false, command: cmd, detail: String(err) });
      }
    }
  } finally {
    cad.endTransaction();
  }
  return results;
}
```

- [ ] **Step 2: Create `cadAiExecutor.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { extractCadBlocks, parseCadCommands, executeAiCadCommands } from "./cadAiExecutor.ts";

describe("extractCadBlocks", () => {
  it("extracts a single CAD block", () => {
    const text = "Here is a command:\n[CAD]\nPOINT 100 200\n[/CAD]\nDone.";
    expect(extractCadBlocks(text)).toEqual(["POINT 100 200"]);
  });
  it("extracts multiple CAD blocks", () => {
    const text = "[CAD]\nPOINT 1 2\n[/CAD]\nmid\n[CAD]\nTEXT 3 4 \"hi\"\n[/CAD]";
    expect(extractCadBlocks(text)).toHaveLength(2);
  });
  it("returns empty array when no blocks", () => {
    expect(extractCadBlocks("no blocks here")).toEqual([]);
  });
});

describe("parseCadCommands", () => {
  it("splits lines and skips comments", () => {
    const block = "# heading\nPOINT 1 2\nLINE 1,2 3,4";
    expect(parseCadCommands(block)).toEqual(["POINT 1 2", "LINE 1,2 3,4"]);
  });
  it("trims whitespace", () => {
    expect(parseCadCommands("  POINT 1 2  \n  ")).toEqual(["POINT 1 2"]);
  });
});

describe("executeAiCadCommands", () => {
  const mockCad = () => ({
    model: { layers: [], points: [], linework: [], texts: [], circles: [], arcs: [], ellipses: [], hatches: [], dimensions: [], surfaces: [], activeLayerId: "0" },
    addPoint: vi.fn((p) => ({ ...p, id: "mock-id", layerId: p.layerId ?? "0" })),
    addLinework: vi.fn((l) => ({ ...l, id: "mock-lw-id", layerId: l.layerId ?? "0" })),
    addText: vi.fn((t) => ({ ...t, id: "mock-text-id", layerId: t.layerId ?? "0" })),
    addCircle: vi.fn((c) => ({ ...c, id: "mock-circle-id", layerId: c.layerId ?? "0" })),
    addArc: vi.fn((a) => ({ ...a, id: "mock-arc-id", layerId: a.layerId ?? "0" })),
    addLayer: vi.fn((name, color) => ({ id: name, name, color: color ?? "#ffffff", visible: true, locked: false })),
    ensureLayerById: vi.fn(),
    nextPointNo: vi.fn(() => "1"),
    beginTransaction: vi.fn(),
    endTransaction: vi.fn(),
  });

  it("creates a POINT", () => {
    const cad = mockCad();
    const results = executeAiCadCommands("POINT 501234 2845678 code=CP1", cad as never);
    expect(results[0].ok).toBe(true);
    expect(cad.addPoint).toHaveBeenCalledWith expect.objectContaining({
      pointNo: "1", n: 501234, e: 2845678, code: "CP1",
    });
  });

  it("creates a LINE with two vertices", () => {
    const cad = mockCad();
    const results = executeAiCadCommands("LINE 100,200 300,400", cad as never);
    expect(results[0].ok).toBe(true);
    expect(cad.addLinework).toHaveBeenCalledWith expect.objectContaining({
      vertices: [{ n: 100, e: 200 }, { n: 300, e: 400 }],
    });
  });

  it("creates TEXT with quoted content", () => {
    const cad = mockCad();
    const results = executeAiCadCommands('TEXT 100 200 "Hello World" h=3.0', cad as never);
    expect(results[0].ok).toBe(true);
    expect(cad.addText).toHaveBeenCalledWith expect.objectContaining({
      n: 100, e: 200, text: "Hello World", height: 3.0,
    });
  });

  it("rejects LINE with fewer than 2 vertices", () => {
    const cad = mockCad();
    const results = executeAiCadCommands("LINE 100,200", cad as never);
    expect(results[0].ok).toBe(false);
  });

  it("wraps in transaction", () => {
    const cad = mockCad();
    executeAiCadCommands("POINT 1 2", cad as never);
    expect(cad.beginTransaction).toHaveBeenCalled();
    expect(cad.endTransaction).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd frontend && npx vitest run src/features/projects/components/cad/cadAiExecutor.test.ts`
Expected: all pass

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/projects/components/cad/cadAiExecutor.ts frontend/src/features/projects/components/cad/cadAiExecutor.test.ts
git commit -m "Add CAD command executor for AI agent integration"
```

---

## Task 3: CadCommandBridge Component

**Files:**
- Create: `frontend/src/features/projects/components/cad/CadCommandBridge.tsx`

**Interfaces:**
- Consumes: `UseCadModel`, assistant message text (string), `extractCadBlocks` + `executeAiCadCommands` from Task 2
- Produces: React component that renders command previews and an Execute button

### Steps

- [ ] **Step 1: Create `CadCommandBridge.tsx`**

```tsx
import { useMemo, useState, useCallback } from "react";
import { Button } from "@/components/ui/button.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import { Check, Play, RotateCcw, X } from "lucide-react";
import type { UseCadModel } from "./useCadModel.ts";
import { extractCadBlocks, parseCadCommands, executeAiCadCommands, type CadExecResult } from "./cadAiExecutor.ts";

interface CadCommandBridgeProps {
  messageText: string;
  cad: UseCadModel;
  onExecuted?: (results: CadExecResult[]) => void;
}

export function CadCommandBridge({ messageText, cad, onExecuted }: CadCommandBridgeProps) {
  const blocks = useMemo(() => extractCadBlocks(messageText), [messageText]);
  const [executed, setExecuted] = useState<Record<number, CadExecResult[]>>({});

  const handleExecute = useCallback(
    (blockIndex: number) => {
      const block = blocks[blockIndex];
      if (!block) return;
      const results = executeAiCadCommands(block, cad);
      // Check for zoom commands
      const hasZoom = parseCadCommands(block).some((c) => c.toUpperCase().startsWith("ZOOM"));
      if (hasZoom) {
        // Trigger zoom extents via a custom event (CadWorkspace listens)
        window.dispatchEvent(new CustomEvent("cad:ai-zoom-extents"));
      }
      setExecuted((prev) => ({ ...prev, [blockIndex]: results }));
      onExecuted?.(results);
    },
    [blocks, cad, onExecuted],
  );

  const handleUndo = useCallback(() => {
    cad.undo();
  }, [cad]);

  if (blocks.length === 0) return null;

  return (
    <div className="space-y-2 border-t border-border/60 pt-3">
      {blocks.map((block, i) => {
        const commands = parseCadCommands(block);
        const results = executed[i];
        const allOk = results?.every((r) => r.ok);

        return (
          <div key={i} className="rounded-md border border-border/60 bg-muted/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                CAD Commands ({commands.length} {commands.length === 1 ? "command" : "commands"})
              </span>
              {!results ? (
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => handleExecute(i)}
                >
                  <Play className="h-3 w-3" />
                  Execute
                </Button>
              ) : (
                <div className="flex items-center gap-1.5">
                  {allOk ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-600">
                      <Check className="h-3 w-3" /> Applied
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-destructive">
                      <X className="h-3 w-3" /> Errors
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-xs"
                    onClick={handleUndo}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Undo
                  </Button>
                </div>
              )}
            </div>
            <ScrollArea className="max-h-40">
              <pre className="whitespace-pre font-mono text-xs leading-relaxed text-foreground/80">
                {commands.map((c, j) => {
                  const result = results?.[j];
                  return (
                    <div key={j} className="flex gap-2">
                      <span className={`inline-block w-3 shrink-0 ${result ? (result.ok ? "text-emerald-500" : "text-destructive") : "text-muted-foreground/40"}`}>
                        {result ? (result.ok ? "✓" : "✗") : "·"}
                      </span>
                      <span>{c}</span>
                    </div>
                  );
                })}
              </pre>
            </ScrollArea>
            {results && (
              <div className="mt-2 space-y-0.5">
                {results.map((r, j) => (
                  <div key={j} className={`text-xs ${r.ok ? "text-muted-foreground" : "text-destructive"}`}>
                    {r.ok ? r.detail : `${r.detail}`}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/projects/components/cad/CadCommandBridge.tsx
git commit -m "Add CadCommandBridge for AI drawing command preview and execution"
```

---

## Task 4: CadChatPanel Component

**Files:**
- Create: `frontend/src/features/projects/components/cad/CadChatPanel.tsx`

**Interfaces:**
- Consumes: `UseCadModel`, `projectId: string`, `workspaceId: string`
- Produces: React component embedding AssistantPage with CAD context + CadCommandBridge

### Steps

- [ ] **Step 1: Create `CadChatPanel.tsx`**

This wraps `AssistantPage` and injects the CAD context. It renders the chat in a sidebar-friendly panel that sits inside the CAD workspace.

```tsx
import { useMemo, useCallback, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import AssistantPage from "@/pages/shared/AssistantPage.tsx";
import { CadCommandBridge } from "./CadCommandBridge.tsx";
import type { UseCadModel } from "./useCadModel.ts";

interface CadChatPanelProps {
  projectId: string;
  workspaceId: string;
  cad: UseCadModel;
  onClose: () => void;
}

export function CadChatPanel({ projectId, workspaceId, cad, onClose }: CadChatPanelProps) {
  const [lastAssistantText, setLastAssistantText] = useState("");

  const contextProps = useMemo(
    () => ({ contextProjectId: projectId, contextWorkspaceId: workspaceId }),
    [projectId, workspaceId],
  );

  const handleFinal = useCallback((text: string) => {
    setLastAssistantText(text);
  }, []);

  return (
    <div className="flex h-full flex-col border-l border-border/60 bg-background">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <h3 className="text-sm font-semibold">SiteSurveyor AI</h3>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-hidden">
        <AssistantPage
          embedded
          contextProjectId={projectId}
          contextWorkspaceId={workspaceId}
          onAssistantFinal={handleFinal}
        />
      </div>
      {lastAssistantText && (
        <div className="border-t border-border/60 px-3 py-2">
          <CadCommandBridge messageText={lastAssistantText} cad={cad} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: 0 errors (will need Task 5 props added to AssistantPage first — see below)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/projects/components/cad/CadChatPanel.tsx
git commit -m "Add CadChatPanel for embedded AI chat in CAD workspace"
```

---

## Task 5: AssistantPage Context Props

**Files:**
- Modify: `frontend/src/pages/shared/AssistantPage.tsx`

**Interfaces:**
- Consumes: (none — extends existing props)
- Produces: `contextProjectId?: string`, `contextWorkspaceId?: string`, `embedded?: boolean`, `onAssistantFinal?: (text: string) => void` props on AssistantPage

### Steps

- [ ] **Step 1: Add new optional props**

At the top of `AssistantPage.tsx`, find the component signature and add the new props. The component currently has no props (it's a bare function component). Wrap it:

```tsx
interface AssistantPageProps {
  /** When set, the AI agent receives this project context for CAD queries. */
  contextProjectId?: string;
  contextWorkspaceId?: string;
  /** When true, hides the page header (for embedding in panels). */
  embedded?: boolean;
  /** Called when a full assistant reply is received. */
  onAssistantFinal?: (text: string) => void;
}

export default function AssistantPage({
  contextProjectId,
  contextWorkspaceId,
  embedded,
  onAssistantFinal,
}: AssistantPageProps) {
```

- [ ] **Step 2: Pass context to streamAiReply**

Find the `handleSend` callback and update the `streamAiReply` call to include the new context:

```ts
const { streamAiReply } = useAiChat({
  conversationId,
  onActivity: setActivity,
  onDelta: handleDelta,
  onFinal: (text) => {
    handleFinal(text);
    onAssistantFinal?.(text);
  },
  onError: (message) => { ... },
  contextProjectId,
  contextWorkspaceId,
});
```

- [ ] **Step 3: Conditionally hide header when embedded**

Find the page header div (`<div className="flex flex-col gap-4 mb-6">` with the heading) and wrap it:

```tsx
{!embedded && (
  <div className="flex flex-col gap-4 mb-6">
    {/* existing header content */}
  </div>
)}
```

- [ ] **Step 4: Update useAiChat to accept and forward context**

In `frontend/src/lib/repositories/aiChatApi.ts`, add `contextProjectId` and `contextWorkspaceId` to the `AiChatOptions` interface and pass them in the request body:

```ts
export interface AiChatOptions {
  // ... existing fields
  contextProjectId?: string;
  contextWorkspaceId?: string;
}
```

In `streamAiReply`, add to the request body:

```ts
body: JSON.stringify({
  conversation_id: conversationId,
  message,
  ...(contextProjectId ? { project_id: contextProjectId } : {}),
  ...(contextWorkspaceId ? { workspace_id: contextWorkspaceId } : {}),
}),
```

- [ ] **Step 5: Forward context in Edge Function + host server**

In `backend/supabase/functions/ai-chat/index.ts`, extract the new fields from the request body and pass to `runAgent`:

```ts
const { conversation_id, message, project_id, workspace_id } = await req.json();
// ... later in runAgent call:
projectContext: project_id ? { projectId: project_id, workspaceId: workspace_id ?? workspaceId } : undefined,
```

In `server/ai-gateway-server.ts`, do the same for the host fallback path.

In `ai-agent.ts`, add to `RunAgentOptions`:

```ts
export interface RunAgentOptions {
  // ... existing fields
  projectContext?: { projectId: string; workspaceId?: string };
}
```

And use it in the system prompt to tell the model which project is active:

```ts
const projectHint = opts.projectContext
  ? `\nThe user currently has project ${opts.projectContext.projectId} open in the CAD workspace.`
  : "";
// Append to system prompt:
+ projectHint
```

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/shared/AssistantPage.tsx frontend/src/lib/repositories/aiChatApi.ts backend/supabase/functions/ai-chat/index.ts backend/supabase/functions/_shared/ai-agent.ts server/ai-gateway-server.ts
git commit -m "Add CAD context props to AssistantPage and forward project context to AI agent"
```

---

## Task 6: Mount in CadWorkspace + Right Panel Toggle

**Files:**
- Modify: `frontend/src/features/projects/components/CadWorkspace.tsx` (lines ~2288-2305 for commandCtx, need to add CAD chat state + mount)
- Modify: `frontend/src/features/projects/components/cad/CadRightPanel.tsx` (add AI toggle button)

**Interfaces:**
- Consumes: `CadChatPanel` from Task 4, `UseCadModel` from existing `useCadModel`
- Produces: AI chat panel visible in CAD workspace when toggle is active

### Steps

- [ ] **Step 1: Add AI chat state to CadWorkspace**

In `CadWorkspace.tsx`, find where state hooks are declared (around line 2200-2280). Add:

```ts
const [cadChatOpen, setCadChatOpen] = useState(false);
```

- [ ] **Step 2: Mount CadChatPanel in CadWorkspace layout**

Find the main layout JSX (the flex container with the canvas and right panel). Add the CadChatPanel as a conditional panel to the left of the canvas or as an overlay. The simplest integration: add it as a collapsible panel on the right side, next to the existing right panel.

Find the right panel section and add:

```tsx
{cadChatOpen && (
  <div className="h-full w-80 shrink-0">
    <CadChatPanel
      projectId={projectId}
      workspaceId={workspaceId}
      cad={cad}
      onClose={() => setCadChatOpen(false)}
    />
  </div>
)}
```

- [ ] **Step 3: Add AI toggle to CadRightPanel**

In `CadRightPanel.tsx`, add a new section/button for the AI assistant toggle. Find the ribbon or toolbar area and add:

```tsx
<Button
  variant={cadChatOpen ? "default" : "outline"}
  size="sm"
  className="h-7 gap-1.5 text-xs"
  onClick={() => setCadChatOpen(!cadChatOpen)}
>
  <Bot className="h-3.5 w-3.5" />
  AI
</Button>
```

(Import `Bot` from `lucide-react` and pass `cadChatOpen`/`setCadChatOpen` as props or use a callback.)

- [ ] **Step 4: Listen for zoom-extents event from CadCommandBridge**

In `CadWorkspace.tsx`, add an effect to listen for the custom event dispatched by CadCommandBridge:

```ts
useEffect(() => {
  const handler = () => fitExtents();
  window.addEventListener("cad:ai-zoom-extents", handler);
  return () => window.removeEventListener("cad:ai-zoom-extents", handler);
}, [fitExtents]);
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/projects/components/CadWorkspace.tsx frontend/src/features/projects/components/cad/CadRightPanel.tsx
git commit -m "Mount AI chat panel in CAD workspace with toggle"
```

---

## Task 7: System Prompt + Deploy

**Files:**
- Modify: `backend/supabase/functions/_shared/ai-agent.ts` (system prompt)
- Deploy: Edge Function

### Steps

- [ ] **Step 1: Enhance system prompt with CAD write instructions**

Update the CAD section in `systemPrompt()` to be more detailed about the write format:

```ts
"CAD INTEGRATION — READING:",
"Use get_cad_drawing to fetch the full model for a project.",
"Use list_cad_layers to see layers with entity counts.",
"Use count_cad_entities for totals (filterable by layer/type).",
"Use inspect_cad_entity for a single entity's full properties.",
"The model contains arrays: points (pointNo, n, e, z, code, layerId),",
"linework (kind, vertices[], closed, label), texts (text, n, e, height, rotation),",
"circles (center, radius), arcs (center, radius, startAngle, endAngle),",
"ellipses (center, semiMajor, semiMinor, rotation), hatches (vertices[], holes[]),",
"dimensions (kind, text, defPoints[]), surfaces (name, points[], triangles[]).",
"",
"CAD INTEGRATION — WRITING:",
"When the user asks you to DRAW, CREATE, or ADD geometry to the current project,",
"output your commands inside a [CAD] ... [/CAD] fenced block. Each line = 1 command.",
"Supported commands:",
"  POINT <n> <e> [z] [code=CODE] [layer=LAYER]",
"  LINE <n1>,<e1> <n2>,<e2> ... [closed] [layer=LAYER]",
"  TEXT <n> <e> \"content\" [h=height] [rot=degrees] [layer=LAYER]",
"  CIRCLE <cn>,<ce> <radius> [layer=LAYER]",
"  ARC <cn>,<ce> <radius> <start_deg> <end_deg> [layer=LAYER]",
"  LAYER CREATE <name> [color=#hex]",
"  ZOOM EXTENTS",
"Coordinates are Northing,Eastings (Y,X). Example: [CAD]\\nPOINT 501234 2845678 code=CP1 layer=CONTROL\\n[/CAD]",
"Always use layers from the existing drawing when possible. Create new layers only when needed.",
```

- [ ] **Step 2: Deploy Edge Function**

Run: `cd backend && npx supabase functions deploy ai-chat`

- [ ] **Step 3: Restart host server**

Kill the existing host server process on :8787 and restart it so it picks up the updated ai-agent.ts.

- [ ] **Step 4: Commit**

```bash
git add backend/supabase/functions/_shared/ai-agent.ts
git commit -m "Enhance AI system prompt with CAD read/write instructions"
```

---

## Task 8: Full Verify + Detector

### Steps

- [ ] **Step 1: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: 0 errors

- [ ] **Step 2: Lint**

Run: `cd frontend && npm run lint`
Expected: 2 warnings (map.tsx:390, CadPlotDialog:164)

- [ ] **Step 3: Tests**

Run: `cd frontend && npm run test`
Expected: 320+ passed

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: ✓ built

- [ ] **Step 5: Detector**

Run: `node "C:/Users/THINKPAD/.agents/skills/impeccable/scripts/detect.mjs" --json frontend/src/features/projects/components/cad/cadAiExecutor.ts frontend/src/features/projects/components/cad/CadCommandBridge.tsx frontend/src/features/projects/components/cad/CadChatPanel.tsx frontend/src/pages/shared/AssistantPage.tsx`
Expected: []

- [ ] **Step 6: Live test**

Open the app, navigate to a project with a CAD drawing (or create one), open the CAD workspace, click the AI toggle, and ask the AI:
- "What layers are on this drawing?"
- "How many points are there?"
- "Draw a point at N=500000 E=3000000 on the CONTROL layer"
- Verify the [CAD] block appears with Execute button
- Click Execute and verify the point appears on the canvas

- [ ] **Step 7: Final commit**

```bash
git add -A && git commit -m "AI ↔ CAD integration: read drawing state, execute drawing commands with confirmation"
```
