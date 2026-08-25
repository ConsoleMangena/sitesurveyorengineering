import type { LayerId } from "./cadModel.ts";
import type { UseCadModel } from "./useCadModel.ts";

export interface CadExecResult {
  ok: boolean;
  command: string;
  detail: string;
}

/** Find every `[CAD]…[/CAD]` block body (tags case-insensitive). */
export function extractCadBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /\[CAD\]([\s\S]*?)\[\/CAD\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) blocks.push(m[1].trim());
  return blocks;
}

/** Split a block into executable lines, dropping blanks and # comments. */
export function parseCadCommands(block: string): string[] {
  return block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

const NUM_RE = /^-?\d+(\.\d+)?$/;
const PAIR_RE = /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/;

function num(token: string | undefined): number | null {
  if (!token || !NUM_RE.test(token)) return null;
  const v = Number(token);
  return Number.isFinite(v) ? v : null;
}

function parsePair(token: string): { n: number; e: number } {
  const comma = token.indexOf(",");
  return { n: Number(token.slice(0, comma).trim()), e: Number(token.slice(comma + 1).trim()) };
}

function parseParams(tokens: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const tok of tokens) {
    const eq = tok.indexOf("=");
    if (eq > 0) params[tok.slice(0, eq)] = tok.slice(eq + 1);
  }
  return params;
}

/**
 * Resolve an explicit `layer=` parameter. The raw value IS the layer id —
 * `ensureLayerById` creates the layer with that exact id when missing, so the
 * entity keeps the id the AI referenced rather than a generated one.
 */
function resolveLayer(cad: UseCadModel, params: Record<string, string>): LayerId | undefined {
  if (params.layer === undefined) return undefined;
  cad.ensureLayerById(params.layer);
  return params.layer;
}

type EntityArgs = { layerId?: LayerId };

function pointArgs(
  cad: UseCadModel,
  params: Record<string, string>,
  base: { pointNo: string; n: number; e: number; z: number | null; code: string },
): typeof base & EntityArgs {
  const layerId = resolveLayer(cad, params);
  return { ...base, ...(layerId !== undefined ? { layerId } : {}) };
}

function textHeightAndRotation(params: Record<string, string>): { height?: number; rotation?: number } {
  const height = params.h !== undefined && Number.isFinite(Number(params.h)) ? Number(params.h) : undefined;
  const rotation =
    params.rot !== undefined && Number.isFinite(Number(params.rot)) ? Number(params.rot) : undefined;
  return { ...(height !== undefined ? { height } : {}), ...(rotation !== undefined ? { rotation } : {}) };
}

function execPoint(tokens: string[], command: string, cad: UseCadModel): CadExecResult {
  const n = num(tokens[1]);
  const e = num(tokens[2]);
  if (n === null || e === null) {
    return { ok: false, command, detail: "POINT requires valid n and e coordinates." };
  }
  // The 4th token is an elevation only when it is not a key=value param.
  let idx = 3;
  let z: number | null = null;
  if (idx < tokens.length && !tokens[idx].includes("=")) {
    const zv = num(tokens[idx]);
    if (zv !== null) z = zv;
    idx += 1;
  }
  const params = parseParams(tokens.slice(idx));
  const pointNo = cad.nextPointNo();
  cad.addPoint(pointArgs(cad, params, { pointNo, n, e, z, code: params.code ?? "" }));
  return { ok: true, command, detail: `Point ${pointNo} created.` };
}

function execLine(tokens: string[], command: string, cad: UseCadModel): CadExecResult {
  const vertices: { n: number; e: number }[] = [];
  let i = 1;
  while (i < tokens.length && PAIR_RE.test(tokens[i])) {
    vertices.push(parsePair(tokens[i]));
    i += 1;
  }
  const rest = tokens.slice(i);
  const closed = rest.some((t) => t.toLowerCase() === "closed");
  const params = parseParams(rest.filter((t) => t.toLowerCase() !== "closed"));
  if (vertices.length < 2) {
    return { ok: false, command, detail: "LINE requires at least 2 coordinate pairs." };
  }
  const kind = closed ? ("boundary" as const) : vertices.length === 2 ? ("line" as const) : ("polyline" as const);
  const layerId = resolveLayer(cad, params);
  cad.addLinework({
    kind,
    vertices,
    closed,
    ...(params.label !== undefined ? { label: params.label } : {}),
    ...(layerId !== undefined ? { layerId } : {}),
  });
  return { ok: true, command, detail: `${kind === "line" ? "Line" : "Polyline"} with ${vertices.length} vertices created.` };
}

