/**
 * AutoCAD-style plot / layout generator.
 *
 * Produces a print-ready, scale-accurate SVG "sheet" (paper space) from the
 * CAD model, complete with the elements a survey plan deliverable needs:
 *   - paper border + inner drawing frame
 *   - the drawing rendered at a true plot scale (1:`scale`)
 *   - a coordinate graticule with Easting/Northing tick labels (axis letters
 *     follow the drawing's axis convention: Y/X for Zimbabwe, X/Y elsewhere)
 *   - a north arrow
 *   - a graphic + ratio scale bar
 *   - a legend keyed to the visible layers
 *   - a title block (project, client, datum, scale, sheet, date, drawn-by)
 *
 * The SVG is laid out in millimetres (1 user unit = 1 mm) so it prints at the
 * correct physical size: a CSS `@page` size matching the chosen sheet makes the
 * browser's "Save as PDF" produce a to-scale plan.
 */
import type { CadLayer, CadModelState, SurveyLinework, SurveyPoint, SurveyText } from "../cadModel.ts";
import { resolveColor } from "../cadModel.ts";
import { inverse } from "../survey/cogo.ts";
import { fmtBearing, fmtDistance, type BearingFormat } from "../survey/format.ts";
import { axisLabels, type AxisConvention } from "../cadSettings.ts";
import { buildCodeTable, resolveFeature } from "../survey/featureCodes.ts";
import { symbolMarkup } from "../survey/symbols.ts";

/** Feature-code table for resolving point symbols on the plotted sheet. */
const PLOT_CODE_TABLE = buildCodeTable();

// ── Paper sizes (mm, landscape) ─────────────────────────────────────────────
export type PaperSize = "A4" | "A3" | "A2" | "A1" | "A0";
export type PaperOrientation = "landscape" | "portrait";

const PAPER_MM: Record<PaperSize, { w: number; h: number }> = {
  A4: { w: 297, h: 210 },
  A3: { w: 420, h: 297 },
  A2: { w: 594, h: 420 },
  A1: { w: 841, h: 594 },
  A0: { w: 1189, h: 841 },
};

export interface TitleBlock {
  projectName: string;
  projectId: string;
  client: string;
  datum: string;
  surveyor: string;
  drawingTitle: string;
  drawingNo: string;
  sheet: string;
  revision: string;
  date: string; // ISO or display string
}

export interface PlotOptions {
  paper: PaperSize;
  orientation: PaperOrientation;
  /** Plot scale denominator (1:scale). When "fit", it is computed to fill the frame. */
  scaleDenominator: number | "fit";
  bearingFormat: BearingFormat;
  /**
   * Axis-label convention for the graticule tick labels. `"yx"` (default,
   * Zimbabwe) labels Easting ticks "Y" and Northing ticks "X"; `"xy"` labels
   * Easting "X" and Northing "Y".
   */
  axisConvention?: AxisConvention;
  showGrid: boolean;
  showLegend: boolean;
  showNorthArrow: boolean;
  showScaleBar: boolean;
  showPointLabels: boolean;
  showSegmentLabels: boolean;
  marginMm: number;
  titleBlock: TitleBlock;
  /**
   * Optional saved framing for the layout's viewport (AutoCAD pan/zoom inside
   * paper space). `offsetE`/`offsetN` recentre the sheet (survey units) and
   * `zoom` multiplies the plot scale (1 = the nominal 1:`scaleDenominator`).
   * When omitted, the sheet auto-centres on the drawing extents.
   */
  view?: { offsetE: number; offsetN: number; zoom: number };
}

export const DEFAULT_TITLE_BLOCK = (
  projectName: string,
  projectId: string,
  client: string,
  datum: string,
): TitleBlock => ({
  projectName,
  projectId,
  client,
  datum,
  surveyor: "",
  drawingTitle: "SURVEY PLAN",
  drawingNo: projectId,
  sheet: "1 of 1",
  revision: "A",
  date: new Date().toISOString().slice(0, 10),
});

