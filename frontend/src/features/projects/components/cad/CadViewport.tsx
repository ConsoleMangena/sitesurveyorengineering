import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CadModelState, CadSelection, CadToolId, SelectedItem, Viewport } from "./cadModel.ts";
import { isSelected, resolveColor, selectionFromItems } from "./cadModel.ts";
import {
  fitToBox,
  niceGridSpacing,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type BBox,
  type ScreenSize,
} from "./cadViewportMath.ts";
import { inverse } from "./survey/cogo.ts";
import { fmtBearing, fmtDistance, type BearingFormat } from "./survey/format.ts";
import { sampleZ } from "./survey/surface.ts";
import { axisBadgeLabels, type AxisConvention } from "./cadSettings.ts";
import { buildCodeTable, resolveFeature } from "./survey/featureCodes.ts";
import { symbolMarkup } from "./survey/symbols.ts";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

/** Shared feature-code table for resolving point symbols in the viewport. */
const VIEWPORT_CODE_TABLE = buildCodeTable();

interface CadViewportProps {
  model: CadModelState;
  tool: CadToolId;
  selection: CadSelection;
  bearingFormat: BearingFormat;
  snap: boolean;
  ortho: boolean;
  showGrid: boolean;
  osnap: boolean;
  /** When true, snap spacing tracks the zoom-dependent grid; else uses `snapSpacing`. */
  snapAuto?: boolean;
  /** Fixed snap spacing (survey units) used when `snapAuto` is false. */
  snapSpacing?: number;
  /** Decimal places for the on-canvas coordinate readout. */
  coordDecimals?: number;
  /** Axis-label convention for the coordinate readout / WCS icon. */
  axisConvention?: AxisConvention;
  /** Show point number/code labels next to survey points. */
  showPointLabels?: boolean;
  /** Show bearing/distance labels along linework segments. */
  showSegmentLabels?: boolean;
  onCursorMove: (world: { n: number; e: number }) => void;
  onPickPoint: (world: { n: number; e: number }) => void;
  onSelectEntity: (sel: CadSelection) => void;
  pendingVertices: { n: number; e: number }[];
  fitSignal: number;
  /** Bumping this applies `scaleTarget` (screen px per survey unit) to the view. */
  scaleSignal?: number;
  /** Screen pixels per survey unit to apply when `scaleSignal` changes. */
  scaleTarget?: number;
  onScaleChange?: (label: string) => void;
  onCommit?: () => void;
  onContextMenu?: (ev: React.MouseEvent) => void;
  /** Forwarded so keyboard shortcuts (Delete, Esc, etc.) work while the
   *  viewport itself holds focus after a pick. */
  onKeyDown?: (ev: React.KeyboardEvent) => void;
  /** Called when the user submits a value from the dynamic cursor input. */
  onDynInput?: (value: string) => void;
}

type World = { n: number; e: number };
type OsnapKind = "endpoint" | "midpoint" | "node";
interface OsnapHit {
  world: World;
  screen: { x: number; y: number };
  kind: OsnapKind;
}
interface CursorInfo {
  x: number;
  y: number;
  lines: string[];
}

const HIT_TOL = 8;
const OSNAP_TOL = 12;
const DRAG_THRESHOLD = 4;
const TOOL_LABELS: Record<CadToolId, string> = {
  select: "Select",
  pan: "Pan",
  point: "Point",
  "control-point": "Control Point",
  line: "Line",
  boundary: "Boundary",
  text: "Text",
  "spot-height": "Spot Height",
  measure: "Measure",
  move: "Move",
  copy: "Copy",
  rotate: "Rotate",
  scale: "Scale",
  mirror: "Mirror",
  offset: "Offset",
  "dim-linear": "Dimension",
  circle: "Circle",
  arc: "Arc",
  "zoom-window": "Zoom Window",
};
const CROSSHAIR_GAP = 4;

