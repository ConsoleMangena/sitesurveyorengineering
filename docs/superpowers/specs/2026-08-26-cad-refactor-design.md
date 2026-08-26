# CAD Refactor — Decompose the Hotspot Files

Date: 2026-08-26
Status: Approved (pending implementation plan)
Scope: Phase 1 of the four-phase CAD improvement roadmap (refactor → editing power → surveyor features → robustness & perf)

## Context

Surveyor CAD is a mature browser drafting workspace: SVG 2D viewport, Three.js
3D viewport, TIN/contour/volume/terrain analysis, an 18-mode COGO panel,
DXF/CSV/GeoJSON IO, paper-space plotting, and an AI command bridge. Its value
is real, but three files have absorbed every feature and are now the bottleneck
for safe change:

| File | Lines | Role |
|---|---|---|
| `frontend/src/features/projects/components/CadWorkspace.tsx` | 3,019 | Orchestration: state wiring, all survey workflows (~L1540–2100), ribbon/menu/command dispatch (L2318–2459), tool flows (`handlePickPoint` L545–877), full render JSX |
| `cad/CadViewport.tsx` | 1,807 | SVG rendering, hit-testing (L529–637), box select (L644–781), snapping, zoom/pan, event handling |
| `cad/useCadModel.ts` | 1,538 | Entity CRUD, selection, transform ops, undo/redo snapshot stacks, persistence |

Every planned improvement (canvas grips, TRIM/FILLET/ARRAY, multi-select
operations, vertical-curve UI) lands on these files. Refactoring first makes
each later phase cheaper and safer.

## Goals

- Decompose the three hotspot files into focused, independently testable units.
- Make survey-analysis workflows unit-testable without React.
- Create a single command registry so future tools register once for ribbon,
  menu, and command line.
- Zero behavior change: identical UI, storage keys (`sitesurveyorCad:<projectId>`),
  undo semantics, exports, and public hook/component APIs.

## Non-goals

- No new features, tools, or UI changes.
- No undo-strategy change (full-model snapshots stay).
- No Zustand store migration; hooks + context + props architecture stays.
- No DXF/block/xref entity work.
- No performance tuning beyond what falls out of cleaner boundaries.

## Target architecture

All paths relative to `frontend/src/features/projects/components/cad/`.
Module names below are indicative; final names fixed in the implementation plan.

```
cad/
├── CadWorkspace.tsx          ← composition only: state wiring + JSX (≤ ~700 lines)
├── model/
│   ├── useCadModel.ts        ← entity CRUD + selection; public hook API unchanged
│   ├── cadUndo.ts            ← past/future snapshot stacks, HISTORY_LIMIT,
│   │                            begin/end/discard transaction
│   └── cadPersistence.ts     ← localStorage seed, debounced save queue,
│                                offline queue, generation guard
├── analysis/                 ← pure functions: (modelApi, dialogs, log) → result
│   ├── surfaceWorkflows.ts   ← buildSurface, constrained breaklines, boundary surface
│   ├── contourWorkflows.ts   ← interval/index/base/smoothing contour generation
│   ├── volumeWorkflows.ts    ← volume-to-elevation, surface-to-surface
│   ├── terrainWorkflows.ts   ← slope/aspect shading overlay + stats
│   ├── profileWorkflow.ts    ← long-section extraction
│   └── fieldToFinishWorkflow.ts
├── commands/
│   └── commandRegistry.ts    ← one table: { id, aliases?, run(ctx) } entries;
│                                ribbon ids, menu paths, and CLI words resolve here
└── viewport/
    ├── CadViewport.tsx       ← event capture, tool state, composition
    ├── entityRenderer.tsx    ← per-entity-type SVG drawing
    ├── hitTesting.ts         ← hitTest priority picking + window/crossing box select
    └── snapping.ts           ← osnap/grid/ortho resolution order
```

Step 7 additionally extracts render chrome: `workspace/CadTopbar.tsx`,
`workspace/CadBody.tsx`, and dialog-binding components (presentational;
state via props).

### Boundary rules

1. **Analysis modules are pure TypeScript.** They receive narrow interfaces as
   arguments — a `modelApi` subset (`addLinework`, `addSurface`, …), a
   `dialogs` service wrapping `CadDialogProvider` (alert/confirm/prompt/select),
   and a `log` function. They never import React components or CadWorkspace.
2. **One command registry.** The three parallel dispatchers
   (`handleRibbonAction`, `handleMenuAction`, `handleCommandSubmit`) merge into
   registry lookups. Handlers register once with their trigger ids.
