/**
 * GeoJSON import/export for survey points and linework.
 *
 * Mirrors the GeoRust-backed `survey-core::geojson_io` Rust module so the WASM
 * and pure-TS paths produce identical output. Points become GeoJSON `Point`
 * features; open linework becomes `LineString`; closed linework becomes
 * `Polygon`. Surveyor attributes ride along in feature `properties`.
 *
 * Coordinates use the CAD/GIS interchange convention X = Easting, Y = Northing,
 * with optional Z = Elevation as the third ordinate.
 */
import type { SurveyLinework, SurveyPoint } from "../cadModel.ts";

export interface GeoModelPoint {
  pointNo: string;
  n: number;
  e: number;
  z?: number | null;
  code?: string;
  layerId?: string;
}

export interface GeoModelLinework {
  vertices: { n: number; e: number }[];
  closed: boolean;
  layerId?: string;
}

export interface GeoModel {
  points: GeoModelPoint[];
  linework: GeoModelLinework[];
}

interface GeoJsonFeature {
  type: "Feature";
  geometry: {
    type: string;
    coordinates: unknown;
  } | null;
  properties: Record<string, unknown> | null;
}

interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

/** Convert the model's points + linework into a GeoJSON FeatureCollection. */
export function modelToGeoJson(model: GeoModel): string {
  const features: GeoJsonFeature[] = [];

  for (const p of model.points) {
    const coords = p.z != null ? [p.e, p.n, p.z] : [p.e, p.n];
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: coords },
      properties: {
        pointNo: p.pointNo,
        code: p.code ?? "",
        layer: p.layerId ?? "",
        ...(p.z != null ? { z: p.z } : {}),
      },
    });
  }

  for (const l of model.linework) {
    const ring = l.vertices.map((v) => [v.e, v.n]);
    if (l.closed && l.vertices.length >= 3) {
      const closed = [...ring];
      const first = closed[0];
      const last = closed[closed.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) closed.push(first);
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [closed] },
        properties: { layer: l.layerId ?? "", closed: true },
      });
    } else {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: ring },
        properties: { layer: l.layerId ?? "", closed: false },
      });
    }
  }

  const fc: GeoJsonFeatureCollection = { type: "FeatureCollection", features };
  return JSON.stringify(fc, null, 2);
}

function str(props: Record<string, unknown> | null, key: string): string {
  const v = props?.[key];
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Parse a GeoJSON string into a model. Unsupported geometries are skipped. */
export function modelFromGeoJson(text: string): GeoModel {
  const model: GeoModel = { points: [], linework: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return model;
  }

  let features: GeoJsonFeature[] = [];
  const root = parsed as { type?: string; features?: GeoJsonFeature[]; geometry?: unknown };
  if (root?.type === "FeatureCollection" && Array.isArray(root.features)) {
    features = root.features;
  } else if (root?.type === "Feature") {
    features = [root as unknown as GeoJsonFeature];
  } else if (root?.type && root.type !== "FeatureCollection") {
    // Bare geometry object.
    features = [{ type: "Feature", geometry: parsed as GeoJsonFeature["geometry"], properties: null }];
  }

  for (const f of features) {
    const geom = f.geometry;
    if (!geom) continue;
    const props = f.properties;
    if (geom.type === "Point") {
      const c = geom.coordinates as number[];
      const z = c.length > 2 ? c[2] : (typeof props?.z === "number" ? props.z : null);
      model.points.push({
        pointNo: str(props, "pointNo"),
        e: num(c[0]),
        n: num(c[1]),
        z,
        code: str(props, "code"),
        layerId: str(props, "layer"),
      });
    } else if (geom.type === "LineString") {
      const cs = geom.coordinates as number[][];
      model.linework.push({
        vertices: cs.map((c) => ({ e: num(c[0]), n: num(c[1]) })),
        closed: false,
        layerId: str(props, "layer"),
      });
    } else if (geom.type === "Polygon") {
      const rings = geom.coordinates as number[][][];
      const outer = rings[0] ?? [];
      const verts = outer.map((c) => ({ e: num(c[0]), n: num(c[1]) }));
      if (
        verts.length > 1 &&
        verts[0].e === verts[verts.length - 1].e &&
        verts[0].n === verts[verts.length - 1].n
      ) {
        verts.pop();
      }
      model.linework.push({ vertices: verts, closed: true, layerId: str(props, "layer") });
    }
  }
  return model;
}

/** Build a GeoModel from the CAD model's points and linework. */
export function toGeoModel(
  points: SurveyPoint[],
  linework: SurveyLinework[],
): GeoModel {
  return {
    points: points.map((p) => ({
      pointNo: p.pointNo,
      n: p.n,
      e: p.e,
      z: p.z,
      code: p.code,
      layerId: p.layerId,
    })),
    linework: linework.map((l) => ({
      vertices: l.vertices.map((v) => ({ n: v.n, e: v.e })),
      closed: l.closed,
      layerId: l.layerId,
    })),
  };
}
