import { useState } from "react";
import type { CadSelection, CadModelState } from "./cadModel.ts";
import { CAD_COLORS } from "./cadModel.ts";
import type { UseCadModel } from "./useCadModel.ts";
import {
  fmtArea, fmtBearing, fmtCoord, fmtDistance,
  type BearingFormat, type AngleEntryMode,
} from "./survey/format.ts";
import { inverse, polygonArea } from "./survey/cogo.ts";
import { CadCogoPanel } from "./CadCogoPanel.tsx";
import {
  Lock, LockOpen, ChevronRight, Layers, ListTree, MapPinned, Calculator,
  Plus, Trash2, Check, X, Pencil,
} from "lucide-react";

/** AutoCAD-style preset colours offered when recolouring a layer. */
const LAYER_COLOR_PRESETS = [
  "#ffffff", "#ff0000", "#ff7a00", "#ffff00", "#22c55e",
  "#22d3ee", "#3b82f6", "#a855f7", "#f43f5e", "#94a3b8",
];

type PanelTab = "layers" | "props" | "points" | "cogo";

interface CadRightPanelProps {
  cad: UseCadModel;
  model: CadModelState;
  selection: CadSelection;
  bearingFormat: BearingFormat;
  /** Angle entry convention used to interpret typed directions in COGO. */
  angleEntry: AngleEntryMode;
  log: (text: string, kind?: "info" | "error") => void;
}

const TAB_LABELS: Record<PanelTab, string> = {
  layers: "Layers",
  props: "Properties",
  points: "Points",
  cogo: "COGO",
};

const TAB_TOOLTIPS: Record<PanelTab, string> = {
  layers: "Manage layers and visibility",
  props: "View and edit entity properties",
  points: "Survey point table",
  cogo: "Coordinate geometry tools",
};

const TAB_ICONS = {
  layers: Layers,
  props: ListTree,
  points: MapPinned,
  cogo: Calculator,
} satisfies Record<PanelTab, typeof Layers>;

export function CadRightPanel({
  cad,
  model,
  selection,
  bearingFormat,
  angleEntry,
  log,
}: CadRightPanelProps) {
  const [tab, setTab] = useState<PanelTab>("layers");
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div className="cad-right-panel collapsed">
        <button
          className="cad-panel-collapse"
          onClick={() => setCollapsed(false)}
          title="Expand panel"
          type="button"
          style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="cad-right-panel">
      <div className="cad-panel-header cad-right-panel-header">
        <div>
          <div className="cad-panel-eyebrow">Inspector</div>
          <div className="cad-panel-title">{TAB_LABELS[tab]}</div>
        </div>
        <button
          className="cad-panel-collapse"
          onClick={() => setCollapsed(true)}
          title="Collapse panel"
          type="button"
        >
          <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
        </button>
      </div>
      <div className="cad-panel-tabs" role="tablist">
        {(["layers", "props", "points", "cogo"] as PanelTab[]).map((t) => {
          const Icon = TAB_ICONS[t];
          return (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`cad-panel-tab ${tab === t ? "active" : ""}`}
              onClick={() => setTab(t)}
              title={TAB_TOOLTIPS[t]}
              type="button"
            >
              <Icon size={14} />
              <span>{TAB_LABELS[t]}</span>
            </button>
          );
        })}
      </div>

      {tab === "layers" && <LayersTab cad={cad} model={model} />}
      {tab === "props" && <PropsTab cad={cad} model={model} selection={selection} bearingFormat={bearingFormat} />}
      {tab === "points" && <PointsTab cad={cad} model={model} />}
      {tab === "cogo" && <CadCogoPanel cad={cad} model={model} selection={selection} bearingFormat={bearingFormat} angleEntry={angleEntry} log={log} />}
    </div>
  );
}