export const DEFAULT_PLOT_OPTIONS = (tb: TitleBlock): PlotOptions => ({
  paper: "A3",
  orientation: "landscape",
  scaleDenominator: "fit",
  bearingFormat: "azimuth",
  axisConvention: "yx",
  showGrid: true,
  showLegend: true,
  showNorthArrow: true,
  showScaleBar: true,
  showPointLabels: true,
  showSegmentLabels: false,
  marginMm: 10,
  titleBlock: tb,
});

interface BBox {
  minN: number;
  maxN: number;
  minE: number;
  maxE: number;
}

/** Bounding box (survey units) of all visible geometry, or null if empty. */
function modelBounds(model: CadModelState): BBox | null {
  const ns: number[] = [];
  const es: number[] = [];
  const visible = (layerId: string) => model.layers.find((l) => l.id === layerId)?.visible !== false;
  for (const p of model.points) { if (visible(p.layerId)) { ns.push(p.n); es.push(p.e); } }
  for (const lw of model.linework) {
    if (!visible(lw.layerId)) continue;
    for (const v of lw.vertices) { ns.push(v.n); es.push(v.e); }
  }
  for (const t of model.texts) { if (visible(t.layerId)) { ns.push(t.n); es.push(t.e); } }
  for (const srf of model.surfaces) {
    if (!visible(srf.layerId)) continue;
    for (const v of srf.points) { ns.push(v.n); es.push(v.e); }
  }
  if (!ns.length) return null;
  return { minN: Math.min(...ns), maxN: Math.max(...ns), minE: Math.min(...es), maxE: Math.max(...es) };
}

/** Title-block band height (mm) by paper size. */
function titleBlockHeight(paper: PaperSize): number {
  return paper === "A4" ? 34 : paper === "A3" ? 40 : 46;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface PlotLayout {
  paperW: number;
  paperH: number;
  /** Inner drawing frame (mm). */
  frame: { x: number; y: number; w: number; h: number };
  /** Title block band (mm). */
  tb: { x: number; y: number; w: number; h: number };
}

/** Compute the sheet, frame and title-block rectangles (all mm). */
function computeLayout(opts: PlotOptions): PlotLayout {
  const base = PAPER_MM[opts.paper];
  const land = opts.orientation === "landscape";
  const paperW = land ? base.w : base.h;
  const paperH = land ? base.h : base.w;
  const m = opts.marginMm;
  const tbH = titleBlockHeight(opts.paper);
  const tbW = Math.min(paperW - 2 * m, opts.paper === "A4" ? 120 : 160);

  const frame = { x: m, y: m, w: paperW - 2 * m, h: paperH - 2 * m };
  const tb = { x: paperW - m - tbW, y: paperH - m - tbH, w: tbW, h: tbH };
  return { paperW, paperH, frame, tb };
}

/**
 * Determine the scale (mm-per-survey-unit) and the survey-coordinate origin
 * that maps the drawing centre to the frame centre at the chosen scale.
 */
function computeProjection(
  bounds: BBox | null,
  opts: PlotOptions,
  layout: PlotLayout,
): { mmPerUnit: number; denominator: number; originE: number; originN: number; cx: number; cy: number } {
  // The usable drawing area sits inside the frame but above the title block.
  const pad = 6; // mm inside the frame
  const areaX = layout.frame.x + pad;
  const areaY = layout.frame.y + pad;
  const areaW = layout.frame.w - 2 * pad;
  // Reserve the title-block strip height at the bottom of the frame.
  const areaH = layout.frame.h - 2 * pad - (layout.tb.h + 4);
  const cx = areaX + areaW / 2;
  const cy = areaY + areaH / 2;

  const view = opts.view;
  if (!bounds) {
    return { mmPerUnit: 1, denominator: 1, originE: 0, originN: 0, cx, cy };
  }

  const spanE = Math.max(bounds.maxE - bounds.minE, 1e-6);
  const spanN = Math.max(bounds.maxN - bounds.minN, 1e-6);

  let denominator: number;
  if (opts.scaleDenominator === "fit") {
    // mm available / (survey units * 1000 mm per m) → fit both axes.
    const denomE = (spanE * 1000) / areaW;
    const denomN = (spanN * 1000) / areaH;
    denominator = Math.max(denomE, denomN);
    denominator = niceScale(denominator);
  } else {
    denominator = opts.scaleDenominator;
  }

  // Apply the saved layout zoom (AutoCAD viewport zoom inside paper space).
  // Zooming in (zoom > 1) tightens the scale; the denominator shrinks. For a
  // fit scale we re-round to a conventional value so the scale bar stays sane.
  const zoom = view && Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1;
  const effDenominator =
    opts.scaleDenominator === "fit" ? niceScale(denominator / zoom) : denominator;

  // 1 survey unit (metre) = (1000 / denominator) mm on paper.
  const mmPerUnit = 1000 / effDenominator;
  // Recentre by the saved pan offset (survey units), AutoCAD pan in layout.
  const originE = (bounds.minE + bounds.maxE) / 2 + (view?.offsetE ?? 0);
  const originN = (bounds.minN + bounds.maxN) / 2 + (view?.offsetN ?? 0);
  return { mmPerUnit, denominator: effDenominator, originE, originN, cx, cy };
}

/** Round a scale denominator up to a conventional surveying value. */
function niceScale(raw: number): number {
  const nice = [1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000];
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const base of nice) {
    const cand = base * pow;
    if (cand >= raw) return cand;
  }
  return Math.ceil(raw / pow) * pow;
}

