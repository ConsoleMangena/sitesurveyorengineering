# CAD Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the three Surveyor CAD hotspot files (`CadWorkspace.tsx` 3,019 lines, `CadViewport.tsx` 1,807, `useCadModel.ts` 1,538) into focused, unit-testable modules with zero behavior change.

**Architecture:** Mechanical extraction by concern — pure analysis workflow modules, one command registry for ribbon/menu actions, per-tool pick handlers, split undo/persistence out of the model hook, and viewport render/interaction separation. Hooks + context + props architecture stays; no Zustand migration.

**Tech Stack:** React 19, TypeScript, Vitest 4 + @testing-library/react, ESLint 9. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-cad-refactor-design.md`

## Global Constraints

- Zero behavior change: same UI, same storage keys (`sitesurveyorCad:<projectId>`), same undo semantics, same log strings, same public hook/component APIs.
- All work under `frontend/src/features/projects/components/cad/` unless stated.
- Every commit keeps green: `cd frontend && npm run lint && npm run typecheck && npm run test`.
- Moves are cut-and-paste; any line that must be edited to compile is flagged in the commit message.
- Dependency direction: `CadWorkspace` → registry/workflows → model API. `cadUndo.ts` / `cadPersistence.ts` never import `useCadModel`. Analysis modules never import React components.
- No new features (no multi-select ERASE fix, no TRIM/FILLET, no grips) — those are later phases.
- Test runner is Vitest from the `frontend/` directory. Run a single file with `npx vitest run src/features/projects/components/cad/<file>`.

## File Structure (target)

```
cad/
├── CadWorkspace.tsx              ← shrinks to ≤ ~700 lines of composition
├── model/
│   ├── useCadModel.ts            ← entity CRUD + selection (public API unchanged)
│   ├── cadUndo.ts                ← NEW: pure history machine
│   └── cadPersistence.ts         ← NEW: cache + debounced save + generation guard
├── analysis/
│   ├── workflowCtx.ts            ← NEW: shared ctx/service types + pickSurface
│   ├── surfaceWorkflows.ts       ├── contourWorkflows.ts
│   ├── volumeWorkflows.ts        ├── terrainWorkflows.ts
│   ├── profileWorkflow.ts        ├── fieldToFinishWorkflow.ts
│   └── geomWorkflows.ts
├── commands/
│   └── commandRegistry.ts        ← NEW: ribbon+menu action table
├── tools/
│   └── pickFlows.ts              ← NEW: per-tool handlePickPoint branches
├── viewport/
│   ├── CadViewport.tsx           ← events, tool state, composition
│   ├── entityRenderer.tsx        ← per-entity SVG drawing
│   ├── hitTesting.ts             ├── snapping.ts
│   └── workspace/
│       ├── CadTopbar.tsx         ← topbar JSX
│       └── CadBody.tsx           ← body layout JSX
```

---

### Task 1: Characterization tests for undo/transaction/persistence behavior

Pin current `useCadModel` behavior BEFORE any internals move. These tests must pass against today's code unchanged.

**Files:**
- Create: `frontend/src/features/projects/components/cad/useCadModel.history.test.tsx`
- Test only; no production changes.

**Interfaces:**
- Consumes: `useCadModel(projectId, workspaceId?)` as-is.
- Produces: regression net used by Tasks 2–3.

- [ ] **Step 1: Write the characterization tests**

```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCadModel } from "./useCadModel";
import { emptyModel } from "./cadModel";

describe("useCadModel history (characterization)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("navigator", { ...navigator, onLine: true });
    // Backend repo calls fail fast in tests; the hook treats them as offline-tolerant errors.
  });
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    return renderHook(() => useCadModel("proj-history"));
  }

  it("single addPoint = one undo step; redo restores", () => {
    const { result } = setup();
    let added: { id: string };
    act(() => {
      added = result.current.addPoint({ pointNo: "1", n: 0, e: 0, z: null, code: "" });
    });
    expect(result.current.canUndo).toBe(true);
    act(() => {
      expect(result.current.undo()).toBe(true);
    });
    expect(result.current.model.points).toHaveLength(0);
    expect(result.current.canRedo).toBe(true);
    act(() => {
      expect(result.current.redo()).toBe(true);
    });
    expect(result.current.model.points.map((p) => p.id)).toEqual([added!.id]);
  });

  it("transaction collapses multiple commits into ONE undo step", () => {
    const { result } = setup();
    act(() => {
      result.current.beginTransaction();
      result.current.addPoint({ pointNo: "1", n: 0, e: 0, z: null, code: "" });
      result.current.addPoint({ pointNo: "2", n: 1, e: 1, z: null, code: "" });
      result.current.endTransaction();
    });
    act(() => {
      result.current.undo();
    });
    expect(result.current.model.points).toHaveLength(0);
  });

  it("discardTransaction restores the base model and drops its history entry", () => {
    const { result } = setup();
    act(() => {
      result.current.beginTransaction();
      result.current.addPoint({ pointNo: "1", n: 5, e: 5, z: null, code: "" });
      result.current.discardTransaction();
    });
    expect(result.current.model.points).toHaveLength(0);
    expect(result.current.canUndo).toBe(false);
  });

  it("HISTORY_LIMIT caps at 100 entries (101st edit evicts the oldest)", () => {
    const { result } = setup();
    act(() => {
      for (let i = 0; i < 101; i++) {
        result.current.addPoint({ pointNo: String(i), n: i, e: i, z: null, code: "" });
      }
    });
    // Undo all the way: exactly 100 steps available.
    let steps = 0;
    act(() => {
      while (result.current.undo()) steps += 1;
    });
    expect(steps).toBe(100);
    expect(result.current.model.points).toHaveLength(1); // the first point remains
  });

  it("undo past the start returns false and keeps the model intact", () => {
    const { result } = setup();
    act(() => {
      result.current.addPoint({ pointNo: "1", n: 0, e: 0, z: null, code: "" });
    });
    const snapshot = result.current.model;
    act(() => {
      expect(result.current.undo()).toBe(true);
      expect(result.current.undo()).toBe(false);
    });
    expect(result.current.model.points).toHaveLength(0);
    expect(snapshot.points).toHaveLength(1);
  });

  it("cache write is debounced at ~600ms", () => {
    vi.useFakeTimers(); // BEFORE mount so the mount-time timer is also fake
    try {
      localStorage.setItem(
        "sitesurveyorCad:proj-cache",
        JSON.stringify(emptyModel()),
      );
      const { result } = renderHook(() => useCadModel("proj-cache"));
      act(() => {
        vi.advanceTimersByTime(700); // let any mount-time debounce settle
      });
      act(() => {
        result.current.addPoint({ pointNo: "9", n: 2, e: 2, z: null, code: "" });
      });
      // Not yet flushed.
      expect(localStorage.getItem("sitesurveyorCad:proj-cache")).not.toContain('"pointNo":"9"');
      act(() => {
        vi.advanceTimersByTime(700);
      });
      expect(localStorage.getItem("sitesurveyorCad:proj-cache")).toContain('"pointNo":"9"');
    } finally {
      vi.useRealTimers();
    }
  });
});
```

Note: if the backend repository import fires network calls in jsdom, mock it at the top of the file:

```tsx
vi.mock("../../../../lib/repositories/cadDrawings.ts", () => ({
  getCadDrawing: vi.fn(async () => null),
  saveCadDrawing: vi.fn(async () => undefined),
}));
```

- [ ] **Step 2: Run to verify they PASS against current code**

Run: `cd frontend && npx vitest run src/features/projects/components/cad/useCadModel.history.test.tsx`
Expected: PASS (these are characterization tests — failures indicate a wrong assumption about current behavior; fix the TEST, not the hook).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/projects/components/cad/useCadModel.history.test.tsx
git commit -m "test(cad): characterize undo/transaction/cache behavior before model split"
```

