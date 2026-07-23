/**
 * Engineering Surveyor CAD domain model.
 *
 * All geometry uses survey coordinates. Internally the fields are `e`, `n`, `z`
 * which map to the user-facing X (Easting), Y (Northing) and Z (Elevation/RL)
 * terminology used in the UI. The viewport converts these to screen pixels for
 * rendering.
 */

export type CadToolId =
  | "select"
  | "pan"
  | "point"
  | "line"
  | "boundary"
  | "text"
  | "spot-height"
  | "control-point"
  | "measure"
  | "move"
  | "copy"
  | "rotate"
  | "scale"
  | "mirror"
  | "offset"
  | "dim-linear"
  | "circle"
  | "arc"
  | "zoom-window";

export type LayerId = string;

/**
 * Object colour. `null` / undefined means "ByLayer" (inherit the layer colour,
 * the AutoCAD default). A hex string overrides it with an explicit colour.
 */
export type CadColor = string | null;

export interface CadLayer {
  id: LayerId;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
}

export interface SurveyPoint {
  id: string;
  /** Surveyor point number/label, e.g. "1001" or "CP1". */
  pointNo: string;
  n: number;
  e: number;
  z: number | null;
  code: string;
  layerId: LayerId;
  /** Explicit object colour; null/undefined = ByLayer. */
  color?: CadColor;
}

export type LineworkKind = "line" | "polyline" | "boundary";

export interface SurveyLinework {
  id: string;
  kind: LineworkKind;
  /** Vertices in survey coordinates. */
  vertices: { n: number; e: number }[];
  layerId: LayerId;
  /** Closed ring (boundary/parcel). */
  closed: boolean;
  /** Explicit object colour; null/undefined = ByLayer. */
  color?: CadColor;
  /** Optional label shown along the linework (e.g. contour elevation). */
  label?: string;
}

export interface SurveyText {
  id: string;
  n: number;
  e: number;
  text: string;
  layerId: LayerId;
  /** Explicit object colour; null/undefined = ByLayer. */
  color?: CadColor;
}

/**
 * A triangulated surface (TIN / digital terrain model) generated from survey
 * points. Triangles reference indices into `points`. Rendered as a wireframe;
 * contours derived from it are emitted as ordinary linework on the CONTOURS
 * layer so they export to DXF and print in reports like any other linework.
 */
export interface SurveySurface {
  id: string;
  name: string;
  points: { n: number; e: number; z: number }[];
  triangles: { a: number; b: number; c: number }[];
  layerId: LayerId;
  /** Whether the TIN wireframe is drawn in the viewport. */
  visible: boolean;
  /**
   * Optional cut/fill overlay. When present the surface is a computed
   * earthworks model: each entry mirrors a TIN triangle (same vertex indices
   * into `points`) with a signed mean height difference (`delta`): positive =
   * cut, negative = fill. The 3D viewport shades these red (cut) → blue (fill)
   * so the volume result is visible as a 3D model, not just a number.
   */
  cutFill?: SurfaceCutFill;
  /**
   * Optional slope-analysis overlay. When present each triangle carries a
   * precomputed colour (green→yellow→red by slope) so the 3D viewport renders
   * a slope-shaded DTM. Triangles are keyed by their vertex indices, matching
   * the `cutFill` mechanism.
   */
  slopeShade?: SurfaceSlopeShade;
}

export interface SurfaceSlopeShadeTriangle {
  a: number;
  b: number;
  c: number;
  /** Slope angle from horizontal, degrees. */
  slopeDeg: number;
  /** Precomputed CSS/hex colour for this triangle. */
  color: string;
}

export interface SurfaceSlopeShade {
  triangles: SurfaceSlopeShadeTriangle[];
  /** Maximum slope (deg) used to scale the colour ramp. */
  maxSlope: number;
}

export interface SurfaceCutFillTriangle {
  a: number;
  b: number;
  c: number;
  /** Signed mean height difference over the triangle (m). +cut / −fill. */
  delta: number;
  /** Signed prism volume for the triangle (m³). +cut / −fill. */
  volume: number;
}

export interface SurfaceCutFill {
  triangles: SurfaceCutFillTriangle[];
  /** Largest cut delta (>= 0), for symmetric colour scaling. */
  maxCut: number;
  /** Largest fill delta magnitude (>= 0), for symmetric colour scaling. */
  maxFill: number;
  /** How the overlay was computed, for labels/legend. */
  mode: "elevation" | "between";
  /** Reference RL used when `mode` is "elevation". */
  reference?: number;
}

