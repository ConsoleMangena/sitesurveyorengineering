import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import type { CadToolId } from "./cadModel.ts";
import {
  MousePointer2, Hand, MapPin, PenLine, Waypoints, Pentagon, Type, Ruler,
  Move, Copy, Crosshair, ChevronLeft, ChevronRight, GripVertical,
} from "lucide-react";

interface CadToolPaletteProps {
  tool: CadToolId;
  onToolChange: (tool: CadToolId) => void;
}

interface ToolDef {
  id: CadToolId;
  label: string;
  icon: ComponentType<{ size?: number | string }>;
  shortcut: string;
  description: string;
}

type ToolTab = "Draw" | "Modify" | "Annotate";

const TABS: ToolTab[] = ["Draw", "Modify", "Annotate"];

const DRAW_TOOLS: ToolDef[] = [
  { id: "point", label: "Point", icon: MapPin, shortcut: "O", description: "Place a survey point" },
  { id: "line", label: "Line", icon: PenLine, shortcut: "L", description: "Draw line segments" },
  { id: "polyline", label: "Polyline", icon: Waypoints, shortcut: "Y", description: "Draw multi-segment polyline" },
  { id: "boundary", label: "Boundary", icon: Pentagon, shortcut: "B", description: "Draw closed boundary" },
];

const MODIFY_TOOLS: ToolDef[] = [
  { id: "select", label: "Select", icon: MousePointer2, shortcut: "S", description: "Select and inspect entities" },
  { id: "move", label: "Move", icon: Move, shortcut: "M", description: "Move selected objects" },
  { id: "copy", label: "Copy", icon: Copy, shortcut: "C", description: "Copy selected objects" },
  { id: "pan", label: "Pan", icon: Hand, shortcut: "P", description: "Pan the viewport" },
];

const ANNOTATE_TOOLS: ToolDef[] = [
  { id: "text", label: "Text", icon: Type, shortcut: "T", description: "Place annotation text" },
  { id: "spot-height", label: "Spot Ht", icon: Crosshair, shortcut: "H", description: "Drop elevation label" },
  { id: "measure", label: "Measure", icon: Ruler, shortcut: "M", description: "Measure distance and bearing" },
];

const ALL_TOOLS: ToolDef[] = [...DRAW_TOOLS, ...MODIFY_TOOLS, ...ANNOTATE_TOOLS];

const MAX_RECENT = 4;
const MIN_WIDTH = 100;
const MAX_WIDTH = 240;
const DEFAULT_WIDTH = 130;

export function CadToolPalette({ tool, onToolChange }: CadToolPaletteProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<ToolTab>("Draw");
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [recent, setRecent] = useState<CadToolId[]>([]);
  const [resizing, setResizing] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const startWidthRef = useRef(DEFAULT_WIDTH);
  const startXRef = useRef(0);
  const prevTool = useRef(tool);

  useEffect(() => {
    const prev = prevTool.current;
    if (prev !== tool) {
      prevTool.current = tool;
      setRecent((r) => {
        const next = r.filter((id) => id !== prev);
        return [prev, ...next].slice(0, MAX_RECENT);
      });
    }
  }, [tool]);

  const recentTools = useMemo(() => {
    return recent
      .map((id) => ALL_TOOLS.find((t) => t.id === id))
      .filter((t): t is ToolDef => t != null);
  }, [recent]);

  const currentTools = useMemo(() => {
    switch (tab) {
      case "Draw": return DRAW_TOOLS;
      case "Modify": return MODIFY_TOOLS;
      case "Annotate": return ANNOTATE_TOOLS;
      default: return DRAW_TOOLS;
    }
  }, [tab]);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = railRef.current?.getBoundingClientRect().width ?? width;

    const handleMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startXRef.current;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta));
      setWidth(next);
    };

    const handleUp = () => {
      setResizing(false);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  return (
    <div
      ref={railRef}
      className={`cad-left-rail ${collapsed ? "collapsed" : ""} ${resizing ? "resizing" : ""}`}
      style={collapsed ? undefined : { width: `${width}px`, minWidth: `${width}px` }}
    >
      <button
        className="cad-left-rail-resize"
        onMouseDown={startResize}
        title="Drag to resize"
        type="button"
        aria-label="Resize tool palette"
      >
        <GripVertical size={12} />
      </button>

      {collapsed ? (
        <div className="cad-left-rail-strip">
          <button
            className="cad-panel-collapse"
            onClick={() => setCollapsed(false)}
            title="Expand tool palette"
            type="button"
          >
            <ChevronRight size={14} />
          </button>
          <ActiveToolIcon tool={tool} />
        </div>
      ) : (
        <>
          <div className="cad-panel-header">
            <div className="cad-panel-title">Tools</div>
            <button
              className="cad-panel-collapse"
              onClick={() => setCollapsed(true)}
              title="Collapse tool palette"
              type="button"
            >
              <ChevronLeft size={14} />
            </button>
          </div>

          <div className="cad-tool-tabs" role="tablist" aria-label="Tool palette tabs">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={`cad-tool-tab ${tab === t ? "active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="cad-tool-list">
            {recentTools.length > 0 && (
              <div className="cad-tool-group cad-recent-group">
                <span className="cad-tool-group-label">Recent</span>
                <div className="cad-tool-group-grid">
                  {recentTools.map((t) => (
                    <ToolButton
                      key={t.id}
                      def={t}
                      active={tool === t.id}
                      onClick={() => onToolChange(t.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="cad-tool-group">
              <span className="cad-tool-group-label">{tab}</span>
              <div className="cad-tool-group-grid">
                {currentTools.map((t) => (
                  <ToolButton
                    key={t.id}
                    def={t}
                    active={tool === t.id}
                    onClick={() => onToolChange(t.id)}
                  />
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ActiveToolIcon({ tool }: { tool: CadToolId }) {
  const def = ALL_TOOLS.find((t) => t.id === tool);
  if (!def) return null;
  const Icon = def.icon;
  return (
    <div className="cad-left-rail-active" title={`Active: ${def.label}`}>
      <Icon size={18} />
    </div>
  );
}

function ToolButton({ def, active, onClick }: {
  def: ToolDef;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = def.icon;
  return (
    <button
      className={`cad-tool-btn ${active ? "active" : ""}`}
      onClick={onClick}
      type="button"
      title={`${def.label} (${def.shortcut}) — ${def.description}`}
    >
      <span className="cad-tool-btn-inner">
        <Icon size={16} />
        <span className="cad-tool-shortcut">{def.shortcut}</span>
      </span>
      <span className="cad-tool-label">{def.label}</span>
    </button>
  );
}
