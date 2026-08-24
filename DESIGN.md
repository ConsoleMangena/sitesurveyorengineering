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
  basemap globe carrying the headline over a legibility scrim, a market-pulse
  stat strip, then divided registry rows instead of card grids. Globe is the
  hero at ~68vh.
- **Ground:** app shadcn tokens throughout (`background`, `card`, `muted`,
  `border`, `primary`); no scoped theme class. The map runs mapcn's Carto
  positron basemap with `theme="light"` set explicitly.
- **Accent system carried from data:** one hue per directory kind —
  amber = listings/instruments, cyan = professionals, violet = jobs,
  emerald = firms (verified = BadgeCheck), rose = training/events. Colors
  live in `frontend/src/components/market/marketDots.ts`
  (`MARKET_DOT_COLORS`) and are echoed in pins, legend chips, pulse stat
  cards, row ticks, hover tints (`*-700` text on hover — AA-safe on light
  ground), and dialog markers. Single CTA color is the app `primary`.
- **Type:** Manrope only (the shared app face); tabular numerals via Tailwind
  `font-mono tabular-nums` utilities for telemetry values — counts, prices,
  rates, ratings, coordinates, page indicators. No custom display face.
- **Composition:** market-pulse strip of stat cards directly under the hero;
  registry rows in divided lists per kind inside `bg-card` panels, paginated
  with Previous / Next controls (5 rows per page; pages reset on search or
  location change; clamped during render); scope segmented control
  (Everything/Listings/Professionals/Jobs/Firms/Training) filters BOTH the
  globe pins and the panels; country filter chips derived from row locations
  (top 12 by frequency) scroll horizontally and also filter the globe;
  listings panel carries Instruments/Accessories sub-chips (category column);
  day-rate benchmark chips computed live as medians over hire listings.
  HUD overlays pinned inside the globe viewport as white pills
  (`bg-background/85 backdrop-blur-sm border shadow-sm`) — per-kind pin-count
  telemetry top-left, cursor coordinate readout top-right, stacked legend
  bottom-right, heading bottom-left over a black scrim gradient for
  legibility on the pale basemap.
- **Signature interaction:** live lat/lng readout tracking the cursor across
  the globe; pins reveal once (900 ms exponential ease-out opacity ramp)
  after style load like acquired plots.
- **Motion budget:** the pin reveal is the one authored moment; everything
  else is plain hover/focus transitions. No bounce/elastic easing.
- **States:** loading = skeleton rows + "ACQUIRING FEED…" pulse pill; fetch
  failure = honest error panel naming recovery (12 s abort timeout, tailored
  hint when the public views are missing); basemap unreachable = globe swaps
  to the tile-free blank canvas automatically; empty = dashed reticle panel;
  no-search-match variants per kind. "NEW" badges mark rows created in
  the last 7 days.

## Boundaries

- `/market` uses only shared tokens; there is no per-route theme class to
  leak. Auth pages and the authenticated app share the same shadcn light
  theme.
- Map stack: mapcn (`components/ui/map.tsx`, vendored from
  https://mapcn.dev) — light Carto basemap, globe projection, self-hosted
  maplibre web worker in `frontend/public/`. If the basemap CDN is
  unreachable the globe falls back to a tile-free sphere; pins and HUD
  always render.