---

### Task 2: Extract `model/cadUndo.ts` — pure history machine

**Files:**
- Create: `frontend/src/features/projects/components/cad/model/cadUndo.ts`
- Create: `frontend/src/features/projects/components/cad/model/cadUndo.test.ts`
- Modify: `frontend/src/features/projects/components/cad/useCadModel.ts:276-352` (replace inline history state with the machine)
- Move nothing else.

**Interfaces:**
- Produces (used by Task 3 consumers and future phases):

```ts
import type { CadModelState } from "../cadModel";

export const HISTORY_LIMIT = 100;

export interface CadHistoryState {
  past: CadModelState[];
  future: CadModelState[];
  tx: { entriesPushed: number; base: CadModelState } | null;
}

export function createCadHistoryState(): CadHistoryState;
/** Standard editor commit: push prev onto past (respecting open transaction + limit), clear future. Returns true if history changed. */
export function recordCommit(h: CadHistoryState, prev: CadModelState, next: CadModelState): boolean;
/** Undo: pops past into future. Returns the model to restore, or null if impossible. */
export function applyUndo(h: CadHistoryState, current: CadModelState): CadModelState | null;
/** Redo: pops future into past. Returns the model to restore, or null. */
export function applyRedo(h: CadHistoryState, current: CadModelState): CadModelState | null;
export function beginTx(h: CadHistoryState, base: CadModelState): void;
export function endTx(h: CadHistoryState): void;
/** Cancel: pops the transaction's pushed entry and returns the base model to restore (or null when no tx was open). */
export function discardTx(h: CadHistoryState): CadModelState | null;
export function resetHistory(h: CadHistoryState): void;
```

- [ ] **Step 1: Write failing module tests**

```ts
import { describe, expect, it } from "vitest";
import { emptyModel } from "../cadModel";
import {
  applyRedo, applyUndo, beginTx, createCadHistoryState, discardTx, endTx,
  HISTORY_LIMIT, recordCommit,
} from "./cadUndo";

const m = (tag: string): ReturnType<typeof emptyModel> =>
  ({ ...emptyModel(), activeLayerId: tag } as ReturnType<typeof emptyModel>);

describe("cadUndo machine", () => {
  it("recordCommit pushes prev and clears future; applyUndo/applyRedo swap stacks", () => {
    const h = createCadHistoryState();
    const a = m("a"), b = m("b"), c = m("c");
    recordCommit(h, a, b);
    recordCommit(h, b, c);
    expect(h.past).toEqual([a, b]);
    expect(applyUndo(h, c)).toBe(b);
    expect(applyUndo(h, b)).toBe(a);
    expect(applyUndo(h, a)).toBeNull();
    expect(applyRedo(h, a)).toBe(b);
    expect(applyRedo(h, b)).toBe(c);
    expect(applyRedo(h, c)).toBeNull();
  });

  it("a new commit after undo clears the redo stack", () => {
    const h = createCadHistoryState();
    const a = m("a"), b = m("b");
    recordCommit(h, a, b);
    applyUndo(h, b);
    recordCommit(h, a, m("z"));
    expect(h.future).toEqual([]);
  });

  it("transaction collapses commits into one entry and honours HISTORY_LIMIT shift", () => {
    const h = createCadHistoryState();
    const base = m("base");
    beginTx(h, base);
    recordCommit(h, base, m("t1"));
    recordCommit(h, m("t1"), m("t2"));
    endTx(h);
    expect(h.past).toEqual([base]); // ONE entry despite two commits
    // Limit: fill past beyond HISTORY_LIMIT and check the shift cap.
    let cur = m("cur");
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      const next = m(`n${i}`);
      recordCommit(h, cur, next);
      cur = next;
    }
    expect(h.past.length).toBeLessThanOrEqual(HISTORY_LIMIT);
  });

  it("discardTx pops only its own entry and returns the tx base", () => {
    const h = createCadHistoryState();
    const a = m("a");
    recordCommit(h, a, m("b"));          // committed step
    const txBase = m("txbase");
    beginTx(h, txBase);
    recordCommit(h, txBase, m("t1"));
    expect(discardTx(h)).toBe(txBase);   // returns base to restore
    expect(h.past).toEqual([a]);         // tx entry gone, earlier commit intact
    expect(discardTx(h)).toBeNull();     // no open tx → null
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/features/projects/components/cad/model/cadUndo.test.ts`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement `model/cadUndo.ts`**

Port the exact logic from `useCadModel.ts:280-352`: `commit`'s push/limit/tx-collapse becomes `recordCommit`; `beginTransaction/endTransaction/discardTransaction` become `beginTx/endTx/discardTx`. The machine holds plain arrays — NO React imports, NO timers. Semantics to preserve exactly:
- Push skipped inside an open tx once `entriesPushed === 1`.
- `past.length > HISTORY_LIMIT` → `shift()`.
- Any successful commit clears `future` (including inside tx).
- `discardTx` pops only when `entriesPushed > 0`, clears `future`, returns `tx.base`.

- [ ] **Step 4: Rewire `useCadModel.ts` to the machine**

Replace refs/state at `useCadModel.ts:281-352`:
- `const histRef = useRef<CadHistoryState>(createCadHistoryState());`
- `commit(updater)` becomes: compute `prev = modelRef.current`, `next = updater(prev)`; if `recordCommit(histRef.current, prev, next)` then `modelRef.current = next; setModel(next); syncHistoryFlags();`
- `undo()`/`redo()` call `applyUndo`/`applyRedo`, set model + flags, return boolean.
- Transaction callbacks delegate to `beginTx/endTx/discardTx` (discard also restores model).
- Project-switch layout effect (`useCadModel.ts:370-373`) and `resetHistory` call `resetHistory(histRef.current)`.

- [ ] **Step 5: Full verification**

Run: `cd frontend && npx vitest run src/features/projects/components/cad/ && npm run typecheck && npm run lint`
Expected: ALL PASS including Task 1 characterization tests (unchanged).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/projects/components/cad/model/cadUndo.ts \
        frontend/src/features/projects/components/cad/model/cadUndo.test.ts \
        frontend/src/features/projects/components/cad/useCadModel.ts
