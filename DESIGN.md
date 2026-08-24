# DESIGN.md — SiteSurveyor Engineering

Recorded from the built code, not intention. Scope note: this file currently
describes ONE shipped surface, the public market (`/market`), which follows the
app's shared shadcn light theme. (An earlier build committed /market to its own
"mission control" dark world; the user reviewed it and pinned light mode, so
the dark world was removed in the re-skin.)

## Product

Multi-tenant survey operations platform (projects, dispatch, assets, quotes,
invoicing) with a no-login public market directory of instrument listings and
survey professionals.

## The /market world — "live registry on a daylight Earth"

- **Thesis:** the open market as a live directory — an edge-to-edge light
  basemap globe carrying the headline over a legibility scrim, followed by
  divided registry rows instead of card grids. Globe is the hero at ~68vh.
- **Ground:** app shadcn tokens throughout (`background`, `card`, `muted`,
  `border`, `primary`); no scoped theme class. The map runs mapcn's Carto
  positron basemap with `theme="light"` set explicitly.
- **Accent system carried from data:** amber = listings, cyan = professionals.
  Pin colors live in `frontend/src/components/market/marketDots.ts`
  (`MARKET_DOT_COLORS`) and are echoed in legend chips, row ticks, hover
  tints (`amber-700` / `cyan-800` text on hover — AA-safe on light ground),
  and dialog markers. Single CTA color is the app `primary`.
- **Type:** Manrope only (the shared app face); tabular numerals via Tailwind
  `font-mono tabular-nums` utilities for telemetry values — counts, prices,
  rates, ratings, coordinates. No custom display face.
- **Composition:** registry rows in one divided list per kind inside
  `bg-card` panels, paginated with Previous / Next controls (5 rows per
  page; pages reset on search; page indicator uses tabular numerals); HUD
  overlays pinned inside the globe viewport as white
  pills (`bg-background/85 backdrop-blur-sm border shadow-sm`) — telemetry
  top-left, cursor coordinate readout top-right, legend bottom-right,
  heading bottom-left over a black scrim gradient for legibility on the pale
  basemap.
- **Signature interaction:** live lat/lng readout tracking the cursor across
  the globe; pins reveal once (900 ms exponential ease-out opacity ramp)
  after style load like acquired plots.
- **Motion budget:** the pin reveal is the one authored moment; everything
  else is plain hover/focus transitions. No bounce/elastic easing.
- **States:** loading = skeleton rows + "ACQUIRING FEED…" pulse pill; fetch
  failure = honest error panel naming recovery (12 s abort timeout, tailored
  hint when the public views are missing); basemap unreachable = globe swaps
  to the tile-free blank canvas automatically; empty = dashed reticle panel;
  no-search-match variants per kind.

## Boundaries

- `/market` uses only shared tokens; there is no per-route theme class to
  leak. Auth pages and the authenticated app share the same shadcn light
  theme.
- Map stack: mapcn (`components/ui/map.tsx`, vendored from
  https://mapcn.dev) — light Carto basemap, globe projection, self-hosted
  maplibre web worker in `frontend/public/`. If the basemap CDN is
  unreachable the globe falls back to a tile-free sphere; pins and HUD
  always render.
