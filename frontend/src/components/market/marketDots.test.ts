import { describe, expect, it } from "vitest";
import {
  buildMarketDots,
  MARKET_DOT_COLORS,
  toFeatureCollection,
  type MarketDot,
} from "./marketDots";

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Item ${id}`,
    location: "Nairobi",
    latitude: -1.2,
    longitude: 36.8,
    ...overrides,
  };
}

describe("buildMarketDots", () => {
  it("drops rows without finite coordinates", () => {
    const dots = buildMarketDots(
      [row("a"), row("b", { latitude: null })],
      [row("c", { longitude: NaN })],
    );
    expect(dots.map((d) => d.id)).toEqual(["a"]);
  });

  it("tags kinds and maps coordinates", () => {
    const dots = buildMarketDots([row("a")], [row("p")]);
    expect(dots).toEqual([
      {
        kind: "listing",
        id: "a",
        name: "Item a",
        location: "Nairobi",
        lat: -1.2,
        lng: 36.8,
      },
      {
        kind: "professional",
        id: "p",
        name: "Item p",
        location: "Nairobi",
        lat: -1.2,
        lng: 36.8,
      },
    ]);
  });

  it("caps the total across both kinds, listings first", () => {
    const listings = ["a", "b"].map((i) => row(i));
    const professionals = ["p", "q"].map((i) => row(i));
    const dots = buildMarketDots(listings, professionals, 3);
    expect(dots.map((d) => d.id)).toEqual(["a", "b", "p"]);
  });

  it("treats a null location as an empty string", () => {
    const dots = buildMarketDots([row("a", { location: null })], []);
    expect(dots[0]?.location).toBe("");
  });
});

describe("toFeatureCollection", () => {
  it("produces lng/lat point features carrying identity properties", () => {
    const dots: MarketDot[] = [
      { kind: "listing", id: "a", name: "A", location: "X", lat: -1.2, lng: 36.8 },
    ];
    expect(toFeatureCollection(dots)).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { kind: "listing", id: "a" },
          geometry: { type: "Point", coordinates: [36.8, -1.2] },
        },
      ],
    });
  });
});

describe("MARKET_DOT_COLORS", () => {
  it("uses amber for listings and cyan for professionals", () => {
    expect(MARKET_DOT_COLORS.listing).toBe("#f59e0b");
    expect(MARKET_DOT_COLORS.professional).toBe("#06b6d4");
  });
});
