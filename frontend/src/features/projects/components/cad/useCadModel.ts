import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAsyncAction } from "../../../../hooks/useAsyncAction.ts";
import {
  cadStorageKey,
  emptyModel,
  EMPTY_SELECTION,
  LAYER_PRESETS,
  type CadEntityType,
  type CadLayer,
  type CadModelState,
  type CadSelection,
  type LayerId,
  type SelectedItem,
  type SurveyArc,
  type SurveyCircle,
  type SurveyEllipse,
  type SurveyDimension,
  type SurveyHatch,
  type SurveyLinework,
  type SurveyPoint,
  type SurveySurface,
  type SurveyText,
} from "./cadModel.ts";
import { getCadDrawing, saveCadDrawing } from "../../../../lib/repositories/cadDrawings.ts";
import type { Json } from "../../../../lib/supabase/types.ts";

function isCadOnline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine;
}

function normalizeModel(parsed: Partial<CadModelState> | null | undefined): CadModelState {
  const base = emptyModel();
  if (!parsed || typeof parsed !== "object") return base;
  return {
    layers: Array.isArray(parsed.layers) && parsed.layers.length ? parsed.layers : base.layers,
    points: Array.isArray(parsed.points) ? parsed.points : [],
    linework: Array.isArray(parsed.linework) ? parsed.linework : [],
    texts: Array.isArray(parsed.texts) ? parsed.texts : [],
    surfaces: Array.isArray(parsed.surfaces) ? parsed.surfaces : [],
    arcs: Array.isArray(parsed.arcs) ? parsed.arcs : [],
    circles: Array.isArray(parsed.circles) ? parsed.circles : [],
    ellipses: Array.isArray(parsed.ellipses) ? parsed.ellipses : [],
    dimensions: Array.isArray(parsed.dimensions) ? parsed.dimensions : [],
    hatches: Array.isArray(parsed.hatches) ? parsed.hatches : [],
    activeLayerId: parsed.activeLayerId ?? base.activeLayerId,
  };
}

/** Synchronous load from the offline cache (localStorage). */
function loadCachedModel(projectId: string): CadModelState {
  try {
    const raw = localStorage.getItem(cadStorageKey(projectId));
    if (!raw) return emptyModel();
    return normalizeModel(JSON.parse(raw) as Partial<CadModelState>);
  } catch {
    return emptyModel();
  }
}

function cacheModel(projectId: string, model: CadModelState): void {
  try {
    localStorage.setItem(cadStorageKey(projectId), JSON.stringify(model));
  } catch {
    /* storage full or unavailable — non-fatal for a drafting session */
  }
}

export type CadSyncStatus = "idle" | "loading" | "saving" | "saved" | "error";

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export interface UseCadModel {
  model: CadModelState;
  selection: CadSelection;
  setSelection: (sel: CadSelection) => void;
  setActiveLayer: (id: LayerId) => void;
  addPoint: (p: Omit<SurveyPoint, "id" | "layerId"> & { layerId?: LayerId }) => SurveyPoint;
  updatePoint: (id: string, patch: Partial<SurveyPoint>) => void;
  deletePoint: (id: string) => void;
  addLinework: (l: Omit<SurveyLinework, "id" | "layerId"> & { layerId?: LayerId }) => SurveyLinework;
  updateLinework: (id: string, patch: Partial<SurveyLinework>) => void;
  deleteLinework: (id: string) => void;
  addText: (t: Omit<SurveyText, "id" | "layerId"> & { layerId?: LayerId }) => SurveyText;
  updateText: (id: string, patch: Partial<SurveyText>) => void;
  deleteText: (id: string) => void;
  addSurface: (s: Omit<SurveySurface, "id" | "layerId" | "visible"> & { layerId?: LayerId; visible?: boolean }) => SurveySurface;
  updateSurface: (id: string, patch: Partial<SurveySurface>) => void;
  deleteSurface: (id: string) => void;
  toggleSurfaceVisible: (id: string) => void;
  addArc: (a: Omit<SurveyArc, "id" | "layerId"> & { layerId?: LayerId }) => SurveyArc;
  updateArc: (id: string, patch: Partial<SurveyArc>) => void;
  deleteArc: (id: string) => void;
  addCircle: (c: Omit<SurveyCircle, "id" | "layerId"> & { layerId?: LayerId }) => SurveyCircle;
  updateCircle: (id: string, patch: Partial<SurveyCircle>) => void;
  deleteCircle: (id: string) => void;
  addEllipse: (el: Omit<SurveyEllipse, "id" | "layerId"> & { layerId?: LayerId }) => SurveyEllipse;
  updateEllipse: (id: string, patch: Partial<SurveyEllipse>) => void;
  deleteEllipse: (id: string) => void;
  addDimension: (d: Omit<SurveyDimension, "id" | "layerId"> & { layerId?: LayerId }) => SurveyDimension;
  updateDimension: (id: string, patch: Partial<SurveyDimension>) => void;
  deleteDimension: (id: string) => void;
  addHatch: (h: Omit<SurveyHatch, "id" | "layerId"> & { layerId?: LayerId }) => SurveyHatch;
  updateHatch: (id: string, patch: Partial<SurveyHatch>) => void;
  deleteHatch: (id: string) => void;
  toggleLayerVisible: (id: LayerId) => void;
  toggleLayerLocked: (id: LayerId) => void;
  /**
   * Create a new layer with a unique id derived from `name`. The new layer
   * becomes the active layer. Returns the created layer (or the existing one if
   * a layer with the same id already exists).
   */
  addLayer: (name: string, color?: string) => CadLayer;
  /**
   * Ensure a layer with the given id exists, creating it from the preset if it
   * does not. Returns the existing or newly-created layer.
   */
  ensureLayerById: (id: LayerId) => CadLayer;
  /** Rename and/or recolour a layer. */
  updateLayer: (id: LayerId, patch: Partial<Pick<CadLayer, "name" | "color">>) => boolean;
  /**
   * Delete a layer. Entities on it are reassigned to `reassignTo` (defaults to
   * the first remaining layer). The last remaining layer cannot be deleted.
   * Returns true when the layer was removed.
   */
  deleteLayer: (id: LayerId, reassignTo?: LayerId) => boolean;
  /** Count entities (points + linework + texts + surfaces) on a layer. */
  layerEntityCount: (id: LayerId) => number;
  importPoints: (rows: Omit<SurveyPoint, "id" | "layerId">[], layerId?: LayerId) => number;
  /** Apply a colour (null = ByLayer) to every entity in the current selection. */
  setColorOfSelection: (color: string | null) => number;
  /**
   * Move or copy the current selection by a (dn, de) survey-coordinate delta.
   * When `asCopy` is true the originals are kept and duplicates are created and
   * selected (AutoCAD COPY); otherwise the originals are translated in place
   * (AutoCAD MOVE). Returns the number of objects affected.
   */
  transformSelection: (dn: number, de: number, asCopy: boolean) => number;
  /**
   * Apply an arbitrary 2D transform to every point in the selection. When
   * `asCopy` is true the originals are kept and transformed copies are created
   * and selected. Returns the number of objects affected.
   */
  mapSelection: (fn: (p: { n: number; e: number }) => { n: number; e: number }, asCopy: boolean) => number;
  /** Create a parallel offset copy of a polyline/boundary. Positive distance is to the left. */
  offsetLinework: (id: string, distance: number) => SurveyLinework | null;
  clearAll: () => void;
  /** Undo the last drawing change. Returns true if anything was undone. */
  undo: () => boolean;
  /** Redo the last undone change. Returns true if anything was redone. */
  redo: () => boolean;
  /** Whether an undo / redo is currently available (for toolbar enabling). */
  canUndo: boolean;
  canRedo: boolean;
  nextPointNo: () => string;
  layerById: (id: LayerId) => CadLayer | undefined;
  /** Backend synchronisation state for the drawing. */
  syncStatus: CadSyncStatus;
  /** Last sync error message, if any. */
  syncError: string | null;
}

