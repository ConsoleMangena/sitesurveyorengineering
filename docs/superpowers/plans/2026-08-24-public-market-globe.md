# Public Market with Full Globe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A no-login `/market` page showing every marketplace listing and professional on a full 3D maplibre globe, plus read-only searchable card grids below.

**Architecture:** Two Postgres views expose only safe columns of `marketplace_listings` and `professionals` to `anon` (base-table RLS untouched). Coordinates are auto-geocoded on save (Open-Meteo, best-effort) and backfilled by an edge function. The frontend adds a lazy-loaded public route rendering a maplibre globe (two circle layers) over searchable card grids.

**Tech Stack:** React 19 + Vite + Tailwind 4, Supabase JS v2, maplibre-gl v6, Deno edge functions, vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-public-market-globe-design.md`

## Global Constraints

- Package manager commands run through the root scripts: `npm --prefix frontend …`; lint/typecheck/test/build via root `npm run lint|typecheck|test|build`.
- Never expose `seller_wallet_address` or `workspace_id` publicly — views use explicit column lists, never `*`.
- Geocoding is always best-effort: a failure must never block saving a listing/professional.
- No comments in code unless explaining a non-obvious decision (repo style has occasional block comments for rationale).
- Frontend imports use explicit `.ts`/`.tsx` extensions (existing convention in this repo).
- Do NOT modify unrelated files; `frontend/src/features/projects/components/cad/CadPlotDialog.tsx` and `opencode/opencode.json` have pre-existing uncommitted changes — leave them alone.

---

### Task 1: Database migration + Supabase types

**Files:**
- Create: `backend/sql/0002_public_market.sql`
- Modify: `frontend/src/lib/supabase/types.ts`

**Interfaces:**
- Produces: anon-readable relations `public_market_listings` and `public_market_professionals`; nullable `latitude`/`longitude` columns on both base tables; matching `Views` entries in `Database` so `supabase.from("public_market_listings")` type-checks.

- [ ] **Step 1: Write the migration**

Create `backend/sql/0002_public_market.sql`:

```sql
-- 0002_public_market.sql — coordinate columns + anonymous-read views for the
-- public market (/market). Run in the Supabase SQL editor AFTER 0001_schema.sql.
--
-- The views deliberately enumerate columns: sensitive fields such as
-- marketplace_listings.seller_wallet_address and every *_workspace_id must
-- stay unreachable anonymously. Base-table RLS is unchanged; these views are
-- the only anon door (definer semantics bypass RLS for their own column set).

-- ── Coordinate columns ──

alter table public.marketplace_listings
  add column if not exists listing_type text;
alter table public.marketplace_listings
  add column if not exists latitude double precision;
alter table public.marketplace_listings
  add column if not exists longitude double precision;

alter table public.professionals
  add column if not exists latitude double precision;
alter table public.professionals
  add column if not exists longitude double precision;

-- listing_type exists in the live database but predates 0001_schema.sql;
-- ensured above so the view works on fresh and drifted databases alike.

-- ── Public views ──

create or replace view public.public_market_listings as
select
  id,
  name,
  type,
  condition,
  price,
  currency,
  seller,
  location,
  description,
  specs,
  listing_type,
  latitude,
  longitude,
  created_at
from public.marketplace_listings;

create or replace view public.public_market_professionals as
select
  id,
  name,
  title,
  discipline,
  experience,
  location,
  rate,
  rate_per,
  currency,
  availability,
  rating,
  reviews,
  skills,
  bio,
  certifications,
  latitude,
  longitude
from public.professionals;

-- ── Grants ──

grant select on public.public_market_listings to anon, authenticated;
grant select on public.public_market_professionals to anon, authenticated;
```

- [ ] **Step 2: Update the generated types — table columns**

In `frontend/src/lib/supabase/types.ts`, inside `public.Tables.marketplace_listings.Row` (alphabetical order), add between the `listing_type` and `location` lines:

```ts
          latitude: number | null
          longitude: number | null
```

Add the same two lines in `marketplace_listings.Insert` and `marketplace_listings.Update`, but as optional:

```ts
          latitude?: number | null
          longitude?: number | null
```

Repeat all three additions for `public.Tables.professionals` (`latitude` goes alphabetically before `location`, `longitude` before `name`).

- [ ] **Step 3: Update the generated types — Views**

Replace the empty public `Views` block:

```ts
    Views: {
      [_ in never]: never
    }