function LayersTab({ cad, model }: { cad: UseCadModel; model: CadModelState }) {
  const activeLayer = model.layers.find((l) => l.id === model.activeLayerId);
  const visibleCount = model.layers.filter((l) => l.visible).length;

  // Inline rename: which layer is being edited and its draft name.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  // Which layer's colour palette is open.
  const [colorMenuId, setColorMenuId] = useState<string | null>(null);

  const beginRename = (id: string, current: string) => {
    setEditingId(id);
    setDraftName(current);
    setColorMenuId(null);
  };

  const commitRename = () => {
    if (editingId && draftName.trim()) cad.updateLayer(editingId, { name: draftName.trim() });
    setEditingId(null);
  };

  const handleDelete = (id: string, name: string) => {
    const count = cad.layerEntityCount(id);
    const msg = count > 0
      ? `Delete layer "${name}"? Its ${count} object${count === 1 ? "" : "s"} will move to another layer.`
      : `Delete layer "${name}"?`;
    if (window.confirm(msg)) {
      if (!cad.deleteLayer(id)) {
        window.alert("Cannot delete the last remaining layer.");
      }
    }
  };

  return (
    <div className="cad-panel-block">
      <div className="cad-panel-summary-grid">
        <div className="cad-summary-card">
          <span>Active</span>
          <strong>{activeLayer?.name ?? "None"}</strong>
        </div>
        <div className="cad-summary-card">
          <span>Visible</span>
          <strong>{visibleCount}/{model.layers.length}</strong>
        </div>
      </div>

      <div className="cad-layer-toolbar">
        <button
          type="button"
          className="cad-chip-btn"
          onClick={() => {
            const layer = cad.addLayer("");
            beginRename(layer.id, layer.name);
          }}
          title="Create a new layer and rename it"
        >
          <Plus size={12} /> New layer
        </button>
      </div>

      <div className="cad-layer-list">
        {model.layers.map((l) => {
          const isActive = model.activeLayerId === l.id;
          const isEditing = editingId === l.id;
          const count = cad.layerEntityCount(l.id);
          return (
            <div key={l.id} className={`cad-layer-row ${isActive ? "active-layer" : ""}`}>
              <input
                type="checkbox"
                checked={l.visible}
                onChange={() => cad.toggleLayerVisible(l.id)}
                title={l.visible ? "Hide layer" : "Show layer"}
              />

              <div className="cad-layer-swatch-wrap">
                <button
                  type="button"
                  className="cad-layer-swatch"
                  style={{ background: l.color }}
                  onClick={() => setColorMenuId((id) => (id === l.id ? null : l.id))}
                  title="Change layer colour"
                  aria-label={`Change colour of layer ${l.name}`}
                />
                {colorMenuId === l.id && (
                  <div className="cad-layer-color-menu" role="menu">
                    {LAYER_COLOR_PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className="cad-layer-color-chip"
                        style={{ background: c }}
                        onClick={() => { cad.updateLayer(l.id, { color: c }); setColorMenuId(null); }}
                        title={c}
                        aria-label={`Set colour ${c}`}
                      />
                    ))}
                  </div>
                )}
              </div>

              {isEditing ? (
                <input
                  className="input-field cad-layer-name-input"
                  value={draftName}
                  autoFocus
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                    else if (e.key === "Escape") { setEditingId(null); }
                  }}
                />
              ) : (
                <button
                  className="cad-layer-name"
                  type="button"
                  onClick={() => cad.setActiveLayer(l.id)}
                  onDoubleClick={() => beginRename(l.id, l.name)}
                  title="Click to make active · double-click to rename"
                >
                  {l.name}
                  <span className="cad-layer-count">{count}</span>
                </button>
              )}

              {isEditing ? (
                <button className="cad-layer-icon-btn" type="button" onMouseDown={(e) => e.preventDefault()}
                  onClick={commitRename} title="Save name">
                  <Check size={12} />
                </button>
              ) : (
                <button className="cad-layer-icon-btn" type="button" onClick={() => beginRename(l.id, l.name)}
                  title="Rename layer">
                  <Pencil size={12} />
                </button>
              )}

              <button className="cad-layer-icon-btn" type="button" onClick={() => cad.toggleLayerLocked(l.id)}
                title={l.locked ? "Unlock layer" : "Lock layer"}>
                {l.locked ? <Lock size={12} /> : <LockOpen size={12} />}
              </button>

              <button
                className="cad-layer-icon-btn cad-layer-delete"
                type="button"
                onClick={() => handleDelete(l.id, l.name)}
                disabled={model.layers.length <= 1}
                title={model.layers.length <= 1 ? "At least one layer is required" : "Delete layer"}
              >
                {model.layers.length <= 1 ? <X size={12} /> : <Trash2 size={12} />}
              </button>
            </div>
          );
        })}
      </div>
      <p className="cad-panel-hint">
        Click a name to set the active layer; double-click (or the pencil) to rename. Use the swatch to recolour,
        the lock to freeze edits, and the checkbox to hide. Locked layers stay visible but can't be selected or edited.
      </p>
    </div>
  );
}