export interface PlotResult {
  svg: string;
  /** Resolved scale denominator actually used (after "fit"). */
  denominator: number;
  paperW: number;
  paperH: number;
  /** Millimetres per survey unit used for the plot (paper mm / ground unit). */
  mmPerUnit: number;
}

/** Build the complete print-ready SVG sheet. */
export function buildPlotSvg(model: CadModelState, opts: PlotOptions): PlotResult {
  const layout = computeLayout(opts);
  const bounds = modelBounds(model);
  const proj = computeProjection(bounds, opts, layout);

  // Survey (n,e) → paper mm. North up: increasing N → decreasing y.
  const toPaper = (n: number, e: number): { x: number; y: number } => ({
    x: proj.cx + (e - proj.originE) * proj.mmPerUnit,
    y: proj.cy - (n - proj.originN) * proj.mmPerUnit,
  });

  const layerOf = (id: string): CadLayer | undefined => model.layers.find((l) => l.id === id);
  const layerVisible = (id: string): boolean => layerOf(id)?.visible !== false;

  const parts: string[] = [];

  // Clip path so geometry never spills over the frame.
  parts.push(
    `<clipPath id="frameClip"><rect x="${layout.frame.x}" y="${layout.frame.y}" ` +
      `width="${layout.frame.w}" height="${layout.frame.h}" /></clipPath>`,
  );

  // ── Sheet background + border ─────────────────────────────────────────────
  parts.push(`<rect x="0" y="0" width="${layout.paperW}" height="${layout.paperH}" fill="#ffffff" />`);
  parts.push(
    `<rect x="${layout.frame.x}" y="${layout.frame.y}" width="${layout.frame.w}" height="${layout.frame.h}" ` +
      `fill="none" stroke="#000" stroke-width="0.5" />`,
  );
  // Heavy outer trim line.
  parts.push(
    `<rect x="2" y="2" width="${layout.paperW - 4}" height="${layout.paperH - 4}" ` +
      `fill="none" stroke="#000" stroke-width="0.25" />`,
  );

  // ── Drawing content (clipped to frame) ────────────────────────────────────
  parts.push(`<g clip-path="url(#frameClip)">`);

  if (opts.showGrid && bounds) {
    parts.push(renderGraticule(bounds, proj.denominator, toPaper, opts.axisConvention ?? "yx"));
  }
  parts.push(renderSurfaces(model, layerOf, layerVisible, toPaper));
  parts.push(renderLinework(model, layerOf, layerVisible, toPaper, opts));
  parts.push(renderTexts(model, layerOf, layerVisible, toPaper));
  parts.push(renderPoints(model, layerOf, layerVisible, toPaper, opts));

  parts.push(`</g>`);

  // ── Sheet furniture ───────────────────────────────────────────────────────
  if (opts.showNorthArrow) parts.push(renderNorthArrow(layout));
  if (opts.showScaleBar) parts.push(renderScaleBar(layout, proj.denominator, proj.mmPerUnit));
  if (opts.showLegend) parts.push(renderLegend(model, layout));
  if (opts.showLegend) parts.push(renderSymbolLegend(model, layout));
  parts.push(renderTitleBlock(layout, opts, proj.denominator));

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.paperW}mm" height="${layout.paperH}mm" ` +
    `viewBox="0 0 ${layout.paperW} ${layout.paperH}" font-family="Arial, Helvetica, sans-serif">` +
    parts.join("") +
    `</svg>`;

  return { svg, denominator: proj.denominator, paperW: layout.paperW, paperH: layout.paperH, mmPerUnit: proj.mmPerUnit };
}