export function CadViewport({
  model,
  tool,
  selection,
  bearingFormat,
  snap,
  ortho,
  showGrid,
  osnap,
  snapAuto = true,
  snapSpacing = 1,
  coordDecimals = 3,
  axisConvention = "yx",
  showPointLabels = true,
  showSegmentLabels = false,
  onCursorMove,
  onPickPoint,
  onSelectEntity,
  pendingVertices,
  fitSignal,
  scaleSignal = 0,
  scaleTarget,
  onScaleChange,
  onCommit,
  onContextMenu,
  onKeyDown,
  onDynInput,
}: CadViewportProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ScreenSize>({ width: 800, height: 600 });
  const [vp, setVp] = useState<Viewport>({ scale: 4, centerN: 0, centerE: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [osnapHit, setOsnapHit] = useState<OsnapHit | null>(null);
  const [resolvedWorld, setResolvedWorld] = useState<World | null>(null);
  const [selRect, setSelRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [cursorInfo, setCursorInfo] = useState<CursorInfo | null>(null);
  const dynInputRef = useRef<HTMLInputElement>(null);

  const isChainTool = tool === "line" || tool === "boundary";
  const showDynInput = isChainTool && pendingVertices.length > 0 && onDynInput != null;

  useEffect(() => {
    if (showDynInput) dynInputRef.current?.focus();
  }, [showDynInput, pendingVertices.length]);

  const didInitialFit = useRef(false);
  const selStartRef = useRef<{ x: number; y: number } | null>(null);

  const pressRef = useRef<{
    x: number; y: number; button: number;
    vp: Viewport; panning: boolean; moved: boolean;
  } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bbox = useMemo<BBox | null>(() => {
    const ns: number[] = [];
    const es: number[] = [];
    for (const p of model.points) { ns.push(p.n); es.push(p.e); }
    for (const lw of model.linework) {
      for (const v of lw.vertices) { ns.push(v.n); es.push(v.e); }
    }
    for (const t of model.texts) { ns.push(t.n); es.push(t.e); }
    for (const srf of model.surfaces) {
      if (!Array.isArray(srf.points)) continue;
      for (const v of srf.points) { ns.push(v.n); es.push(v.e); }
    }
    if (!ns.length) return null;
    return {
      minN: Math.min(...ns), maxN: Math.max(...ns),
      minE: Math.min(...es), maxE: Math.max(...es),
    };
  }, [model.points, model.linework, model.texts, model.surfaces]);

  useEffect(() => {
    if (didInitialFit.current) return;
    if (size.width < 10 || size.height < 10) return;
    if (bbox) {
      setVp(fitToBox(bbox, size));
      didInitialFit.current = true;
    }
  }, [bbox, size]);

  useEffect(() => {
    if (fitSignal === 0) return;
    if (bbox) {
      setVp(fitToBox(bbox, size));
    } else {
      setVp({ scale: 4, centerN: 0, centerE: 0 });
    }
    didInitialFit.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  // Apply a user-requested scale (screen px per survey unit) about the view
  // centre, keeping the current centre fixed.
  useEffect(() => {
    if (scaleSignal === 0 || !scaleTarget || scaleTarget <= 0) return;
    setVp((v) => ({ ...v, scale: scaleTarget }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleSignal]);

  const localPoint = (clientX: number, clientY: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const applySnap = useCallback(
    (world: World): World => {
      if (!snap) return world;
      const spacing = snapAuto || !(snapSpacing > 0) ? niceGridSpacing(vp) : snapSpacing;
      return {
        n: Math.round(world.n / spacing) * spacing,
        e: Math.round(world.e / spacing) * spacing,
      };
    },
    [snap, snapAuto, snapSpacing, vp],
  );

  const applyOrtho = useCallback(
    (world: World): World => {
      if (!ortho || pendingVertices.length === 0) return world;
      const last = pendingVertices[pendingVertices.length - 1];
      const dn = Math.abs(world.n - last.n);
      const de = Math.abs(world.e - last.e);
      return dn >= de ? { n: world.n, e: last.e } : { n: last.n, e: world.e };
    },
    [ortho, pendingVertices],
  );

  const visibleLayer = useCallback(
    (layerId: string) => {
      const l = model.layers.find((x) => x.id === layerId);
      return !l || l.visible;
    },
    [model.layers],
  );

  /**
   * Entities on a locked layer stay visible but cannot be selected or edited
   * (AutoCAD behaviour). Hidden layers are excluded too.
   */
  const selectableLayer = useCallback(
    (layerId: string) => {
      const l = model.layers.find((x) => x.id === layerId);
      return !l || (l.visible && !l.locked);
    },
    [model.layers],
  );

  const findOsnap = useCallback(
    (x: number, y: number): OsnapHit | null => {
      if (!osnap) return null;
      let best: OsnapHit | null = null;
      let bestDist = OSNAP_TOL;

      const consider = (w: World, kind: OsnapKind) => {
        const s = worldToScreen(w.n, w.e, vp, size);
        const d = Math.hypot(s.x - x, s.y - y);
        if (d <= bestDist) {
          bestDist = d;
          best = { world: w, screen: s, kind };
        }
      };

      for (const p of model.points) {
        if (!visibleLayer(p.layerId)) continue;
        consider({ n: p.n, e: p.e }, "node");
      }
      for (const lw of model.linework) {
        if (!visibleLayer(lw.layerId)) continue;
        for (let i = 0; i < lw.vertices.length; i++) {
          consider(lw.vertices[i], "endpoint");
          if (i > 0) {
            const a = lw.vertices[i - 1];
            const b = lw.vertices[i];
            consider({ n: (a.n + b.n) / 2, e: (a.e + b.e) / 2 }, "midpoint");
          }
        }
        if (lw.closed && lw.vertices.length > 2) {
          const a = lw.vertices[lw.vertices.length - 1];
          const b = lw.vertices[0];
          consider({ n: (a.n + b.n) / 2, e: (a.e + b.e) / 2 }, "midpoint");
        }
      }
      return best;
    },
    [osnap, model.points, model.linework, visibleLayer, vp, size],
  );

  const resolveWorld = useCallback(
    (x: number, y: number): World => {
      const osnapped = findOsnap(x, y);
      if (osnapped) return applyOrtho(osnapped.world);
      const raw = screenToWorld(x, y, vp, size);
      return applyOrtho(applySnap(raw));
    },
    [findOsnap, applyOrtho, applySnap, vp, size],
  );

  const distToSegment = (
    px: number, py: number,
    ax: number, ay: number,
    bx: number, by: number,
  ): number => {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };

  /** True when screen point (px,py) lies inside the triangle (a,b,c). */
  const pointInTriangle = (
    px: number, py: number,
    ax: number, ay: number,
    bx: number, by: number,
    cx: number, cy: number,
  ): boolean => {
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  };

  /** Hit-test the surfaces: a surface is picked when the cursor is over any of
   * its triangles (interior) or close to a triangle edge. Returns the id. */
  const hitSurface = useCallback(
    (x: number, y: number): string | null => {
      // Iterate back-to-front so the most recently added surface wins ties.
      for (let s = model.surfaces.length - 1; s >= 0; s--) {
        const srf = model.surfaces[s];
        if (!srf.visible) continue;
        if (!selectableLayer(srf.layerId)) continue;
        if (!Array.isArray(srf.points) || !Array.isArray(srf.triangles)) continue;
        const screen = srf.points.map((v) => worldToScreen(v.n, v.e, vp, size));
        for (const t of srf.triangles) {
          const a = screen[t.a];
          const b = screen[t.b];
          const c = screen[t.c];
          if (!a || !b || !c) continue;
          if (pointInTriangle(x, y, a.x, a.y, b.x, b.y, c.x, c.y)) return srf.id;
          // Edge proximity so the thin wireframe is also easy to pick.
          if (
            distToSegment(x, y, a.x, a.y, b.x, b.y) <= HIT_TOL ||
            distToSegment(x, y, b.x, b.y, c.x, c.y) <= HIT_TOL ||
            distToSegment(x, y, c.x, c.y, a.x, a.y) <= HIT_TOL
          ) {
            return srf.id;
          }
        }
      }
      return null;
    },
    [model.surfaces, selectableLayer, vp, size],
  );

  const hitTest = useCallback(
    (x: number, y: number): CadSelection => {
      let bestPt: { id: string; d: number } | null = null;
      for (const p of model.points) {
        if (!selectableLayer(p.layerId)) continue;
        const s = worldToScreen(p.n, p.e, vp, size);
        const d = Math.hypot(s.x - x, s.y - y);
        if (d <= HIT_TOL && (!bestPt || d < bestPt.d)) bestPt = { id: p.id, d };
      }
      if (bestPt) return { type: "point", id: bestPt.id };

      let bestLw: { id: string; d: number } | null = null;
      for (const lw of model.linework) {
        if (!selectableLayer(lw.layerId)) continue;
        const pts = lw.vertices.map((v) => worldToScreen(v.n, v.e, vp, size));
        if (pts.length < 2) continue;
        const segCount = lw.closed ? pts.length : pts.length - 1;
        for (let i = 0; i < segCount; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          const d = distToSegment(x, y, a.x, a.y, b.x, b.y);
          if (d <= HIT_TOL && (!bestLw || d < bestLw.d)) bestLw = { id: lw.id, d };
        }
      }
      if (bestLw) return { type: "linework", id: bestLw.id };

      for (const t of model.texts) {
        if (!selectableLayer(t.layerId)) continue;
        const s = worldToScreen(t.n, t.e, vp, size);
        const w = Math.max(20, t.text.length * 7);
        if (x >= s.x - 2 && x <= s.x + w && y >= s.y - 12 && y <= s.y + 4) {
          return { type: "text", id: t.id };
        }
      }

      // Surfaces are picked last so points / linework / text drawn on top of a
      // TIN remain selectable; clicking bare mesh selects the surface itself.
      const srfId = hitSurface(x, y);
      if (srfId) return { type: "surface", id: srfId };

      return { type: null, id: null };
    },
    [model.points, model.linework, model.texts, hitSurface, selectableLayer, vp, size],
  );

  /**
   * AutoCAD-style box selection. Dragging left→right is a WINDOW selection
   * (entities must be fully enclosed); right→left is a CROSSING selection
   * (entities that are enclosed OR cross the box). Returns every match.
   */
  const entitiesInRect = useCallback(
    (x1: number, y1: number, x2: number, y2: number): SelectedItem[] => {
      const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
      const crossing = x2 < x1; // right-to-left drag → crossing
      const items: SelectedItem[] = [];

      const inBox = (sx: number, sy: number) =>
        sx >= minX && sx <= maxX && sy >= minY && sy <= maxY;

      // Segment-vs-rect intersection for crossing selection.
      const segCrossesBox = (ax: number, ay: number, bx: number, by: number) => {
        if (inBox(ax, ay) || inBox(bx, by)) return true;
        // Clip test against the four box edges.
        const edges: [number, number, number, number][] = [
          [minX, minY, maxX, minY],
          [maxX, minY, maxX, maxY],
          [maxX, maxY, minX, maxY],
          [minX, maxY, minX, minY],
        ];
        const segInt = (
          p0x: number, p0y: number, p1x: number, p1y: number,
          p2x: number, p2y: number, p3x: number, p3y: number,
        ) => {
          const d = (p1x - p0x) * (p3y - p2y) - (p1y - p0y) * (p3x - p2x);
          if (Math.abs(d) < 1e-9) return false;
          const t = ((p2x - p0x) * (p3y - p2y) - (p2y - p0y) * (p3x - p2x)) / d;
          const u = ((p2x - p0x) * (p1y - p0y) - (p2y - p0y) * (p1x - p0x)) / d;
          return t >= 0 && t <= 1 && u >= 0 && u <= 1;
        };
        return edges.some((e) => segInt(ax, ay, bx, by, e[0], e[1], e[2], e[3]));
      };

      for (const p of model.points) {
        if (!selectableLayer(p.layerId)) continue;
        const s = worldToScreen(p.n, p.e, vp, size);
        if (inBox(s.x, s.y)) items.push({ type: "point", id: p.id });
      }
      for (const lw of model.linework) {
        if (!selectableLayer(lw.layerId)) continue;
        const pts = lw.vertices.map((v) => worldToScreen(v.n, v.e, vp, size));
        if (!pts.length) continue;
        const allIn = pts.every((s) => inBox(s.x, s.y));
        let touches = allIn;
        if (!touches && crossing) {
          const segCount = lw.closed ? pts.length : pts.length - 1;
          for (let i = 0; i < segCount && !touches; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            if (segCrossesBox(a.x, a.y, b.x, b.y)) touches = true;
          }
        }
        if (crossing ? touches : allIn) items.push({ type: "linework", id: lw.id });
      }
      for (const t of model.texts) {
        if (!selectableLayer(t.layerId)) continue;
        const s = worldToScreen(t.n, t.e, vp, size);
        if (inBox(s.x, s.y)) items.push({ type: "text", id: t.id });
      }
      for (const srf of model.surfaces) {
        if (!srf.visible) continue;
        if (!selectableLayer(srf.layerId)) continue;
        if (!Array.isArray(srf.points) || !Array.isArray(srf.triangles)) continue;
        const screen = srf.points.map((v) => worldToScreen(v.n, v.e, vp, size));
        if (!screen.length) continue;
        const allIn = screen.every((s) => inBox(s.x, s.y));
        let touches = allIn;
        if (!touches && crossing) {
          for (const t of srf.triangles) {
            const a = screen[t.a];
            const b = screen[t.b];
            const c = screen[t.c];
            if (!a || !b || !c) continue;
            if (
              segCrossesBox(a.x, a.y, b.x, b.y) ||
              segCrossesBox(b.x, b.y, c.x, c.y) ||
              segCrossesBox(c.x, c.y, a.x, a.y)
            ) {
              touches = true;
              break;
            }
          }
        }
        if (crossing ? touches : allIn) items.push({ type: "surface", id: srf.id });
      }
      return items;
    },
    [model.points, model.linework, model.texts, model.surfaces, selectableLayer, vp, size],
  );

  const handleMouseDown = (ev: React.MouseEvent) => {
    const { x, y } = localPoint(ev.clientX, ev.clientY);
    wrapRef.current?.focus();
    const startPan = ev.button === 1 || (ev.button === 0 && tool === "pan");
    pressRef.current = { x, y, button: ev.button, vp, panning: startPan, moved: false };

    if (ev.button === 0 && (tool === "select" || tool === "zoom-window")) {
      const hit = tool === "select" ? hitTest(x, y) : { type: null, id: null };
      if (hit.type === null) {
        selStartRef.current = { x, y };
        setSelRect({ x1: x, y1: y, x2: x, y2: y });
      }
    }
  };

  const handleMouseMove = (ev: React.MouseEvent) => {
    const { x, y } = localPoint(ev.clientX, ev.clientY);
    setCursor({ x, y });

    const press = pressRef.current;
    if (press) {
      if (Math.hypot(x - press.x, y - press.y) > DRAG_THRESHOLD) press.moved = true;
      const canDragPan = press.panning || press.button === 1;
      if (canDragPan && press.moved) {
        const dx = x - press.x;
        const dy = y - press.y;
        setVp({
          scale: press.vp.scale,
          centerE: press.vp.centerE - dx / press.vp.scale,
          centerN: press.vp.centerN + dy / press.vp.scale,
        });
        setCursorInfo(null);
        return;
      }
    }

    const snapHit = findOsnap(x, y);
    setOsnapHit(snapHit);

    const world = resolveWorld(x, y);
    setResolvedWorld(world);
    onCursorMove(world);

    if (selStartRef.current) {
      const { x: sx, y: sy } = selStartRef.current;
      setSelRect({ x1: sx, y1: sy, x2: x, y2: y });
      setCursorInfo(null);
      return;
    }

    const info: CursorInfo = { x, y, lines: [] };
    // Axis labels follow the selected convention. Default `"yx"` is the Zimbabwe
    // Gauss Conform (Lo.) convention: Y = Easting/westing, X = Northing/southing.
    const ax = axisBadgeLabels(axisConvention);
    info.lines.push(`${ax.easting}: ${world.e.toFixed(coordDecimals)}`);
    info.lines.push(`${ax.northing}: ${world.n.toFixed(coordDecimals)}`);

    if (tool === "spot-height") {
      let z: number | null = null;
      if (model.surfaces.length > 0) {
        const surface = model.surfaces[model.surfaces.length - 1];
        z = sampleZ({ points: surface.points, triangles: surface.triangles }, world.n, world.e);
      }
      if (z !== null) {
        info.lines.push(`RL: ${z.toFixed(coordDecimals)}`);
      } else {
        info.lines.push(`RL: --`);
      }
    }

    if (pendingVertices.length > 0 && (tool === "line" || tool === "boundary" || tool === "measure")) {
      const last = pendingVertices[pendingVertices.length - 1];
      const inv = inverse(last, world);
      info.lines.push(`${fmtBearing(inv.azimuth, bearingFormat)}`);
      info.lines.push(`${fmtDistance(inv.distance)}`);
    }

    setCursorInfo(info);
  };

  /** Merge new items into the existing selection (additive when Shift held). */
  const commitSelection = useCallback(
    (newItems: SelectedItem[], additive: boolean) => {
      const existing = selection.items ?? (selection.type && selection.id
        ? [{ type: selection.type, id: selection.id } as SelectedItem]
        : []);
      if (!additive) {
        onSelectEntity(selectionFromItems(newItems));
        return;
      }
      // Shift toggles each clicked entity in/out of the set.
      const map = new Map(existing.map((it) => [`${it.type}:${it.id}`, it]));
      for (const it of newItems) {
        const key = `${it.type}:${it.id}`;
        if (map.has(key)) map.delete(key);
        else map.set(key, it);
      }
      onSelectEntity(selectionFromItems([...map.values()]));
    },
    [selection, onSelectEntity],
  );

  const handleMouseUp = (ev: React.MouseEvent) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press) return;
    const additive = ev.shiftKey;

    if (selStartRef.current) {
      const start = selStartRef.current;
      selStartRef.current = null;
      setSelRect(null);

      const { x: ex, y: ey } = localPoint(ev.clientX, ev.clientY);
      const dx = Math.abs(ex - start.x);
      const dy = Math.abs(ey - start.y);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        if (tool === "zoom-window") {
          const minX = Math.min(start.x, ex), maxX = Math.max(start.x, ex);
          const minY = Math.min(start.y, ey), maxY = Math.max(start.y, ey);
          const sw = screenToWorld(minX, maxY, vp, size);
          const ne = screenToWorld(maxX, minY, vp, size);
          const box: BBox = { minN: sw.n, maxN: ne.n, minE: sw.e, maxE: ne.e };
          setVp(fitToBox(box, size));
          return;
        }
        const hits = entitiesInRect(start.x, start.y, ex, ey);
        commitSelection(hits, additive);
        return;
      }
    }

    if (press.button !== 0) return;
    if (press.moved) return;

    const { x, y } = localPoint(ev.clientX, ev.clientY);
    if (tool === "pan") return;
    if (tool === "zoom-window") return;

    if (tool === "select") {
      const hit = hitTest(x, y);
      if (hit.type && hit.id) {
        commitSelection([{ type: hit.type, id: hit.id }], additive);
      } else if (!additive) {
        onSelectEntity({ type: null, id: null, items: [] });
      }
      return;
    }

    onPickPoint(resolveWorld(x, y));
  };

  const handleMouseLeave = () => {
    pressRef.current = null;
    selStartRef.current = null;
    setSelRect(null);
    setCursor(null);
    setOsnapHit(null);
    setResolvedWorld(null);
    setCursorInfo(null);
  };

  const handleWheel = (ev: React.WheelEvent) => {
    const { x, y } = localPoint(ev.clientX, ev.clientY);
    const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
    setVp((v) => zoomAt(v, factor, x, y, size));
  };

  const handleDoubleClick = () => onCommit?.();

  const handleZoomIn = useCallback(() => {
    setVp((v) => zoomAt(v, 1.4, size.width / 2, size.height / 2, size));
  }, [size]);

  const handleZoomOut = useCallback(() => {
    setVp((v) => zoomAt(v, 1 / 1.4, size.width / 2, size.height / 2, size));
  }, [size]);

  const handleZoomExtents = useCallback(() => {
    if (bbox) {
      setVp(fitToBox(bbox, size));
    } else {
      setVp({ scale: 4, centerN: 0, centerE: 0 });
    }
  }, [bbox, size]);

  const handleContextMenuInner = (ev: React.MouseEvent) => {
    ev.preventDefault();
    onContextMenu?.(ev);
  };

  // ── Render helpers ────────────────────────────────────────────────────────
  /**
   * AutoCAD-style grid: major grid lines plus dotted intersections.
   * Minor grid lines are omitted so the canvas stays clean and readable.
   */
  const gridElements = useMemo(() => {
    if (!showGrid) return null;
    const spacing = niceGridSpacing(vp);
    const majorEvery = 5;
    const majorSpacing = spacing * majorEvery;
    const tl = screenToWorld(0, 0, vp, size);
    const br = screenToWorld(size.width, size.height, vp, size);
    const startE = Math.floor(Math.min(tl.e, br.e) / spacing) * spacing;
    const endE = Math.ceil(Math.max(tl.e, br.e) / spacing) * spacing;
    const startN = Math.floor(Math.min(tl.n, br.n) / spacing) * spacing;
    const endN = Math.ceil(Math.max(tl.n, br.n) / spacing) * spacing;
    if ((endE - startE) / spacing > 500 || (endN - startN) / spacing > 500) return null;

    const elements: React.ReactNode[] = [];
    const majorEs: number[] = [];
    const majorNs: number[] = [];

    for (let e = startE; e <= endE; e += spacing) {
      const idx = Math.round(e / spacing);
      const major = idx % majorEvery === 0;
      const axis = Math.abs(e) < 1e-9;
      if (!major && !axis) continue;
      if (major) majorEs.push(e);
      const a = worldToScreen(startN, e, vp, size);
      const b = worldToScreen(endN, e, vp, size);
      elements.push(
        <line
          key={`ve-${e}`}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={axis ? "#6a6a70" : "#3e3e42"}
          strokeWidth={axis ? 1.2 : 0.6}
          opacity={axis ? 0.55 : 0.7}
        />,
      );
    }
    for (let n = startN; n <= endN; n += spacing) {
      const idx = Math.round(n / spacing);
      const major = idx % majorEvery === 0;
      const axis = Math.abs(n) < 1e-9;
      if (!major && !axis) continue;
      if (major) majorNs.push(n);
      const a = worldToScreen(n, startE, vp, size);
      const b = worldToScreen(n, endE, vp, size);
      elements.push(
        <line
          key={`hn-${n}`}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={axis ? "#6a6a70" : "#3e3e42"}
          strokeWidth={axis ? 1.2 : 0.6}
          opacity={axis ? 0.55 : 0.7}
        />,
      );
    }

    // Dotted grid at every major intersection.
    let dotKey = 0;
    for (const e of majorEs) {
      for (const n of majorNs) {
        const s = worldToScreen(n, e, vp, size);
        elements.push(
          <circle
            key={`dot-${dotKey++}`}
            cx={s.x}
            cy={s.y}
            r={1.2}
            fill="#5a5a5e"
            opacity={0.85}
          />,
        );
      }
    }
    return elements;
  }, [showGrid, vp, size]);

  const surfaceElements = useMemo(() => {
    return model.surfaces.map((srf) => {
      if (!srf.visible) return null;
      if (!visibleLayer(srf.layerId)) return null;
      if (!Array.isArray(srf.points) || !Array.isArray(srf.triangles)) return null;
      const layer = model.layers.find((l) => l.id === srf.layerId);
      const selected = isSelected(selection, "surface", srf.id);
      const color = selected ? "#5cc3ff" : layer?.color ?? "#5cc3ff";
      const screen = srf.points.map((v) => worldToScreen(v.n, v.e, vp, size));
      return (
        <g key={srf.id} opacity={selected ? 0.85 : 0.5}>
          {srf.triangles.map((t, i) => {
            const a = screen[t.a];
            const b = screen[t.b];
            const c = screen[t.c];
            if (!a || !b || !c) return null;
            return (
              <polygon
                key={`${srf.id}-${i}`}
                points={`${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y}`}
                fill={selected ? "rgba(92, 195, 255, 0.08)" : "none"}
                stroke={color}
                strokeWidth={selected ? 1 : 0.5}
              />
            );
          })}
        </g>
      );
    });
  }, [model.surfaces, model.layers, selection, vp, size]);

  const lineworkElements = useMemo(() => {
    return model.linework.map((lw) => {
      if (!visibleLayer(lw.layerId)) return null;
      const layer = model.layers.find((l) => l.id === lw.layerId);
      const color = resolveColor(lw.color, layer?.color, "#a0b0c8");
      const pts = lw.vertices.map((v) => worldToScreen(v.n, v.e, vp, size));
      if (!pts.length) return null;
      const d =
        pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") +
        (lw.closed ? " Z" : "");
      const selected = isSelected(selection, "linework", lw.id);

      const isContour = lw.layerId === "CONTOURS" || lw.layerId === "CONTOURS_INDEX";
      const isIndexContour = lw.layerId === "CONTOURS_INDEX";
      const baseW = isIndexContour
        ? 2.0
        : lw.kind === "boundary" ? 2.4 : lw.kind === "polyline" ? 1.6 : 1.2;
      const sw = selected ? baseW + 0.8 : baseW;

      const labels: React.ReactNode[] = [];
      if (showSegmentLabels && !isContour) {
        for (let i = 1; i < lw.vertices.length; i++) {
          const a = lw.vertices[i - 1];
          const b = lw.vertices[i];
          const inv = inverse(a, b);
          const mid = worldToScreen((a.n + b.n) / 2, (a.e + b.e) / 2, vp, size);
          const angle = Math.atan2(b.e - a.e, b.n - a.n);
          const offX = -Math.sin(angle) * 10;
          const offY = Math.cos(angle) * 10;
          labels.push(
            <text key={`${lw.id}-lbl-${i}`} x={mid.x + offX} y={mid.y + offY - 3}
              fill="#90a5c4" stroke="rgba(10,14,20,0.85)" strokeWidth={1.5}
              paintOrder="stroke fill" fontSize={11} fontFamily="Arial, 'Helvetica Neue', Helvetica, 'Liberation Sans', sans-serif"
              textAnchor="middle" className="cad-seg-label">
              {fmtBearing(inv.azimuth, bearingFormat)} · {fmtDistance(inv.distance)}
            </text>,
          );
        }
      } else if (lw.label && isIndexContour && lw.vertices.length >= 2) {
        // Show the elevation label once per contour, placed at the midpoint of
        // the polyline and rotated to follow the contour direction.
        const midIdx = Math.floor(lw.vertices.length / 2);
        const va = lw.vertices[Math.max(0, midIdx - 1)];
        const vb = lw.vertices[Math.min(lw.vertices.length - 1, midIdx)];
        const midPt = worldToScreen((va.n + vb.n) / 2, (va.e + vb.e) / 2, vp, size);
        // Rotation angle so text follows the contour. Screen coords: atan2
        // with y inverted because screen Y goes downward.
        const sa = worldToScreen(va.n, va.e, vp, size);
        const sb = worldToScreen(vb.n, vb.e, vp, size);
        let angleDeg = Math.atan2(sb.y - sa.y, sb.x - sa.x) * (180 / Math.PI);
        // Keep text upright (readable left-to-right).
        if (angleDeg > 90) angleDeg -= 180;
        if (angleDeg < -90) angleDeg += 180;
          labels.push(
            <text
              key={`${lw.id}-elev`}
              x={midPt.x}
              y={midPt.y - 4}
              fill="#b0bfd0"
              stroke="rgba(10,14,20,0.85)" strokeWidth={1.5}
              paintOrder="stroke fill"
              fontSize={10}
              fontWeight={500}
              fontFamily="Arial, 'Helvetica Neue', Helvetica, 'Liberation Sans', sans-serif"
              textAnchor="middle"
              className="cad-seg-label"
              transform={`rotate(${angleDeg.toFixed(1)}, ${midPt.x}, ${midPt.y - 4})`}
            >
              {lw.label}
            </text>,
          );
      }
      return (
        <g key={lw.id}>
          {selected && (
            <path
              d={d}
              fill={lw.closed ? "rgba(92, 195, 255, 0.08)" : "none"}
              stroke="#5cc3ff"
              strokeWidth={sw + 1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.55}
            />
          )}
          <path d={d} fill={lw.closed ? `${color}18` : "none"} stroke={color}
            strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
          {selected && pts.map((p, i) => (
            <rect key={`vh-${i}`} x={p.x - 4} y={p.y - 4} width={8} height={8}
              fill="none" stroke="#2b9ed8" strokeWidth={1.5} rx={0} />
          ))}
          {labels}
        </g>
      );
    });
  }, [model.linework, model.layers, selection, vp, size, showSegmentLabels, bearingFormat]);

  const pointElements = useMemo(() => {
    return model.points.map((p) => {
      if (!visibleLayer(p.layerId)) return null;
      const layer = model.layers.find((l) => l.id === p.layerId);
      const color = resolveColor(p.color, layer?.color, "#5cc3ff");
      const s = worldToScreen(p.n, p.e, vp, size);
      const selected = isSelected(selection, "point", p.id);
      const feature = resolveFeature(p.code, VIEWPORT_CODE_TABLE);
      const symR = selected ? 6 : 5;
      return (
        <g key={p.id}>
          {selected && (
            <rect x={s.x - 6} y={s.y - 6} width={12} height={12} fill="none"
              stroke="#5cc3ff" strokeWidth={1.5} rx={1} />
          )}
          {feature.symbol === "dot" ? (
            <circle cx={s.x} cy={s.y} r={selected ? 4.5 : 3.5} fill={color}
              stroke={selected ? "#f0f0f8" : "none"} strokeWidth={selected ? 1.5 : 0} />
          ) : (
            <g
              transform={`translate(${s.x} ${s.y})`}
              stroke={color}
              strokeWidth={1.3}
              fill={color}
              dangerouslySetInnerHTML={{ __html: symbolMarkup(feature.symbol, symR) }}
            />
          )}
          {showPointLabels && (
            <text x={s.x + 7} y={s.y - 5} fill="#a0b0c8" stroke="rgba(10,14,20,0.85)" strokeWidth={1.5}
              paintOrder="stroke fill" fontSize={11}
              fontFamily="Arial, 'Helvetica Neue', Helvetica, 'Liberation Sans', sans-serif">
              {p.pointNo}{p.code ? ` ${p.code}` : ""}
            </text>
          )}
        </g>
      );
    });
  }, [model.points, model.layers, selection, vp, size, showPointLabels]);

  const textElements = useMemo(() => {
    return model.texts.map((t) => {
      if (!visibleLayer(t.layerId)) return null;
      const layer = model.layers.find((l) => l.id === t.layerId);
      const s = worldToScreen(t.n, t.e, vp, size);
      const selected = isSelected(selection, "text", t.id);
      const baseColor = resolveColor(t.color, layer?.color, "#d0d8e8");
      return (
        <text key={t.id} x={s.x} y={s.y}
          fill={selected ? "#5cc3ff" : baseColor}
          stroke="rgba(10,14,20,0.85)" strokeWidth={1.5}
          paintOrder="stroke fill"
          fontSize={16} fontWeight={selected ? 600 : 400}
          fontFamily="Arial, 'Helvetica Neue', Helvetica, 'Liberation Sans', sans-serif">
          {t.text}
        </text>
      );
    });
  }, [model.texts, model.layers, selection, vp, size]);

  const renderPending = () => {
    if (pendingVertices.length === 0) return null;
    const pts = pendingVertices.map((v) => worldToScreen(v.n, v.e, vp, size));

    let rubber = "";
    if (cursor && resolvedWorld) {
      const last = pts[pts.length - 1];
      const target = osnapHit ? osnapHit.screen : worldToScreen(resolvedWorld.n, resolvedWorld.e, vp, size);
      rubber = `M${last.x},${last.y} L${target.x},${target.y}`;
    }
    const placed = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
    const endX = cursor && resolvedWorld
      ? (osnapHit ? osnapHit.screen.x : worldToScreen(resolvedWorld.n, resolvedWorld.e, vp, size).x)
      : 0;
    const endY = cursor && resolvedWorld
      ? (osnapHit ? osnapHit.screen.y : worldToScreen(resolvedWorld.n, resolvedWorld.e, vp, size).y)
      : 0;
    return (
      <g>
        {pendingVertices.length > 1 && (
          <path d={placed} fill="none" stroke="#5cc3ff" strokeWidth={1.8} strokeLinejoin="round" />
        )}
        {rubber && (
          <path d={rubber} fill="none" stroke="#5cc3ff" strokeWidth={1.2} strokeDasharray="4 3" opacity={0.85} />
        )}
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3} fill="#5cc3ff" stroke="#f0f0f8" strokeWidth={0.5} />
            <text x={p.x + 5} y={p.y - 6} fill="#8aa0c0" fontSize={8}
              textAnchor="start" className="cad-seg-label">
              {i + 1}
            </text>
          </g>
        ))}
        {rubber && (
          <g>
            <line x1={endX - 3} y1={endY - 3} x2={endX + 3} y2={endY + 3}
              stroke="#5cc3ff" strokeWidth={0.8} opacity={0.5} />
            <line x1={endX + 3} y1={endY - 3} x2={endX - 3} y2={endY + 3}
              stroke="#5cc3ff" strokeWidth={0.8} opacity={0.5} />
          </g>
        )}
      </g>
    );
  };

  const renderOsnap = () => {
    if (!osnapHit) return null;
    const { x, y } = osnapHit.screen;
    const c = "#3bb46e";
    if (osnapHit.kind === "midpoint") {
      return (
        <polygon points={`${x},${y - 6} ${x + 6},${y + 4} ${x - 6},${y + 4}`}
          fill="none" stroke={c} strokeWidth={1.5} />
      );
    }
    if (osnapHit.kind === "node") {
      return (
        <g stroke={c} strokeWidth={1.5} fill="none">
          <circle cx={x} cy={y} r={5} />
          <line x1={x - 6} y1={y - 6} x2={x + 6} y2={y + 6} />
          <line x1={x - 6} y1={y + 6} x2={x + 6} y2={y - 6} />
        </g>
      );
    }
    return <rect x={x - 5} y={y - 5} width={10} height={10} fill="none" stroke={c} strokeWidth={1.5} />;
  };

  const scaleBar = useMemo(() => {
    const targetPx = 100;
    const worldLen = targetPx / vp.scale;
    const pow = Math.pow(10, Math.floor(Math.log10(worldLen)));
    const nice = [1, 2, 5, 10].map((m) => m * pow).reduce((best, c) =>
      Math.abs(c * vp.scale - targetPx) < Math.abs(best * vp.scale - targetPx) ? c : best, pow);
    const px = nice * vp.scale;
    return { px, label: `${nice} m` };
  }, [vp.scale]);

  useEffect(() => {
    onScaleChange?.(scaleBar.label);
  }, [scaleBar.label, onScaleChange]);

  const cursorClass =
    tool === "pan" ? "cad-cursor-pan" : tool === "select" ? "cad-cursor-select" : "cad-cursor-cross";

  return (
    <div
      ref={wrapRef}
      className={`cad-canvas-grid ${cursorClass}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenuInner}
      onWheel={handleWheel}
      role="application"
      aria-label="CAD model space"
    >
      <svg className="cad-drawing-svg" width={size.width} height={size.height}>
        {gridElements}
        {surfaceElements}
        {lineworkElements}
        {textElements}
        {pointElements}
        {renderPending()}
        {renderOsnap()}

        {selRect && (
          <rect
            x={Math.min(selRect.x1, selRect.x2)}
            y={Math.min(selRect.y1, selRect.y2)}
            width={Math.abs(selRect.x2 - selRect.x1)}
            height={Math.abs(selRect.y2 - selRect.y1)}
            fill={selRect.x2 >= selRect.x1 ? "rgba(65, 140, 255, 0.08)" : "rgba(50, 205, 120, 0.08)"}
            stroke={selRect.x2 >= selRect.x1 ? "#418cff" : "#32cd78"}
            strokeWidth={1}
            strokeDasharray={selRect.x2 >= selRect.x1 ? "none" : "4 2"}
            rx={1}
          />
        )}
      </svg>

      {/* Crosshair — AutoCAD-style hairlines with center gap + pickbox */}
      {cursor && tool !== "pan" && (
        <svg className="cad-crosshair" width={size.width} height={size.height}>
          <defs>
            <filter id="crosshair-glow">
              <feGaussianBlur stdDeviation="1" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g filter={tool === "select" ? undefined : "url(#crosshair-glow)"}>
            <line x1={cursor.x} y1={0} x2={cursor.x} y2={cursor.y - CROSSHAIR_GAP}
              stroke="#5cc3ff" strokeWidth={0.8} opacity={0.45} />
            <line x1={cursor.x} y1={cursor.y + CROSSHAIR_GAP} x2={cursor.x} y2={size.height}
              stroke="#5cc3ff" strokeWidth={0.8} opacity={0.45} />
            <line x1={0} y1={cursor.y} x2={cursor.x - CROSSHAIR_GAP} y2={cursor.y}
              stroke="#5cc3ff" strokeWidth={0.8} opacity={0.45} />
            <line x1={cursor.x + CROSSHAIR_GAP} y1={cursor.y} x2={size.width} y2={cursor.y}
              stroke="#5cc3ff" strokeWidth={0.8} opacity={0.45} />
            <rect
              x={cursor.x - 5}
              y={cursor.y - 5}
              width={10}
              height={10}
              fill="rgba(43, 158, 216, 0.08)"
              stroke="#5cc3ff"
              strokeWidth={1.2}
            />
          </g>
        </svg>
      )}

      {/* Dynamic input tooltip — shows coordinates and bearing/distance at cursor */}
      {cursorInfo && tool !== "pan" && (
        <div
          className="cad-dynamic-tip"
          style={{
            left: Math.min(cursorInfo.x + 16, size.width - 160),
            top: Math.max(cursorInfo.y - 48, 4),
          }}
        >
          {cursorInfo.lines.map((line, i) => (
            <span key={i} className="cad-dynamic-tip-line">{line}</span>
          ))}
        </div>
      )}

      {/* AutoCAD-style dynamic input box near the last picked point */}
      {showDynInput && (
        <div
          className="cad-dyn-input-wrap"
          style={(() => {
            const last = pendingVertices[pendingVertices.length - 1];
            const s = worldToScreen(last.n, last.e, vp, size);
            return { left: Math.min(s.x + 16, size.width - 200), top: Math.max(s.y - 38, 4) };
          })()}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseMove={(e) => e.stopPropagation()}
        >
          <input
            ref={dynInputRef}
            type="text"
            className="cad-dyn-input"
            defaultValue=""
            placeholder="dist<bearing"
            spellCheck={false}
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                dynInputRef.current?.blur();
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                const input = dynInputRef.current;
                const v = input?.value.trim() ?? "";
                if (v === "") {
                  onCommit?.();
                } else {
                  onDynInput?.(v);
                  if (input) input.value = "";
                }
                return;
              }
              if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
            }}
          />
        </div>
      )}

      <div className="cad-viewport-hud" aria-hidden="true">
        <span className="cad-hud-tool">{TOOL_LABELS[tool]}</span>
        <span className="cad-hud-divider" />
        <span>
          {pendingVertices.length > 0
            ? `${pendingVertices.length} point${pendingVertices.length === 1 ? "" : "s"} picked · Enter/right-click to finish`
            : tool === "select"
              ? "Click entities to inspect · drag to window-select"
              : tool === "pan"
                ? "Drag model space to pan"
                : "Click in model space to place geometry"}
        </span>
      </div>

      {/* WCS icon (AutoCAD-style coordinate axes at bottom-left) */}
      <div className="cad-ucs-icon" aria-hidden="true" title={`Coordinate system: ${axisBadgeLabels(axisConvention).first}, ${axisBadgeLabels(axisConvention).second}`}>
        <svg width="68" height="44" viewBox="0 0 68 44">
          <line x1="6" y1="36" x2="32" y2="36" stroke="#e06c75" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="6" y1="36" x2="6" y2="10" stroke="#3bb46e" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="6" cy="36" r="2.5" fill="#f0f0f8" />
          <text x="35" y="39" fill="#e06c75" textAnchor="start" fontSize="9"
            fontFamily="'Segoe UI', system-ui, sans-serif" fontWeight="700">{axisBadgeLabels(axisConvention).easting}</text>
          <text x="3" y="8" fill="#3bb46e" textAnchor="start" fontSize="9"
            fontFamily="'Segoe UI', system-ui, sans-serif" fontWeight="700">{axisBadgeLabels(axisConvention).northing}</text>
        </svg>
      </div>

      {/* Zoom controls */}
      <div className="cad-zoom-controls" aria-label="Zoom controls">
        <button
          type="button"
          className="cad-zoom-btn"
          onClick={handleZoomIn}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <ZoomIn size={15} />
        </button>
        <button
          type="button"
          className="cad-zoom-btn"
          onClick={handleZoomOut}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <ZoomOut size={15} />
        </button>
        <button
          type="button"
          className="cad-zoom-btn"
          onClick={handleZoomExtents}
          title="Zoom extents"
          aria-label="Zoom to extents"
        >
          <Maximize2 size={15} />
        </button>
      </div>

      {/* Scale bar */}
      <div className="cad-scale-bar" aria-hidden="true">
        <div className="cad-scale-bar-line" style={{ width: `${Math.max(20, scaleBar.px)}px` }} />
        <span>{scaleBar.label}</span>
      </div>
    </div>
  );
}