git commit -m "refactor(cad): extract pure undo history machine into model/cadUndo"
```

---

### Task 3: Extract `model/cadPersistence.ts` — cache, debounce scheduling, generation guard

**Files:**
- Create: `frontend/src/features/projects/components/cad/model/cadPersistence.ts`
- Create: `frontend/src/features/projects/components/cad/model/cadPersistence.test.ts`
- Modify: `frontend/src/features/projects/components/cad/useCadModel.ts` (delete moved helpers L27–66, L265–266 constants, L375–383 guard/timer refs init, L460–526 effects → replaced by scheduler usage)

**Interfaces:**

```ts
import type { CadModelState } from "../cadModel";

export const SAVE_DEBOUNCE_MS = 1200;   // was useCadModel.ts:265
export const CACHE_DEBOUNCE_MS = 600;   // was useCadModel.ts:266

export function normalizeModel(parsed: Partial<CadModelState> | null | undefined): CadModelState;   // moved verbatim from L31-47
export function loadCachedModel(projectId: string): CadModelState;                                   // moved verbatim from L50-58
export function cacheModel(projectId: string, model: CadModelState): void;                           // moved verbatim from L60-66
export function isCadOnline(): boolean;                                                              // moved verbatim from L27-29

/** Debounce scheduler mirroring the two-timer behaviour of useCadModel.ts:483-507. */
export interface PersistenceDeps {
  projectId: string;
  getCachedModel(): CadModelState;                       // () => modelRef.current
  hydrated(): boolean;
  online(): boolean;
  save(model: CadModelState): Promise<void>;             // already try/catch'd caller
}
export class CadPersistenceScheduler {
  constructor(deps: PersistenceDeps);
  /** Call from the model-change effect: restarts cache timer; schedules save only when hydrated+online. */
  onModelChange(): void;
  /** Flush both timers immediately (pagehide/beforeunload/unmount). */
  flush(): Promise<void>;
  dispose(): void;
}

/** Generation counter for cross-project loads (useCadModel.ts:377,430,442). */
export class LoadGeneration {
  next(): number;          // increments and returns new value
  isCurrent(g: number): boolean;
}
```

- [ ] **Step 1: Write failing tests**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyModel } from "../cadModel";
import {
  CACHE_DEBOUNCE_MS, SAVE_DEBOUNCE_MS, loadCachedModel, normalizeModel, CadPersistenceScheduler, LoadGeneration,
} from "./cadPersistence";

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe("cadPersistence cache", () => {
  it("round-trips a model through localStorage and tolerates corrupt JSON", () => {
    localStorage.setItem("sitesurveyorCad:p1", JSON.stringify({ points: [{ id: "x" }] }));
    expect(loadCachedModel("p1").points).toHaveLength(1);
    localStorage.setItem("sitesurveyorCad:p1", "{not json");
    expect(loadCachedModel("p1")).toEqual(emptyModel());
  });
  it("normalizeModel fills missing collections and defaults", () => {
    const m = normalizeModel({});
    expect(m.layers).toEqual(emptyModel().layers);
    expect(m.activeLayerId).toBe("0");
  });
});

describe("CadPersistenceScheduler", () => {
  function makeDeps() {
    return {
      projectId: "p",
      getCachedModel: () => ({ ...emptyModel() }),
      hydrated: () => true,
      online: () => true,
      save: vi.fn(async () => undefined),
    };
  }

  it("flush writes the cache immediately and saves only a PENDING save", async () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    const s = new CadPersistenceScheduler(deps);
    await s.flush(); // nothing pending
    expect(deps.save).not.toHaveBeenCalled();

    s.onModelChange();
    await s.flush(); // cache write + pending save fire now
    expect(JSON.parse(localStorage.getItem("sitesurveyorCad:p")!)).toEqual(emptyModel());
    expect(deps.save).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it("save timer fires at SAVE_DEBOUNCE_MS after onModelChange", async () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    const s = new CadPersistenceScheduler(deps);
    s.onModelChange();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1);
    expect(deps.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.save).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it("skips scheduling save when not hydrated or offline", async () => {
    vi.useFakeTimers();
    const deps = { ...makeDeps(), hydrated: () => false, online: () => false };
    const s = new CadPersistenceScheduler(deps);
    s.onModelChange();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + CACHE_DEBOUNCE_MS + 10_000);
    expect(deps.save).not.toHaveBeenCalled();
    s.dispose();
  });
});
```

**Flush contract (decided — encode exactly this):** `flush()` clears both timers; writes the cache immediately; and if a save timer WAS pending and `hydrated()+online()`, invokes `save()` immediately (mirrors `useCadModel.ts:461-469` pagehide behavior).

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/features/projects/components/cad/model/cadPersistence.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `cadPersistence.ts`** — move helpers verbatim; scheduler holds `cacheTimer`/`saveTimer` refs replicating `useCadModel.ts:483-507` semantics (skip save scheduling when `!hydrated() || !online()`; `flush()` mirrors L461-469; `dispose()` clears timers).

- [ ] **Step 4: Rewire `useCadModel.ts`** — delete moved code; instantiate `const persistence = useMemo(...)` or plain object keyed by deps; effects at L483-507 and pagehide handler L460-478 delegate to `persistence.onModelChange()/flush()/dispose()`. Keep `syncStatus`/`syncError` setState logic INSIDE the `save()` closure passed in (it stays in the hook).

- [ ] **Step 5: Verify** — full cad suite + typecheck + lint green, Task 1 characterization cache test still passes.

- [ ] **Step 6: Commit** — `refactor(cad): extract persistence scheduling into model/cadPersistence`

---

### Task 4: Analysis foundation — `analysis/workflowCtx.ts` + surface workflows

**Files:**
- Create: `frontend/src/features/projects/components/cad/analysis/workflowCtx.ts`
- Create: `frontend/src/features/projects/components/cad/analysis/surfaceWorkflows.ts`
- Create: `frontend/src/features/projects/components/cad/analysis/surfaceWorkflows.test.ts`
- Modify: `frontend/src/features/projects/components/CadWorkspace.tsx` (delete `buildSurface` L1672-1692, `buildSurfaceWithBreaklines` L1721-1784, `buildBoundarySurface` L1787-1816, `surfacePoints` L1666-1670; replace call sites at L2368-2370 with thin wrappers)

**Interfaces:**