export type CadEntity =
  | { type: "point"; data: SurveyPoint }
  | { type: "linework"; data: SurveyLinework }
  | { type: "text"; data: SurveyText }
  | { type: "surface"; data: SurveySurface };

export type CadEntityType = "point" | "linework" | "text" | "surface";

/**
 * Current selection. Backward compatible with the old single-selection shape
 * (`type` + `id`), but also carries a full set of selected entities so the
 * viewport can support AutoCAD-style window/crossing and shift multi-select.
 *
 * `type`/`id` reflect the *primary* (last-picked) entity, used by the
 * Properties panel; `items` holds every selected entity.
 */
export interface SelectedItem {
  type: CadEntityType;
  id: string;
}

export interface CadSelection {
  type: CadEntityType | null;
  id: string | null;
  /** All selected entities (includes the primary one). */
  items?: SelectedItem[];
}

export const EMPTY_SELECTION: CadSelection = { type: null, id: null, items: [] };

/** Build a selection from a list of items, exposing the last one as primary. */
export function selectionFromItems(items: SelectedItem[]): CadSelection {
  if (items.length === 0) return { type: null, id: null, items: [] };
  const primary = items[items.length - 1];
  return { type: primary.type, id: primary.id, items };
}

/** True when an entity is part of the current selection. */
export function isSelected(sel: CadSelection, type: CadEntityType, id: string): boolean {
  if (sel.items && sel.items.length) {
    return sel.items.some((it) => it.type === type && it.id === id);
  }
  return sel.type === type && sel.id === id;
}

/**
 * AutoCAD-style colour palette for the per-object colour picker.
 * The first entry (null) is "ByLayer".
 */
export const CAD_COLORS: { value: CadColor; label: string }[] = [
  { value: null, label: "ByLayer" },
  { value: "#ffffff", label: "White" },
  { value: "#ff0000", label: "Red" },
  { value: "#ff7a00", label: "Orange" },
  { value: "#ffff00", label: "Yellow" },
  { value: "#22c55e", label: "Green" },
  { value: "#22d3ee", label: "Cyan" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#a855f7", label: "Magenta" },
  { value: "#94a3b8", label: "Grey" },
];

/** Resolve the colour an object is drawn with: explicit colour, else the layer's. */
export function resolveColor(
  objColor: CadColor | undefined,
  layerColor: string | undefined,
  fallback = "#a0b0c8",
): string {
  if (objColor) return objColor;
  return layerColor ?? fallback;
}

export interface Viewport {
  /** Screen pixels per survey unit. */
  scale: number;
  /** Survey coordinate currently centred in the viewport. */
  centerN: number;
  centerE: number;
}

export interface CadModelState {
  layers: CadLayer[];
  points: SurveyPoint[];
  linework: SurveyLinework[];
  texts: SurveyText[];
  surfaces: SurveySurface[];
  activeLayerId: LayerId;
}

/**
 * AutoCAD-style layer presets. These are not created by default — they are
 * materialised on demand when a command or feature code references them. The
 * default drawing starts with a single "0" layer, exactly like AutoCAD.
 */
export const LAYER_PRESETS: Record<string, { name: string; color: string }> = {
  "0": { name: "0", color: "#ffffff" },
  CONTROL: { name: "Control", color: "#f97316" },
  TRAVERSE: { name: "Traverse", color: "#a78bfa" },
  BOUNDARY: { name: "Boundary", color: "#f43f5e" },
  TOPO: { name: "Topo / Detail", color: "#38bdf8" },
  CONTOURS: { name: "Contours", color: "#22c55e" },
  CONTOURS_INDEX: { name: "Contours (index)", color: "#16a34a" },
  SETOUT: { name: "Set-out", color: "#eab308" },
  TEXT: { name: "Annotation", color: "#e2e8f0" },
};

export const DEFAULT_LAYERS: CadLayer[] = [
  { id: "0", name: "0", color: "#ffffff", visible: true, locked: false },
];

export function emptyModel(): CadModelState {
  return {
    layers: DEFAULT_LAYERS.map((l) => ({ ...l })),
    points: [],
    linework: [],
    texts: [],
    surfaces: [],
    activeLayerId: "0",
  };
}

export function cadStorageKey(projectId: string): string {
  return `sitesurveyorCad:${projectId}`;
}