3. **Dependency direction is downward:** `CadWorkspace` → registry/workflows →
   model API. `useCadModel` imports `cadUndo`/`cadPersistence`; those modules
   never import back. Viewport reports picks/events upward via callbacks only;
   it never calls workflows directly.
4. **No public behavior or import-path breakage** outside the cad folder:
   existing exports keep their paths during migration (re-exports allowed).

## Extraction sequence

Each step ships independently: characterization tests green → extract → full
suite green → commit. Order follows the dependency chain.

### Step 1 — Characterization pass

Before any move, pin current behavior at the seams to be cut:

- **Dispatch routing table**: every ribbon id, menu path, and command-line word
  routes to the correct handler.
- **Analysis outcomes** on fixture drawings: surface triangle counts, contour
  interval/index emission, cut/fill volume signs, profile chainage sampling.
- **Undo semantics**: transaction collapsing (multi-entity op = one undo step),
  HISTORY_LIMIT enforcement.
- **Persistence**: debounce timing (fake timers), offline queue, generation
  guard against cross-project races.

### Step 2 — Analysis workflows out of CadWorkspace (~650 lines, L1540–2100)

Move `buildSurface`, `buildSurfaceWithBreaklines`, `buildBoundarySurface`,
`processLinework`, `buildContours`, `computeVolumeToElevation`,
`computeVolumeBetween`, `analyseSurfaceTerrain`, `extractProfile` into
`analysis/` modules. CadWorkspace keeps thin call sites in its handlers.

### Step 3 — Command registry

Merge dispatchers into `commands/commandRegistry.ts`. Behavior-identical.
This becomes the single registration point for later-phase tools (TRIM,
FILLET, ARRAY, grip operations).

### Step 4 — Tool flows out of handlePickPoint

Extract the ~330 lines of base-point machinery into per-tool handlers keyed by
active tool, each receiving `(point, modelApi, toolState)`. Viewport remains
responsible only for event capture.

### Step 5 — Model internals split

`cadUndo.ts` and `cadPersistence.ts` become modules used *by* `useCadModel`.
The hook's public API is untouched, so no consumer changes.

### Step 6 — Viewport split

Move `hitTest` + box-select into `hitTesting.ts`, snap resolution into
`snapping.ts`, per-entity SVG drawing into `entityRenderer.tsx`. CadViewport
keeps events, tool state, and composition.

### Step 7 — Workspace chrome extraction

The render JSX (topbar header, body layout, dialog bindings, ~L2644–3017)
splits into presentational components (`CadTopbar`, `CadBody`, dialog binding
components) that receive state via props. Still mechanical: no logic moves,
only JSX and its immediate handlers. This is what brings CadWorkspace down to
the target size; without it the composition shell alone stays ~1,500 lines.

## Testing strategy

- New tests beside their seams:
  - `commands/commandRegistry.test.ts` — routing table coverage (every id,
    menu path, CLI alias resolves).
  - `analysis/*.test.ts` — fixture drawings → expected counts/values, matching
    the existing style of `survey/*.test.ts`.
  - `model/cadUndo.test.ts`, `model/cadPersistence.test.ts` — transaction
    collapse, history limit, debounce timing with fake timers, generation guard.
  - `viewport/hitTesting.test.ts`, `viewport/snapping.test.ts`.
- Pure-module tests use plain entity fixtures — no React rendering.
- Every commit keeps the existing suites green: `npm run test`, plus
  `npm run lint` and `npm run typecheck` in `frontend/`.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Dispatch merge silently drops an action | Routing-table characterization test written before the merge |
| Circular imports (model ↔ undo/persistence) | One-way dependency rule, enforced by review; an ESLint import-boundary rule is added only if trivially configurable |
| Behavior drift while moving code | Cut-and-paste moves; any line edited to compile is flagged in the commit message |
| Regression mid-sequence | Each extraction step is exactly one commit — trivially revertible |

## Success criteria

- `CadWorkspace.tsx` reduced to ≤ ~700 lines (from 3,019); no newly created
  cad module exceeds ~900 lines. Existing large pure libraries (`cogo.ts`,
  `surface.ts`) and the already-slim `useCadModel.ts` public API are out of
  scope for size targets.
- All analysis workflows unit-tested without React rendering.
- One registry drives ribbon, menu, and command-line actions.
- Full suite, lint, and typecheck green at every commit.
- No user-visible change: same interactions, same saved-drawing format, same
  undo behavior.