```ts
// analysis/workflowCtx.ts
import type { CadModelState, CadSelection, LayerId, SurveyLinework, SurveyPoint, SurveySurface, SurveyText } from "../cadModel.ts";

export interface WorkflowDialogs {
  prompt(message: string, defaultValue?: string): Promise<string | null>;
  select(message: string, options: string[]): Promise<string | null>;
}

export interface WorkflowApi {
  ensureLayerById(id: LayerId): unknown;
  addLinework(l: Omit<SurveyLinework, "id" | "layerId"> & { layerId?: LayerId }): SurveyLinework;
  updateLinework(id: string, patch: Partial<SurveyLinework>): void;
  deleteLinework(id: string): void;
  addPoint(p: Omit<SurveyPoint, "id" | "layerId"> & { layerId?: LayerId }): SurveyPoint;
  updatePoint(id: string, patch: Partial<SurveyPoint>): void;
  deletePoint(id: string): void;
  updateText(id: string, patch: Partial<SurveyText>): void;
  addSurface(s: Omit<SurveySurface, "id" | "layerId" | "visible"> & { layerId?: LayerId; visible?: boolean }): SurveySurface;
  updateSurface(id: string, patch: Partial<SurveySurface>): void;
  deleteSurface(id: string): void;
  beginTransaction(): void;
  endTransaction(): void;
}

export interface WorkflowServices {
  dialog: WorkflowDialogs;
  log(text: string, kind?: "info" | "error"): void;
  fitExtents(): void;
  show3d(): void;
  openReport(title: string, bodyHtml: string): void;
  downloadCsv(filename: string, rows: (string | number)[][]): void;
  projectName: string;
}

export function surfacePointsOf(model: CadModelState): { n: number; e: number; z: number }[];
// verbatim port of surfacePoints (L1666-1670)

export async function pickSurface(
  surfaces: SurveySurface[], dialog: WorkflowDialogs, title: string,
): Promise<SurveySurface | null>;
// MOVE VERBATIM: locate `pickSurface` in CadWorkspace.tsx (search "function pickSurface")
// It dialog.selects over numbered surface names and returns the chosen surface or null.
```

```ts
// analysis/surfaceWorkflows.ts exports:
export async function runBuildSurface(model: CadModelState, api: WorkflowApi, services: WorkflowServices): Promise<void>;
export async function runBuildSurfaceWithBreaklines(model: CadModelState, selection: CadSelection, api: WorkflowApi, services: WorkflowServices): Promise<void>;
export async function runBuildBoundarySurface(model: CadModelState, selection: CadSelection, api: WorkflowApi, services: WorkflowServices): Promise<void>;
```

- [ ] **Step 1: Write failing tests with a fake api/services harness**

```ts
// analysis/testHarness.ts (shared by Tasks 4-8 tests)
import type { CadModelState, SurveyLinework, SurveySurface } from "../cadModel.ts";
import { emptyModel } from "../cadModel.ts";
import type { WorkflowApi, WorkflowDialogs, WorkflowServices } from "./workflowCtx.ts";

let seq = 0;
export function fakeModel(patch: Partial<CadModelState> = {}): CadModelState {
  return { ...emptyModel(), ...patch };
}
export function fakeApi(model: CadModelState) {
  const calls: { op: string; args: unknown[] }[] = [];
  const api: WorkflowApi = {
    ensureLayerById: (id) => { calls.push({ op: "ensureLayer", args: [id] }); return id; },
    addLinework: (l) => {
      calls.push({ op: "addLinework", args: [l] });
      seq += 1;
      return { id: `lw-${seq}`, layerId: l.layerId ?? "0", ...l } as SurveyLinework;
    },
    updateLinework: (id, patch) => calls.push({ op: "updateLinework", args: [id, patch] }),
    deleteLinework: (id) => calls.push({ op: "deleteLinework", args: [id] }),
    addPoint: (p) => { calls.push({ op: "addPoint", args: [p] }); seq += 1; return { id: `pt-${seq}`, layerId: p.layerId ?? "0", ...p }; },
    updatePoint: (id, patch) => calls.push({ op: "updatePoint", args: [id, patch] }),
    deletePoint: (id) => calls.push({ op: "deletePoint", args: [id] }),
    updateText: (id, patch) => calls.push({ op: "updateText", args: [id, patch] }),
    addSurface: (s) => {
      calls.push({ op: "addSurface", args: [s] });
      seq += 1;
      return { id: `sf-${seq}`, visible: true, layerId: s.layerId ?? "0", name: s.name, points: s.points, triangles: s.triangles } as unknown as SurveySurface;
    },
    updateSurface: (id, patch) => calls.push({ op: "updateSurface", args: [id, patch] }),
    deleteSurface: (id) => calls.push({ op: "deleteSurface", args: [id] }),
    beginTransaction: () => calls.push({ op: "beginTx", args: [] }),
    endTransaction: () => calls.push({ op: "endTx", args: [] }),
  };
  return { api, calls };
}
export function fakeServices(dialogs: Partial<WorkflowDialogs> = {}) {
  const log = vi.fn();
  const services: WorkflowServices = {
    dialog: {
      prompt: async () => null,
      select: async () => null,
      ...dialogs,
    } as WorkflowDialogs,
    log,
    fitExtents: vi.fn(),
    show3d: vi.fn(),
    openReport: vi.fn(),
    downloadCsv: vi.fn(),
    projectName: "Test Project",
  };
  return { services, log };
}
```

```ts
// analysis/surfaceWorkflows.test.ts
import { describe, expect, it } from "vitest";
import { runBuildSurface, runBuildSurfaceWithBreaklines } from "./surfaceWorkflows";
import { fakeApi, fakeModel, fakeServices } from "./testHarness";
// buildTin is async (WASM bridge w/ TS fallback) — the exported workflows
// await internally, so tests simply await them.

function pts(count: number) {
  // Three well-spread 3D points triangulate to exactly one triangle.
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`, pointNo: String(i), n: i * 10, e: i * 7, z: i * 3, code: "", layerId: "TOPO",
  }));
}

