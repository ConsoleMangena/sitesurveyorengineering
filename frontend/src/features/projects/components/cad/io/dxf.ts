/**
 * Minimal DXF (R2000 / AC1015 ASCII) writer for survey deliverables.
 *
 * AutoCAD and all major CAD packages open DXF natively. We emit:
 * - LAYER table entries (one per CAD layer, with AutoCAD colour indices)
 * - POINT entities for survey points (+ TEXT for point numbers)
 * - LINE / LWPOLYLINE entities for linework
 * - 3DFACE entities for TIN surfaces
 * - TEXT entities for annotations
 *
 * NOTE ON THE DXF VERSION: LWPOLYLINE and 3DFACE (as written here) are R13+
 * entities and are NOT valid in a strict R12 (AC1009) file. We therefore
 * declare AC1015 (AutoCAD 2000), the lowest version that fully supports every
 * entity we emit, so the output imports cleanly into strict parsers.
 *
 * Coordinates are written as X=Easting, Y=Northing, Z=Elevation, which is the
 * standard mapping when bringing survey data into CAD.
 */
import type { CadLayer, CadModelState } from "../cadModel.ts";

// Map a hex colour to the nearest of the 7 standard AutoCAD Color Indices.
function aci(hex: string): number {
  const palette: Record<string, number> = {
    "#f43f5e": 1, // red
    "#ff0000": 1, // red
    "#22c55e": 3, // green
    "#38bdf8": 4, // cyan
    "#22d3ee": 4, // cyan
    "#a78bfa": 6, // magenta-ish
    "#a855f7": 6, // magenta
    "#eab308": 2, // yellow
    "#ffff00": 2, // yellow
    "#f97316": 30, // orange
    "#ff7a00": 30, // orange
    "#3b82f6": 5, // blue
    "#94a3b8": 8, // grey
    "#ffffff": 7, // white
    "#e2e8f0": 7, // white
  };
  return palette[hex.toLowerCase()] ?? 7;
}

function group(code: number, value: string | number): string {
  return `${code}\n${value}\n`;
}

/** DXF colour group (62) for an explicit object colour; "" when ByLayer. */
function objColor(color: string | null | undefined): string {
  return color ? group(62, aci(color)) : "";
}

function layerTable(layers: CadLayer[]): string {
  let out = group(0, "TABLE") + group(2, "LAYER") + group(70, layers.length);
  for (const l of layers) {
    // AutoCAD convention: a layer is OFF when its colour (group 62) is
    // written as a NEGATIVE ACI. Group 70 carries the lock bit (4).
    const color = l.visible ? aci(l.color) : -aci(l.color);
    out +=
      group(0, "LAYER") +
      group(2, l.name.toUpperCase().replace(/\s+/g, "_")) +
      group(70, l.locked ? 4 : 0) +
      group(62, color) +
      group(6, "CONTINUOUS");
  }
  out += group(0, "ENDTAB");
  return out;
}

function layerName(layers: CadLayer[], id: string): string {
  const l = layers.find((x) => x.id === id);
  return (l ? l.name : id).toUpperCase().replace(/\s+/g, "_");
}

export function modelToDxf(model: CadModelState): string {
  const L = model.layers;
  let dxf = "";

  // HEADER (minimal).
  dxf += group(0, "SECTION") + group(2, "HEADER");
  dxf += group(9, "$ACADVER") + group(1, "AC1015");
  dxf += group(0, "ENDSEC");

  // TABLES.
  dxf += group(0, "SECTION") + group(2, "TABLES");
  dxf += layerTable(L);
  dxf += group(0, "ENDSEC");

  // ENTITIES.
  dxf += group(0, "SECTION") + group(2, "ENTITIES");

  for (const p of model.points) {
    const ln = layerName(L, p.layerId);
    dxf +=
      group(0, "POINT") +
      group(8, ln) +
      objColor(p.color) +
      group(10, p.e) +
      group(20, p.n) +
      group(30, p.z ?? 0);
    // Point number label.
    dxf +=
      group(0, "TEXT") +
      group(8, ln) +
      group(10, p.e) +
      group(20, p.n) +
      group(30, 0) +
      group(40, 1.5) +
      group(1, p.pointNo + (p.code ? ` ${p.code}` : ""));
  }

  for (const lw of model.linework) {
    const ln = layerName(L, lw.layerId);
    if (lw.vertices.length === 2 && lw.kind === "line") {
      const [a, b] = lw.vertices;
      dxf +=
        group(0, "LINE") +
        group(8, ln) +
        objColor(lw.color) +
        group(10, a.e) +
        group(20, a.n) +
        group(30, 0) +
        group(11, b.e) +
        group(21, b.n) +
        group(31, 0);
    } else {
      dxf +=
        group(0, "LWPOLYLINE") +
        group(8, ln) +
        objColor(lw.color) +
        group(90, lw.vertices.length) +
        group(70, lw.closed ? 1 : 0);
      for (const v of lw.vertices) {
        dxf += group(10, v.e) + group(20, v.n);
      }
    }
  }

  // TIN surfaces as 3DFACE entities (one per triangle), so the DTM imports
  // into AutoCAD/Civil 3D as a true 3D surface mesh.
  for (const srf of model.surfaces) {
    const ln = layerName(L, srf.layerId);
    for (const tri of srf.triangles) {
      const a = srf.points[tri.a];
      const b = srf.points[tri.b];
      const c = srf.points[tri.c];
      if (!a || !b || !c) continue;
      dxf +=
        group(0, "3DFACE") +
        group(8, ln) +
        group(10, a.e) + group(20, a.n) + group(30, a.z) +
        group(11, b.e) + group(21, b.n) + group(31, b.z) +
        group(12, c.e) + group(22, c.n) + group(32, c.z) +
        // 4th corner repeats the 3rd (triangular face).
        group(13, c.e) + group(23, c.n) + group(33, c.z);
    }
  }

  for (const t of model.texts) {
    dxf +=
      group(0, "TEXT") +
      group(8, layerName(L, t.layerId)) +
      objColor(t.color) +
      group(10, t.e) +
      group(20, t.n) +
      group(30, 0) +
      group(40, 2) +
      group(1, t.text);
  }

  dxf += group(0, "ENDSEC") + group(0, "EOF");
  return dxf;
}

/** Trigger a browser download of a text blob. */
export function downloadText(filename: string, content: string, mime = "text/plain"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
