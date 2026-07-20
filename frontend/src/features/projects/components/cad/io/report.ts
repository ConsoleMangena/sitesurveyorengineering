/**
 * Survey report generator (coordinate list, traverse summary, surface
 * summary, cut/fill volume report).
 *
 * Opens in a styled, printable window so the surveyor can save as PDF or
 * hand directly to a client.
 */
import type { CadModelState, SurveySurface } from "../cadModel.ts";
import { computeTraverse, inverse, type NE } from "../survey/cogo.ts";
import { fmtCoord, fmtDistance, fmtArea } from "../survey/format.ts";
import { planArea as computePlanArea } from "../survey/surface.ts";
import type { TerrainStats } from "../survey/terrain.ts";

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtVol(v: number): string {
  return v.toFixed(2);
}

/* ── Full survey report (coordinate list + traverse + surfaces + cut/fill) ── */

export function buildSurveyReport(
  projectName: string,
  projectId: string,
  model: CadModelState,
): string {
  const sections: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────
  sections.push(reportHeader(projectName, projectId));

  // ── Coordinate list ─────────────────────────────────────────────────────
  sections.push(coordinateListSection(model));

  // ── Traverse summary ────────────────────────────────────────────────────
  if (model.points.length >= 3) {
    sections.push(traverseSection(model));
  }

  // ── Surface summaries ───────────────────────────────────────────────────
  if (model.surfaces.length > 0) {
    sections.push(surfaceSummarySection(model.surfaces));
  }

  // ── Cut / fill volume reports ───────────────────────────────────────────
  const cutFillSurfaces = model.surfaces.filter((s) => s.cutFill);
  if (cutFillSurfaces.length > 0) {
    sections.push(cutFillSection(cutFillSurfaces));
  }

  return sections.join("");
}

/* ── Cut/fill-only report (for the dedicated Surface ribbon button) ─────── */

export function buildCutFillReport(
  projectName: string,
  projectId: string,
  model: CadModelState,
): string {
  const sections: string[] = [];
  sections.push(reportHeader(projectName, projectId, "CUT / FILL VOLUME REPORT"));

  if (model.surfaces.length > 0) {
    sections.push(surfaceSummarySection(model.surfaces));
  }

  const cutFillSurfaces = model.surfaces.filter((s) => s.cutFill);
  if (cutFillSurfaces.length > 0) {
    sections.push(cutFillSection(cutFillSurfaces));
  } else {
    sections.push(
      `<section class="report-section"><p class="report-empty">No cut/fill computations found. Run <strong>Vol → RL</strong> or <strong>Vol Δ</strong> first.</p></section>`,
    );
  }

  return sections.join("");
}

/* ── Terrain analysis report ────────────────────────────────────────────── */

export function buildTerrainReport(
  projectName: string,
  projectId: string,
  surfaceName: string,
  stats: TerrainStats,
): string {
  const rugosity = stats.planArea > 0 ? stats.surfaceArea / stats.planArea : 1;
  return (
    reportHeader(projectName, projectId, "TERRAIN ANALYSIS REPORT") +
    `
<section class="report-section">
  <h2>${escapeHtml(surfaceName)}</h2>
  <table class="report-table report-table-kv">
    <tbody>
      <tr><td>Plan area</td><td class="num">${fmtArea(stats.planArea)}</td></tr>
      <tr><td>True 3D surface area</td><td class="num">${fmtArea(stats.surfaceArea)}</td></tr>
      <tr><td>Rugosity (3D / plan)</td><td class="num">${rugosity.toFixed(4)}</td></tr>
      <tr><td>Mean slope</td><td class="num">${stats.meanSlopeDeg.toFixed(2)}°</td></tr>
      <tr><td>Min slope</td><td class="num">${stats.minSlopeDeg.toFixed(2)}°</td></tr>
      <tr><td>Max slope</td><td class="num">${stats.maxSlopeDeg.toFixed(2)}°</td></tr>
      <tr><td>Min elevation</td><td class="num">${fmtCoord(stats.minElevation)} m</td></tr>
      <tr><td>Max elevation</td><td class="num">${fmtCoord(stats.maxElevation)} m</td></tr>
      <tr><td>Relief (max − min)</td><td class="num">${fmtCoord(stats.maxElevation - stats.minElevation)} m</td></tr>
      <tr><td>Triangles</td><td class="num">${stats.triangles}</td></tr>
    </tbody>
  </table>
</section>`
  );
}