describe("runBuildSurface", () => {
  it("adds one TOPO surface", async () => {
    const model = fakeModel({ points: pts(3) });
    const { api, calls } = fakeApi(model);
    const { services, log } = fakeServices();
    await runBuildSurface(model, api, services);
    const adds = calls.filter((c) => c.op === "addSurface");
    expect(adds).toHaveLength(1);
    expect((adds[0].args[0] as { layerId: string }).layerId).toBe("TOPO");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("triangles"));
    expect(services.fitExtents).toHaveBeenCalled();
  });

  it("replaces any previous TOPO surfaces before adding the new one", async () => {
    const stale = {
      id: "sf-old", name: "Surface 1", layerId: "TOPO", visible: true,
      points: [], triangles: [],
    };
    const model = fakeModel({ points: pts(3), surfaces: [stale] });
    const { api, calls } = fakeApi(model);
    const { services } = fakeServices();
    await runBuildSurface(model, api, services);
    expect(calls.some((c) => c.op === "deleteSurface" && c.args[0] === "sf-old")).toBe(true);
    expect(calls.indexOf(calls.find((c) => c.op === "deleteSurface")!))
      .toBeLessThan(calls.indexOf(calls.find((c) => c.op === "addSurface")!));
  });

  it("logs an error when fewer than 3 valid-Z points exist", async () => {
    const model = fakeModel({ points: pts(2) });
    const { api } = fakeApi(model);
    const { services, log } = fakeServices();
    await runBuildSurface(model, api, services);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("at least 3 points"), "error");
  });

  it("uses a selected closed ring as the clip boundary (constrained variant)", async () => {
    const ring = {
      id: "lw-ring", kind: "boundary" as const, closed: true,
      vertices: [{ n: 0, e: 0 }, { n: 100, e: 0 }, { n: 50, e: 80 }],
      layerId: "BOUNDARY",
    };
    const model = fakeModel({
      points: pts(4),
      linework: [ring],
    });
    const selection = { type: "linework" as const, id: "lw-ring", items: [{ type: "linework" as const, id: "lw-ring" }] };
    const { api, calls } = fakeApi(model);
    const { services } = fakeServices();
    await runBuildSurfaceWithBreaklines(model, selection, api, services);
    const adds = calls.filter((c) => c.op === "addSurface");
    expect(adds).toHaveLength(1);
    expect((adds[0].args[0] as { name: string }).name).toContain("(constrained)");
  });
});
```

- [ ] **Step 2: Run → FAIL (modules missing)**

- [ ] **Step 3: Implement by moving bodies VERBATIM from CadWorkspace.tsx**
- `runBuildSurface` ← L1672-1692 body; `model.surfaces` reads come from the `model` param; `cad.*` → `api.*`; `log`/`fitExtents` → `services.*`; `lastBackend()` import moves too (from whichever survey/*Bridge module supplies it — copy the existing import).
- `runBuildSurfaceWithBreaklines` ← L1721-1784 (takes `selection` param instead of closing over `cad.selection`; imports `buildCodeTable`/`buildFeatureStrings` from `../survey/featureCodes.ts` + `../survey/fieldToFinish.ts`, `buildConstrainedTin` from its current source).
- `runBuildBoundarySurface` ← L1787-1816.
- In CadWorkspace replace each callback with a 2-line wrapper, e.g.:

```tsx
const buildSurface = useCallback(
  () => runBuildSurface(model, cad, cadServices),
  [model, cad, cadServices],
);
```

where `cadServices` is a `useMemo` object built once near the other context objects (~L2300) mapping `{ dialog, log, fitExtents, show3d: () => settingsApi.update({ view3d: true }), openReport: openReportWindow, downloadCsv: downloadCsvFile, projectName: activeProject.name }`. (`openReportWindow`/`downloadCsvFile` already exist in CadWorkspace — reuse their names as found; do NOT rename.)

- [ ] **Step 4: Run → PASS** (module tests + full cad suite + typecheck + lint)
- [ ] **Step 5: Commit** — `refactor(cad): extract TIN surface workflows to analysis/surfaceWorkflows`

---

### Task 5: `analysis/contourWorkflows.ts`

**Files:** Create `contourWorkflows.ts` + `.test.ts`; Modify CadWorkspace (delete `buildContours` L1818-1912, wrapper at ribbon case `"surface:contours"`).

**Interfaces:** `export async function runBuildContours(model: CadModelState, api: WorkflowApi, services: WorkflowServices): Promise<void>;`

- [ ] **Step 1: Failing tests** — fixture surface (two flat levels z=10/z=20 joined by sloped triangles, hand-written triangles array), dialogs scripted via `fakeServices({ select: async () => "0", prompt: async (msg, def) => def ?? "1" })`:
  - interval/index/base/smoothing defaults flow through; `addLinework` calls recorded; assert every call's `layerId` ∈ {"CONTOURS","CONTOURS_INDEX"} and `label` matches elevation string;
  - index math: choose interval=10, indexEvery default "5", base=10 → contours at 10 & 20: steps = (el−10)/10 = 0 and 1 → only el=10 is index. Assert exactly one CONTOURS_INDEX entity labelled "10.00";
  - `beginTransaction` precedes and `endTransaction` follows all addLinework calls (check ordering in `calls`);
  - error path: no surfaces → log contains "build a TIN surface first".
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Move body verbatim** (L1818-1912). Imports: `generateContours`, `autoContourInterval` from their current survey module, `pickSurface` from `./workflowCtx.ts`. Replace `dialog.` → `services.dialog.`, `cad.` → `api.`, `log` → `services.log`.
- [ ] **Step 4: Run → PASS; wrapper swap in CadWorkspace.**
- [ ] **Step 5: Commit** — `refactor(cad): extract contour workflow to analysis/contourWorkflows`

---

### Task 6: `analysis/volumeWorkflows.ts`

**Files:** Create `volumeWorkflows.ts` + `.test.ts`; Modify CadWorkspace (delete L1914-2019; wrappers for `"surface:volume-elevation"` / `"surface:volume-between"`).

**Interfaces:**

```ts
export async function runVolumeToElevation(model: CadModelState, api: WorkflowApi, services: WorkflowServices): Promise<void>;
export async function runVolumeBetween(model: CadModelState, api: WorkflowApi, services: WorkflowServices): Promise<void>;
```

- [ ] **Step 1: Failing tests**
  - Volume-to-elevation: fixture surface with known cut/fill vs RL; scripted dialogs (`select` returns the "Lowest…" option text computed from fixture zMin — assert against actual option list passed to `select`), assert logged string contains `cut `, `fill `, `net `, and one `addSurface` with `layerId === "CUT_FILL"`, `cutFill.mode === "elevation"`, `cutFill.reference === RL`; `services.show3d` called; sign convention: RL above surface ⇒ fill > cut (per SurfaceCutFill docs +cut/−fill mirrored in log).
  - Volume-between: two overlapping fixtures; `select` picks "Overlap only…"; assert `cutFill.mode === "between"` and error path logs strict-mode exception message when `select` returns "Strict…" over disjoint footprints.
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Move verbatim** (L1914-1969 and L1971-2019). Imports: `volumeToElevation`, `volumeBetween`, `cutFillToElevation`, `cutFillBetween`, plus `fmtArea` from `../survey/format.ts` (verify current import source). `settingsApi.update({ view3d: true })` → `services.show3d()`.
- [ ] **Step 4: Run → PASS; wrappers swapped.**
- [ ] **Step 5: Commit** — `refactor(cad): extract volume workflows to analysis/volumeWorkflows`

---

### Task 7: `analysis/terrainWorkflows.ts` + `analysis/profileWorkflow.ts`

**Files:** Create both + tests; Modify CadWorkspace (delete `aspectColor` L2023-2038, `analyseSurfaceTerrain` L2042-2091, `extractProfile` L2095 through its end — read forward from L2159 to find the closing `}, [deps]);` before the annotation label functions; wrappers for `"surface:terrain"` and `"surface:profile"`).

**Interfaces:**

```ts
export function aspectColor(aspectDeg: number | null): string;  // moved verbatim (L2023-2038)
export async function runTerrainAnalysis(model: CadModelState, api: WorkflowApi, services: WorkflowServices): Promise<void>;
export async function runExtractProfile(model: CadModelState, selection: CadSelection, api: WorkflowApi, services: WorkflowServices): Promise<void>;
```

- [ ] **Step 1: Failing tests**
  - `aspectColor`: N→"#dc2626", E→"#eab308", S→"#16a34a", W→"#3b82f6", null→"#64748b", 350° wraps to N sector.
  - Terrain: single flat-ish fixture surface; `select` → slope mode; assert one `addSurface` carrying `slopeShade.triangles` of same length as fixture triangles, `services.openReport` called with title starting "Terrain Analysis — ", log contains "mean slope".
  - Profile: fixture tin with constant z=10 covering the section line; selected linework with vertices (0,0)→(0,30); interval prompt default; assert `services.downloadCsv` rows include chainages 0/interval-steps/30 with z=10, `services.openReport` called, error path when selection empty ("select a polyline or boundary").
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Move verbatim.** Profile block includes its local chart-SVG builder and CSV assembly — relocate whole region L2095→end-of-callback intact. `activeProject.name` → `services.projectName`; `openReportWindow(...)` → `services.openReport(...)`; CSV download helper call → `services.downloadCsv(...)`.
- [ ] **Step 4: Run → PASS; wrappers swapped.**
- [ ] **Step 5: Commit** — `refactor(cad): extract terrain + long-section workflows`

---

### Task 8: `analysis/fieldToFinishWorkflow.ts` + `analysis/geomWorkflows.ts`

**Files:** Create both + tests; Modify CadWorkspace (delete `processLinework` L1695-1718, hull L1542-1555 area (`computeConvexHull` callback start above L1540 — include its guard lines), `simplifySelection` L1557-1577, `reprojectDrawing` L1581-1661; wrappers for `"f2f:linework"`, `"geom:hull"`, `"geom:simplify"`, `"geom:reproject"`).

**Interfaces:**

```ts
export function runProcessLinework(model: CadModelState, api: WorkflowApi, services: WorkflowServices): void;
export async function runConvexHull(model: CadModelState, api: WorkflowApi, services: WorkflowServices): Promise<void>;
export async function runSimplifySelection(model: CadModelState, selection: CadSelection, api: WorkflowApi, services: WorkflowServices): Promise<void>;
export async function runReproject(model: CadModelState, api: WorkflowApi, services: WorkflowServices): Promise<void>;
```

- [ ] **Step 1: Failing tests**
  - f2f: points coded "FL1".."FL3" (consult `survey/featureCodes.ts` for the exact stringable-code shape; reuse fixtures from `featureCodes.test.ts`) → one `addLinework` with closed=false on that feature's layer; zero stringable → info log "no stringable coded points".
  - Hull: 5 points → one closed boundary on BOUNDARY layer with 5 vertices; degenerate (collinear 2 distinct) → error log "degenerate point set".
  - Simplify: selected polyline + tolerance prompt "0.5"; collinear-heavy fixture reduces vertex count; no-selection → error "select a polyline/boundary first".
  - Reproject: skip numeric CRS assertion (bridge-dependent); test only the guards: empty drawing → "nothing to transform"; identical from/to selection → info log. Mock `reproject` via `vi.mock` on its bridge module for a happy-path counting test (updates batched: one `updateLinework` per affected polyline, not per vertex).
- [ ] **Step 2–4: FAIL → move verbatim (ranges above; imports `PROJECTION_PRESETS`, `reproject`, `lastReprojectBackend`, `convexHull`, `simplifyLine` from their current modules) → PASS; wrappers swapped.**
- [ ] **Step 5: Commit** — `refactor(cad): extract field-to-finish and geometry workflows`

After this task CadWorkspace should have lost ~650 lines of analysis code. Sanity-check with `wc -l`.

---

### Task 9: `commands/commandRegistry.ts` — merge ribbon+menu dispatch

**Files:**
- Create: `frontend/src/features/projects/components/cad/commands/commandRegistry.ts`
- Create: `frontend/src/features/projects/components/cad/commands/commandRegistry.test.ts`
- Modify: `frontend/src/features/projects/components/CadWorkspace.tsx` — `handleRibbonAction` L2318-2425 and `handleMenuAction` L2459-2518 become thin delegations.

**Scope decision (behavior preservation > literal merging):** the command LINE stays in `useCadCommands.ts::runCommand` (already unit-tested; `handleCommandSubmit` keeps its `parseDistanceBearing` pre-step untouched). The registry owns ribbon ids + menu ids.

**Interfaces:**

```ts
// commands/commandRegistry.ts
import type { CommandContext } from "../../useCadCommands.ts";
import type { CadToolId } from "../cadModel.ts";
import type { UseCadModel } from "../../useCadModel.ts"; // adjust relative depth
import type { CadSettingsPanelToggleKey } from "../cadSettings.ts"; // adapt to real export