function PropsTab({
  cad,
  model,
  selection,
  bearingFormat,
}: {
  cad: UseCadModel;
  model: CadModelState;
  selection: CadSelection;
  bearingFormat: BearingFormat;
}) {
  const selCount = selection.items?.length ?? (selection.id ? 1 : 0);

  // Multiple objects selected → show a bulk editor (colour + delete), AutoCAD-style.
  if (selCount > 1) {
    return (
      <div className="cad-panel-block">
        <div className="cad-panel-title" style={{ padding: 0 }}>{selCount} objects selected</div>
        <ColorRow
          value={null}
          onChange={(c) => cad.setColorOfSelection(c)}
        />
        <button
          className="cad-chip-btn"
          type="button"
          onClick={() => {
            for (const it of selection.items ?? []) {
              if (it.type === "point") cad.deletePoint(it.id);
              else if (it.type === "linework") cad.deleteLinework(it.id);
              else if (it.type === "text") cad.deleteText(it.id);
              else if (it.type === "surface") cad.deleteSurface(it.id);
            }
          }}
        >
          Delete {selCount} objects
        </button>
        <p className="cad-panel-hint">Bulk-edit colour, or delete the whole selection. Pick a single object to edit its geometry.</p>
      </div>
    );
  }

  if (selection.type === "point" && selection.id) {
    const p = model.points.find((x) => x.id === selection.id);
    if (!p) return <EmptyProps />;
    return (
      <div className="cad-panel-block">
        <div className="cad-panel-title" style={{ padding: 0 }}>Point {p.pointNo}</div>
        <EditableRow key={`${p.id}-ptno`} label="Pt #" value={p.pointNo} onChange={(v) => cad.updatePoint(p.id, { pointNo: v })} />
        <EditableRow key={`${p.id}-e`} label="Y (Easting)" value={String(p.e)} numeric onChange={(v) => cad.updatePoint(p.id, { e: parseFloat(v) || 0 })} />
        <EditableRow key={`${p.id}-n`} label="X (Northing)" value={String(p.n)} numeric onChange={(v) => cad.updatePoint(p.id, { n: parseFloat(v) || 0 })} />
        <EditableRow key={`${p.id}-z`} label="H (Height/RL)" value={p.z == null ? "" : String(p.z)} numeric
          onChange={(v) => cad.updatePoint(p.id, { z: v === "" ? null : parseFloat(v) })} />
        <EditableRow key={`${p.id}-code`} label="Code" value={p.code} onChange={(v) => cad.updatePoint(p.id, { code: v })} />
        <ColorRow value={p.color ?? null} onChange={(c) => cad.updatePoint(p.id, { color: c })} />
        <button className="cad-chip-btn" type="button" onClick={() => cad.deletePoint(p.id)}>Delete point</button>
      </div>
    );
  }

  if (selection.type === "linework" && selection.id) {
    const lw = model.linework.find((x) => x.id === selection.id);
    if (!lw) return <EmptyProps />;
    let length = 0;
    for (let i = 1; i < lw.vertices.length; i++) {
      length += inverse(lw.vertices[i - 1], lw.vertices[i]).distance;
    }
    const area = lw.closed ? polygonArea(lw.vertices) : 0;
    return (
      <div className="cad-panel-block">
        <div className="cad-panel-title" style={{ padding: 0 }}>{lw.kind} ({lw.vertices.length} pts)</div>
        <div className="cad-prop-list">
          <div><span>Length</span><strong>{fmtDistance(length)} m</strong></div>
          {lw.closed && <div><span>Area</span><strong>{fmtArea(area)}</strong></div>}
          {lw.vertices.length >= 2 && (
            <div><span>Start bearing</span><strong>{fmtBearing(inverse(lw.vertices[0], lw.vertices[1]).azimuth, bearingFormat)}</strong></div>
          )}
        </div>
        <ColorRow value={lw.color ?? null} onChange={(c) => cad.updateLinework(lw.id, { color: c })} />
        <button className="cad-chip-btn" type="button" onClick={() => cad.deleteLinework(lw.id)}>Delete linework</button>
      </div>
    );
  }

  if (selection.type === "text" && selection.id) {
    const t = model.texts.find((x) => x.id === selection.id);
    if (!t) return <EmptyProps />;
    return (
      <div className="cad-panel-block">
        <div className="cad-panel-title" style={{ padding: 0 }}>Text</div>
        <EditableRow key={`${t.id}-text`} label="Content" value={t.text} onChange={(v) => cad.updateText(t.id, { text: v })} />
        <ColorRow value={t.color ?? null} onChange={(c) => cad.updateText(t.id, { color: c })} />
        <button className="cad-chip-btn" type="button" onClick={() => cad.deleteText(t.id)}>Delete text</button>
      </div>
    );
  }

  if (selection.type === "surface" && selection.id) {
    const srf = model.surfaces.find((x) => x.id === selection.id);
    if (!srf) return <EmptyProps />;
    let planArea = 0;
    for (const tri of srf.triangles) {
      const a = srf.points[tri.a];
      const b = srf.points[tri.b];
      const c = srf.points[tri.c];
      if (a && b && c) planArea += polygonArea([a, b, c]);
    }
    return (
      <div className="cad-panel-block">
        <div className="cad-panel-title" style={{ padding: 0 }}>{srf.name}</div>
        <div className="cad-prop-list">
          <div><span>Triangles</span><strong>{srf.triangles.length}</strong></div>
          <div><span>Points</span><strong>{srf.points.length}</strong></div>
          <div><span>Plan area</span><strong>{fmtArea(planArea)}</strong></div>
        </div>
        <label className="cad-edit-row">
          <span>Visible</span>
          <input type="checkbox" checked={srf.visible} onChange={() => cad.toggleSurfaceVisible(srf.id)} />
        </label>
        <button className="cad-chip-btn" type="button" onClick={() => cad.deleteSurface(srf.id)}>Delete surface</button>
      </div>
    );
  }

  return <EmptyProps />;
}