// ── Renderers ────────────────────────────────────────────────────────────────

type ToPaper = (n: number, e: number) => { x: number; y: number };

function renderGraticule(
  bounds: BBox,
  denom: number,
  toPaper: ToPaper,
  axisConvention: AxisConvention,
): string {
  const ax = axisLabels(axisConvention);
  // Pick a ground spacing that yields ~30–50 mm grid squares on paper.
  const mmPerUnit = 1000 / denom;
  const targetMm = 40;
  const rawSpacing = targetMm / mmPerUnit;
  const pow = Math.pow(10, Math.floor(Math.log10(rawSpacing)));
  const spacing = [1, 2, 5, 10].map((m) => m * pow).find((c) => c >= rawSpacing) ?? rawSpacing;

  const startE = Math.ceil(bounds.minE / spacing) * spacing;
  const endE = Math.floor(bounds.maxE / spacing) * spacing;
  const startN = Math.ceil(bounds.minN / spacing) * spacing;
  const endN = Math.floor(bounds.maxN / spacing) * spacing;

  const lines: string[] = [`<g stroke="#c8c8c8" stroke-width="0.12" fill="#555" font-size="2">`];

  for (let e = startE; e <= endE + 1e-6; e += spacing) {
    const top = toPaper(bounds.maxN, e);
    const bot = toPaper(bounds.minN, e);
    lines.push(`<line x1="${f(top.x)}" y1="${f(top.y)}" x2="${f(bot.x)}" y2="${f(bot.y)}" />`);
    // Tick label (Easting axis) at top, labelled per the axis convention.
    lines.push(
      `<text x="${f(top.x)}" y="${f(top.y - 1)}" text-anchor="middle">${ax.easting} ${Math.round(e)}E</text>`,
    );
  }
  for (let n = startN; n <= endN + 1e-6; n += spacing) {
    const left = toPaper(n, bounds.minE);
    const right = toPaper(n, bounds.maxE);
    lines.push(`<line x1="${f(left.x)}" y1="${f(left.y)}" x2="${f(right.x)}" y2="${f(right.y)}" />`);
    lines.push(
      `<text x="${f(left.x - 1)}" y="${f(left.y)}" text-anchor="end" dominant-baseline="middle" ` +
        `transform="rotate(-90 ${f(left.x - 1)} ${f(left.y)})">${ax.northing} ${Math.round(n)}N</text>`,
    );
  }
  lines.push(`</g>`);
  return lines.join("");
}