```

with:

```ts
    Views: {
      public_market_listings: {
        Row: {
          condition: string
          created_at: string
          currency: string
          description: string | null
          id: string
          latitude: number | null
          listing_type: string | null
          location: string
          longitude: number | null
          name: string
          price: number
          seller: string
          specs: string[] | null
          type: string
        }
      }
      public_market_professionals: {
        Row: {
          availability: string
          bio: string | null
          certifications: string[] | null
          currency: string
          discipline: string
          experience: string
          id: string
          latitude: number | null
          location: string
          longitude: number | null
          name: string
          rate: number
          rate_per: string
          rating: number | null
          reviews: number | null
          skills: string[] | null
          title: string
        }
      }
    }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors)

- [ ] **Step 5: Commit**

```bash
git add backend/sql/0002_public_market.sql frontend/src/lib/supabase/types.ts
git commit -m "feat(db): public market views and coordinate columns"
```

---

### Task 2: Geocoding module (TDD)

**Files:**
- Create: `frontend/src/lib/geo/geocode.ts`
- Test: `frontend/src/lib/geo/geocode.test.ts`

**Interfaces:**
- Produces:
  - `geocodeLocation(text: string, timeoutMs?: number): Promise<{ lat: number; lng: number } | null>`
  - `attachCoordinates<P extends { location?: string | null; latitude?: number | null; longitude?: number | null }>(payload: P): Promise<P>`
  - `clearGeocodeCache(): void` (test helper)

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/geo/geocode.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachCoordinates,
  clearGeocodeCache,
  geocodeLocation,
} from "./geocode.ts";

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearGeocodeCache();
});

describe("geocodeLocation", () => {
  it("resolves the first Open-Meteo hit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        results: [
          { latitude: -1.286389, longitude: 36.817223, name: "Nairobi" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await geocodeLocation("Nairobi, Kenya")).toEqual({
      lat: -1.286389,
      lng: 36.817223,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("name=Nairobi");
  });

  it("returns null for blank input without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await geocodeLocation("   ")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when nothing matched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({})));
    expect(await geocodeLocation("Nowhereville")).toBeNull();
  });

  it("returns null on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 500 })),
    );
    expect(await geocodeLocation("Nairobi")).toBeNull();
  });

  it("returns null when the request fails or times out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await geocodeLocation("Nairobi")).toBeNull();
  });

  it("caches repeated queries but not failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ results: [{ latitude: 1, longitude: 2 }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await geocodeLocation("Nairobi");
    await geocodeLocation("Nairobi");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await geocodeLocation("Kisumu");
    await geocodeLocation("Kisumu");
    expect(
      (vi.mocked(globalThis.fetch)).mock.calls.length,
    ).toBe(2);
  });
});