/** Colour selector row used in the Properties panel (ByLayer + explicit). */
function ColorRow({ value, onChange }: { value: string | null; onChange: (c: string | null) => void }) {
  return (
    <label className="cad-edit-row">
      <span>Colour</span>
      <select
        className="input-field"
        value={value ?? "bylayer"}
        onChange={(e) => onChange(e.target.value === "bylayer" ? null : e.target.value)}
      >
        {CAD_COLORS.map((c) => (
          <option key={c.label} value={c.value ?? "bylayer"}>{c.label}</option>
        ))}
      </select>
    </label>
  );
}

function EmptyProps() {
  return (
    <div className="cad-panel-block" style={{ alignItems: "center", justifyContent: "center" }}>
      <p className="cad-panel-hint" style={{ textAlign: "center" }}>
        No entity selected<br />
        <span style={{ fontSize: 10 }}>Select a point, linework, or text annotation to view its properties.</span>
      </p>
    </div>
  );
}

function PointsTab({ cad, model }: { cad: UseCadModel; model: CadModelState }) {
  return (
    <div className="cad-panel-block">
      <div className="cad-panel-title" style={{ padding: 0 }}>Point Table ({model.points.length})</div>
      <div className="cad-point-table-wrap">
        <table className="cad-point-table">
          <thead>
            <tr><th>Pt</th><th>Y</th><th>X</th><th>H</th><th>Code</th></tr>
          </thead>
          <tbody>
            {model.points.map((p) => (
              <tr key={p.id} className={cad.selection.id === p.id ? "selected" : ""}
                onClick={() => cad.setSelection({ type: "point", id: p.id })}>
                <td>{p.pointNo}</td>
                <td>{fmtCoord(p.e, 2)}</td>
                <td>{fmtCoord(p.n, 2)}</td>
                <td>{p.z == null ? "—" : fmtCoord(p.z, 2)}</td>
                <td>{p.code}</td>
              </tr>
            ))}
            {model.points.length === 0 && (
              <tr><td colSpan={5} className="cad-point-table-empty">No points yet. Use the Point tool or Import CSV.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditableRow({
  label,
  value,
  onChange,
  numeric,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  numeric?: boolean;
}) {
  const [local, setLocal] = useState(value);

  const commit = () => {
    if (numeric && local.trim() !== "" && !Number.isFinite(parseFloat(local))) {
      setLocal(value);
      return;
    }
    onChange(local);
  };

  return (
    <label className="cad-edit-row">
      <span>{label}</span>
      <input
        className="input-field"
        inputMode={numeric ? "decimal" : "text"}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
      />
    </label>
  );
}