function renderSurfaces(
  model: CadModelState,
  layerOf: (id: string) => CadLayer | undefined,
  layerVisible: (id: string) => boolean,
  toPaper: ToPaper,
): string {
  const out: string[] = [];
  for (const srf of model.surfaces) {
    if (!srf.visible || !layerVisible(srf.layerId)) continue;
    const color = layerOf(srf.layerId)?.color ?? "#888";
    const screen = srf.points.map((v) => toPaper(v.n, v.e));
    out.push(`<g stroke="${color}" stroke-width="0.1" fill="none" opacity="0.6">`);
    for (const t of srf.triangles) {
      const a = screen[t.a]; const b = screen[t.b]; const c = screen[t.c];
      if (!a || !b || !c) continue;
      out.push(`<polygon points="${f(a.x)},${f(a.y)} ${f(b.x)},${f(b.y)} ${f(c.x)},${f(c.y)}" />`);
    }
    out.push(`</g>`);
  }
  return out.join("");
}

function renderLinework(
  model: CadModelState,
  layerOf: (id: string) => CadLayer | undefined,
  layerVisible: (id: string) => boolean,
  toPaper: ToPaper,
  opts: PlotOptions,
): string {
  const out: string[] = [];
  for (const lw of model.linework as SurveyLinework[]) {
    if (!layerVisible(lw.layerId)) continue;
    const color = resolveColor(lw.color, layerOf(lw.layerId)?.color, "#222");
    const pts = lw.vertices.map((v) => toPaper(v.n, v.e));
    if (pts.length < 2) continue;
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${f(p.x)},${f(p.y)}`).join(" ") + (lw.closed ? " Z" : "");
    const w = lw.kind === "boundary" ? 0.5 : lw.kind === "polyline" ? 0.35 : 0.3;
    out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round" />`);

    if (opts.showSegmentLabels) {
      for (let i = 1; i < lw.vertices.length; i++) {
        const a = lw.vertices[i - 1];
        const b = lw.vertices[i];
        const inv = inverse(a, b);
        const mid = toPaper((a.n + b.n) / 2, (a.e + b.e) / 2);
        out.push(
          `<text x="${f(mid.x)}" y="${f(mid.y - 0.8)}" font-size="1.8" fill="#333" text-anchor="middle">` +
            `${esc(fmtBearing(inv.azimuth, opts.bearingFormat))} ${esc(fmtDistance(inv.distance))}</text>`,
        );
      }
    }
  }
  return out.join("");
}

function renderTexts(
  model: CadModelState,
  layerOf: (id: string) => CadLayer | undefined,
  layerVisible: (id: string) => boolean,
  toPaper: ToPaper,
): string {
  const out: string[] = [];
  for (const t of model.texts as SurveyText[]) {
    if (!layerVisible(t.layerId)) continue;
    const color = resolveColor(t.color, layerOf(t.layerId)?.color, "#111");
    const s = toPaper(t.n, t.e);
    out.push(`<text x="${f(s.x)}" y="${f(s.y)}" font-size="2.6" fill="${color}">${esc(t.text)}</text>`);
  }
  return out.join("");
}