describe("attachCoordinates", () => {
  it("fills missing coordinates from the location text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({ results: [{ latitude: -1.29, longitude: 36.82 }] }),
      ),
    );

    const payload = await attachCoordinates({
      name: "Leica TS16",
      location: "Nairobi",
      latitude: null,
      longitude: null,
    });
    expect(payload.latitude).toBe(-1.29);
    expect(payload.longitude).toBe(36.82);
    expect(payload.name).toBe("Leica TS16");
  });

  it("keeps coordinates that are already present", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const payload = await attachCoordinates({
      location: "Nairobi",
      latitude: 5,
      longitude: 6,
    });
    expect(payload).toEqual({ location: "Nairobi", latitude: 5, longitude: 6 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves the payload untouched when there is no location", async () => {
    const payload = await attachCoordinates({ name: "Drone", latitude: null, longitude: null });
    expect(payload).toEqual({ name: "Drone", latitude: null, longitude: null });
  });

  it("returns the payload unchanged when geocoding fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const payload = await attachCoordinates({
      location: "Nairobi",
      latitude: null,
      longitude: null,
    });
    expect(payload).toEqual({ location: "Nairobi", latitude: null, longitude: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix frontend run test -- geocode`
Expected: FAIL — cannot resolve `./geocode.ts`

- [ ] **Step 3: Implement the module**

Create `frontend/src/lib/geo/geocode.ts`:

```ts
const GEOCODE_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";

export interface Coords {
  lat: number;
  lng: number;
}

// Session-scoped memo. Definitive misses are cached too; transient failures
// (network, timeout) are not, so a later save can still succeed.
const cache = new Map<string, Coords | null>();

export function clearGeocodeCache(): void {
  cache.clear();
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

async function requestCoords(query: string, timeoutMs: number): Promise<Coords | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url =
      `${GEOCODE_ENDPOINT}?name=${encodeURIComponent(query)}` +
      "&count=1&language=en&format=json";
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      results?: { latitude: number; longitude: number }[];
    };
    const hit = body.results?.[0];
    if (!hit || typeof hit.latitude !== "number" || typeof hit.longitude !== "number") {
      return null;
    }
    return { lat: hit.latitude, lng: hit.longitude };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve free-text "City, country" to coordinates, or null. */
export async function geocodeLocation(text: string, timeoutMs = 5000): Promise<Coords | null> {
  const query = text.trim();
  if (!query) return null;

  const key = normalize(query);
  if (cache.has(key)) return cache.get(key) ?? null;

  const coords = await requestCoords(query, timeoutMs);
  cache.set(key, coords);
  return coords;
}

type WithOptionalCoords = {
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

/** Best-effort: fill missing coordinates from the payload's location text.
 *  Never throws — an unresolved location simply stays null. */
export async function attachCoordinates<P extends WithOptionalCoords>(payload: P): Promise<P> {
  const hasCoords =
    typeof payload.latitude === "number" &&
    Number.isFinite(payload.latitude) &&
    typeof payload.longitude === "number" &&
    Number.isFinite(payload.longitude);
  const location = payload.location?.trim();
  if (hasCoords || !location) return payload;

  try {
    const coords = await geocodeLocation(location);
    return coords ? { ...payload, latitude: coords.lat, longitude: coords.lng } : payload;
  } catch {
    return payload;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix frontend run test -- geocode`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/geo/geocode.ts frontend/src/lib/geo/geocode.test.ts
git commit -m "feat(geo): best-effort open-meteo geocoding helper"
```

---

### Task 3: Wire geocoding into repositories

**Files:**
- Modify: `frontend/src/lib/repositories/marketplace.ts`
- Modify: `frontend/src/lib/repositories/professionals.ts`

**Interfaces:**
- Consumes: `attachCoordinates` from `../geo/geocode.ts`.
- Produces: `createMarketplaceListing`, `updateMarketplaceListing`, `createProfessional`, `updateProfessional`, `upsertProfessionalProfile` now persist resolved coordinates when callers didn't supply them. Signatures unchanged.

- [ ] **Step 1: Marketplace repository**

In `frontend/src/lib/repositories/marketplace.ts`, add the import next to the existing relative imports:

```ts
import { attachCoordinates } from '../geo/geocode.ts'
```

Change `createMarketplaceListing`'s insert call from:

```ts
    .insert({ ...payload, workspace_id: workspaceId })
```

to:

```ts
    .insert({ ...(await attachCoordinates(payload)), workspace_id: workspaceId })
```

Change `updateMarketplaceListing`'s update call from:

```ts
    .update({ ...patch, updated_at: new Date().toISOString() })
```

to:

```ts
    .update({ ...(await attachCoordinates(patch)), updated_at: new Date().toISOString() })
```

(`patch` already satisfies `WithOptionalCoords` structurally — both fields exist on `TablesUpdate`.)

- [ ] **Step 2: Professionals repository**

In `frontend/src/lib/repositories/professionals.ts`, add:

```ts
import { attachCoordinates } from '../geo/geocode.ts'
```

Apply the same two edits as Step 1: wrap the `payload`/`patch` spreads in `attachCoordinates(...)` inside `createProfessional` (insert) and `updateProfessional` (update). `upsertProfessionalProfile` flows through those two functions, so no further change.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/repositories/marketplace.ts frontend/src/lib/repositories/professionals.ts
git commit -m "feat(market): resolve listing and professional coordinates on save"
```

---

### Task 4: Backfill edge function

**Files:**
- Create: `backend/supabase/functions/backfill-geocode/index.ts`

**Interfaces:**
- Consumes: `corsHeaders`, `json`, `getCallerId`, `adminClient` from `../_shared/supabase.ts`.
- Produces: POST `/functions/v1/backfill-geocode` (Authorization: Bearer `<access token>`) → `{ updated: number; failed: number; remaining_note?: string }`.

- [ ] **Step 1: Write the function**

Create `backend/supabase/functions/backfill-geocode/index.ts`:

```ts
/**
 * Edge Function: backfill-geocode
 * --------------------------------
 * Resolves stored coordinates for rows that predate auto-geocoding (or whose
 * save-time lookup failed). Any signed-in user may invoke it; writes go
 * through the service-role client because rows belong to other workspaces.
 *
 * Each run processes at most BATCH_LIMIT rows per table and spaces requests
 * to respect the free geocoding API. Idempotent: rows with coordinates are
 * skipped, so run repeatedly until `{ processed: 0 }`.
 */

import { corsHeaders, getCallerId, adminClient, json } from "../_shared/supabase.ts";

const GEOCODE_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const BATCH_LIMIT = 200;
const REQUEST_SPACING_MS = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url =
      `${GEOCODE_ENDPOINT}?name=${encodeURIComponent(query)}` +
      "&count=1&language=en&format=json";
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = await res.json();
    const hit = body.results?.[0];
    if (
      !hit ||
      typeof hit.latitude !== "number" ||
      typeof hit.longitude !== "number"
    ) {
      return null;
    }
    return { lat: hit.latitude, lng: hit.longitude };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const callerId = await getCallerId(req);
  if (!callerId) {
    return json({ error: "authentication required" }, 401);
  }

  const admin = adminClient();
  let updated = 0;
  let failed = 0;
  let processed = 0;

  for (const table of ["marketplace_listings", "professionals"] as const) {
    const { data: rows, error } = await admin
      .from(table)
      .select("id, location")
      .is("latitude", null)
      .not("location", "is", null)
      .limit(BATCH_LIMIT);
    if (error) {
      return json({ error: error.message }, 500);
    }

    for (const row of rows ?? []) {
      processed++;
      const location = (row.location ?? "").trim();
      if (!location) continue;
      const coords = await geocode(location);
      if (!coords) {
        failed++;
        continue;
      }
      const { error: updateError } = await admin
        .from(table)
        .update({ latitude: coords.lat, longitude: coords.lng })
        .eq("id", row.id);
      if (updateError) {
        failed++;
      } else {
        updated++;
      }
      await sleep(REQUEST_SPACING_MS);
    }
  }

  return json({ updated, failed, processed });
});
```

- [ ] **Step 2: Lint-check what can be checked**

Run: `npm run typecheck`
Expected: PASS (edge function lives outside `tsc` projects — this step guards against accidental frontend breakage)

- [ ] **Step 3: Commit**

```bash
git add backend/supabase/functions/backfill-geocode/index.ts
git commit -m "feat(functions): backfill-geocode edge function for public market"
```

Deployment (manual, after Task 8): `cd backend && npx supabase functions deploy backfill-geocode`, then invoke once signed-in to backfill existing rows.

---

### Task 5: maplibre dependency + globe dot helpers (TDD)

**Files:**
- Create: `frontend/src/components/market/marketDots.ts`
- Test: `frontend/src/components/market/marketDots.test.ts`

**Interfaces:**
- Produces:
  - `MARKET_DOT_COLORS = { listing: "#f59e0b", professional: "#06b6d4" }`
  - `interface MarketDot { kind: "listing" | "professional"; id: string; name: string; location: string; lat: number; lng: number }`
  - `buildMarketDots(listings, professionals, cap?): MarketDot[]` where inputs are `{ id: string; name: string; location: string | null; latitude: number | null; longitude: number | null }[]`
  - `toFeatureCollection(dots): GeoJSON.FeatureCollection<GeoJSON.Point>`

- [ ] **Step 1: Install dependencies**

```bash
npm --prefix frontend install maplibre-gl@^6
npm --prefix frontend install -D @types/geojson
```

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/components/market/marketDots.test.ts`:

```ts
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
      { kind: "listing", id: "a", name: "Item a", location: "Nairobi", lat: -1.2, lng: 36.8 },
      { kind: "professional", id: "p", name: "Item p", location: "Nairobi", lat: -1.2, lng: 36.8 },
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm --prefix frontend run test -- marketDots`
Expected: FAIL — cannot resolve `./marketDots`

- [ ] **Step 4: Implement**

Create `frontend/src/components/market/marketDots.ts`:

```ts
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix frontend run test -- marketDots`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/components/market/marketDots.ts frontend/src/components/market/marketDots.test.ts
git commit -m "feat(market): globe dot helpers and maplibre dependency"
```

---

### Task 6: PublicMarketGlobe component

**Files:**
- Create: `frontend/src/components/market/PublicMarketGlobe.tsx`

**Interfaces:**
- Consumes: `buildMarketDots` outputs — `MarketDot`, `MARKET_DOT_COLORS`, `toFeatureCollection` from `./marketDots`.
- Produces: `default export PublicMarketGlobe(props: PublicMarketGlobeProps)` with
  `{ dots: MarketDot[] | null; totalListings: number; totalProfessionals: number; failed: boolean; onSelect(dot: MarketDot): void; onRetry(): void }`.
  Renders a full-width globe; reports load failure internally via a timed-out flag combined with `failed`.

- [ ] **Step 1: Write the component**

Create `frontend/src/components/market/PublicMarketGlobe.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Globe2 } from "lucide-react";
import { Button } from "../ui/button.tsx";
import {
  MARKET_DOT_COLORS,
  toFeatureCollection,
  type MarketDot,
} from "./marketDots";

// Generous: slow connections beat a false error (bizintel uses the same value).
const LOAD_FAILURE_TIMEOUT_MS = 10_000;
const EMPTY_FC = toFeatureCollection([]);

interface PublicMarketGlobeProps {
  /** null while the parent is fetching. */
  dots: MarketDot[] | null;
  totalListings: number;
  totalProfessionals: number;
  failed: boolean;
  onSelect: (dot: MarketDot) => void;
  onRetry: () => void;
}

function countLabel(
  dots: MarketDot[] | null,
  totalListings: number,
  totalProfessionals: number,
): string {
  if (dots === null) return "Loading…";
  const pinnedListings = dots.filter((d) => d.kind === "listing").length;
  const pinnedPros = dots.length - pinnedListings;
  if (totalListings === 0 && totalProfessionals === 0) {
    return "Nothing published yet";
  }
  const listingsFull = pinnedListings === totalListings;
  const prosFull = pinnedPros === totalProfessionals;
  if (listingsFull && prosFull) {
    return `${totalListings} ${totalListings === 1 ? "listing" : "listings"} · ${totalProfessionals} ${totalProfessionals === 1 ? "professional" : "professionals"}`;
  }
  return `${pinnedListings} of ${totalListings} listings · ${pinnedPros} of ${totalProfessionals} professionals have a pinned location`;
}

/** Full-width 3D globe of the public market: amber listing dots, cyan
 *  professional dots, tap either to open its detail dialog. */
export default function PublicMarketGlobe({
  dots,
  totalListings,
  totalProfessionals,
  failed,
  onSelect,
  onRetry,
}: PublicMarketGlobeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Latest values for handlers bound once at map creation.
  const dotsRef = useRef(dots);
  dotsRef.current = dots;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || failed) return;

    setLoaded(false);
    setTimedOut(false);

    const map = new maplibregl.Map({
      container,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [15, 20],
      zoom: 1.35,
      attributionControl: true,
      projection: { type: "globe" },
    });
    mapRef.current = map;

    const timeoutId = window.setTimeout(() => setTimedOut(true), LOAD_FAILURE_TIMEOUT_MS);

    map.on("load", () => {
      window.clearTimeout(timeoutId);
      map.addSource("market-points", {
        type: "geojson",
        data: toFeatureCollection(dotsRef.current ?? []),
      });
      map.addLayer({
        id: "market-dots",
        type: "circle",
        source: "market-points",
        paint: {
          "circle-radius": 6,
          "circle-color": [
            "match",
            ["get", "kind"],
            "professional",
            MARKET_DOT_COLORS.professional,
            MARKET_DOT_COLORS.listing,
          ],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.on("click", "market-dots", (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const props = feature.properties as { kind?: string; id?: string } | null;
        const dot = dotsRef.current?.find(
          (candidate) => candidate.kind === props?.kind && candidate.id === props?.id,
        );
        if (dot) selectRef.current(dot);
      });
      map.on("mouseenter", "market-dots", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "market-dots", () => {
        map.getCanvas().style.cursor = "";
      });
      setLoaded(true);
    });

    return () => {
      window.clearTimeout(timeoutId);
      map.remove();
      mapRef.current = null;
    };
  }, [attempt, failed]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const source = map.getSource("market-points");
    if (source && "setData" in source) {
      (source as maplibregl.GeoJSONSource).setData(toFeatureCollection(dots ?? []));
    }
  }, [dots, loaded]);

  const handleRetry = () => {
    setAttempt((value) => value + 1);
    onRetry();
  };

  const broken = failed || (timedOut && !loaded);

  return (
    <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight sm:text-lg">
          <Globe2 className="size-4 text-muted-foreground" />
          Everything on the globe
        </h2>
        <span className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {countLabel(dots, totalListings, totalProfessionals)}
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: MARKET_DOT_COLORS.listing }}
              aria-hidden="true"
            />
            Listings
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: MARKET_DOT_COLORS.professional }}
              aria-hidden="true"
            />
            Professionals
          </span>
        </span>
      </div>

      <div className="relative z-0 h-[420px] w-full overflow-hidden rounded-xl border bg-muted/40 sm:h-[520px]">
        {/* Canvas-only content; the searchable card grids below carry the
            same information for keyboard and screen-reader users. */}
        <p className="sr-only">
          Interactive globe of published listings and professionals. The same
          items are listed below the globe.
        </p>
        {!broken ? (
          <div ref={containerRef} className="absolute inset-0" />
        ) : (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <Globe2 className="size-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">Couldn&rsquo;t load the globe.</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Check your connection — everything is also browsable below.
            </p>
            <Button size="sm" variant="outline" onClick={handleRetry}>
              Try again
            </Button>
          </div>
        )}
        {!broken && dots === null ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div className="flex gap-1" role="status" aria-label="Loading the market">
              <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
              <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
              <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/market/PublicMarketGlobe.tsx
git commit -m "feat(market): public market globe with maplibre"
```

---

### Task 7: Public market page, route, and auth-page links

**Files:**
- Create: `frontend/src/pages/public/PublicMarketPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/auth/LoginPage.tsx`
- Modify: `frontend/src/pages/auth/SignupPage.tsx`

**Interfaces:**
- Consumes: `PublicMarketGlobe` (Task 6), `MarketDot`/`buildMarketDots` (Task 5), `supabase` from `../../lib/supabase/client.ts`, view row types `Database["public"]["Views"][...]` (Task 1), UI primitives `Card/Button/Badge/Input/Tabs/Dialog` from `../../components/ui/*`.

- [ ] **Step 1: Write the page**

Create `frontend/src/pages/public/PublicMarketPage.tsx`:

```tsx
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Briefcase, Globe2, MapPin, Search, UserRound } from "lucide-react";
import { supabase } from "../../lib/supabase/client.ts";
import type { Database } from "../../lib/supabase/types.ts";
import { buildMarketDots, type MarketDot } from "../../components/market/marketDots";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent } from "../../components/ui/card.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Skeleton } from "../../components/ui/skeleton.tsx";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs.tsx";

const PublicMarketGlobe = lazy(() => import("../../components/market/PublicMarketGlobe.tsx"));

type ListingRow = Database["public"]["Views"]["public_market_listings"]["Row"];
type ProfessionalRow = Database["public"]["Views"]["public_market_professionals"]["Row"];

type Scope = "all" | "listing" | "professional";

function matches(term: string, haystack: (string | null | undefined)[]): boolean {
  if (!term.trim()) return true;
  const needle = term.trim().toLowerCase();
  return haystack.some((field) => (field ?? "").toLowerCase().includes(needle));
}

export default function PublicMarketPage() {
  const [listings, setListings] = useState<ListingRow[] | null>(null);
  const [professionals, setProfessionals] = useState<ProfessionalRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [selected, setSelected] = useState<MarketDot | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    setListings(null);
    setProfessionals(null);
    try {
      const [listingsRes, professionalsRes] = await Promise.all([
        supabase
          .from("public_market_listings")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase.from("public_market_professionals").select("*"),
      ]);
      if (listingsRes.error) throw listingsRes.error;
      if (professionalsRes.error) throw professionalsRes.error;
      setListings(listingsRes.data ?? []);
      setProfessionals(professionalsRes.data ?? []);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  const dots = useMemo(
    () =>
      listings !== null && professionals !== null
        ? buildMarketDots(listings, professionals)
        : null,
    [listings, professionals],
  );

  const filteredListings = useMemo(
    () =>
      (listings ?? []).filter((row) =>
        matches(search, [row.name, row.type, row.seller, row.location, row.description]),
      ),
    [listings, search],
  );
  const filteredProfessionals = useMemo(
    () =>
      (professionals ?? []).filter((row) =>
        matches(search, [row.name, row.title, row.discipline, row.location, row.bio]),
      ),
    [professionals, search],
  );

  const showListings = scope !== "professional";
  const showProfessionals = scope !== "listing";
  const loading = listings === null || professionals === null;

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <Globe2 className="size-4 text-primary" />
            SiteSurveyor Market
          </span>
          <Button variant="outline" size="sm" asChild>
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
      </header>

      <main className="space-y-6 py-8">
        <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            The public engineering market
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Instruments for sale or hire and survey professionals worldwide —
            published by SiteSurveyor workspaces. No account needed to browse.
          </p>
        </section>

        <Suspense fallback={
          <div className="mx-auto h-[420px] w-full max-w-7xl px-4 sm:h-[520px] sm:px-6 lg:px-8">
            <Skeleton className="h-full w-full rounded-xl" />
          </div>
        }>
          <PublicMarketGlobe
            dots={dots}
            totalListings={listings?.length ?? 0}
            totalProfessionals={professionals?.length ?? 0}
            failed={failed}
            onSelect={setSelected}
            onRetry={retry}
          />
        </Suspense>

        <section className="mx-auto w-full max-w-7xl space-y-4 px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs value={scope} onValueChange={(value) => setScope(value as Scope)}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="listing">Listings</TabsTrigger>
                <TabsTrigger value="professional">Professionals</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative w-full sm:w-[280px]">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search instruments & professionals…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {failed ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <Globe2 className="size-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">Couldn&rsquo;t load the market.</p>
                <Button size="sm" variant="outline" onClick={retry}>
                  Try again
                </Button>
              </CardContent>
            </Card>
          ) : loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-40 rounded-xl" />
              ))}
            </div>
          ) : (
            <>
              {showListings ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    Listings ({filteredListings.length})
                  </h3>
                  {filteredListings.length === 0 ? (
                    <EmptyHint label="No listings match your search." />
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {filteredListings.map((row) => (
                        <ListingCard
                          key={row.id}
                          row={row}
                          onOpen={() =>
                            setSelected(
                              dotOf(listings ?? [], professionals ?? [], "listing", row.id),
                            )
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              {showProfessionals ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    Professionals ({filteredProfessionals.length})
                  </h3>
                  {filteredProfessionals.length === 0 ? (
                    <EmptyHint label="No professionals match your search." />
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {filteredProfessionals.map((row) => (
                        <ProfessionalCard
                          key={row.id}
                          row={row}
                          onOpen={() =>
                            setSelected(
                              dotOf(listings ?? [], professionals ?? [], "professional", row.id),
                            )
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </>
          )}
        </section>
      </main>

      <footer className="border-t py-6">
        <p className="mx-auto max-w-7xl px-4 text-xs text-muted-foreground sm:px-6 lg:px-8">
          Data shown is published by SiteSurveyor workspaces. Sign in to request,
          hire, or purchase.
        </p>
      </footer>

      <MarketDotDialog dot={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function dotOf(
  listings: ListingRow[],
  professionals: ProfessionalRow[],
  kind: MarketDot["kind"],
  id: string,
): MarketDot | null {
  const source =
    kind === "listing"
      ? listings.find((row) => row.id === id)
      : professionals.find((row) => row.id === id);
  if (!source || source.latitude == null || source.longitude == null) return null;
  return {
    kind,
    id,
    name: source.name,
    location: source.location ?? "",
    lat: source.latitude,
    lng: source.longitude,
  };
}

function EmptyHint({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">{label}</CardContent>
    </Card>
  );
}

function ListingCard({ row, onOpen }: { row: ListingRow; onOpen: () => void }) {
  return (
    <Card
      className="cursor-pointer transition-all hover:border-primary hover:shadow-md"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <CardContent className="space-y-2 p-5">
        <div className="flex items-start justify-between gap-2">
          <Briefcase className="size-5 text-primary" />
          <div className="flex gap-1">
            {row.condition ? <Badge variant="secondary">{row.condition}</Badge> : null}
            <Badge variant="outline">{row.listing_type === "hire" ? "Hire" : "Sale"}</Badge>
          </div>
        </div>
        <div>
          <h4 className="font-semibold">{row.name}</h4>
          <p className="text-sm text-muted-foreground">{row.type}</p>
        </div>
        <p className="font-semibold">
          {row.price.toLocaleString()} {row.currency}
          {row.listing_type === "hire" ? " / day" : ""}
        </p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3" /> {row.seller} · {row.location}
        </p>
      </CardContent>
    </Card>
  );
}

function ProfessionalCard({ row, onOpen }: { row: ProfessionalRow; onOpen: () => void }) {
  return (
    <Card
      className="cursor-pointer transition-all hover:border-primary hover:shadow-md"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <CardContent className="space-y-2 p-5">
        <div className="flex items-start justify-between gap-2">
          <UserRound className="size-5 text-primary" />
          <Badge variant="outline">{row.availability}</Badge>
        </div>
        <div>
          <h4 className="font-semibold">{row.name}</h4>
          <p className="text-sm text-muted-foreground">{row.title}</p>
        </div>
        <p className="text-sm">{row.discipline}</p>
        <p className="font-semibold">
          {row.rate.toLocaleString()} {row.currency} / {row.rate_per}
        </p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3" /> {row.location}
        </p>
      </CardContent>
    </Card>
  );
}

function MarketDotDialog({ dot, onClose }: { dot: MarketDot | null; onClose: () => void }) {
  return (
    <Dialog open={dot !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        {dot ? (
          <>
            <DialogHeader>
              <DialogTitle>{dot.name}</DialogTitle>
              <DialogDescription>
                {dot.kind === "listing" ? "Marketplace listing" : "Survey professional"} ·{" "}
                {dot.location}
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Sign in to contact the publisher{dot.location ? ` in ${dot.location}` : ""}.
            </p>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
```

Note: `dotOf` intentionally returns `null` for rows without coordinates — the dialog stays closed because `open={dot !== null}`. Cards always open the dialog when the row has coordinates; uncoordinated rows simply show nothing extra. If `Skeleton` is not exported by `components/ui/skeleton.tsx`, check its exports and adapt (it exists in the ui folder listing).

- [ ] **Step 2: Register the public route**

In `frontend/src/App.tsx`:

Change the React import line:

```tsx
import { useCallback, useEffect } from "react";
```

to:

```tsx
import { lazy, Suspense, useCallback, useEffect } from "react";
```

Add after the last page import block (below `import ResetPasswordPage …`):

```tsx
const PublicMarketPage = lazy(() => import("./pages/public/PublicMarketPage"));
```

Inside `<Routes>`, immediately above the `<Route element={<ProtectedRoute />}>` line, add:

```tsx
          <Route
            path="/market"
            element={
              <Suspense fallback={<div className="min-h-screen bg-background" />}>
                <PublicMarketPage />
              </Suspense>
            }
          />
```

- [ ] **Step 3: Login page link**

In `frontend/src/pages/auth/LoginPage.tsx`, inside the `CardFooter` (the block containing "Don't have an account?"), after the "Clear local data" button, append:

```tsx
          <span className="mx-1">·</span>
          <Button variant="link" className="h-auto p-0" asChild>
            <Link to="/market">Public market</Link>
          </Button>
```

(`Link` is already imported there.)

- [ ] **Step 4: Signup page link**

In `frontend/src/pages/auth/SignupPage.tsx`, locate every `CardFooter` whose copy says "Already have an account?" (there is one per render branch). After its "Log in" button, append:

```tsx
            <span className="mx-1">·</span>
            <Button variant="link" className="h-auto p-0" onClick={() => navigate("/market")}>
              Public market
            </Button>
```

(`navigate` is already in scope in that file; do not add imports.)

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. Fix any unused-import errors the edits introduce.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/public/PublicMarketPage.tsx frontend/src/App.tsx frontend/src/pages/auth/LoginPage.tsx frontend/src/pages/auth/SignupPage.tsx
git commit -m "feat(market): public /market route with globe and browsable grids"
```

---

### Task 8: Full verification

**Files:** none created — verification only.

- [ ] **Step 1: Tests**

Run: `npm run test`
Expected: PASS (new geocode + marketDots suites green, no regressions)

- [ ] **Step 2: Lint & typecheck & build**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: all PASS

- [ ] **Step 3: Manual smoke (dev server)**

Run: `npm run dev`, then verify:
1. Open `http://localhost:<port>/market` signed out — header, globe render, empty states if DB has no public rows yet.
2. Apply `backend/sql/0002_public_market.sql` in the Supabase SQL editor, create a listing with location "Nairobi, Kenya" in the app, confirm its row gains coordinates (DB check), and the dot appears on `/market` after reload.
3. Click the login-page "Public market" link; confirm navigation while signed out.
4. Confirm `seller_wallet_address` is absent from `GET <supabase>/rest/v1/public_market_listings?select=*` called with only the anon key.

- [ ] **Step 4: Final commit (if anything was touched)**

Only commit if Step 1–3 forced changes:

```bash
git add -A -- frontend/src backend/sql
git commit -m "fix(market): address verification findings"
```
