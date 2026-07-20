import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import type { CadToolId } from "./cadModel.ts";
import {
  MousePointer2, Hand, MapPin, PenLine, Waypoints, Pentagon, Type, Ruler,
} from "lucide-react";

interface CadToolBarProps {
  tool: CadToolId;
  onToolChange: (tool: CadToolId) => void;
}

interface ToolDef {
  id: CadToolId;
  label: string;
  shortLabel: string;
  icon: ComponentType<{ size?: number | string }>;
  shortcut: string;
  description: string;
}

interface ToolGroup {
  label: string;
  tools: ToolDef[];
}

const TOOL_GROUPS: ToolGroup[] = [
  {
    label: "Navigate",
    tools: [
      { id: "select", label: "Select", shortLabel: "Sel", icon: MousePointer2, shortcut: "S", description: "Select and inspect entities" },
      { id: "pan", label: "Pan", shortLabel: "Pan", icon: Hand, shortcut: "P", description: "Pan the viewport" },
    ],
  },
  {
    label: "Draw",
    tools: [
      { id: "point", label: "Point", shortLabel: "Pt", icon: MapPin, shortcut: "O", description: "Place a survey point" },
      { id: "line", label: "Line", shortLabel: "Line", icon: PenLine, shortcut: "L", description: "Draw line segments" },
      { id: "polyline", label: "Polyline", shortLabel: "Poly", icon: Waypoints, shortcut: "Y", description: "Multi-segment polyline" },
      { id: "boundary", label: "Boundary", shortLabel: "Bnd", icon: Pentagon, shortcut: "B", description: "Draw closed boundary" },
    ],
  },
  {
    label: "Label",
    tools: [
      { id: "text", label: "Text", shortLabel: "Text", icon: Type, shortcut: "T", description: "Place annotation text" },
      { id: "measure", label: "Measure", shortLabel: "Meas", icon: Ruler, shortcut: "M", description: "Measure distance and bearing" },
    ],
  },
];

const MAX_RECENT = 3;

export function CadToolBar({ tool, onToolChange }: CadToolBarProps) {
  const [recent, setRecent] = useState<CadToolId[]>([]);
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

  const recentDefs = recent
    .map((id) => TOOL_GROUPS.flatMap((g) => g.tools).find((t) => t.id === id))
    .filter((t): t is ToolDef => t != null);

  const recentIds = new Set(recent);

  return (
    <div className="cad-toolbar" role="toolbar" aria-label="Drawing tools">
      <div className="cad-toolbar-scroll">
        {recentDefs.length > 0 && (
          <div className="cad-toolbar-group cad-toolbar-recent">
            <span className="cad-toolbar-group-label">Recent</span>
            <div className="cad-toolbar-items">
              {recentDefs.map((t) => (
                <ToolBarBtn
                  key={t.id}
                  def={t}
                  active={tool === t.id}
                  onClick={() => onToolChange(t.id)}
                />
              ))}
            </div>
          </div>
        )}

        {TOOL_GROUPS.map((group) => {
          const visible = group.tools.filter((t) => !recentIds.has(t.id));
          if (visible.length === 0) return null;
          return (
            <div className="cad-toolbar-group" key={group.label}>
              <span className="cad-toolbar-group-label">{group.label}</span>
              <div className="cad-toolbar-items">
                {visible.map((t) => (
                  <ToolBarBtn
                    key={t.id}
                    def={t}
                    active={tool === t.id}
                    onClick={() => onToolChange(t.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToolBarBtn({ def, active, onClick }: {
  def: ToolDef;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = def.icon;
  return (
    <button
      className={`cad-toolbar-btn ${active ? "active" : ""}`}
      onClick={onClick}
      title={`${def.label} (${def.shortcut}) — ${def.description}`}
      type="button"
    >
      <Icon size={13} />
      <span className="cad-toolbar-btn-key">{def.shortcut}</span>
      <span className="cad-toolbar-btn-label">{def.shortLabel}</span>
    </button>
  );
}