function execText(command: string, cad: UseCadModel): CadExecResult {
  const content = command.match(/"([^"]*)"/);
  // Re-tokenise with quoted fragments blanked so params after the content parse cleanly.
  const tokens = command.replace(/"[^"]*"/g, " ").trim().split(/\s+/).filter(Boolean);
  const n = num(tokens[1]);
  const e = num(tokens[2]);
  if (!content || n === null || e === null) {
    return { ok: false, command, detail: 'TEXT requires coordinates and quoted "content".' };
  }
  const params = parseParams(tokens.slice(3));
  const layerId = resolveLayer(cad, params);
  cad.addText({
    n,
    e,
    text: content[1],
    ...textHeightAndRotation(params),
    ...(layerId !== undefined ? { layerId } : {}),
  });
  return { ok: true, command, detail: `Text "${content[1]}" created.` };
}

function execCircle(tokens: string[], command: string, cad: UseCadModel): CadExecResult {
  const centerOk = tokens[1] !== undefined && PAIR_RE.test(tokens[1]);
  const radius = num(tokens[2]);
  if (!centerOk || radius === null || radius <= 0) {
    return { ok: false, command, detail: "CIRCLE requires a centre pair and a radius greater than 0." };
  }
  const params = parseParams(tokens.slice(3));
  const layerId = resolveLayer(cad, params);
  cad.addCircle({
    center: parsePair(tokens[1]),
    radius,
    ...(layerId !== undefined ? { layerId } : {}),
  });
  return { ok: true, command, detail: `Circle r=${radius} created.` };
}

function execArc(tokens: string[], command: string, cad: UseCadModel): CadExecResult {
  const centerOk = tokens[1] !== undefined && PAIR_RE.test(tokens[1]);
  const radius = num(tokens[2]);
  const startAngle = num(tokens[3]);
  const endAngle = num(tokens[4]);
  if (!centerOk || radius === null || radius <= 0 || startAngle === null || endAngle === null) {
    return {
      ok: false,
      command,
      detail: "ARC requires a centre pair, radius greater than 0, and start/end angles.",
    };
  }
  const params = parseParams(tokens.slice(5));
  const layerId = resolveLayer(cad, params);
  cad.addArc({
    center: parsePair(tokens[1]),
    radius,
    startAngle,
    endAngle,
    ...(layerId !== undefined ? { layerId } : {}),
  });
  return { ok: true, command, detail: `Arc r=${radius} created.` };
}

function execLayer(tokens: string[], command: string, cad: UseCadModel): CadExecResult {
  const sub = (tokens[1] ?? "").toUpperCase();
  if (sub !== "CREATE" && sub !== "NEW") {
    return { ok: false, command, detail: "LAYER expects CREATE or NEW." };
  }
  const name = tokens[2];
  if (!name) return { ok: false, command, detail: "LAYER CREATE requires a layer name." };
  const params = parseParams(tokens.slice(3));
  const layer = cad.addLayer(name, params.color);
  return { ok: true, command, detail: `Layer "${layer.name}" created.` };
}

function execCommand(command: string, cad: UseCadModel): CadExecResult {
  const tokens = command.split(/\s+/).filter(Boolean);
  const verb = (tokens[0] ?? "").toUpperCase();
  switch (verb) {
    case "POINT":
      return execPoint(tokens, command, cad);
    case "LINE":
    case "POLYLINE":
    case "PLINE":
      return execLine(tokens, command, cad);
    case "TEXT":
    case "DT":
      return execText(command, cad);
    case "CIRCLE":
      return execCircle(tokens, command, cad);
    case "ARC":
      return execArc(tokens, command, cad);
    case "LAYER":
      return execLayer(tokens, command, cad);
    case "ZOOM":
      return { ok: true, command, detail: "Zoom extents requested." };
    default:
      return { ok: false, command, detail: `Unknown command: ${verb}` };
  }
}

/**
 * Execute every `[CAD]` command against the model. The whole batch runs inside
 * ONE transaction so a single `undo()` reverts it; a failing command never
 * aborts the remaining ones.
 */
export function executeAiCadCommands(raw: string, cad: UseCadModel): CadExecResult[] {
  const results: CadExecResult[] = [];
  cad.beginTransaction();
  try {
    for (const command of parseCadCommands(raw)) {
      try {
        results.push(execCommand(command, cad));
      } catch (err) {
        results.push({
          ok: false,
          command,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    cad.endTransaction();
  }
  return results;
}