/** Workspace-level callbacks the registry needs beyond CommandContext. */
export interface RegistryHost extends CommandContext {
  cad: UseCadModel;
  deleteSelection(): void;
  explodeSelection(): void;
  openProjectPoints(): void;
  openImportDxf(): void;
  importGeoJson(): void;
  exportDxf(): void;
  exportCsv(): void;
  exportReport(): void;
  exportGeoJson(): Promise<void>;
  runIntersection(): void;
  runInverse(): void;
  runArea(): void;
  labelBoundarySegments(): void;
  labelArea(): void;
  labelCoordinates(): void;
  toggleView(key: "snap" | "ortho" | "grid" | "osnap"): void;
  toggle3d(): void;
}

export interface CommandEntry {
  id: string;                 // canonical: ribbon group:sub, e.g. "surface:tin"
  menuAliases?: string[];     // menu action ids mapping here, e.g. ["edit:delete"]
  run(host: RegistryHost): void;
}

export function buildCommandRegistry(entries: CommandEntry[]): {
  runRibbon(actionId: string, host: RegistryHost): void;   // logs "Unhandled action: X" like L2413
  runMenu(action: string, host: RegistryHost): void;       // resolves menuAliases; unknown = no-op (current default)
};
```

Entries replicate EVERY branch of L2320-2414 one-for-one (tool:* for each CadToolId, zoom:extents, edit:delete/undo/redo/explode, project:points, import:dxf, f2f:linework, plot:layout, export:dxf/csv/report/geojson, geom:hull/simplify/reproject, cogo:intersection/inverse/area/bearing-distance/traverse, surface:tin/tin-breaklines/boundary/contours/volume-elevation/volume-between/terrain/profile/cutfill-report/clear-contours/clear-surfaces, annotate:label-boundary/label-area/label-coord, cmd:hatch). Menu aliases: file:project-points→project:points; file:import-dxf→import:dxf; file:export-dxf→export:dxf; file:import-geojson→host.importGeoJson (own entry `file:import-geojson`); file:export-csv→export:csv; file:export-geojson→export:geojson; edit:undo/edit:redo/edit:delete→edit:*; view:zoom-extents→zoom:extents; plot:layout→plot:layout; view:grid/snap/osnap→own entries calling host.toggleView; view:3d→own entry calling host.toggle3d.

- [ ] **Step 1: Failing routing-table test**

```ts
const host: RegistryHost = stubHost(); // vi.fn() for every member
const reg = buildCommandRegistry(DEFAULT_COMMAND_ENTRIES);