const SAVE_DEBOUNCE_MS = 1200;
const CACHE_DEBOUNCE_MS = 600;

export function useCadModel(projectId: string, workspaceId?: string): UseCadModel {
  // Seed from the offline cache so the canvas paints instantly; the backend
  // copy (authoritative, team-shared) is loaded right after and replaces it.
  const [model, setModel] = useState<CadModelState>(() => loadCachedModel(projectId));
  const [selection, setSelection] = useState<CadSelection>(EMPTY_SELECTION);
  const [syncStatus, setSyncStatus] = useState<CadSyncStatus>("idle");
  const [syncError, setSyncError] = useState<string | null>(null);

  // ── Undo / redo history ───────────────────────────────────────────────────
  // `past`/`future` hold model snapshots. A content mutation pushes the current
  // model onto `past` and clears `future`; undo/redo move snapshots between the
  // two stacks. Capped to avoid unbounded memory on long drafting sessions.
  const HISTORY_LIMIT = 100;
  const pastRef = useRef<CadModelState[]>([]);
  const futureRef = useRef<CadModelState[]>([]);
  // Always-current mirror of `model` so undo/redo/commit can read and rewrite
  // history synchronously without depending on a stale closure.
  const modelRef = useRef<CadModelState>(model);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);
  // `canUndo`/`canRedo` are mirrored into state so the UI re-renders and the
  // values are read from state (never refs) during render.
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const syncHistoryFlags = useCallback(() => {
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }, []);

  const resetHistory = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  /**
   * Apply a content mutation while recording history. `updater` receives the
   * current model and returns the next one. The pre-mutation model is pushed
   * onto the undo stack and the redo stack is cleared (standard editor model).
   */
  const commit = useCallback((updater: (m: CadModelState) => CadModelState) => {
    const prev = modelRef.current;
    const next = updater(prev);
    if (next === prev) return; // no-op guard
    pastRef.current.push(prev);
    if (pastRef.current.length > HISTORY_LIMIT) pastRef.current.shift();
    futureRef.current = [];
    modelRef.current = next;
    setModel(next);
    syncHistoryFlags();
  }, [syncHistoryFlags]);

  // Track the project the current state belongs to. Adjusting state during
  // render (the React-recommended alternative to setState-in-effect) when the
  // project changes, so switching projects reloads the cached model.
  const [loadedProject, setLoadedProject] = useState(projectId);
  if (loadedProject !== projectId) {
    setLoadedProject(projectId);
    setModel(loadCachedModel(projectId));
    setSelection(EMPTY_SELECTION);
    // History is cleared via resetHistory() once the backend copy loads; here
    // we only flag the buttons as disabled for the new project.
    setCanUndo(false);
    setCanRedo(false);
  }

  // Guards so we never persist before the backend copy has loaded (which would
  // clobber team work with a fresh empty model), and to debounce writes.
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Push the current model to the backend. Non-fatal when offline.
  const saveToBackend = useCallback(
    async (modelToSave: CadModelState) => {
      if (!workspaceId) return;
      setSyncStatus("saving");
      try {
        await saveCadDrawing(projectId, workspaceId, modelToSave as unknown as Json);
        setSyncStatus("saved");
        setSyncError(null);
      } catch (err) {
        const online = isCadOnline();
        if (!online) {
          // Queue silently while offline; sync will resume when the browser comes online.
          setSyncStatus("idle");
          setSyncError(null);
        } else {
          setSyncStatus("error");
          setSyncError(err instanceof Error ? err.message : "Failed to save CAD work.");
        }
      }
    },
    [projectId, workspaceId],
  );

  // Load the authoritative model from the backend whenever the project changes.
  // If the browser reports it is offline, stay hydrated from the local cache
  // so drafting never stalls waiting for a network request.
  const loadFromBackend = useCallback(async () => {
    hydratedRef.current = false;
    // Start each project with a clean undo history.
    resetHistory();
    setSyncStatus("loading");
    setSyncError(null);

    if (!isCadOnline()) {
      hydratedRef.current = true;
      setSyncStatus("idle");
      return;
    }

    try {
      const record = await getCadDrawing(projectId);
      if (record?.model) {
        const remote = normalizeModel(record.model as Partial<CadModelState>);
        setModel(remote);
        cacheModel(projectId, remote);
        // The freshly loaded server copy is the new baseline; discard any
        // history accumulated against the local cache.
        resetHistory();
      }
      hydratedRef.current = true;
      setSyncStatus("idle");
    } catch (err) {
      hydratedRef.current = true;
      if (!isCadOnline()) {
        // Network is down — the local cache is already loaded and usable.
        setSyncStatus("idle");
        setSyncError(null);
      } else {
        setSyncStatus("error");
        setSyncError(err instanceof Error ? err.message : "Failed to load saved CAD work.");
      }
    }
  }, [projectId, resetHistory]);

  useAsyncAction(loadFromBackend, [loadFromBackend]);

  // Persist on change: debounce both the local cache write and the backend upsert
  // so rapid edits (imports, drag ops, contour generation) do not block the main
  // thread with repeated JSON.stringify or network calls.
  useEffect(() => {
    if (cacheTimerRef.current) clearTimeout(cacheTimerRef.current);
    cacheTimerRef.current = setTimeout(() => {
      cacheModel(projectId, model);
    }, CACHE_DEBOUNCE_MS);

    if (!hydratedRef.current || !workspaceId) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    if (!isCadOnline()) {
      // Offline: do not schedule a network write; the offline listener keeps
      // the sync indicator calm, and online edits resume in the listener below.
      return;
    }

    saveTimerRef.current = setTimeout(() => {
      void saveToBackend(model);
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (cacheTimerRef.current) clearTimeout(cacheTimerRef.current);
    };
  }, [projectId, workspaceId, model, saveToBackend]);

  // When connectivity changes, keep the sync status honest and push/pause
  // accordingly. Using event listeners avoids synchronous setState in effects.
  useEffect(() => {
    const handleOnline = () => {
      if (!hydratedRef.current || !workspaceId) return;
      void saveToBackend(modelRef.current);
    };
    const handleOffline = () => {
      setSyncStatus("idle");
      setSyncError(null);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [workspaceId, saveToBackend]);

  const layerById = useCallback(
    (id: LayerId) => model.layers.find((l) => l.id === id),
    [model.layers],
  );

  /** True when the entity's layer is locked (edits/deletes are blocked). */
  const isEntityLocked = useCallback((layerId: LayerId | undefined): boolean => {
    if (!layerId) return false;
    return modelRef.current.layers.find((l) => l.id === layerId)?.locked === true;
  }, []);

  const setActiveLayer = useCallback((id: LayerId) => {
    setModel((m) => ({ ...m, activeLayerId: id }));
  }, []);

  const nextPointNo = useCallback(() => {
    const nums = model.points
      .map((p) => parseInt(p.pointNo, 10))
      .filter((n) => Number.isFinite(n));
    const max = nums.length ? Math.max(...nums) : 1000;
    return String(max + 1);
  }, [model.points]);

  const addPoint = useCallback<UseCadModel["addPoint"]>((p) => {
    const point: SurveyPoint = {
      id: nextId("pt"),
      pointNo: p.pointNo,
      n: p.n,
      e: p.e,
      z: p.z ?? null,
      code: p.code ?? "",
      layerId: p.layerId ?? modelRef.current.activeLayerId,
      color: p.color ?? null,
    };
    commit((m) => ({ ...m, points: [...m.points, point] }));
    return point;
  }, [commit]);

  const updatePoint = useCallback((id: string, patch: Partial<SurveyPoint>) => {
    commit((m) => {
      const p = m.points.find((x) => x.id === id);
      if (!p || isEntityLocked(p.layerId)) return m;
      return { ...m, points: m.points.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
    });
  }, [commit, isEntityLocked]);

  const dropFromSelection = useCallback((id: string) => {
    setSelection((s) => {
      const items = (s.items ?? []).filter((it) => it.id !== id);
      if (items.length === 0) return EMPTY_SELECTION;
      const primary = items[items.length - 1];
      return { type: primary.type, id: primary.id, items };
    });
  }, []);

  const deletePoint = useCallback((id: string) => {
    commit((m) => {
      const p = m.points.find((x) => x.id === id);
      if (!p || isEntityLocked(p.layerId)) return m;
      return { ...m, points: m.points.filter((x) => x.id !== id) };
    });
    dropFromSelection(id);
  }, [dropFromSelection, commit, isEntityLocked]);

  const addLinework = useCallback<UseCadModel["addLinework"]>((l) => {
    const work: SurveyLinework = {
      id: nextId("lw"),
      kind: l.kind,
      vertices: l.vertices,
      closed: l.closed,
      layerId: l.layerId ?? modelRef.current.activeLayerId,
      color: l.color ?? null,
      label: l.label,
    };
    commit((m) => ({ ...m, linework: [...m.linework, work] }));
    return work;
  }, [commit]);

  const updateLinework = useCallback((id: string, patch: Partial<SurveyLinework>) => {
    commit((m) => {
      const lw = m.linework.find((x) => x.id === id);
      if (!lw || isEntityLocked(lw.layerId)) return m;
      return { ...m, linework: m.linework.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
    });
  }, [commit, isEntityLocked]);

  const deleteLinework = useCallback((id: string) => {
    commit((m) => {
      const lw = m.linework.find((x) => x.id === id);
      if (!lw || isEntityLocked(lw.layerId)) return m;
      return { ...m, linework: m.linework.filter((x) => x.id !== id) };
    });
    dropFromSelection(id);
  }, [dropFromSelection, commit, isEntityLocked]);

  const addText = useCallback<UseCadModel["addText"]>((t) => {
    const txt: SurveyText = {
      id: nextId("tx"),
      n: t.n,
      e: t.e,
      text: t.text,
      layerId: t.layerId ?? modelRef.current.activeLayerId,
      color: t.color ?? null,
      height: t.height,
      rotation: t.rotation,
    };
    commit((m) => ({ ...m, texts: [...m.texts, txt] }));
    return txt;
  }, [commit]);

  const updateText = useCallback((id: string, patch: Partial<SurveyText>) => {
    commit((m) => {
      const t = m.texts.find((x) => x.id === id);
      if (!t || isEntityLocked(t.layerId)) return m;
      return { ...m, texts: m.texts.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
    });
  }, [commit, isEntityLocked]);

  const deleteText = useCallback((id: string) => {
    commit((m) => {
      const t = m.texts.find((x) => x.id === id);
      if (!t || isEntityLocked(t.layerId)) return m;
      return { ...m, texts: m.texts.filter((x) => x.id !== id) };
    });
    dropFromSelection(id);
  }, [dropFromSelection, commit, isEntityLocked]);

  const addSurface = useCallback<UseCadModel["addSurface"]>((s) => {
    const surface: SurveySurface = {
      id: nextId("srf"),
      name: s.name,
      points: s.points,
      triangles: s.triangles,
      layerId: s.layerId ?? modelRef.current.activeLayerId,
      visible: s.visible ?? true,
      cutFill: s.cutFill,
      slopeShade: s.slopeShade,
    };
    commit((m) => ({ ...m, surfaces: [...m.surfaces, surface] }));
    return surface;
  }, [commit]);

  const updateSurface = useCallback<UseCadModel["updateSurface"]>((id, patch) => {
    commit((m) => {
      const s = m.surfaces.find((x) => x.id === id);
      if (!s) return m;
      return { ...m, surfaces: m.surfaces.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
    });
  }, [commit]);

  const deleteSurface = useCallback((id: string) => {
    commit((m) => ({ ...m, surfaces: m.surfaces.filter((s) => s.id !== id) }));
    dropFromSelection(id);
  }, [dropFromSelection, commit]);

  const addArc = useCallback<UseCadModel["addArc"]>((a) => {
    const arc: SurveyArc = {
      id: nextId("arc"),
      center: a.center,
      radius: a.radius,
      startAngle: a.startAngle,
      endAngle: a.endAngle,
      layerId: a.layerId ?? modelRef.current.activeLayerId,
      color: a.color ?? null,
    };
    commit((m) => ({ ...m, arcs: [...m.arcs, arc] }));
    return arc;
  }, [commit]);

  const updateArc = useCallback((id: string, patch: Partial<SurveyArc>) => {
    commit((m) => {
      const a = m.arcs.find((x) => x.id === id);
      if (!a || isEntityLocked(a.layerId)) return m;
      return { ...m, arcs: m.arcs.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
    });
  }, [commit, isEntityLocked]);

  const deleteArc = useCallback((id: string) => {
    commit((m) => {
      const a = m.arcs.find((x) => x.id === id);
      if (!a || isEntityLocked(a.layerId)) return m;
      return { ...m, arcs: m.arcs.filter((x) => x.id !== id) };
    });
    dropFromSelection(id);
  }, [dropFromSelection, commit, isEntityLocked]);

  const addCircle = useCallback<UseCadModel["addCircle"]>((c) => {
    const circle: SurveyCircle = {
      id: nextId("cir"),
      center: c.center,
      radius: c.radius,
      layerId: c.layerId ?? modelRef.current.activeLayerId,
      color: c.color ?? null,
    };
    commit((m) => ({ ...m, circles: [...m.circles, circle] }));
    return circle;
  }, [commit]);

  const updateCircle = useCallback((id: string, patch: Partial<SurveyCircle>) => {
    commit((m) => {
      const c = m.circles.find((x) => x.id === id);
      if (!c || isEntityLocked(c.layerId)) return m;
      return { ...m, circles: m.circles.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
    });
  }, [commit, isEntityLocked]);

  const deleteCircle = useCallback((id: string) => {
    commit((m) => {
      const c = m.circles.find((x) => x.id === id);
      if (!c || isEntityLocked(c.layerId)) return m;
      return { ...m, circles: m.circles.filter((x) => x.id !== id) };
    });
    dropFromSelection(id);
  }, [dropFromSelection, commit, isEntityLocked]);

  const addEllipse = useCallback<UseCadModel["addEllipse"]>((el) => {
    const ellipse: SurveyEllipse = {
      id: nextId("ell"),
      center: el.center,
      semiMajor: el.semiMajor,
      semiMinor: el.semiMinor,
      rotation: el.rotation,
      layerId: el.layerId ?? modelRef.current.activeLayerId,
      color: el.color ?? null,
    };
    commit((m) => ({ ...m, ellipses: [...m.ellipses, ellipse] }));
    return ellipse;
  }, [commit]);

  const updateEllipse = useCallback((id: string, patch: Partial<SurveyEllipse>) => {
    commit((m) => {
      const el = m.ellipses.find((x) => x.id === id);
      if (!el || isEntityLocked(el.layerId)) return m;
      return { ...m, ellipses: m.ellipses.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
    });
  }, [commit, isEntityLocked]);

  const deleteEllipse = useCallback((id: string) => {
    commit((m) => {
      const el = m.ellipses.find((x) => x.id === id);
      if (!el || isEntityLocked(el.layerId)) return m;
      return { ...m, ellipses: m.ellipses.filter((x) => x.id !== id) };
    });
    dropFromSelection(id);
  }, [dropFromSelection, commit, isEntityLocked]);

  const addDimension = useCallback<UseCadModel["addDimension"]>((d) => {
    const dim: SurveyDimension = {
      id: nextId("dim"),
      kind: d.kind,
      text: d.text,
      textPosition: d.textPosition,
      defPoints: d.defPoints,
      angle: d.angle,
      layerId: d.layerId ?? modelRef.current.activeLayerId,
      color: d.color ?? null,
    };
    commit((m) => ({ ...m, dimensions: [...m.dimensions, dim] }));
    return dim;
  }, [commit]);

  const updateDimension = useCallback((id: string, patch: Partial<SurveyDimension>) => {
    commit((m) => {
      const d = m.dimensions.find((x) => x.id === id);
      if (!d || isEntityLocked(d.layerId)) return m;
      return { ...m, dimensions: m.dimensions.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
    });
  }, [commit, isEntityLocked]);

  const deleteDimension = useCallback((id: string) => {
    commit((m) => {
      const d = m.dimensions.find((x) => x.id === id);
      if (!d || isEntityLocked(d.layerId)) return m;
      return { ...m, dimensions: m.dimensions.filter((x) => x.id !== id) };
    });
    dropFromSelection(id);
  }, [dropFromSelection, commit, isEntityLocked]);

  const addHatch = useCallback<UseCadModel["addHatch"]>((h) => {
    const hatch: SurveyHatch = {
      id: nextId("hatch"),
      vertices: h.vertices,
      holes: h.holes,
      pattern: h.pattern,
      patternScale: h.patternScale,
      patternAngle: h.patternAngle,
      layerId: h.layerId ?? modelRef.current.activeLayerId,
      color: h.color ?? null,
    };
    commit((m) => ({ ...m, hatches: [...m.hatches, hatch] }));
    return hatch;
  }, [commit]);

  const updateHatch = useCallback((id: string, patch: Partial<SurveyHatch>) => {
    commit((m) => {
      const h = m.hatches.find((x) => x.id === id);
      if (!h || isEntityLocked(h.layerId)) return m;
      return { ...m, hatches: m.hatches.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
    });
  }, [commit, isEntityLocked]);

  const deleteHatch = useCallback((id: string) => {
    commit((m) => {
      const h = m.hatches.find((x) => x.id === id);
      if (!h || isEntityLocked(h.layerId)) return m;
      return { ...m, hatches: m.hatches.filter((x) => x.id !== id) };
    });
    dropFromSelection(id);
  }, [dropFromSelection, commit, isEntityLocked]);

  // Surface visibility is a view toggle, not a content edit, so it stays out
  // of the undo history.
  const toggleSurfaceVisible = useCallback((id: string) => {
    setModel((m) => ({
      ...m,
      surfaces: m.surfaces.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s)),
    }));
  }, []);

  const toggleLayerVisible = useCallback((id: LayerId) => {
    setModel((m) => ({
      ...m,
      layers: m.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    }));
  }, []);

  const toggleLayerLocked = useCallback((id: LayerId) => {
    setModel((m) => ({
      ...m,
      layers: m.layers.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l)),
    }));
  }, []);

  /** Build a unique, AutoCAD-style layer id from a display name. */
  const uniqueLayerId = useCallback((name: string, existing: CadLayer[]): LayerId => {
    const base = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "LAYER";
    let id = base;
    let i = 1;
    while (existing.some((l) => l.id === id)) {
      id = `${base}_${i}`;
      i += 1;
    }
    return id;
  }, []);

  // A short, readable default-colour cycle for new layers.
  const LAYER_PALETTE = [
    "#38bdf8", "#f97316", "#a78bfa", "#f43f5e", "#22c55e",
    "#eab308", "#e2e8f0", "#14b8a6", "#ec4899", "#f59e0b",
  ];

  /** Make a display name unique among existing layers (AutoCAD names must be unique). */
  const uniqueLayerName = useCallback((name: string, existing: CadLayer[], selfId?: LayerId): string => {
    const base = name.trim() || "Layer";
    if (!existing.some((l) => l.name === base && l.id !== selfId)) return base;
    let i = 2;
    while (existing.some((l) => l.name === `${base} ${i}` && l.id !== selfId)) i += 1;
    return `${base} ${i}`;
  }, []);

  // Creating/renaming/deleting layers is a content edit (it can reassign
  // entities), so it goes through `commit` and participates in undo/redo.
  const addLayer = useCallback<UseCadModel["addLayer"]>((name, color) => {
    const current = modelRef.current;
    const trimmed = (name ?? "").trim();
    const baseName = trimmed || "Layer";
    const layerName = uniqueLayerName(baseName, current.layers);
    const id = uniqueLayerId(layerName, current.layers);
    const layer: CadLayer = {
      id,
      name: layerName,
      color: color ?? LAYER_PALETTE[current.layers.length % LAYER_PALETTE.length],
      visible: true,
      locked: false,
    };
    commit((m) => ({ ...m, layers: [...m.layers, layer], activeLayerId: id }));
    return layer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit, uniqueLayerId, uniqueLayerName]);

  const ensureLayerById = useCallback<UseCadModel["ensureLayerById"]>((id) => {
    const current = modelRef.current;
    const existing = current.layers.find((l) => l.id === id);
    if (existing) return existing;
    const preset = LAYER_PRESETS[id];
    const layerName = preset ? uniqueLayerName(preset.name, current.layers) : uniqueLayerName(id, current.layers);
    const layer: CadLayer = {
      id,
      name: layerName,
      color: preset?.color ?? LAYER_PALETTE[current.layers.length % LAYER_PALETTE.length],
      visible: true,
      locked: false,
    };
    commit((m) => ({ ...m, layers: [...m.layers, layer] }));
    return layer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit, uniqueLayerName]);

  const updateLayer = useCallback<UseCadModel["updateLayer"]>((id, patch) => {
    let ok = false;
    commit((m) => {
      const target = m.layers.find((l) => l.id === id);
      if (!target) return m;
      const clean: Partial<Pick<CadLayer, "name" | "color">> = {};
      if (typeof patch.name === "string" && patch.name.trim()) {
        clean.name = uniqueLayerName(patch.name.trim(), m.layers, id);
      }
      if (typeof patch.color === "string" && patch.color) clean.color = patch.color;
      if (Object.keys(clean).length === 0) return m;
      ok = true;
      return {
        ...m,
        layers: m.layers.map((l) => (l.id === id ? { ...l, ...clean } : l)),
      };
    });
    return ok;
  }, [commit, uniqueLayerName]);

  const deleteLayer = useCallback<UseCadModel["deleteLayer"]>((id, reassignTo) => {
    const current = modelRef.current;
    if (current.layers.length <= 1) return false; // keep at least one layer
    if (!current.layers.some((l) => l.id === id)) return false;
    const target = reassignTo && current.layers.some((l) => l.id === reassignTo && l.id !== id)
      ? reassignTo
      : current.layers.find((l) => l.id !== id)!.id;

    commit((m) => ({
      ...m,
      layers: m.layers.filter((l) => l.id !== id),
      points: m.points.map((p) => (p.layerId === id ? { ...p, layerId: target } : p)),
      linework: m.linework.map((l) => (l.layerId === id ? { ...l, layerId: target } : l)),
      texts: m.texts.map((t) => (t.layerId === id ? { ...t, layerId: target } : t)),
      surfaces: m.surfaces.map((s) => (s.layerId === id ? { ...s, layerId: target } : s)),
      arcs: m.arcs.map((a) => (a.layerId === id ? { ...a, layerId: target } : a)),
      circles: m.circles.map((c) => (c.layerId === id ? { ...c, layerId: target } : c)),
      ellipses: m.ellipses.map((el) => (el.layerId === id ? { ...el, layerId: target } : el)),
      dimensions: m.dimensions.map((d) => (d.layerId === id ? { ...d, layerId: target } : d)),
      hatches: m.hatches.map((h) => (h.layerId === id ? { ...h, layerId: target } : h)),
      activeLayerId: m.activeLayerId === id ? target : m.activeLayerId,
    }));
    return true;
  }, [commit]);

  const layerEntityCount = useCallback<UseCadModel["layerEntityCount"]>((id) => {
    return (
      model.points.filter((p) => p.layerId === id).length +
      model.linework.filter((l) => l.layerId === id).length +
      model.texts.filter((t) => t.layerId === id).length +
      model.surfaces.filter((s) => s.layerId === id).length +
      model.arcs.filter((a) => a.layerId === id).length +
      model.circles.filter((c) => c.layerId === id).length +
      model.ellipses.filter((el) => el.layerId === id).length +
      model.dimensions.filter((d) => d.layerId === id).length +
      model.hatches.filter((h) => h.layerId === id).length
    );
  }, [model.points, model.linework, model.texts, model.surfaces, model.arcs, model.circles, model.ellipses, model.dimensions, model.hatches]);

  const importPoints = useCallback<UseCadModel["importPoints"]>((rows, layerId) => {
    const active = modelRef.current.activeLayerId;
    const created: SurveyPoint[] = rows.map((r) => ({
      id: nextId("pt"),
      pointNo: r.pointNo,
      n: r.n,
      e: r.e,
      z: r.z ?? null,
      code: r.code ?? "",
      layerId: layerId ?? active,
      color: null,
    }));
    commit((m) => ({ ...m, points: [...m.points, ...created] }));
    return created.length;
  }, [commit]);

  const setColorOfSelection = useCallback<UseCadModel["setColorOfSelection"]>((color) => {
    const sel = selection;
    const items = sel.items && sel.items.length
      ? sel.items
      : sel.type && sel.id
        ? [{ type: sel.type, id: sel.id }]
        : [];
    if (items.length === 0) return 0;
    const groupIds = (type: CadEntityType) => new Set(items.filter((i) => i.type === type).map((i) => i.id));
    const ptIds = groupIds("point");
    const lwIds = groupIds("linework");
    const txIds = groupIds("text");
    const arcIds = groupIds("arc");
    const cirIds = groupIds("circle");
    const ellIds = groupIds("ellipse");
    const dimIds = groupIds("dimension");
    const hatchIds = groupIds("hatch");
    commit((m) => ({
      ...m,
      points: m.points.map((p) => (ptIds.has(p.id) ? { ...p, color } : p)),
      linework: m.linework.map((l) => (lwIds.has(l.id) ? { ...l, color } : l)),
      texts: m.texts.map((t) => (txIds.has(t.id) ? { ...t, color } : t)),
      arcs: m.arcs.map((a) => (arcIds.has(a.id) ? { ...a, color } : a)),
      circles: m.circles.map((c) => (cirIds.has(c.id) ? { ...c, color } : c)),
      ellipses: m.ellipses.map((el) => (ellIds.has(el.id) ? { ...el, color } : el)),
      dimensions: m.dimensions.map((d) => (dimIds.has(d.id) ? { ...d, color } : d)),
      hatches: m.hatches.map((h) => (hatchIds.has(h.id) ? { ...h, color } : h)),
    }));
    return items.length;
  }, [selection, commit]);

  const transformSelection = useCallback<UseCadModel["transformSelection"]>((dn, de, asCopy) => {
    const sel = selection;
    const items = sel.items && sel.items.length
      ? sel.items
      : sel.type && sel.id
        ? [{ type: sel.type, id: sel.id }]
        : [];
    if (items.length === 0) return 0;
    if (dn === 0 && de === 0 && !asCopy) return 0;

    const ptIds = new Set(items.filter((i) => i.type === "point").map((i) => i.id));
    const lwIds = new Set(items.filter((i) => i.type === "linework").map((i) => i.id));
    const txIds = new Set(items.filter((i) => i.type === "text").map((i) => i.id));
    const arcIds = new Set(items.filter((i) => i.type === "arc").map((i) => i.id));
    const cirIds = new Set(items.filter((i) => i.type === "circle").map((i) => i.id));
    const ellIds = new Set(items.filter((i) => i.type === "ellipse").map((i) => i.id));
    const dimIds = new Set(items.filter((i) => i.type === "dimension").map((i) => i.id));
    const hatchIds = new Set(items.filter((i) => i.type === "hatch").map((i) => i.id));

    const offsetVert = (v: { n: number; e: number }) => ({ n: v.n + dn, e: v.e + de });
    const offsetPos = (p: { n: number; e: number }) => ({ n: p.n + dn, e: p.e + de });

    if (!asCopy) {
      // MOVE — translate the originals in place.
      commit((m) => ({
        ...m,
        points: m.points.map((p) => (ptIds.has(p.id) ? { ...p, ...offsetPos(p) } : p)),
        linework: m.linework.map((l) =>
          lwIds.has(l.id) ? { ...l, vertices: l.vertices.map(offsetVert) } : l,
        ),
        texts: m.texts.map((t) => (txIds.has(t.id) ? { ...t, ...offsetPos(t) } : t)),
        arcs: m.arcs.map((a) => (arcIds.has(a.id) ? { ...a, center: offsetVert(a.center) } : a)),
        circles: m.circles.map((c) => (cirIds.has(c.id) ? { ...c, center: offsetVert(c.center) } : c)),
        ellipses: m.ellipses.map((el) => (ellIds.has(el.id) ? { ...el, center: offsetVert(el.center) } : el)),
        dimensions: m.dimensions.map((d) =>
          dimIds.has(d.id)
            ? { ...d, textPosition: offsetVert(d.textPosition), defPoints: d.defPoints.map(offsetVert) }
            : d,
        ),
        hatches: m.hatches.map((h) =>
          hatchIds.has(h.id)
            ? { ...h, vertices: h.vertices.map(offsetVert), holes: h.holes?.map((hole) => hole.map(offsetVert)) }
            : h,
        ),
      }));
      return items.length;
    }

    // COPY — duplicate the selected objects, offset, and select the copies.
    const newItems: SelectedItem[] = [];
    commit((m) => {
      const newPoints: SurveyPoint[] = [];
      for (const p of m.points) {
        if (!ptIds.has(p.id)) continue;
        const copy: SurveyPoint = { ...p, id: nextId("pt"), ...offsetPos(p) };
        newPoints.push(copy);
        newItems.push({ type: "point", id: copy.id });
      }
      const newLinework: SurveyLinework[] = [];
      for (const l of m.linework) {
        if (!lwIds.has(l.id)) continue;
        const copy: SurveyLinework = { ...l, id: nextId("lw"), vertices: l.vertices.map(offsetVert) };
        newLinework.push(copy);
        newItems.push({ type: "linework", id: copy.id });
      }
      const newTexts: SurveyText[] = [];
      for (const t of m.texts) {
        if (!txIds.has(t.id)) continue;
        const copy: SurveyText = { ...t, id: nextId("tx"), ...offsetPos(t) };
        newTexts.push(copy);
        newItems.push({ type: "text", id: copy.id });
      }
      const newArcs: SurveyArc[] = [];
      for (const a of m.arcs) {
        if (!arcIds.has(a.id)) continue;
        const copy: SurveyArc = { ...a, id: nextId("arc"), center: offsetVert(a.center) };
        newArcs.push(copy);
        newItems.push({ type: "arc", id: copy.id });
      }
      const newCircles: SurveyCircle[] = [];
      for (const c of m.circles) {
        if (!cirIds.has(c.id)) continue;
        const copy: SurveyCircle = { ...c, id: nextId("cir"), center: offsetVert(c.center) };
        newCircles.push(copy);
        newItems.push({ type: "circle", id: copy.id });
      }
      const newEllipses: SurveyEllipse[] = [];
      for (const el of m.ellipses) {
        if (!ellIds.has(el.id)) continue;
        const copy: SurveyEllipse = { ...el, id: nextId("ell"), center: offsetVert(el.center) };
        newEllipses.push(copy);
        newItems.push({ type: "ellipse", id: copy.id });
      }
      const newDimensions: SurveyDimension[] = [];
      for (const d of m.dimensions) {
        if (!dimIds.has(d.id)) continue;
        const copy: SurveyDimension = {
          ...d,
          id: nextId("dim"),
          textPosition: offsetVert(d.textPosition),
          defPoints: d.defPoints.map(offsetVert),
        };
        newDimensions.push(copy);
        newItems.push({ type: "dimension", id: copy.id });
      }
      const newHatches: SurveyHatch[] = [];
      for (const h of m.hatches) {
        if (!hatchIds.has(h.id)) continue;
        const copy: SurveyHatch = {
          ...h,
          id: nextId("hatch"),
          vertices: h.vertices.map(offsetVert),
          holes: h.holes?.map((hole) => hole.map(offsetVert)),
        };
        newHatches.push(copy);
        newItems.push({ type: "hatch", id: copy.id });
      }
      return {
        ...m,
        points: [...m.points, ...newPoints],
        linework: [...m.linework, ...newLinework],
        texts: [...m.texts, ...newTexts],
        arcs: [...m.arcs, ...newArcs],
        circles: [...m.circles, ...newCircles],
        ellipses: [...m.ellipses, ...newEllipses],
        dimensions: [...m.dimensions, ...newDimensions],
        hatches: [...m.hatches, ...newHatches],
      };
    });
    if (newItems.length) {
      const primary = newItems[newItems.length - 1];
      setSelection({ type: primary.type, id: primary.id, items: newItems });
    }
    return newItems.length;
  }, [selection, commit]);

  const mapSelection = useCallback<UseCadModel["mapSelection"]>((fn, asCopy) => {
    const sel = selection;
    const items = sel.items && sel.items.length
      ? sel.items
      : sel.type && sel.id
        ? [{ type: sel.type, id: sel.id }]
        : [];
    if (items.length === 0) return 0;

    const ptIds = new Set(items.filter((i) => i.type === "point").map((i) => i.id));
    const lwIds = new Set(items.filter((i) => i.type === "linework").map((i) => i.id));
    const txIds = new Set(items.filter((i) => i.type === "text").map((i) => i.id));
    const arcIds = new Set(items.filter((i) => i.type === "arc").map((i) => i.id));
    const cirIds = new Set(items.filter((i) => i.type === "circle").map((i) => i.id));
    const ellIds = new Set(items.filter((i) => i.type === "ellipse").map((i) => i.id));
    const dimIds = new Set(items.filter((i) => i.type === "dimension").map((i) => i.id));
    const hatchIds = new Set(items.filter((i) => i.type === "hatch").map((i) => i.id));

    if (!asCopy) {
      commit((m) => ({
        ...m,
        points: m.points.map((p) => (ptIds.has(p.id) ? { ...p, ...fn({ n: p.n, e: p.e }) } : p)),
        linework: m.linework.map((l) =>
          lwIds.has(l.id)
            ? { ...l, vertices: l.vertices.map((v) => fn({ n: v.n, e: v.e })) }
            : l,
        ),
        texts: m.texts.map((t) => (txIds.has(t.id) ? { ...t, ...fn({ n: t.n, e: t.e }) } : t)),
        arcs: m.arcs.map((a) => (arcIds.has(a.id) ? { ...a, center: fn(a.center) } : a)),
        circles: m.circles.map((c) => (cirIds.has(c.id) ? { ...c, center: fn(c.center) } : c)),
        ellipses: m.ellipses.map((el) => (ellIds.has(el.id) ? { ...el, center: fn(el.center) } : el)),
        dimensions: m.dimensions.map((d) =>
          dimIds.has(d.id)
            ? { ...d, textPosition: fn(d.textPosition), defPoints: d.defPoints.map(fn) }
            : d,
        ),
        hatches: m.hatches.map((h) =>
          hatchIds.has(h.id)
            ? { ...h, vertices: h.vertices.map(fn), holes: h.holes?.map((hole) => hole.map(fn)) }
            : h,
        ),
      }));
      return items.length;
    }

    const newItems: SelectedItem[] = [];
    commit((m) => {
      const newPoints: SurveyPoint[] = [];
      for (const p of m.points) {
        if (!ptIds.has(p.id)) continue;
        const pos = fn({ n: p.n, e: p.e });
        const copy: SurveyPoint = { ...p, id: nextId("pt"), n: pos.n, e: pos.e };
        newPoints.push(copy);
        newItems.push({ type: "point", id: copy.id });
      }
      const newLinework: SurveyLinework[] = [];
      for (const l of m.linework) {
        if (!lwIds.has(l.id)) continue;
        newLinework.push({
          ...l,
          id: nextId("lw"),
          vertices: l.vertices.map((v) => fn({ n: v.n, e: v.e })),
        });
        newItems.push({ type: "linework", id: newLinework[newLinework.length - 1].id });
      }
      const newTexts: SurveyText[] = [];
      for (const t of m.texts) {
        if (!txIds.has(t.id)) continue;
        const pos = fn({ n: t.n, e: t.e });
        const copy: SurveyText = { ...t, id: nextId("tx"), n: pos.n, e: pos.e };
        newTexts.push(copy);
        newItems.push({ type: "text", id: newTexts[newTexts.length - 1].id });
      }
      const newArcs: SurveyArc[] = [];
      for (const a of m.arcs) {
        if (!arcIds.has(a.id)) continue;
        const copy: SurveyArc = { ...a, id: nextId("arc"), center: fn(a.center) };
        newArcs.push(copy);
        newItems.push({ type: "arc", id: copy.id });
      }
      const newCircles: SurveyCircle[] = [];
      for (const c of m.circles) {
        if (!cirIds.has(c.id)) continue;
        const copy: SurveyCircle = { ...c, id: nextId("cir"), center: fn(c.center) };
        newCircles.push(copy);
        newItems.push({ type: "circle", id: copy.id });
      }
      const newEllipses: SurveyEllipse[] = [];
      for (const el of m.ellipses) {
        if (!ellIds.has(el.id)) continue;
        const copy: SurveyEllipse = { ...el, id: nextId("ell"), center: fn(el.center) };
        newEllipses.push(copy);
        newItems.push({ type: "ellipse", id: copy.id });
      }
      const newDimensions: SurveyDimension[] = [];
      for (const d of m.dimensions) {
        if (!dimIds.has(d.id)) continue;
        const copy: SurveyDimension = {
          ...d,
          id: nextId("dim"),
          textPosition: fn(d.textPosition),
          defPoints: d.defPoints.map(fn),
        };
        newDimensions.push(copy);
        newItems.push({ type: "dimension", id: copy.id });
      }
      const newHatches: SurveyHatch[] = [];
      for (const h of m.hatches) {
        if (!hatchIds.has(h.id)) continue;
        const copy: SurveyHatch = {
          ...h,
          id: nextId("hatch"),
          vertices: h.vertices.map(fn),
          holes: h.holes?.map((hole) => hole.map(fn)),
        };
        newHatches.push(copy);
        newItems.push({ type: "hatch", id: copy.id });
      }
      return {
        ...m,
        points: [...m.points, ...newPoints],
        linework: [...m.linework, ...newLinework],
        texts: [...m.texts, ...newTexts],
        arcs: [...m.arcs, ...newArcs],
        circles: [...m.circles, ...newCircles],
        ellipses: [...m.ellipses, ...newEllipses],
        dimensions: [...m.dimensions, ...newDimensions],
        hatches: [...m.hatches, ...newHatches],
      };
    });
    if (newItems.length) {
      const primary = newItems[newItems.length - 1];
      setSelection({ type: primary.type, id: primary.id, items: newItems });
    }
    return newItems.length;
  }, [selection, commit, setSelection]);

  const offsetLinework = useCallback<UseCadModel["offsetLinework"]>((id, distance) => {
    const lw = model.linework.find((l) => l.id === id);
    if (!lw || lw.vertices.length < 2) return null;
    const verts = [...lw.vertices];
    const closed = lw.closed;
    const offsetVerts: { n: number; e: number }[] = [];
    const count = verts.length;

    for (let i = 0; i < count; i++) {
      const prev = verts[(i - 1 + count) % count];
      const curr = verts[i];
      const next = verts[(i + 1) % count];
      const inE = curr.e - prev.e;
      const inN = curr.n - prev.n;
      const outE = next.e - curr.e;
      const outN = next.n - curr.n;
      const inLen = Math.hypot(inE, inN);
      const outLen = Math.hypot(outE, outN);
      if (inLen === 0 || outLen === 0) {
        offsetVerts.push(curr);
        continue;
      }
      const inUE = inE / inLen, inUN = inN / inLen;
      const outUE = outE / outLen, outUN = outN / outLen;
      const inLeftE = -inUN, inLeftN = inUE;
      const outLeftE = -outUN, outLeftN = outUE;
      const a = { e: prev.e + inLeftE * distance, n: prev.n + inLeftN * distance };
      const b1 = { e: curr.e + inLeftE * distance, n: curr.n + inLeftN * distance };
      const b2 = { e: curr.e + outLeftE * distance, n: curr.n + outLeftN * distance };
      const c = { e: next.e + outLeftE * distance, n: next.n + outLeftN * distance };
      const dx1 = b1.e - a.e, dy1 = b1.n - a.n;
      const dx2 = c.e - b2.e, dy2 = c.n - b2.n;
      const denom = dx1 * dy2 - dy1 * dx2;
      if (Math.abs(denom) < 1e-12) {
        offsetVerts.push({ e: b1.e, n: b1.n });
        continue;
      }
      const t = ((b2.e - a.e) * dy2 - (b2.n - a.n) * dx2) / denom;
      offsetVerts.push({ e: a.e + dx1 * t, n: a.n + dy1 * t });
    }

    if (!closed) {
      const start = verts[0];
      const second = verts[1];
      const se = second.e - start.e, sn = second.n - start.n;
      const sLen = Math.hypot(se, sn);
      if (sLen > 0) {
        offsetVerts[0] = {
          e: start.e - (sn / sLen) * distance,
          n: start.n + (se / sLen) * distance,
        };
      }
      const last = verts[count - 1];
      const prev = verts[count - 2];
      const le = last.e - prev.e, ln = last.n - prev.n;
      const lLen = Math.hypot(le, ln);
      if (lLen > 0) {
        offsetVerts[count - 1] = {
          e: last.e - (ln / lLen) * distance,
          n: last.n + (le / lLen) * distance,
        };
      }
    }

    const copy: SurveyLinework = { ...lw, id: nextId("lw"), vertices: offsetVerts };
    commit((m) => ({
      ...m,
      linework: [...m.linework, copy],
      selection: { type: "linework", id: copy.id, items: [] },
    }));
    return copy;
  }, [model.linework, commit]);

  const clearAll = useCallback(() => {
    commit((m) => ({
      ...m,
      points: [],
      linework: [],
      texts: [],
      surfaces: [],
      arcs: [],
      circles: [],
      ellipses: [],
      dimensions: [],
      hatches: [],
    }));
    setSelection(EMPTY_SELECTION);
  }, [commit]);

  // ── Undo / redo ─────────────────────────────────────────────────────────
  const undo = useCallback<UseCadModel["undo"]>(() => {
    const prev = pastRef.current.pop();
    if (prev === undefined) return false;
    futureRef.current.push(modelRef.current);
    modelRef.current = prev;
    setModel(prev);
    setSelection(EMPTY_SELECTION);
    syncHistoryFlags();
    return true;
  }, [syncHistoryFlags]);

  const redo = useCallback<UseCadModel["redo"]>(() => {
    const next = futureRef.current.pop();
    if (next === undefined) return false;
    pastRef.current.push(modelRef.current);
    modelRef.current = next;
    setModel(next);
    setSelection(EMPTY_SELECTION);
    syncHistoryFlags();
    return true;
  }, [syncHistoryFlags]);

  return useMemo(
    () => ({
      model,
      selection,
      setSelection,
      setActiveLayer,
      addPoint,
      updatePoint,
      deletePoint,
      addLinework,
      updateLinework,
      deleteLinework,
      addText,
      updateText,
      deleteText,
      addSurface,
      updateSurface,
      deleteSurface,
      toggleSurfaceVisible,
      addArc,
      updateArc,
      deleteArc,
      addCircle,
      updateCircle,
      deleteCircle,
      addEllipse,
      updateEllipse,
      deleteEllipse,
      addDimension,
      updateDimension,
      deleteDimension,
      addHatch,
      updateHatch,
      deleteHatch,
      toggleLayerVisible,
      toggleLayerLocked,
      addLayer,
      ensureLayerById,
      updateLayer,
      deleteLayer,
      layerEntityCount,
      importPoints,
      setColorOfSelection,
      transformSelection,
      mapSelection,
      offsetLinework,
      clearAll,
      undo,
      redo,
      canUndo,
      canRedo,
      nextPointNo,
      layerById,
      syncStatus,
      syncError,
    }),
    [
      model,
      selection,
      syncStatus,
      syncError,
      canUndo,
      canRedo,
      setActiveLayer,
      addPoint,
      updatePoint,
      deletePoint,
      addLinework,
      updateLinework,
      deleteLinework,
      addText,
      updateText,
      deleteText,
      addSurface,
      updateSurface,
      deleteSurface,
      toggleSurfaceVisible,
      addArc,
      updateArc,
      deleteArc,
      addCircle,
      updateCircle,
      deleteCircle,
      addEllipse,
      updateEllipse,
      deleteEllipse,
      addDimension,
      updateDimension,
      deleteDimension,
      addHatch,
      updateHatch,
      deleteHatch,
      toggleLayerVisible,
      toggleLayerLocked,
      addLayer,
      ensureLayerById,
      updateLayer,
      deleteLayer,
      layerEntityCount,
      importPoints,
      setColorOfSelection,
      transformSelection,
      mapSelection,
      offsetLinework,
      clearAll,
      undo,
      redo,
      nextPointNo,
      layerById,
    ],
  );
}
