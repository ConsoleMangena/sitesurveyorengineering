import type * as GeoJSON from "geojson";

export const MARKET_DOT_COLORS = {
  listing: "#f59e0b",
  professional: "#06b6d4",
} as const;

export type MarketDotKind = keyof typeof MARKET_DOT_COLORS;

/** One tappable point on the public market globe. */
export interface MarketDot {
  kind: MarketDotKind;
  id: string;
  name: string;
  location: string;
  lat: number;
  lng: number;
}

export interface MarketDotSource {
  id: string;
  name: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Plot every row that has coordinates, listings first, capped overall. */
export function buildMarketDots(
  listings: MarketDotSource[],
  professionals: MarketDotSource[],
  cap = 500,
): MarketDot[] {
  const dots: MarketDot[] = [];
  const groups = [
    [listings, "listing"],
    [professionals, "professional"],
  ] as const;
  for (const [rows, kind] of groups) {
    for (const row of rows) {
      if (dots.length >= cap) return dots;
      if (!Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) continue;
      dots.push({
        kind,
        id: row.id,
        name: row.name,
        location: row.location ?? "",
        lat: row.latitude as number,
        lng: row.longitude as number,
      });
    }
  }
  return dots;
}

export function toFeatureCollection(
  dots: MarketDot[],
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: dots.map((dot) => ({
      type: "Feature",
      properties: { kind: dot.kind, id: dot.id },
      geometry: { type: "Point", coordinates: [dot.lng, dot.lat] },
    })),
  };
}
