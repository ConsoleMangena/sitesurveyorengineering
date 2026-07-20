import type { ComponentType } from "react";
import type { CadToolId } from "./cadModel.ts";
import {
  MousePointer2, Move, Hand, Maximize2, Trash2, MapPin, FileUp,
  PenLine, Waypoints, Pentagon,
  Type, Ruler, FileDown, FileText, ClipboardList,
  Waves, Undo2, Redo2, Copy,
  Hexagon, Spline, Globe,
  Mountain, Layers2, Diff, Printer,
  Compass, Tag, SquareStack, Workflow, TriangleRight, Crosshair,
} from "lucide-react";

export interface RibbonAction {
  id: string;
  label: string;
  hint?: string;
}

interface RibbonPanel {
  label: string;
  actions: RibbonAction[];
}

interface CadRibbonProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onAction: (actionId: string) => void;
  datum: string;
  tool: CadToolId;
  /** Whether undo / redo are currently possible (greys out the buttons). */
  canUndo?: boolean;
  canRedo?: boolean;
}

const PANELS: Record<string, RibbonPanel[]> = {
  Home: [
    {
      label: "Navigate",
      actions: [
        { id: "tool:select", label: "Select", hint: "Select entities (S)" },
        { id: "tool:pan", label: "Pan", hint: "Pan viewport (P)" },
        { id: "zoom:extents", label: "Extents", hint: "Zoom to extents" },
      ],
    },
    {
      label: "Edit",
      actions: [
        { id: "edit:undo", label: "Undo", hint: "Undo last change (Ctrl+Z)" },
        { id: "edit:redo", label: "Redo", hint: "Redo (Ctrl+Y)" },
        { id: "edit:delete", label: "Delete", hint: "Delete selected entity (Del)" },
      ],
    },
    {
      label: "Modify",
      actions: [
        { id: "tool:move", label: "Move", hint: "Move selected objects: pick base then destination (M)" },
        { id: "tool:copy", label: "Copy", hint: "Copy selected objects: pick base then destination" },
      ],
    },
  ],
  Survey: [
    {
      label: "Draw",
      actions: [
        { id: "tool:point", label: "Point", hint: "Place a survey point (O)" },
        { id: "tool:line", label: "Line", hint: "Draw line segments (L)" },
        { id: "tool:polyline", label: "Polyline", hint: "Draw polyline (Y)" },
        { id: "tool:boundary", label: "Boundary", hint: "Draw closed boundary (B)" },
      ],
    },
    {
      label: "Data",
      actions: [
        { id: "import:csv", label: "Import CSV", hint: "Import points from CSV" },
        { id: "import:geojson", label: "Import GeoJSON", hint: "Import points & linework from GeoJSON" },
      ],
    },
    {
      label: "Field to Finish",
      actions: [
        { id: "f2f:linework", label: "Process Linework", hint: "Join coded points into linework strings (kerbs, fences, buildings) using the feature-code table" },
      ],
    },
    {
      label: "Geometry",
      actions: [
        { id: "geom:hull", label: "Convex Hull", hint: "Convex hull of all points (GeoRust geo)" },
        { id: "geom:simplify", label: "Simplify", hint: "Simplify the selected polyline (Douglas–Peucker)" },
        { id: "geom:reproject", label: "Reproject", hint: "Reproject all points between CRS (PROJ on desktop)" },
      ],
    },
  ],
  Surface: [
    {
      label: "Terrain",
      actions: [
        { id: "surface:tin", label: "Build TIN", hint: "Triangulate survey points into a surface (DTM)" },
        { id: "surface:tin-breaklines", label: "Build TIN + Breaklines", hint: "Triangulate honouring coded breaklines and clipping to the selected boundary (survey-grade DTM)" },
        { id: "surface:contours", label: "Contours", hint: "Generate contours from the surface (index + intermediate, labelled)" },
      ],
    },
    {
      label: "Volumes",
      actions: [
        { id: "surface:volume-elevation", label: "Vol → RL", hint: "Cut/fill between surface and a level" },
        { id: "surface:volume-between", label: "Vol Δ", hint: "Cut/fill between two surfaces" },
        { id: "surface:cutfill-report", label: "Cut/Fill Report", hint: "Generate a printable cut/fill volume report" },
      ],
    },
    {
      label: "Analysis",
      actions: [
        { id: "surface:terrain", label: "Slope / Aspect", hint: "Shade the TIN by slope and report terrain statistics (mean/min/max slope, 3D area)" },
      ],
    },
    {
      label: "Manage",
      actions: [
        { id: "surface:clear-contours", label: "Clear Contours", hint: "Remove all generated contour lines" },
        { id: "surface:clear-surfaces", label: "Clear Surfaces", hint: "Remove all TIN surfaces and cut/fill models" },
      ],
    },
  ],
  Annotate: [
    {
      label: "Annotation",
      actions: [
        { id: "tool:text", label: "Text", hint: "Place annotation text (T)" },
        { id: "tool:spot-height", label: "Spot Height", hint: "Click on the surface or points to drop elevation labels" },
        { id: "annotate:label-boundary", label: "Label Boundary", hint: "Annotate the selected boundary/polyline with bearing & distance on each segment" },
        { id: "annotate:label-area", label: "Label Area", hint: "Place an area/perimeter label at the centroid of the selected closed boundary" },
      ],
    },
    {
      label: "Inquiry",
      actions: [
        { id: "tool:measure", label: "Measure", hint: "Measure distance and bearing (M)" },
      ],
    },
  ],
  Output: [
    {
      label: "Plot",
      actions: [
        { id: "plot:layout", label: "Plot / Layout", hint: "Configure a printed sheet (title block, north arrow, scale bar, legend) and print to PDF" },
      ],
    },
    {
      label: "Export",
      actions: [
        { id: "export:dxf", label: "DXF", hint: "Export drawing to DXF" },
        { id: "export:csv", label: "CSV", hint: "Export points to CSV" },
        { id: "export:geojson", label: "GeoJSON", hint: "Export points & linework to GeoJSON" },
        { id: "export:report", label: "Report", hint: "Generate survey report" },
      ],
    },
  ],
};