function renderPoints(
  model: CadModelState,
  layerOf: (id: string) => CadLayer | undefined,
  layerVisible: (id: string) => boolean,
  toPaper: ToPaper,
  opts: PlotOptions,
): string {
  const out: string[] = [];
  for (const p of model.points as SurveyPoint[]) {
    if (!layerVisible(p.layerId)) continue;
    const color = resolveColor(p.color, layerOf(p.layerId)?.color, "#111");
    const s = toPaper(p.n, p.e);
    const feature = resolveFeature(p.code, PLOT_CODE_TABLE);
    if (feature.symbol === "dot") {
      // Plain survey point marker: small cross + dot.
      out.push(
        `<g stroke="${color}" stroke-width="0.18">` +
          `<line x1="${f(s.x - 1)}" y1="${f(s.y)}" x2="${f(s.x + 1)}" y2="${f(s.y)}" />` +
          `<line x1="${f(s.x)}" y1="${f(s.y - 1)}" x2="${f(s.x)}" y2="${f(s.y + 1)}" />` +
          `</g><circle cx="${f(s.x)}" cy="${f(s.y)}" r="0.35" fill="${color}" />`,
      );
    } else {
      // Cartographic symbol (~1.4 mm) driven by the feature code.
      out.push(
        `<g transform="translate(${f(s.x)} ${f(s.y)})" stroke="${color}" ` +
          `stroke-width="0.22" fill="${color}">${symbolMarkup(feature.symbol, 1.4)}</g>`,
      );
    }
    if (opts.showPointLabels) {
      const label = `${p.pointNo}${p.code ? ` ${p.code}` : ""}`;
      out.push(`<text x="${f(s.x + 1.4)}" y="${f(s.y - 1)}" font-size="2" fill="${color}">${esc(label)}</text>`);
    }
  }
  return out.join("");
}

function renderNorthArrow(layout: PlotLayout): string {
  // Place top-right, inside the frame.
  const cx = layout.frame.x + layout.frame.w - 14;
  const cy = layout.frame.y + 18;
  const r = 9;
  return (
    `<g transform="translate(${f(cx)} ${f(cy)})" stroke="#000" fill="#000">` +
    `<circle cx="0" cy="0" r="${r}" fill="none" stroke-width="0.25" />` +
    // Filled north needle (pointing up).
    `<polygon points="0,${-r} 3,3 0,0.5" fill="#000" />` +
    // Open south needle.
    `<polygon points="0,${-r} -3,3 0,0.5" fill="#fff" stroke-width="0.2" />` +
    `<polygon points="0,${r} 3,-3 0,-0.5" fill="#fff" stroke-width="0.2" />` +
    `<polygon points="0,${r} -3,-3 0,-0.5" fill="#fff" stroke-width="0.2" />` +
    `<text x="0" y="${-r - 1.5}" text-anchor="middle" font-size="3.5" font-weight="bold" stroke="none">N</text>` +
    `</g>`
  );
}

function renderScaleBar(layout: PlotLayout, denom: number, mmPerUnit: number): string {
  // Choose a "nice" ground length giving a 40–80 mm bar.
  const targetMm = 60;
  const rawGround = targetMm / mmPerUnit; // ground metres
  const pow = Math.pow(10, Math.floor(Math.log10(rawGround)));
  const ground = [1, 2, 5, 10].map((m) => m * pow).reduce((best, c) =>
    Math.abs(c * mmPerUnit - targetMm) < Math.abs(best * mmPerUnit - targetMm) ? c : best, pow);
  const barMm = ground * mmPerUnit;
  const segs = 4;
  const segMm = barMm / segs;
  const segGround = ground / segs;

  const x0 = layout.frame.x + 10;
  const y0 = layout.frame.y + layout.frame.h - layout.tb.h - 10;
  const h = 2.2;

  const out: string[] = [`<g font-size="2.4" fill="#000">`];
  for (let i = 0; i < segs; i++) {
    out.push(
      `<rect x="${f(x0 + i * segMm)}" y="${f(y0)}" width="${f(segMm)}" height="${h}" ` +
        `fill="${i % 2 === 0 ? "#000" : "#fff"}" stroke="#000" stroke-width="0.2" />`,
    );
    out.push(`<text x="${f(x0 + i * segMm)}" y="${f(y0 + h + 3)}" text-anchor="middle">${fmtGround(i * segGround)}</text>`);
  }
  out.push(`<text x="${f(x0 + barMm)}" y="${f(y0 + h + 3)}" text-anchor="middle">${fmtGround(ground)} m</text>`);
  out.push(`<text x="${f(x0)}" y="${f(y0 - 1.5)}" font-weight="bold">SCALE 1:${denom}</text>`);
  out.push(`</g>`);
  return out.join("");
}