/* ── Section builders ──────────────────────────────────────────────────── */

function reportHeader(project: string, projectId: string, title = "SURVEY REPORT"): string {
  return `
<header class="report-header">
  <h1>${escapeHtml(title)}</h1>
  <div class="report-meta">
    <span><strong>Project:</strong> ${escapeHtml(project)} (${escapeHtml(projectId)})</span>
    <span><strong>Generated:</strong> ${new Date().toLocaleString()}</span>
  </div>
</header>`;
}

function coordinateListSection(model: CadModelState): string {
  if (model.points.length === 0) {
    return `<section class="report-section"><h2>Coordinate List</h2><p class="report-empty">No points in the drawing.</p></section>`;
  }
  let rows = "";
  for (const p of model.points) {
    rows += `<tr>
      <td>${escapeHtml(p.pointNo)}</td>
      <td class="num">${fmtCoord(p.e)}</td>
      <td class="num">${fmtCoord(p.n)}</td>
      <td class="num">${p.z == null ? "—" : fmtCoord(p.z)}</td>
      <td>${escapeHtml(p.code)}</td>
    </tr>`;
  }
  return `
<section class="report-section">
  <h2>Coordinate List <span class="report-count">(${model.points.length} points)</span></h2>
  <table class="report-table">
    <thead><tr><th>Pt#</th><th>Y (Easting)</th><th>X (Northing)</th><th>Z (RL)</th><th>Code</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function traverseSection(model: CadModelState): string {
  const ordered = [...model.points].sort(
    (a, b) => (parseInt(a.pointNo, 10) || 0) - (parseInt(b.pointNo, 10) || 0),
  );
  const start: NE = { n: ordered[0].n, e: ordered[0].e };
  const legs = [];
  for (let i = 1; i < ordered.length; i++) {
    const r = inverse(
      { n: ordered[i - 1].n, e: ordered[i - 1].e },
      { n: ordered[i].n, e: ordered[i].e },
    );
    legs.push({ azimuth: r.azimuth, distance: r.distance });
  }
  const close = inverse(
    { n: ordered[ordered.length - 1].n, e: ordered[ordered.length - 1].e },
    start,
  );
  legs.push({ azimuth: close.azimuth, distance: close.distance });
  const tr = computeTraverse(start, legs);

  return `
<section class="report-section">
  <h2>Traverse Summary <span class="report-count">(closed loop by point order)</span></h2>
  <table class="report-table report-table-kv">
    <tbody>
      <tr><td>Perimeter</td><td class="num">${fmtDistance(tr.perimeter)} m</td></tr>
      <tr><td>Misclosure Y (Easting)</td><td class="num">${fmtCoord(tr.misclosureE)} m</td></tr>
      <tr><td>Misclosure X (Northing)</td><td class="num">${fmtCoord(tr.misclosureN)} m</td></tr>
      <tr><td>Linear misclosure</td><td class="num">${fmtDistance(tr.linearMisclosure)} m</td></tr>
      <tr><td>Precision</td><td class="num">${tr.precision === Infinity ? "Perfect closure" : `1:${Math.round(tr.precision).toLocaleString()}`}</td></tr>
    </tbody>
  </table>
</section>`;
}

function surfaceSummarySection(surfaces: SurveySurface[]): string {
  let rows = "";
  for (const s of surfaces) {
    const area = computePlanArea({ points: s.points, triangles: s.triangles });
    const type = s.cutFill ? "Cut/Fill" : "TIN";
    rows += `<tr>
      <td>${escapeHtml(s.name)}</td>
      <td>${type}</td>
      <td class="num">${s.points.length}</td>
      <td class="num">${s.triangles.length}</td>
      <td class="num">${fmtArea(area)}</td>
    </tr>`;
  }
  return `
<section class="report-section">
  <h2>Surface Summary <span class="report-count">(${surfaces.length} surface${surfaces.length === 1 ? "" : "s"})</span></h2>
  <table class="report-table">
    <thead><tr><th>Name</th><th>Type</th><th>Points</th><th>Triangles</th><th>Plan Area</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function cutFillSection(surfaces: SurveySurface[]): string {
  let html = "";
  for (const s of surfaces) {
    const cf = s.cutFill!;
    const area = computePlanArea({ points: s.points, triangles: s.triangles });

    // Aggregate totals
    let totalCut = 0;
    let totalFill = 0;
    for (const t of cf.triangles) {
      if (t.volume >= 0) totalCut += t.volume;
      else totalFill += -t.volume;
    }
    const net = totalCut - totalFill;

    // Mode label
    const modeLabel =
      cf.mode === "elevation"
        ? `Surface vs Reference Level ${cf.reference != null ? cf.reference.toFixed(2) : "—"} m`
        : "Surface vs Surface (between)";

    // Summary table
    html += `
<section class="report-section report-cutfill">
  <h2>Cut / Fill — ${escapeHtml(s.name)}</h2>
  <p class="report-mode">${modeLabel}</p>
  <table class="report-table report-table-kv report-volume-summary">
    <tbody>
      <tr class="cut-row"><td>Total Cut</td><td class="num">${fmtVol(totalCut)} m³</td></tr>
      <tr class="fill-row"><td>Total Fill</td><td class="num">${fmtVol(totalFill)} m³</td></tr>
      <tr class="net-row"><td>Net Volume</td><td class="num">${fmtVol(net)} m³ <span class="net-label">(${net >= 0 ? "net cut" : "net fill"})</span></td></tr>
      <tr><td>Plan Area</td><td class="num">${fmtArea(area)}</td></tr>
      <tr><td>Max Cut Depth</td><td class="num">${cf.maxCut.toFixed(3)} m</td></tr>
      <tr><td>Max Fill Depth</td><td class="num">${cf.maxFill.toFixed(3)} m</td></tr>
      <tr><td>Triangles</td><td class="num">${cf.triangles.length}</td></tr>
    </tbody>
  </table>`;

    // Per-triangle detail table (capped at 200 rows for readability)
    const MAX_DETAIL_ROWS = 200;
    const sorted = [...cf.triangles]
      .map((t, i) => ({ ...t, idx: i }))
      .sort((a, b) => Math.abs(b.volume) - Math.abs(a.volume));
    const shown = sorted.slice(0, MAX_DETAIL_ROWS);

    let detailRows = "";
    for (const t of shown) {
      const triArea = t.volume !== 0 && t.delta !== 0 ? Math.abs(t.volume / t.delta) : 0;
      const cls = t.delta > 0.001 ? "cut-row" : t.delta < -0.001 ? "fill-row" : "";
      detailRows += `<tr class="${cls}">
        <td class="num">${t.idx + 1}</td>
        <td class="num">${triArea.toFixed(2)}</td>
        <td class="num">${t.delta >= 0 ? "+" : ""}${t.delta.toFixed(3)}</td>
        <td class="num">${t.volume >= 0 ? "+" : ""}${t.volume.toFixed(3)}</td>
        <td class="num">${t.delta > 0.001 ? "CUT" : t.delta < -0.001 ? "FILL" : "—"}</td>
      </tr>`;
    }

    html += `
  <h3>Triangle Detail <span class="report-count">(top ${shown.length} by volume${sorted.length > MAX_DETAIL_ROWS ? `, ${sorted.length - MAX_DETAIL_ROWS} more omitted` : ""})</span></h3>
  <table class="report-table report-detail">
    <thead><tr><th>Tri #</th><th>Area (m²)</th><th>Δ Height (m)</th><th>Volume (m³)</th><th>Type</th></tr></thead>
    <tbody>${detailRows}</tbody>
  </table>
</section>`;
  }

  return html;
}

/* ── Report window ─────────────────────────────────────────────────────── */

const REPORT_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 11px;
    line-height: 1.5;
    color: #1e293b;
    background: #fff;
    padding: 32px 40px;
    max-width: 1100px;
    margin: 0 auto;
  }

  .report-header {
    border-bottom: 3px solid #0f172a;
    padding-bottom: 12px;
    margin-bottom: 24px;
  }
  .report-header h1 {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #0f172a;
  }
  .report-meta {
    display: flex;
    gap: 24px;
    margin-top: 6px;
    font-size: 11px;
    color: #475569;
  }

  .report-section {
    margin-bottom: 28px;
    page-break-inside: avoid;
  }
  .report-section h2 {
    font-size: 14px;
    font-weight: 600;
    color: #0f172a;
    border-bottom: 1.5px solid #cbd5e1;
    padding-bottom: 4px;
    margin-bottom: 10px;
  }
  .report-section h3 {
    font-size: 12px;
    font-weight: 600;
    color: #334155;
    margin-top: 16px;
    margin-bottom: 6px;
  }
  .report-count {
    font-weight: 400;
    color: #64748b;
    font-size: 0.85em;
  }
  .report-mode {
    font-size: 11px;
    color: #475569;
    margin-bottom: 8px;
    font-style: italic;
  }
  .report-empty {
    color: #94a3b8;
    font-style: italic;
  }

  .report-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }
  .report-table th {
    background: #f1f5f9;
    font-weight: 600;
    text-align: left;
    padding: 5px 8px;
    border-bottom: 1.5px solid #94a3b8;
    color: #334155;
    white-space: nowrap;
  }
  .report-table td {
    padding: 3px 8px;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: top;
  }
  .report-table td.num,
  .report-table th.num {
    text-align: right;
    font-feature-settings: 'tnum';
  }
  .report-table tbody tr:hover {
    background: #f8fafc;
  }

  .report-table-kv {
    max-width: 480px;
  }
  .report-table-kv td:first-child {
    font-weight: 500;
    color: #475569;
    width: 200px;
  }

  .report-volume-summary .cut-row td { color: #dc2626; }
  .report-volume-summary .fill-row td { color: #2563eb; }
  .report-volume-summary .net-row td { font-weight: 700; color: #0f172a; }
  .net-label { font-weight: 400; color: #64748b; font-size: 0.9em; }

  .report-detail .cut-row td:nth-child(4),
  .report-detail .cut-row td:nth-child(5) { color: #dc2626; }
  .report-detail .fill-row td:nth-child(4),
  .report-detail .fill-row td:nth-child(5) { color: #2563eb; }

  @media print {
    body { padding: 16px 20px; font-size: 9.5px; }
    .report-header { margin-bottom: 16px; }
    .report-section { margin-bottom: 18px; }
    .report-table th { background: #f1f5f9 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .report-volume-summary .cut-row td { color: #dc2626 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .report-volume-summary .fill-row td { color: #2563eb !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .report-detail .cut-row td:nth-child(4),
    .report-detail .cut-row td:nth-child(5) { color: #dc2626 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .report-detail .fill-row td:nth-child(4),
    .report-detail .fill-row td:nth-child(5) { color: #2563eb !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

export function openReportWindow(title: string, bodyHtml: string): void {
  const win = window.open("", "_blank", "width=900,height=960");
  if (!win) return;
  win.document.write(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>${REPORT_CSS}</style>
</head>
<body>${bodyHtml}</body>
</html>`,
  );
  win.document.close();
  win.focus();
}