const ICON_MAP: Record<string, ComponentType<{ size?: number | string }>> = {
  "tool:select": MousePointer2,
  "tool:pan": Hand,
  "zoom:extents": Maximize2,
  "edit:undo": Undo2,
  "edit:redo": Redo2,
  "edit:delete": Trash2,
  "tool:move": Move,
  "tool:copy": Copy,
  "tool:point": MapPin,
  "import:csv": FileUp,
  "import:geojson": Globe,
  "geom:hull": Hexagon,
  "geom:simplify": Spline,
  "geom:reproject": Globe,
  "tool:line": PenLine,
  "tool:polyline": Waypoints,
  "tool:boundary": Pentagon,
  "tool:text": Type,
  "tool:spot-height": Crosshair,
  "tool:measure": Ruler,
  "f2f:linework": Workflow,
  "surface:tin": Mountain,
  "surface:tin-breaklines": TriangleRight,
  "surface:contours": Waves,
  "surface:volume-elevation": Layers2,
  "surface:volume-between": Diff,
  "surface:cutfill-report": ClipboardList,
  "surface:terrain": Compass,
  "surface:clear-contours": Trash2,
  "surface:clear-surfaces": Trash2,
  "annotate:label-boundary": Tag,
  "annotate:label-area": SquareStack,
  "plot:layout": Printer,
  "export:dxf": FileDown,
  "export:csv": FileDown,
  "export:geojson": Globe,
  "export:report": FileText,
};

const TABS = ["Home", "Survey", "Surface", "Annotate", "Output"] as const;

export function CadRibbon({ activeTab, onTabChange, onAction, datum, tool, canUndo = true, canRedo = true }: CadRibbonProps) {
  const panels = PANELS[activeTab] ?? [];

  const isDisabled = (actionId: string): boolean => {
    if (actionId === "edit:undo") return !canUndo;
    if (actionId === "edit:redo") return !canRedo;
    return false;
  };

  return (
    <div className="cad-ribbon">
      <div className="cad-ribbon-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={activeTab === t}
            className={`cad-ribbon-tab ${activeTab === t ? "active" : ""}`}
            onClick={() => onTabChange(t)}
            type="button"
          >
            {t}
          </button>
        ))}
        <span className="cad-ribbon-datum" title="Project datum / CRS">{datum || "No datum set"}</span>
      </div>
      <div className="cad-ribbon-panels">
        {panels.map((panel) => (
          <div key={panel.label} className="cad-ribbon-panel">
            <div className="cad-ribbon-actions">
              {panel.actions.map((a) => {
                const isToolAction = a.id.startsWith("tool:");
                const toolId = a.id.split(":")[1] as CadToolId;
                const active = isToolAction && tool === toolId;
                const disabled = isDisabled(a.id);
                const Icon = ICON_MAP[a.id];
                return (
                  <button
                    key={a.id}
                    className={`cad-ribbon-btn ${active ? "active" : ""} ${disabled ? "disabled" : ""}`}
                    onClick={() => { if (!disabled) onAction(a.id); }}
                    title={a.hint ?? a.label}
                    type="button"
                    disabled={disabled}
                    aria-disabled={disabled}
                  >
                    {Icon && <Icon size={14} />}
                    <span>{a.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