it("routes every legacy ribbon id", () => {
  for (const id of ["tool:line","tool:pan","tool:point","tool:text","tool:measure",
    "zoom:extents","edit:delete","edit:undo","edit:redo","edit:explode","project:points",
    "import:dxf","f2f:linework","plot:layout","export:dxf","export:csv","export:report",
    "export:geojson","geom:hull","geom:simplify","geom:reproject","cogo:intersection",
    "cogo:inverse","cogo:area","cogo:bearing-distance","surface:tin","surface:tin-breaklines",
    "surface:boundary","surface:contours","surface:volume-elevation","surface:volume-between",
    "surface:terrain","surface:profile","surface:cutfill-report","surface:clear-contours",
    "surface:clear-surfaces","annotate:label-boundary","annotate:label-area",
    "annotate:label-coord","cmd:hatch"]) {
    expect(() => reg.runRibbon(id, host)).not.toThrow();
  }
  reg.runRibbon("nonexistent:x", host);
  expect(host.log).toHaveBeenCalledWith("Unhandled action: nonexistent:x", "error");
});

it("menu aliases hit the same handlers", () => {
  reg.runMenu("edit:delete", host);
  expect(host.deleteSelection).toHaveBeenCalledTimes(1);
  reg.runMenu("file:project-points", host);
  expect(host.openProjectPoints).toHaveBeenCalledTimes(1);
  reg.runMenu("view:3d", host);
  expect(host.toggle3d).toHaveBeenCalledTimes(1);
});
```

Also enumerate the tool:* cases actually produced by `CadRibbon` (read `CadRibbon.tsx` for the exact id list — e.g. `tool:move`, `tool:copy`, `tool:rotate`, `tool:scale`, `tool:mirror`, `tool:offset`, `tool:dim-linear`, `tool:circle`, `tool:arc`, `tool:zoom-window`, `tool:control-point`, `tool:spot-height`, `tool:boundary`) and add them to the table test so none can silently vanish.

- [ ] **Step 2: FAIL → Step 3: implement entries as direct ports of each switch branch** (bodies reference the extracted workflow functions from Tasks 4–8 where applicable, e.g. `case "surface:clear-contours"` keeps its inline transaction loop verbatim).
- [ ] **Step 4:** CadWorkspace: `const registry = useMemo(() => buildCommandRegistry(DEFAULT_COMMAND_ENTRIES), [])`; `handleRibbonAction = (id) => registry.runRibbon(id, host)` where `host` is the memoized object currently named `commandCtx` EXTENDED with the extra members (rename optional). Delete old switch bodies. `handleMenuAction = (a) => registry.runMenu(a, host)`.
- [ ] **Step 5: Full suite + typecheck + lint green** (existing `CadMenuBar.test.tsx` must stay green).
- [ ] **Step 6: Commit** — `refactor(cad): single command registry behind ribbon and menu dispatch`

---

### Task 10: `tools/pickFlows.ts` — per-tool pick-point branches

**Files:**
- Create: `tools/pickFlows.ts` + `tools/pickFlows.test.ts`
- Modify: `CadWorkspace.tsx` `handlePickPoint` L545-877 → dispatch loop calling flows.

**Interfaces:**

```ts
export interface PickFlowCtx {
  world: { n: number; e: number };
  tool: CadToolId;
  cad: UseCadModel;
  dialog: WorkflowDialogs;
  log(text: string, kind?: "info" | "error"): void;
  activeColor: string | null;
  pendingVertices: { n: number; e: number }[];
  setPendingVertices(update: (v: { n: number; e: number }[]) => { n: number; e: number }[]): void;
  setPointForm(form: PointFormOpenState): void;        // reuse the exact state shapes/types from CadWorkspace
  setControlPointForm(form: ControlPointFormOpenState): void;
  axisConvention: AxisConvention;                      // for spot-height/RL preview branches further down L665+
}
/** Runs the branch for ctx.tool; returns true when the tool consumed the pick. */
export async function handleToolPick(ctx: PickFlowCtx): Promise<boolean>;
```

- [ ] **Step 1: Failing tests** (fake `cad` object literal with `vi.fn()` members + minimal `model`/`layerById`):
  - circle: first pick appends vertex + logs "Specify point on circumference:"; second pick with radius>0 creates circle (`cad.addCircle` called with hypot radius) and selects it; radius 0 → error log, resets pending to [].
  - arc: three collinear points → error "collinear or coincident", pending reset.
  - move/copy: empty selection → error "select objects first"; two picks call `transformSelection(dn, de, isCopy)` and log count.
  - line/boundary pick appends to pendingVertices.
  - locked active layer blocks draw tools (error mentions layer name).
  Port remaining tools found at L665-877 (rotate/scale/mirror/offset/dim-linear/spot-height/measure/zoom-window) the same way — one test each asserting the observable api/log/setPendingVertices effect.
- [ ] **Step 2: FAIL → Step 3: move each `if (tool === …)` branch verbatim into `handleToolPick`** (shared prologue L548-556 stays at top of the function). CadWorkspace's `handlePickPoint` becomes: lock-check prologue + `await handleToolPick({...ctx})`.
- [ ] **Step 4: PASS full suite → Step 5: Commit** — `refactor(cad): per-tool pick handlers in tools/pickFlows`

---

### Task 11: `viewport/snapping.ts` + `viewport/hitTesting.ts`

**Files:**
- Create both + tests.
- Modify `CadViewport.tsx`: `applySnap` L290-300, `applyOrtho` L302-311, `findOsnap` L333-398, `resolveWorld` L400-408, `distToSegment` L410+, `hitTest` L529-637, box-select L644-781 → imports from the new modules.

**Interfaces:**

```ts
// viewport/snapping.ts
import type { CadModelState, Viewport } from "../cadModel.ts";
export interface ScreenProjector { (w: { n: number; e: number }): { x: number; y: number } }
export type OsnapKind = "endpoint" | "midpoint" | "node";
export interface OsnapHit { world: { n: number; e: number }; screen: { x: number; y: number }; kind: OsnapKind }
export const OSNAP_TOL_PX = 12;   // confirm constant value from CadViewport source; move verbatim

export function applyGridSnap(world: { n: number; e: number }, spacing: number, enabled: boolean): { n: number; e: number };
export function orthoConstraint(world: { n: number; e: number }, last: { n: number; e: number } | null): { n: number; e: number };
export function findOsnapHit(model: CadModelState, project: ScreenProjector, x: number, y: number, tolPx?: number): OsnapHit | null;
```

```ts
// viewport/hitTesting.ts
export type PickHit =
  | { type: "point"; id: string } | { type: "linework"; id: string } | { type: "text"; id: string }
  | { type: "arc"; id: string } | { type: "circle"; id: string } | { type: "ellipse"; id: string }
  | { type: "dimension"; id: string } | { type: "hatch"; id: string } | { type: "surface"; id: string };

