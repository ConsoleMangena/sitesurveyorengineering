/**
 * Project tool registry.
 *
 * Each project tool declares how it behaves when opened:
 * - `kind: "cad"`     → opens the Engineering Surveyor CAD workspace (optionally on a tab).
 * - `kind: "calc"`    → opens an in-app calculator/modal backed by real survey math.
 * - `kind: "soon"`    → not implemented yet; surfaced honestly as "Coming soon".
 *
 * This replaces the previous behaviour where every tool merely wrote a
 * "Tool: X initialized" note into the activity log and did nothing.
 */
import type { ComponentType } from "react";
import {
  Crosshair,
  Settings2,
  Wrench,
  ClipboardCheck,
  Map,
  PencilRuler,
  LineChart,
  Compass,
  Ruler,
  Waypoints,
  AlignEndHorizontal,
  ArrowLeftRight,
  RefreshCcw,
  LandPlot,
  Target,
  MailOpen,
  FileUp,
  FileDown,
  Printer,
  FolderOpen,
  LayoutGrid,
  Triangle,
  Calculator,
  PenTool,
  Mountain,
  type LucideProps,
} from "lucide-react";

export type ToolCategory =
  | "Survey Setup"
  | "COGO & Computation"
  | "Field Data"
  | "Drafting & Outputs";

export type CalcToolId =
  | "polar-forward"
  | "join-inverse"
  | "traverse-adjustment"
  | "levelling"
  | "area-volume"
  | "intersection"
  | "resection"
  | "angle-converter"
  | "stakeout"
  | "horizontal-curve"
  | "vertical-curve";

export type ToolBehavior =
  | { kind: "cad" }
  | { kind: "calc"; calc: CalcToolId }
  | { kind: "soon" };

/**
 * Access tier:
 * - "free" → available to every workspace, no marketplace entitlement.
 * - "paid" → requires an active entitlement for `requiresFeature`.
 */
export type ToolTier = "free" | "paid";

export interface ProjectTool {
  id: string;
  label: string;
  category: ToolCategory;
  description: string;
  pinned?: boolean;
  tier: ToolTier;
  /** Marketplace feature key required when tier is "paid". */
  requiresFeature?: string;
  behavior: ToolBehavior;
  /** Icon shown in the tool cards and quick-access area. */
  icon: ComponentType<LucideProps>;
}

export const CAD_TOOL_ID = "surveyor-cad";
export const CAD_FEATURE_KEY = "cad_engine";

export const TOOL_CATEGORIES: ToolCategory[] = [
  "Survey Setup",
  "COGO & Computation",
  "Field Data",
  "Drafting & Outputs",
];