function fmtGround(m: number): string {
  return Number.isInteger(m) ? String(m) : m.toFixed(1);
}

function renderLegend(model: CadModelState, layout: PlotLayout): string {
  // Legend lists layers that actually carry geometry and are visible.
  const used = new Set<string>();
  for (const p of model.points) used.add(p.layerId);
  for (const l of model.linework) used.add(l.layerId);
  for (const t of model.texts) used.add(t.layerId);
  for (const s of model.surfaces) used.add(s.layerId);
  const layers = model.layers.filter((l) => l.visible && used.has(l.id));
  if (!layers.length) return "";

  const rowH = 5;
  const w = 44;
  const h = 8 + layers.length * rowH;
  const x = layout.frame.x + 6;
  const y = layout.frame.y + 6;

  const out: string[] = [
    `<g font-size="2.4" fill="#000">`,
    `<rect x="${f(x)}" y="${f(y)}" width="${w}" height="${f(h)}" fill="#fff" stroke="#000" stroke-width="0.25" opacity="0.92" />`,
    `<text x="${f(x + 3)}" y="${f(y + 5)}" font-weight="bold">LEGEND</text>`,
  ];
  layers.forEach((l, i) => {
    const ry = y + 8 + i * rowH + rowH / 2;
    out.push(`<line x1="${f(x + 3)}" y1="${f(ry)}" x2="${f(x + 12)}" y2="${f(ry)}" stroke="${l.color}" stroke-width="0.8" />`);
    out.push(`<text x="${f(x + 14)}" y="${f(ry + 0.9)}">${esc(l.name)}</text>`);
  });
  out.push(`</g>`);
  return out.join("");
}

/**
 * Legend of the feature *symbols* present in the drawing (as distinct from the
 * layer legend). Placed under the layer legend at top-left. Only symbols that
 * are actually used by at least one point are listed.
 */
function renderSymbolLegend(model: CadModelState, layout: PlotLayout): string {
  const used = new Map<string, { symbol: ReturnType<typeof resolveFeature>["symbol"]; label: string }>();
  for (const p of model.points) {
    const feat = resolveFeature(p.code, PLOT_CODE_TABLE);
    if (feat.symbol === "dot") continue;
    if (!used.has(feat.symbol)) used.set(feat.symbol, { symbol: feat.symbol, label: feat.description });
  }
  if (used.size === 0) return "";

  const entries = [...used.values()];
  const rowH = 5;
  const w = 44;
  const h = 8 + entries.length * rowH;
  const x = layout.frame.x + 6;
  // Position below the layer legend (approx height: 8 + layers*5, capped).
  const y = layout.frame.y + 6 + Math.min(60, 8 + model.layers.length * 5) + 4;

  const out: string[] = [
    `<g font-size="2.4" fill="#000">`,
    `<rect x="${f(x)}" y="${f(y)}" width="${w}" height="${f(h)}" fill="#fff" stroke="#000" stroke-width="0.25" opacity="0.92" />`,
    `<text x="${f(x + 3)}" y="${f(y + 5)}" font-weight="bold">SYMBOLS</text>`,
  ];
  entries.forEach((e, i) => {
    const ry = y + 8 + i * rowH + rowH / 2;
    out.push(
      `<g transform="translate(${f(x + 7)} ${f(ry)})" stroke="#000" stroke-width="0.22" fill="#000">` +
        `${symbolMarkup(e.symbol, 1.3)}</g>`,
    );
    out.push(`<text x="${f(x + 14)}" y="${f(ry + 0.9)}">${esc(e.label)}</text>`);
  });
  out.push(`</g>`);
  return out.join("");
}

