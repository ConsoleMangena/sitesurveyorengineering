# DESIGN.md — SiteSurveyor Engineering

Recorded from the built code, not intention. Scope note: this file currently
describes ONE shipped surface, the public market (`/market`), which commits to
its own visual world ("mission control"). The rest of the app still runs the
shared shadcn/Tailwind light theme; nothing here overrides it globally.

## Product

Multi-tenant survey operations platform (projects, dispatch, assets, quotes,
invoicing) with a no-login public market directory of instrument listings and
survey professionals.

## The /market world — "mission control"

- **Thesis:** the market is a live orbital feed on a night-side Earth, not a
  boxed SaaS directory. The globe is the hero, edge-to-edge, ~68vh.
- **Ground:** page background `#050910`, panels `bg-white/[0.02]`, hairline
  borders `white/5–white/15`. The dark world is scoped by the `.market-dark`
  class in `frontend/src/index.css` and never leaks into other routes.
- **Accent system carried from data:** amber = listings, cyan = professionals.
  Pin colors live in `frontend/src/components/market/marketDots.ts`
  (`MARKET_DOT_COLORS`) and are echoed in legend chips, row ticks, active
  hover tints, and dialog markers. Single CTA color is amber-400 on near-black.
- **Type:** Chakra Petch (Google Fonts, 500/600/700) for display headings via
  `.font-display`; Manrope stays the app body face; mono
  (`ui-monospace` stack via `.mono-data`) is reserved strictly for telemetry
  values — counts, prices, rates, ratings, coordinates. Tabular numerals via
  `.tnum`.
- **Composition:** registry rows in one divided list per kind instead of card
  grids; HUD overlays pinned inside the globe viewport (telemetry top-left,
  cursor coordinate readout top-right, legend bottom-right, display heading
  bottom-left over a legibility scrim).
- **Signature interaction:** live lat/lng readout tracking the cursor across
  the globe; pins reveal once (900 ms exponential ease-out opacity ramp) after
  style load like acquired plots.
- **Motion budget:** the pin reveal is the one authored moment; everything
  else is plain hover/focus transitions. No bounce/elastic easing.
- **Browser surfaces themed under `.market-dark`:** amber selection, amber
  caret, amber focus-visible ring, thin scrollbars (`scrollbar-color`),
  tabular numerals for all numeric data.
- **States:** loading = skeleton rows + "ACQUIRING FEED…" pulses; fetch
  failure = honest error panel naming recovery (12 s abort timeout, tailored
  hint when the public views are missing); empty = dashed reticle panel;
  no-search-match variants per kind.
- **Contrast floor:** informational text is slate-400 or brighter on the
  ground; slate-600 appears only on aria-hidden decorative icons.

## Boundaries

- `/market` visual world does not apply to auth pages or the authenticated
  app; those follow the existing shadcn tokens.
- Map basemap: Carto dark-matter GL style; maplibre v6 requires
  `map.setProjection({type:"globe"})` only after the map `load` event.
