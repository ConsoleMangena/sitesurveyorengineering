# Public Market with Full Globe — Design

Date: 2026-08-24
Status: Approved (user delegated decisions: "choose yourself", then approved design in chat)

## Goal

A no-login public market page (`/market`) like bizintel's public directory: a full
3D globe showing every marketplace listing and every professional as a tappable dot,
with searchable read-only card grids below.

Decisions made with the user:

- Content: listings **and** professionals (two dot layers).
- "Public" means no login required.
- Coordinates: auto-geocode free-text locations on save + backfill existing rows.
- Globe tech: maplibre-gl (same library as bizintel), globe projection.

## Non-goals

- No contact/request/payment actions on the public page (read-only).
- No changes to authenticated marketplace or professionals pages other than
  geocoding at save time.
- No realtime subscriptions on the public page (static fetch per visit).

## 1. Database

New file `backend/sql/0002_public_market.sql` (applied via SQL editor / `db:push`
per existing repo convention — `0001_schema.sql` is the only prior file).

1. Columns:
   ```sql
   alter table public.marketplace_listings
     add column if not exists latitude double precision,
     add column if not exists longitude double precision;
   -- same for public.professionals
   ```
   Note: `marketplace_listings.listing_type` exists in the generated types/live
   DB but is missing from `0001_schema.sql`. The migration adds it defensively
   (`add column if not exists listing_type text`) so the view works on both
   fresh and drifted databases.
2. Views (definer semantics, so they bypass base-table RLS which stays
   authenticated-only):
   - `public_market_listings`: id, name, type, condition, price, currency, seller,
     location, description, specs, listing_type, latitude, longitude, created_at.
     **Excludes `seller_wallet_address` and `workspace_id`.**
   - `public_market_professionals`: name, title, discipline, experience, location,
     rate, rate_per, currency, availability, rating, reviews, skills, bio,
     certifications, latitude, longitude. **Excludes `workspace_id`.**
3. Grants: `grant select on public.public_market_listings,
   public.public_market_professionals to anon;`

Base-table RLS is untouched; the views are the only anonymous door.

### Types

`frontend/src/lib/supabase/types.ts` is generated but hand-maintained here:
add the two columns to both table Row/Insert/Update shapes and add a `Views`
section for the two public views (Row types = view column lists, Insert/Update =
never).

## 2. Geocoding

- New `frontend/src/lib/geo/geocode.ts`:
  - `geocodeLocation(text: string): Promise<{ lat: number; lng: number } | null>`
    calling Open-Meteo geocoding (`https://geocoding-api.open-meteo.com/v1/search`),
    first result, 5s timeout; returns null on any failure.
  - In-memory Map cache keyed by normalized text (session-scoped).
- Repository integration (best-effort, never blocks saving):
  - `marketplace.ts` `createMarketplaceListing` / `updateMarketplaceListing`:
    if payload has a location and no coords, resolve and store them; failure → null.
  - `professionals.ts` same for create/update paths.
- Edge function `backend/supabase/functions/backfill-geocode/index.ts`:
  - Authorization: caller must be a signed-in Supabase user (matches
    `delete-user` convention via `_shared/supabase.ts` helpers).
  - Scans both tables for rows with non-null `location` and null coords
    (limit ~200/run), geocodes each (0.3s spacing to respect rate limits),
    updates via service-role client.
  - Run once after migration; idempotent.

## 3. Frontend

Dependencies added to `frontend/package.json`: `maplibre-gl` (^6.x, matching
bizintel) and dev-only `@types/geojson`.

- `frontend/src/components/market/PublicMarketGlobe.tsx`:
  - maplibre map, `projection: { type: 'globe' }`, Carto positron style,
    `attributionControl` on.
  - Two GeoJSON circle layers: listings amber (#f59e0b), professionals cyan
    (#06b6d4); click handler opens info dialog; cursor pointer on hover.
  - Honest count label ("N listings · M professionals"; when some rows lack
    coords: "K of N have pinned locations"), loading dots, and a retry overlay
    on load failure (pattern borrowed from bizintel's GlobeMap).
  - Pure helper `buildMarketDots(rows)` exported for tests.
  - Info dialog shows name, type/discipline, price/rate, condition, location,
    description/specs/skills.
- `frontend/src/pages/public/PublicMarketPage.tsx`:
  - Lazy-loaded; header with app name + "Sign in" link; globe section;
    below: search input + type filter tabs and two card grids (Listings,
    Professionals) built from one fetch of each view (client-side filter/paginate;
    datasets are small).
  - Empty state when no rows have coordinates yet.
- `App.tsx`: add `<Route path="/market" element={<Suspense…PublicMarketPage/>} />`
  outside `ProtectedRoute`; unknown routes keep redirecting to `/`.
- `LoginPage` / `SignupPage`: footer link "Explore the public market →".

## 4. Errors & edge cases

- Geocode failure → row saved without coords; excluded from globe; counts say so.
- Public page offline / CDN blocked → retry overlay (bizintel pattern).
- No public data yet → friendly empty states, globe still renders (empty layers).
- Anon queries hitting RLS-denied base tables directly are impossible from the
  UI (views only).

## 5. Testing & verification

- Vitest unit tests: `geocode.ts` (mocked fetch: happy path, timeout, bad status,
  cache hit) and `buildMarketDots` (coord filtering, shape).
- `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test` all green.
- Manual check list: `/market` signed-out; dot click dialog; login page link;
  saving a listing with a city fills lat/lng.

## Risks

- View must be updated if sensitive columns are ever added to either table
  (mitigated by explicit column lists, never `select *`).
- Open-Meteo rate limits: mitigated by session cache, best-effort saves, spaced
  backfill.
