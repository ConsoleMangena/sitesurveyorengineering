import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cadStorageKey,
  emptyModel,
  EMPTY_SELECTION,
  LAYER_PRESETS,
  type CadLayer,
  type CadModelState,
  type CadSelection,
  type LayerId,
  type SelectedItem,
  type SurveyLinework,
  type SurveyPoint,
  type SurveySurface,
  type SurveyText,
} from "./cadModel.ts";
import { getCadDrawing, saveCadDrawing } from "../../../../lib/repositories/cadDrawings.ts";
import type { Json } from "../../../../lib/supabase/types.ts";

function normalizeModel(parsed: Partial<CadModelState> | null | undefined): CadModelState {
  const base = emptyModel();
  if (!parsed || typeof parsed !== "object") return base;
  return {
    layers: Array.isArray(parsed.layers) && parsed.layers.length ? parsed.layers : base.layers,
    points: Array.isArray(parsed.points) ? parsed.points : [],
    linework: Array.isArray(parsed.linework) ? parsed.linework : [],
    texts: Array.isArray(parsed.texts) ? parsed.texts : [],
    surfaces: Array.isArray(parsed.surfaces) ? parsed.surfaces : [],
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

  // Load the authoritative model from the backend whenever the project changes.
  useEffect(() => {
    let cancelled = false;
    hydratedRef.current = false;
    // Start each project with a clean undo history.
    resetHistory();
    setSyncStatus("loading");
    setSyncError(null);

    getCadDrawing(projectId)
      .then((record) => {
        if (cancelled) return;
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
      })
      .catch((err) => {
        if (cancelled) return;
        // Fall back to the cached/local model — drafting can continue offline.
        hydratedRef.current = true;
        setSyncStatus("error");
        setSyncError(err instanceof Error ? err.message : "Failed to load saved CAD work.");
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, resetHistory]);

  // Persist on change: always cache locally; debounce the backend upsert.
  useEffect(() => {
    cacheModel(projectId, model);

    if (!hydratedRef.current || !workspaceId) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setSyncStatus("saving");
      saveCadDrawing(projectId, workspaceId, model as unknown as Json)
        .then(() => {
          setSyncStatus("saved");
          setSyncError(null);
        })
        .catch((err) => {
          setSyncStatus("error");
          setSyncError(err instanceof Error ? err.message : "Failed to save CAD work.");
        });
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [projectId, workspaceId, model]);

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
      activeLayerId: m.activeLayerId === id ? target : m.activeLayerId,
    }));
    return true;
  }, [commit]);

  const layerEntityCount = useCallback<UseCadModel["layerEntityCount"]>((id) => {
    return (
      model.points.filter((p) => p.layerId === id).length +
      model.linework.filter((l) => l.layerId === id).length +
      model.texts.filter((t) => t.layerId === id).length +
      model.surfaces.filter((s) => s.layerId === id).length
    );
  }, [model.points, model.linework, model.texts, model.surfaces]);

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
    const ptIds = new Set(items.filter((i) => i.type === "point").map((i) => i.id));
    const lwIds = new Set(items.filter((i) => i.type === "linework").map((i) => i.id));
    const txIds = new Set(items.filter((i) => i.type === "text").map((i) => i.id));
    commit((m) => ({
      ...m,
      points: m.points.map((p) => (ptIds.has(p.id) ? { ...p, color } : p)),
      linework: m.linework.map((l) => (lwIds.has(l.id) ? { ...l, color } : l)),
      texts: m.texts.map((t) => (txIds.has(t.id) ? { ...t, color } : t)),
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

    if (!asCopy) {
      // MOVE — translate the originals in place.
      commit((m) => ({
        ...m,
        points: m.points.map((p) => (ptIds.has(p.id) ? { ...p, n: p.n + dn, e: p.e + de } : p)),
        linework: m.linework.map((l) =>
          lwIds.has(l.id)
            ? { ...l, vertices: l.vertices.map((v) => ({ n: v.n + dn, e: v.e + de })) }
            : l,
        ),
        texts: m.texts.map((t) => (txIds.has(t.id) ? { ...t, n: t.n + dn, e: t.e + de } : t)),
      }));
      return items.length;
    }

    // COPY — duplicate the selected objects, offset, and select the copies.
    const newItems: SelectedItem[] = [];
    commit((m) => {
      const newPoints: SurveyPoint[] = [];
      for (const p of m.points) {
        if (!ptIds.has(p.id)) continue;
        const copy: SurveyPoint = { ...p, id: nextId("pt"), n: p.n + dn, e: p.e + de };
        newPoints.push(copy);
        newItems.push({ type: "point", id: copy.id });
      }
      const newLinework: SurveyLinework[] = [];
      for (const l of m.linework) {
        if (!lwIds.has(l.id)) continue;
        const copy: SurveyLinework = {
          ...l,
          id: nextId("lw"),
          vertices: l.vertices.map((v) => ({ n: v.n + dn, e: v.e + de })),
        };
        newLinework.push(copy);
        newItems.push({ type: "linework", id: copy.id });
      }
      const newTexts: SurveyText[] = [];
      for (const t of m.texts) {
        if (!txIds.has(t.id)) continue;
        const copy: SurveyText = { ...t, id: nextId("tx"), n: t.n + dn, e: t.e + de };
        newTexts.push(copy);
        newItems.push({ type: "text", id: copy.id });
      }
      return {
        ...m,
        points: [...m.points, ...newPoints],
        linework: [...m.linework, ...newLinework],
        texts: [...m.texts, ...newTexts],
      };
    });
    if (newItems.length) {
      const primary = newItems[newItems.length - 1];
      setSelection({ type: primary.type, id: primary.id, items: newItems });
    }
    return newItems.length;
  }, [selection, commit]);

  const clearAll = useCallback(() => {
    commit((m) => ({ ...m, points: [], linework: [], texts: [], surfaces: [] }));
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
      clearAll,
      undo,
      redo,
      nextPointNo,
      layerById,
    ],
  );
}