export function pickEntityAt(
  model: CadModelState,
  isVisibleLayer(layerId: string): boolean,
  isSelectableLayer(layerId: string): boolean,
  project: ScreenProjector,
  x: number, y: number, tolPx?: number,          // tolPx default = current 8px PICK_TOL
): PickHit | null;

export function boxSelect(
  model: CadModelState, isSelectableLayer(layerId: string): boolean, project: ScreenProjector,
  a: { x: number; y: number }, b: { x: number; y: number }, crossing: boolean,
): { type: CadEntityType; id: string }[];         // WINDOW (fully-inside) vs CROSSING (touches)
```

- [ ] **Step 1: Failing tests** — grid snap rounds to spacing; ortho picks dominant axis; osnap midpoint beats farther endpoint within tolerance, ignores hidden layers; `pickEntityAt` prefers point over linework at equal distance and excludes locked layers; `boxSelect` WINDOW requires full containment, CROSSING accepts segment intersection.
- [ ] **Step 2: FAIL → Step 3: move bodies, converting closures to parameters exactly as the interfaces show** (the component passes `(w) => worldToScreen(w.n, w.e, vp, size)` and its `visibleLayer`/`selectableLayer` callbacks). Behavior identical including priority order documented at CadViewport L529 (`points > linework > text > surfaces > arc > circle > ellipse > dim > hatch`).
- [ ] **Step 4: PASS full suite → Step 5: Commit** — `refactor(cad): pure snapping and hit-testing modules under viewport/`

---

### Task 12: `viewport/entityRenderer.tsx`

**Files:** Create `entityRenderer.tsx` (and `.test.tsx` optional smoke test); Modify CadViewport render tree (the large `<svg>` body) to map entities through renderer components.

**Approach:** Move each entity-type render block (points/linework/arcs/circles/ellipses/texts/dimensions/hatches/surfaces incl. highlight styling for selection, labels, ByLayer color resolution via `resolveColor`/`canvasColor`) into exported components:

```tsx
export function PointEntities(props: { points: SurveyPoint[]; layers: CadLayer[]; selection: CadSelection; project: ScreenProjector }): JSX.Element;
export function LineworkEntities(props: {...}): JSX.Element;
// …one export per entity collection, props carry exactly what the block reads.
```

- [ ] **Step 1:** Smoke test rendering a fixture model into jsdom svg snapshot-free assertions (each entity id appears once in `container.querySelectorAll('[data-entity-id]')` — add `data-entity-id` attributes ONLY IF already present; otherwise assert element counts per type).
- [ ] **Step 2: FAIL → Step 3: move JSX blocks verbatim into components → CadViewport renders `<PointEntities …/>` etc. → Step 4: PASS → Step 5: Commit** — `refactor(cad): entity SVG rendering extracted to viewport/entityRenderer`

If a block proves too entangled with local closures to lift cleanly in mechanical fashion, STOP that block, leave it in CadViewport, and note it in the commit message — partial extraction is acceptable; silent rewriting is not.

---

### Task 13: `workspace/CadTopbar.tsx` + `workspace/CadBody.tsx`

**Files:** Create both components (+ `.test.tsx` render smoke tests); Modify CadWorkspace render region L2644-3017.

**Interfaces:**

```tsx
// CadTopbar receives explicit props for everything the topbar JSX reads:
export function CadTopbar(props: {
  activeProject: { id: string; name: string };
  statPills: { label: string; value: string }[];      // mirror whatever the current JSX computes inline
  layers: CadLayer[];
  activeLayerId: LayerId;
  onSelectLayer(id: LayerId): void;
  colorValue: string | null;                          // ByLayer dropdown state as found in the JSX
  onSelectColor(v: string | null): void;
  view3d: boolean;
  onToggle3d(): void;
  onOpenAiChat(): void;
  syncStatus: CadSyncStatus;
  syncError: string | null;
  settingsSlot: React.ReactNode;                      // settings popover rendered by parent if lifting is unsafe
  onExit(): void;
}): JSX.Element;

// CadBody composes viewport + right panel + chat panel:
export function CadBody(props: {
  view3d: boolean;
  viewportSlot: React.ReactNode;   // parent keeps CadViewport wiring; slots avoid re-plumbing events
  rightPanelSlot: React.ReactNode;
  chatOpen: boolean;
  chatSlot: React.ReactNode;
}): JSX.Element;
```

Use slot props for anything whose wiring lives in CadWorkspace hooks — moving event plumbing is NOT part of this task; moving JSX is.

- [ ] **Step 1: Smoke tests** — render each component with minimal props; assert key landmarks (project ref text, Exit button, 3D toggle presence).
- [ ] **Step 2: FAIL → Step 3: move JSX verbatim, threading props → Step 4: PASS full suite + manual sanity (`npm run dev`, open a project, CAD loads, draw a line, undo, plot preview opens) → Step 5: Commit** — `refactor(cad): extract topbar/body chrome to workspace components`

---

### Task 14: Final audit vs success criteria

**Files:** None created; possibly small fixes.

- [ ] **Step 1:** `wc -l` on CadWorkspace.tsx, cad/useCadModel.ts, CadViewport.tsx. Targets: CadWorkspace ≤ ~700; no NEW module > ~900. If CadWorkspace exceeds target, the overflow is by definition JSX/wiring still eligible for Task 13-style extraction — do one more focused chrome extraction, not logic edits.
- [ ] **Step 2:** `cd frontend && npm run lint && npm run typecheck && npm run test` — all green.
- [ ] **Step 3:** Manual smoke: load drawing (cache seed), draw line/point/circle, window+crossing select, ERASE, undo/redo ×3, Build TIN, contours, volume, profile, DXF import/export, plot preview, AI chat panel toggle. Compare against pre-refactor behavior.
- [ ] **Step 4:** Commit any residual fixes — `chore(cad): refactor audit fixes`

## Self-Review Notes

- Spec coverage: Steps 1–7 of the spec map to Tasks 1–3 (characterization + model splits), 4–8 (analysis + registry prep), 9 (registry), 10 (tool flows), 11–12 (viewport), 13 (chrome), 14 (audit).
- Deviation from spec letter, faithful to intent: CLI dispatch stays in `useCadCommands.ts` (Task 9 Scope decision) because rewriting the command parser risks behavior drift for zero extraction value; ribbon+menu unify in the registry as specified.
- Type consistency: `WorkflowApi`/`WorkflowServices` defined once in Task 4 and consumed by Tasks 5–8; `RegistryHost` extends `CommandContext` from the existing `useCadCommands.ts`; `PickFlowCtx` reuses CadWorkspace's existing form-state types rather than inventing new ones.
