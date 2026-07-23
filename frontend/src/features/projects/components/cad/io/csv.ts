/**
 * CSV import/export for survey points.
 *
 * Default field order is the Southern-African surveyor layout: P,Y,X,Z,Code
 * (PointNo, Y/Easting, X/Northing, Z/Elevation, Code), matching the Y=Easting,
 * X=Northing convention used throughout the app (see `fmtPointRef` and the DXF
 * writer). A header row is auto-detected and skipped.
 */
import type { SurveyPoint } from "../cadModel.ts";

export type ParsedPoint = Omit<SurveyPoint, "id" | "layerId">;

export interface CsvParseResult {
  points: ParsedPoint[];
  skipped: number;
  errors: string[];
}

function looksNumeric(v: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(v.trim());
}

export interface CsvColumnMapping {
  pointNo: number;
  easting: number;
  northing: number;
  elevation: number | null;
  code: number | null;
}

export function parsePointsCsv(text: string, mapping?: CsvColumnMapping, hasHeader?: boolean): CsvParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const points: ParsedPoint[] = [];
  const errors: string[] = [];
  let skipped = 0;

  lines.forEach((line, idx) => {
    const cols = line.split(/[,\t;]/).map((c) => c.trim());
    if (cols.length < 2) {
      skipped += 1;
      return;
    }

    if (mapping) {
      // Mapped import: skip the header row when present.
      if (hasHeader && idx === 0) return;
      const col = (i: number) => cols[i] ?? "";
      const eRaw = col(mapping.easting);
      const nRaw = col(mapping.northing);
      const e = parseFloat(eRaw);
      const n = parseFloat(nRaw);
      if (!Number.isFinite(n) || !Number.isFinite(e)) {
        errors.push(`Line ${idx + 1}: invalid X/Y`);
        skipped += 1;
        return;
      }
      const zRaw = mapping.elevation == null ? "" : col(mapping.elevation);
      const z = zRaw && looksNumeric(zRaw) ? parseFloat(zRaw) : null;
      const codeRaw = mapping.code == null ? "" : col(mapping.code);
      const pno = col(mapping.pointNo);
      points.push({
        pointNo: pno || String(idx + 1),
        n,
        e,
        z,
        code: codeRaw,
      });
      return;
    }

    // Header detection: a genuine header row has non-numeric labels across
    // its leading columns (e.g. "PointNo,Y,X"). A data row with a
    // numeric point number but unparseable N/E is NOT a header; it must be
    // reported as an error rather than silently skipped.
    if (
      idx === 0 &&
      !looksNumeric(cols[0]) &&
      !looksNumeric(cols[1]) &&
      !looksNumeric(cols[2])
    ) {
      return; // skip header silently
    }
    // Column order is PointNo, Y(Easting), X(Northing), Z, Code.
    const [pno, eRaw, nRaw, zRaw, code] = cols;
    const e = parseFloat(eRaw);
    const n = parseFloat(nRaw);
    if (!Number.isFinite(n) || !Number.isFinite(e)) {
      errors.push(`Line ${idx + 1}: invalid X/Y`);
      skipped += 1;
      return;
    }
    const z = zRaw && looksNumeric(zRaw) ? parseFloat(zRaw) : null;
    points.push({
      pointNo: pno || String(idx + 1),
      n,
      e,
      z,
      code: code ?? "",
    });
  });

  return { points, skipped, errors };
}

export function pointsToCsv(points: SurveyPoint[]): string {
  // Y = Easting, X = Northing (Southern-African convention).
  const header = "PointNo,Y,X,Z,Code";
  const rows = points.map((p) =>
    [p.pointNo, p.e.toFixed(4), p.n.toFixed(4), p.z == null ? "" : p.z.toFixed(4), p.code]
      .join(","),
  );
  return [header, ...rows].join("\n");
}