export const PROJECT_TOOLS: ProjectTool[] = [
  // ── Survey Setup ─────────────────────────────────────────────────────────
  {
    id: "control-points",
    label: "Control Points",
    category: "Survey Setup",
    description: "Manage control stations and baseline references in the CAD model.",
    pinned: true,
    tier: "paid",
    requiresFeature: CAD_FEATURE_KEY,
    behavior: { kind: "cad" },
    icon: Crosshair,
  },
  {
    id: "instrument-calibration",
    label: "Instrument Calibration",
    category: "Survey Setup",
    description: "Track calibration status for project instruments.",
    tier: "free",
    behavior: { kind: "soon" },
    icon: Wrench,
  },

  // ── COGO & Computation (all FREE) ─────────────────────────────────────
  {
    id: "polar-forward",
    label: "Polar / Forward Computation",
    category: "COGO & Computation",
    description: "Compute X, Y of a new point from a known point, bearing, and distance.",
    pinned: true,
    tier: "free",
    behavior: { kind: "calc", calc: "polar-forward" },
    icon: PencilRuler,
  },
  {
    id: "join-inverse",
    label: "Join / Inverse (Polar)",
    category: "COGO & Computation",
    description: "Bearing and distance between two known X, Y coordinates.",
    pinned: true,
    tier: "free",
    behavior: { kind: "calc", calc: "join-inverse" },
    icon: ArrowLeftRight,
  },
  {
    id: "traverse-adjustment",
    label: "Traverse Computation & Balancing",
    category: "COGO & Computation",
    description: "Closing error, accuracy, and Bowditch (compass-rule) adjustment of X, Y.",
    tier: "free",
    behavior: { kind: "calc", calc: "traverse-adjustment" },
    icon: Waypoints,
  },
  {
    id: "levelling",
    label: "Levelling (Rise & Fall / HPC)",
    category: "COGO & Computation",
    description: "Reduce BS/IS/FS to levels (Z) with arithmetic check and misclosure adjustment.",
    pinned: true,
    tier: "free",
    behavior: { kind: "calc", calc: "levelling" },
    icon: AlignEndHorizontal,
  },
  {
    id: "area-volume",
    label: "Area & Volume",
    category: "COGO & Computation",
    description:
      "Polygon area/perimeter plus earthwork volumes: TIN surface/stockpile, cross-section (end-area & prismoidal) and grid methods.",
    pinned: true,
    tier: "free",
    behavior: { kind: "calc", calc: "area-volume" },
    icon: LandPlot,
  },
  {
    id: "intersection",
    label: "Intersection",
    category: "COGO & Computation",
    description: "Fix a new point from two stations by bearing-bearing or distance-distance.",
    tier: "free",
    behavior: { kind: "calc", calc: "intersection" },
    icon: Triangle,
  },
  {
    id: "resection",
    label: "Resection (Three-Point)",
    category: "COGO & Computation",
    description: "Fix the observer's X, Y from angles to three known stations (Tienstra).",
    tier: "free",
    behavior: { kind: "calc", calc: "resection" },
    icon: Compass,
  },
  {
    id: "angle-converter",
    label: "Bearing / Angle Converter",
    category: "COGO & Computation",
    description: "Convert between azimuth (DMS), quadrant bearing, decimal degrees, and gon.",
    tier: "free",
    behavior: { kind: "calc", calc: "angle-converter" },
    icon: RefreshCcw,
  },
  {
    id: "stakeout",
    label: "Stake-out / Set-out",
    category: "COGO & Computation",
    description: "Angle-right, distance and offsets to set out a design point from an occupied station and backsight.",
    tier: "free",
    behavior: { kind: "calc", calc: "stakeout" },
    icon: Target,
  },
  {
    id: "horizontal-curve",
    label: "Horizontal Curve Set-out",
    category: "COGO & Computation",
    description: "Solve a circular curve (T, L, E, M, chord) and generate stake-out stations with deflection angles.",
    tier: "free",
    behavior: { kind: "calc", calc: "horizontal-curve" },
    icon: LineChart,
  },
  {
    id: "vertical-curve",
    label: "Vertical Curve Set-out",
    category: "COGO & Computation",
    description: "Design an equal-tangent parabolic curve: BVC/EVC, high/low point and chainage RL table.",
    tier: "free",
    behavior: { kind: "calc", calc: "vertical-curve" },
    icon: Mountain,
  },

  // ── Field Data ───────────────────────────────────────────────────────────
  {
    id: "raw-observations",
    label: "Raw Observations",
    category: "Field Data",
    description: "Review imported field points in the CAD workspace.",
    tier: "paid",
    requiresFeature: CAD_FEATURE_KEY,
    behavior: { kind: "cad" },
    icon: FolderOpen,
  },
  {
    id: "gnss-import",
    label: "GNSS Import",
    category: "Field Data",
    description: "Import GNSS/total-station CSV points into the CAD model.",
    pinned: true,
    tier: "paid",
    requiresFeature: CAD_FEATURE_KEY,
    behavior: { kind: "cad" },
    icon: FileUp,
  },
  {
    id: "field-notes",
    label: "Field Notes",
    category: "Field Data",
    description: "Capture notes, issues, and field actions on the project timeline.",
    tier: "free",
    behavior: { kind: "soon" },
    icon: MailOpen,
  },
  {
    id: "qa-flags",
    label: "QA Flags",
    category: "Field Data",
    description: "Track outliers and pending QA checks (points coded QA/CHECK).",
    tier: "free",
    behavior: { kind: "soon" },
    icon: ClipboardCheck,
  },

  // ── Drafting & Outputs ───────────────────────────────────────────────────
  {
    id: CAD_TOOL_ID,
    label: "Engineering Surveyor CAD",
    category: "Drafting & Outputs",
    description: "Open the full-screen CAD drafting workspace.",
    pinned: true,
    tier: "paid",
    requiresFeature: CAD_FEATURE_KEY,
    behavior: { kind: "cad" },
    icon: PenTool,
  },
  {
    id: "cad-export",
    label: "Export to DXF",
    category: "Drafting & Outputs",
    description: "Export CAD-ready linework, layers and TIN surfaces as DXF.",
    tier: "paid",
    requiresFeature: CAD_FEATURE_KEY,
    behavior: { kind: "cad" },
    icon: FileDown,
  },
  {
    id: "map-layouts",
    label: "Plot / Layout",
    category: "Drafting & Outputs",
    description: "Compose to-scale paper-space sheets with title block, north arrow and scale bar.",
    tier: "paid",
    requiresFeature: CAD_FEATURE_KEY,
    behavior: { kind: "cad" },
    icon: Printer,
  },
  {
    id: "deliverable-pack",
    label: "Deliverable Pack",
    category: "Drafting & Outputs",
    description: "Generate the survey report (coordinates, traverse, surfaces, cut/fill) from the CAD workspace.",
    tier: "paid",
    requiresFeature: CAD_FEATURE_KEY,
    behavior: { kind: "cad" },
    icon: Map,
  },
];

export const PROJECT_TOOLS_BY_ID: Record<string, ProjectTool> = PROJECT_TOOLS.reduce(
  (acc, tool) => {
    acc[tool.id] = tool;
    return acc;
  },
  {} as Record<string, ProjectTool>,
);

/** Tools the user can actually open right now (excludes Coming soon placeholders). */
export const ACTIVE_PROJECT_TOOLS = PROJECT_TOOLS.filter((t) => t.behavior.kind !== "soon");

/** Tools that live inside the Engineering Surveyor CAD workspace should not be
    listed as standalone tiles — the CAD button is the single entry point. */
export const NON_CAD_TOOLS = PROJECT_TOOLS.filter((t) => t.behavior.kind !== "cad");

/** Coming-soon tools shown separately so they don't dilute active tools. */
export const COMING_SOON_TOOLS = PROJECT_TOOLS.filter((t) => t.behavior.kind === "soon");

/** Pinned tools for the Overview quick-access section (CAD tools excluded). */
export const PINNED_TOOLS = PROJECT_TOOLS.filter((t) => t.pinned && t.behavior.kind !== "cad");