function renderTitleBlock(layout: PlotLayout, opts: PlotOptions, denom: number): string {
  const { tb } = layout;
  const t = opts.titleBlock;
  const x = tb.x;
  const y = tb.y;
  const w = tb.w;
  const h = tb.h;

  // A grid of labelled cells, AutoCAD title-block style.
  const out: string[] = [`<g font-size="2.4" fill="#000">`];
  out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="#fff" stroke="#000" stroke-width="0.5" />`);

  // Header band: drawing title.
  const headerH = h * 0.32;
  out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(headerH)}" fill="#f0f0f0" stroke="#000" stroke-width="0.3" />`);
  out.push(
    `<text x="${f(x + w / 2)}" y="${f(y + headerH / 2 + 1.5)}" text-anchor="middle" font-size="4.2" font-weight="bold">` +
      `${esc(t.drawingTitle || "SURVEY PLAN")}</text>`,
  );

  // Body: two columns of key/value cells.
  const bodyY = y + headerH;
  const bodyH = h - headerH;
  const rows = 4;
  const rowH = bodyH / rows;
  const colX = x + w * 0.5;

  // Vertical divider + row lines.
  out.push(`<line x1="${f(colX)}" y1="${f(bodyY)}" x2="${f(colX)}" y2="${f(y + h)}" stroke="#000" stroke-width="0.3" />`);
  for (let r = 1; r < rows; r++) {
    const ly = bodyY + r * rowH;
    out.push(`<line x1="${f(x)}" y1="${f(ly)}" x2="${f(x + w)}" y2="${f(ly)}" stroke="#000" stroke-width="0.2" />`);
  }

  const cell = (cx: number, ry: number, label: string, value: string) => {
    out.push(`<text x="${f(cx + 1.5)}" y="${f(ry + 2)}" font-size="1.8" fill="#666">${esc(label)}</text>`);
    out.push(`<text x="${f(cx + 1.5)}" y="${f(ry + rowH - 1.2)}" font-size="2.6" font-weight="bold">${esc(value || "—")}</text>`);
  };

  // Left column.
  cell(x, bodyY + 0 * rowH, "PROJECT", t.projectName);
  cell(x, bodyY + 1 * rowH, "CLIENT", t.client);
  cell(x, bodyY + 2 * rowH, "DATUM / CRS", t.datum);
  cell(x, bodyY + 3 * rowH, "SURVEYOR", t.surveyor);

  // Right column.
  cell(colX, bodyY + 0 * rowH, "DRAWING No.", t.drawingNo);
  cell(colX, bodyY + 1 * rowH, "SCALE", `1:${denom}`);
  cell(colX, bodyY + 2 * rowH, "DATE", t.date);
  cell(colX, bodyY + 3 * rowH, "SHEET / REV", `${t.sheet}   ${t.revision}`);

  out.push(`</g>`);
  return out.join("");
}

/** Trim mm coordinates to 3 dp to keep the SVG compact. */
function f(v: number): string {
  return (Math.round(v * 1000) / 1000).toString();
}

/** Open the plot SVG in a new window sized to the sheet and trigger print. */
export function openPlotWindow(result: PlotResult, title: string): void {
  const win = window.open("", "_blank");
  if (!win) return;
  const html =
    `<!DOCTYPE html><html><head><title>${esc(title)}</title>` +
    `<style>` +
    `@page { size: ${result.paperW}mm ${result.paperH}mm; margin: 0; }` +
    `html,body { margin: 0; padding: 0; background: #525252; }` +
    `.sheet { display: block; margin: 0 auto; box-shadow: 0 0 12px rgba(0,0,0,0.5); background:#fff; }` +
    `@media print { body { background: #fff; } .sheet { box-shadow: none; } }` +
    `</style></head><body><div class="sheet">${result.svg}</div>` +
    `<script>window.onload=function(){setTimeout(function(){window.print();},250);};</script>` +
    `</body></html>`;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
}
