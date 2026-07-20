import { useCallback, useMemo, useRef, useState } from "react";
import type { HubProject } from "../../../pages/shared/ProjectHubPage.tsx";
import "../../../styles/cad.css";

import type { CadSelection, CadToolId } from "./cad/cadModel.ts";
import { CAD_COLORS } from "./cad/cadModel.ts";
import { useCadModel } from "./cad/useCadModel.ts";
import { useCadSettings } from "./cad/useCadSettings.ts";
import { useCadLayouts } from "./cad/useCadLayouts.ts";
import { MODEL_TAB } from "./cad/cadLayouts.ts";
import { runCommand } from "./cad/useCadCommands.ts";
import {
  intersectionBearingBearing,
  intersectionDistanceDistance,
  type NE,
} from "./cad/survey/cogo.ts";

import { CadRibbon } from "./cad/CadRibbon.tsx";
import { CadMenuBar } from "./cad/CadMenuBar.tsx";
import type { CadMenuAction } from "./cad/CadMenuBar.tsx";
import { CadToolDropdown } from "./cad/CadToolDropdown.tsx";
import { CadViewport } from "./cad/CadViewport.tsx";
import { Cad3dViewport } from "./cad/Cad3dViewport.tsx";
import { CadRightPanel } from "./cad/CadRightPanel.tsx";
import { CadSettingsPopover } from "./cad/CadSettingsPanel.tsx";
import { CadStatusBar } from "./cad/CadStatusBar.tsx";
import { CadCommandLine, type CommandLogEntry } from "./cad/CadCommandLine.tsx";
import { CadPlotDialog } from "./cad/CadPlotDialog.tsx";
import {
  DEFAULT_PLOT_OPTIONS,
  DEFAULT_TITLE_BLOCK,
  buildPlotSvg,
  openPlotWindow,
  type PlotOptions,
} from "./cad/io/plot.ts";
import { SlidersHorizontal, Box, Square } from "lucide-react";

import { parsePointsCsv, pointsToCsv } from "./cad/io/csv.ts";
import { modelToDxf, downloadText } from "./cad/io/dxf.ts";
import { buildSurveyReport, buildCutFillReport, openReportWindow } from "./cad/io/report.ts";
import { toGeoModel } from "./cad/io/geojson.ts";
import {
  modelToGeoJson,
  modelFromGeoJson,
  convexHull,
  simplify as simplifyLine,
  lastGeomBackend,
} from "./cad/survey/geomBridge.ts";
import { reproject, lastReprojectBackend } from "./cad/survey/reprojectBridge.ts";
import { PROJECTION_PRESETS } from "./cad/survey/projection.ts";
import {
  buildTin,
  buildConstrainedTin,
  generateContours,
  volumeToElevation,
  volumeBetween,
  cutFillToElevation,
  cutFillBetween,
  lastBackend,
  type SurfacePoint3,
  type SurfaceConstraint,
} from "./cad/survey/tinBridge.ts";
import { buildCodeTable } from "./cad/survey/featureCodes.ts";
import { buildFeatureStrings } from "./cad/survey/fieldToFinish.ts";
import { sampleZ } from "./cad/survey/surface.ts";
import { analyseTerrain, terrainStats, slopeColor, lastTerrainBackend } from "./cad/survey/terrainBridge.ts";
import { inverse, polygonArea, polylineLength } from "./cad/survey/cogo.ts";
import { buildTerrainReport } from "./cad/io/report.ts";
import { fmtArea, fmtBearing, fmtDistance } from "./cad/survey/format.ts";

interface CadWorkspaceProps {
  activeProject: HubProject;
  workspaceId: string;
  setProjectMobileMenuOpen: (v: boolean) => void;
  exitCadWorkspace: () => void;
}

/** Tools that build multi-vertex linework, committed on double-click / Enter / right-click. */
const LINEWORK_TOOLS: Record<string, "line" | "polyline" | "boundary"> = {
  line: "line",
  polyline: "polyline",
  boundary: "boundary",
};

let logCounter = 0;

export function CadWorkspace({
  activeProject,
  workspaceId,
  setProjectMobileMenuOpen,
  exitCadWorkspace,
}: CadWorkspaceProps) {
  const cad = useCadModel(activeProject.dbId, workspaceId);
  const { model, selection } = cad;

  const settingsApi = useCadSettings(activeProject.dbId);
  const { settings } = settingsApi;
  const { bearingFormat, snap, ortho, showGrid, osnap, view3d } = settings;

  const [tool, setTool] = useState<CadToolId>("select");
  const [ribbonTab, setRibbonTab] = useState<string>("Home");

  /** Active drawing colour for new geometry. null = ByLayer (AutoCAD default). */
  const [activeColor, setActiveColor] = useState<string | null>(null);

  /** Whether the drawing-settings popover (anchored to the top-bar gear) is open. */
  const [settingsOpen, setSettingsOpen] = useState(false);

  /** Whether the plot/layout dialog is open. */
  const [plotOpen, setPlotOpen] = useState(false);

  const [cursor, setCursor] = useState<{ n: number; e: number } | null>(null);
  const [scaleLabel, setScaleLabel] = useState("1 m");
  const [fitSignal, setFitSignal] = useState(0);
  /** Bumped to push a target scale (px per survey unit) into the viewport. */
  const [scaleSignal, setScaleSignal] = useState(0);
  const [scaleTarget, setScaleTarget] = useState<number | undefined>(undefined);

  const [pendingVertices, setPendingVertices] = useState<{ n: number; e: number }[]>([]);
  const [lastTool, setLastTool] = useState<CadToolId>("select");
  const [commandLog, setCommandLog] = useState<CommandLogEntry[]>([
    { id: ++logCounter, kind: "info", text: `Engineering Surveyor CAD ready — ${activeProject.name}` },
    { id: ++logCounter, kind: "info", text: "Pick a tool or type a command. Enter / right-click to finish linework." },
  ]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const geojsonInputRef = useRef<HTMLInputElement>(null);

  const datum = activeProject.datum || "No datum set";

  // Title-block seed (project metadata) for both the ad-hoc plot dialog and the
  // persistent AutoCAD-style layouts.
  const titleSeed = useMemo(
    () =>
      DEFAULT_TITLE_BLOCK(
        activeProject.name,
        activeProject.id,
        activeProject.client ?? "",
        activeProject.datum ?? "",
      ),
    [activeProject.name, activeProject.id, activeProject.client, activeProject.datum],
  );

  // AutoCAD-style layouts (paper space). Switching to a layout tab presents the
  // model on a to-scale sheet; "Model" returns to full-size drawing.
  const layoutApi = useCadLayouts(activeProject.dbId, titleSeed);

  // Seed the plot dialog from project metadata and the current drafting prefs.
  // It is only used as the dialog's initial state, so recomputing on each open
  // (rather than live) is intentional.
  const plotOptions = useMemo<PlotOptions>(() => {
    const base = DEFAULT_PLOT_OPTIONS(titleSeed);
    return {
      ...base,
      bearingFormat,
      axisConvention: settings.axisConvention,
      showPointLabels: settings.showPointLabels,
      showSegmentLabels: settings.showSegmentLabels,
      showGrid: settings.showGrid,
      scaleDenominator: "fit",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleSeed, plotOpen]);

  const log = useCallback((text: string, kind: CommandLogEntry["kind"] = "info") => {
    setCommandLog((prev) => [...prev.slice(-40), { id: ++logCounter, kind, text }]);
  }, []);

  const fitExtents = useCallback(() => {
    setFitSignal((s) => s + 1);
  }, []);

  const hasGeometry = useCallback(
    () =>
      model.points.length > 0 ||
      model.linework.length > 0 ||
      model.texts.length > 0 ||
      model.surfaces.length > 0,
    [model.points.length, model.linework.length, model.texts.length, model.surfaces.length],
  );

  /**
   * Enter paper space (AutoCAD "Layout"). Activates the current layout tab, or
   * the first layout if Model is active, creating one if none exist yet.
   */
  const openLayout = useCallback(() => {
    if (!hasGeometry()) {
      log("Plot: nothing to lay out yet — draw or import some geometry first.", "error");
      return;
    }
    if (layoutApi.active !== MODEL_TAB) return; // already in a layout
    const first = layoutApi.layouts[0];
    if (first) layoutApi.setActive(first.id);
    else layoutApi.add();
  }, [hasGeometry, layoutApi, log]);

  const handleSelectTab = useCallback(
    (tab: string) => {
      if (tab !== MODEL_TAB && !hasGeometry()) {
        log("Layout: nothing to lay out yet — draw or import some geometry first.", "error");
        return;
      }
      layoutApi.setActive(tab);
      if (tab === MODEL_TAB) log("Switched to Model space.");
      else {
        const l = layoutApi.layouts.find((x) => x.id === tab);
        if (l) log(`Switched to layout "${l.name}" (paper space).`);
      }
    },
    [hasGeometry, layoutApi, log],
  );

  const handleAddLayout = useCallback(() => {
    const created = layoutApi.add();
    if (created) log(`Created layout "${created.name}".`);
  }, [layoutApi, log]);

  /**
   * PLOT command: open the to-scale print/PDF window for the current sheet.
   * Uses the active layout's saved options when in paper space, otherwise the
   * ad-hoc plot defaults (and shows the dialog so the user can also tweak it).
   */
  const requestPlot = useCallback(() => {
    if (!hasGeometry()) {
      log("PLOT: nothing to plot yet — draw or import some geometry first.", "error");
      return;
    }
    const active = layoutApi.activeLayout;
    if (active) {
      const result = buildPlotSvg(model, {
        ...active.options,
        bearingFormat,
        axisConvention: settings.axisConvention,
      });
      openPlotWindow(result, `${active.options.titleBlock.drawingTitle} — ${active.name}`);
      log(`Plotting "${active.name}" — ${active.options.paper}, 1:${result.denominator}.`);
    } else {
      setPlotOpen(true);
    }
  }, [hasGeometry, layoutApi.activeLayout, model, bearingFormat, settings.axisConvention, log]);

  /**
   * Apply a plotting scale 1:`denominator` to the viewport. We map ground
   * metres to screen pixels at a standard 96 dpi (1 px ≈ 0.0254/96 m on paper),
   * so px-per-ground-unit = 96 / 0.0254 / denominator. This makes "1:500"
   * render at the conventional on-screen size; the scale bar confirms it.
   */
  const applyScale = useCallback((denominator: number) => {
    if (!Number.isFinite(denominator) || denominator <= 0) {
      log("Scale: enter a positive denominator (e.g. 500 for 1:500).", "error");
      return;
    }
    const pxPerMetrePaper = 96 / 0.0254; // ≈ 3779.5 px per paper metre at 96 dpi
    const pxPerGroundUnit = pxPerMetrePaper / denominator;
    settingsApi.update({ scaleDenominator: Math.round(denominator) });
    setScaleTarget(pxPerGroundUnit);
    setScaleSignal((s) => s + 1);
    log(`Scale set to 1:${Math.round(denominator)}.`);
  }, [settingsApi, log]);

  const isDrawingTool = LINEWORK_TOOLS[tool] != null || tool === "point" || tool === "text" || tool === "measure";

  const commitPending = useCallback(
    (closeChain = false) => {
      // LINE: AutoCAD draws a separate line entity per segment, all sharing
      // their endpoints. Commit one "line" per consecutive vertex pair.
      if (tool === "line") {
        setPendingVertices((verts) => {
          if (verts.length < 2) {
            if (verts.length > 0) log("Cancelled (a line needs at least 2 points).", "info");
            return [];
          }
          const pairs = closeChain ? verts.length : verts.length - 1;
          let last = null as ReturnType<typeof cad.addLinework> | null;
          for (let i = 0; i < pairs; i++) {
            const a = verts[i];
            const b = verts[(i + 1) % verts.length];
            last = cad.addLinework({ kind: "line", vertices: [a, b], closed: false, color: activeColor });
          }
          log(`${pairs} line segment${pairs === 1 ? "" : "s"} created${closeChain ? " (closed)" : ""}.`);
          if (last) cad.setSelection({ type: "linework", id: last.id });
          return [];
        });
        return;
      }

      const kind = tool === "polyline" ? "polyline" : tool === "boundary" ? "boundary" : null;
      if (!kind) {
        setPendingVertices([]);
        return;
      }
      setPendingVertices((verts) => {
        if (verts.length < 2) {
          if (verts.length > 0) log("Linework needs at least 2 vertices.", "error");
          return [];
        }
        const closed = kind === "boundary" || closeChain;
        const created = cad.addLinework({ kind, vertices: verts, closed, color: activeColor });
        log(`${kind} created (${verts.length} vertices)${closed ? ", closed" : ""}.`);
        cad.setSelection({ type: "linework", id: created.id });
        return [];
      });
    },
    [tool, cad, log, activeColor],
  );

  const cancelPending = useCallback(() => {
    setPendingVertices((verts) => {
      if (verts.length) log("Cancelled.", "info");
      return [];
    });
  }, [log]);

  const handlePickPoint = useCallback(
    (world: { n: number; e: number }) => {
      // Block drawing onto a locked active layer (AutoCAD convention).
      const drawsToActiveLayer =
        tool === "point" || tool === "text" || tool === "line" || tool === "polyline" || tool === "boundary";
      if (drawsToActiveLayer) {
        const active = cad.layerById(model.activeLayerId);
        if (active?.locked) {
          log(`Layer "${active.name}" is locked. Unlock it or pick another active layer to draw.`, "error");
          return;
        }
      }
      if (tool === "point") {
        const created = cad.addPoint({ pointNo: cad.nextPointNo(), n: world.n, e: world.e, z: null, code: "", color: activeColor });
        log(`Point ${created.pointNo} placed: Y ${world.e.toFixed(3)} X ${world.n.toFixed(3)}`);
        return;
      }
      if (tool === "text") {
        const value = window.prompt("Annotation text:");
        if (value && value.trim()) {
          cad.addText({ n: world.n, e: world.e, text: value.trim(), color: activeColor });
          log(`Text placed: "${value.trim()}"`);
        }
        return;
      }
      // AutoCAD-style Line / Polyline / Boundary: build a continuous chain of
      // vertices. The segments are previewed live and committed on Enter /
      // double-click / right-click (see commitPending). Backspace removes the
      // last vertex; "C" closes the chain.
      if (tool === "line" || tool === "polyline" || tool === "boundary") {
        setPendingVertices((verts) => [...verts, world]);
        return;
      }
      // MOVE / COPY: pick a base point, then a destination. The delta between
      // them translates (Move) or duplicates (Copy) the current selection.
      if (tool === "move" || tool === "copy") {
        const hasSel = (cad.selection.items?.length ?? (cad.selection.id ? 1 : 0)) > 0;
        if (!hasSel) {
          log(`${tool === "move" ? "Move" : "Copy"}: select objects first (use Select), then pick base point.`, "error");
          return;
        }
        setPendingVertices((verts) => {
          const next = [...verts, world];
          if (next.length === 2) {
            const dn = next[1].n - next[0].n;
            const de = next[1].e - next[0].e;
            const count = cad.transformSelection(dn, de, tool === "copy");
            const dist = Math.hypot(dn, de);
            log(`${tool === "copy" ? "Copied" : "Moved"} ${count} object${count === 1 ? "" : "s"} — ${dist.toFixed(3)} m.`);
            return [];
          }
          log("Specify destination point:");
          return next;
        });
        return;
      }

      if (tool === "spot-height") {
        // Find the elevation at this point. First check if we snapped to a point with a Z value.
        let z = undefined;
        // If the user snapped directly to a point, we could use its Z, but we don't have the snap hit here.
        // Instead, search points near the click if needed, or simply always sample the active surface.
        if (model.surfaces.length > 0) {
          const surface = model.surfaces[model.surfaces.length - 1]; // Use latest surface
          const sampled = sampleZ({ points: surface.points, triangles: surface.triangles }, world.n, world.e);
          if (sampled !== null) {
            z = sampled;
          }
        }
        if (z === undefined) {
          log("Spot Height: Click inside a TIN surface to sample elevation.", "error");
          return;
        }
        const text = `RL ${z.toFixed(settings.coordDecimals)}`;
        cad.addText({ n: world.n, e: world.e, text, color: activeColor, layerId: "SPOT_HEIGHTS" });
        log(`Spot Height placed: ${text}`);
        return;
      }

      if (tool === "measure") {
        setPendingVertices((verts) => {
          const next = [...verts, world];
          if (next.length === 2) {
            const dn = next[1].n - next[0].n;
            const de = next[1].e - next[0].e;
            const dist = Math.hypot(dn, de);
            let az = (Math.atan2(de, dn) * 180) / Math.PI;
            if (az < 0) az += 360;
            const dnAbs = Math.abs(dn);
            const deAbs = Math.abs(de);
            log(`Measure: ${dist.toFixed(3)} m @ ${az.toFixed(4)}°  dX:${dnAbs.toFixed(3)}  dY:${deAbs.toFixed(3)}`);
            return [];
          }
          return next;
        });
      }
    },
    [tool, cad, log, activeColor, model.activeLayerId],
  );

  const handleSelectEntity = useCallback(
    (sel: CadSelection) => {
      cad.setSelection(sel);
      const count = sel.items?.length ?? (sel.type ? 1 : 0);
      if (count > 1) log(`Selected ${count} objects.`);
      else if (sel.type) log(`Selected ${sel.type}.`);
    },
    [cad, log],
  );

  const changeTool = useCallback((t: CadToolId) => {
    setPendingVertices([]);
    setLastTool(t);
    setTool(t);
  }, []);

  const repeatLastTool = useCallback(() => {
    changeTool(lastTool);
  }, [lastTool, changeTool]);

  const deleteSelection = useCallback(() => {
    const sel = cad.selection;
    const items = sel.items && sel.items.length
      ? sel.items
      : sel.type && sel.id
        ? [{ type: sel.type, id: sel.id }]
        : [];
    if (items.length === 0) {
      log("Nothing selected to delete.", "error");
      return;
    }
    for (const it of items) {
      if (it.type === "point") cad.deletePoint(it.id);
      else if (it.type === "linework") cad.deleteLinework(it.id);
      else if (it.type === "text") cad.deleteText(it.id);
      else if (it.type === "surface") cad.deleteSurface(it.id);
    }
    log(`Deleted ${items.length} object${items.length === 1 ? "" : "s"}.`);
  }, [cad, log]);

  /** Select every visible entity (Ctrl+A). */
  const selectAll = useCallback(() => {
    const items = [
      ...model.points.map((p) => ({ type: "point" as const, id: p.id })),
      ...model.linework.map((l) => ({ type: "linework" as const, id: l.id })),
      ...model.texts.map((t) => ({ type: "text" as const, id: t.id })),
      ...model.surfaces.map((s) => ({ type: "surface" as const, id: s.id })),
    ];
    if (items.length === 0) { log("Nothing to select.", "info"); return; }
    const primary = items[items.length - 1];
    cad.setSelection({ type: primary.type, id: primary.id, items });
    log(`Selected ${items.length} object${items.length === 1 ? "" : "s"}.`);
  }, [model.points, model.linework, model.texts, model.surfaces, cad, log]);

  const findPoint = useCallback(
    (pno: string): NE | null => {
      const p = model.points.find((x) => x.pointNo === pno.trim());
      return p ? { n: p.n, e: p.e } : null;
    },
    [model.points],
  );

  const runIntersection = useCallback(() => {
    const mode = window.prompt("Intersection type — 'BB' (bearing-bearing) or 'DD' (distance-distance):", "BB");
    if (!mode) return;
    const m = mode.trim().toUpperCase();
    if (m === "BB") {
      const p1no = window.prompt("From point 1 (Pt #):");
      const az1 = window.prompt("Azimuth from point 1 (deg):");
      const p2no = window.prompt("From point 2 (Pt #):");
      const az2 = window.prompt("Azimuth from point 2 (deg):");
      const p1 = p1no ? findPoint(p1no) : null;
      const p2 = p2no ? findPoint(p2no) : null;
      if (!p1 || !p2 || az1 == null || az2 == null) { log("Intersection: invalid input.", "error"); return; }
      const res = intersectionBearingBearing(p1, parseFloat(az1), p2, parseFloat(az2));
      if (!res) { log("Intersection: rays are parallel.", "error"); return; }
      const created = cad.addPoint({ pointNo: cad.nextPointNo(), n: res.n, e: res.e, z: null, code: "INT", color: activeColor });
      log(`Intersection point ${created.pointNo}: N ${res.n.toFixed(3)} E ${res.e.toFixed(3)}`);
    } else if (m === "DD") {
      const p1no = window.prompt("From point 1 (Pt #):");
      const r1 = window.prompt("Distance from point 1 (m):");
      const p2no = window.prompt("From point 2 (Pt #):");
      const r2 = window.prompt("Distance from point 2 (m):");
      const p1 = p1no ? findPoint(p1no) : null;
      const p2 = p2no ? findPoint(p2no) : null;
      if (!p1 || !p2 || r1 == null || r2 == null) { log("Intersection: invalid input.", "error"); return; }
      const sols = intersectionDistanceDistance(p1, parseFloat(r1), p2, parseFloat(r2));
      if (!sols.length) { log("Intersection: circles do not intersect.", "error"); return; }
      for (const s of sols) {
        const created = cad.addPoint({ pointNo: cad.nextPointNo(), n: s.n, e: s.e, z: null, code: "INT", color: activeColor });
        log(`Intersection point ${created.pointNo}: N ${s.n.toFixed(3)} E ${s.e.toFixed(3)}`);
      }
    } else {
      log("Intersection: choose BB or DD.", "error");
    }
  }, [cad, findPoint, log, activeColor]);

  const handleImportCsv = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? "");
        const result = parsePointsCsv(text);
        const count = cad.importPoints(result.points, model.activeLayerId);
        log(`Imported ${count} point(s)${result.skipped ? `, skipped ${result.skipped}` : ""}.`);
        result.errors.slice(0, 3).forEach((e) => log(e, "error"));
        fitExtents();
      };
      reader.onerror = () => log("Failed to read CSV file.", "error");
      reader.readAsText(file);
    },
    [cad, model.activeLayerId, log, fitExtents],
  );

  const exportDxf = useCallback(() => {
    if (!model.points.length && !model.linework.length && !model.texts.length) {
      log("Nothing to export.", "error");
      return;
    }
    const dxf = modelToDxf(model);
    const safe = activeProject.id.replace(/[^a-z0-9_-]/gi, "_");
    downloadText(`${safe}.dxf`, dxf, "application/dxf");
    log("Exported DXF.");
  }, [model, activeProject.id, log]);

  const exportCsv = useCallback(() => {
    if (!model.points.length) { log("No points to export.", "error"); return; }
    const csv = pointsToCsv(model.points);
    const safe = activeProject.id.replace(/[^a-z0-9_-]/gi, "_");
    downloadText(`${safe}_points.csv`, csv, "text/csv");
    log(`Exported ${model.points.length} point(s) to CSV.`);
  }, [model, activeProject.id, log]);

  const exportReport = useCallback(() => {
    const body = buildSurveyReport(activeProject.name, activeProject.id, model);
    openReportWindow(`Survey Report — ${activeProject.name}`, body);
    log("Generated survey report.");
  }, [model, activeProject.name, activeProject.id, log]);

  const exportCutFillReport = useCallback(() => {
    const cutFillSurfaces = model.surfaces.filter((s) => s.cutFill);
    if (cutFillSurfaces.length === 0) {
      log("Cut/Fill Report: run Vol → RL or Vol Δ first to generate volume data.", "error");
      return;
    }
    const body = buildCutFillReport(activeProject.name, activeProject.id, model);
    openReportWindow(`Cut/Fill Report — ${activeProject.name}`, body);
    log("Generated cut/fill volume report.");
  }, [model, activeProject.name, activeProject.id, log]);

  // ── GeoJSON (GeoRust geojson) ──────────────────────────────────────────────

  const exportGeoJson = useCallback(async () => {
    if (!model.points.length && !model.linework.length) {
      log("Nothing to export to GeoJSON.", "error");
      return;
    }
    const geojson = await modelToGeoJson(toGeoModel(model.points, model.linework));
    const safe = activeProject.id.replace(/[^a-z0-9_-]/gi, "_");
    downloadText(`${safe}.geojson`, geojson, "application/geo+json");
    log(
      `Exported ${model.points.length} point(s) and ${model.linework.length} line(s) to GeoJSON (${lastGeomBackend()}).`,
    );
  }, [model, activeProject.id, log]);

  const handleImportGeoJson = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const text = String(reader.result ?? "");
        const gm = await modelFromGeoJson(text);
        const count = cad.importPoints(
          gm.points.map((p) => ({
            pointNo: p.pointNo || "",
            n: p.n,
            e: p.e,
            z: p.z ?? null,
            code: p.code ?? "",
          })),
          model.activeLayerId,
        );
        for (const l of gm.linework) {
          if (l.vertices.length < 2) continue;
          cad.addLinework({
            kind: l.closed ? "boundary" : "polyline",
            vertices: l.vertices.map((v) => ({ n: v.n, e: v.e })),
            closed: l.closed,
            layerId: model.activeLayerId,
          });
        }
        log(
          `Imported ${count} point(s) and ${gm.linework.length} line(s) from GeoJSON (${lastGeomBackend()}).`,
        );
        fitExtents();
      };
      reader.onerror = () => log("Failed to read GeoJSON file.", "error");
      reader.readAsText(file);
    },
    [cad, model.activeLayerId, log, fitExtents],
  );

  // ── Geometry (GeoRust geo) ─────────────────────────────────────────────────

  const computeConvexHull = useCallback(async () => {
    if (model.points.length < 3) {
      log("Convex hull: need at least 3 points.", "error");
      return;
    }
    const hull = await convexHull(model.points.map((p) => ({ n: p.n, e: p.e })));
    if (hull.length < 3) {
      log("Convex hull: degenerate point set.", "error");
      return;
    }
    cad.ensureLayerById("BOUNDARY");
    cad.addLinework({
      kind: "boundary",
      vertices: hull.map((v) => ({ n: v.n, e: v.e })),
      closed: true,
      layerId: "BOUNDARY",
    });
    log(`Convex hull: ${hull.length}-vertex boundary on the Boundary layer (${lastGeomBackend()}).`);
  }, [model.points, cad, log]);

  const simplifySelection = useCallback(async () => {
    const sel = cad.selection;
    const id = sel.type === "linework" ? sel.id : null;
    const target = id ? model.linework.find((l) => l.id === id) : undefined;
    if (!target) {
      log("Simplify: select a polyline/boundary first.", "error");
      return;
    }
    const epsRaw = window.prompt("Simplify tolerance (m):", "0.5");
    if (epsRaw == null) return;
    const eps = parseFloat(epsRaw);
    if (!Number.isFinite(eps) || eps <= 0) {
      log("Simplify: tolerance must be a positive number.", "error");
      return;
    }
    const simplified = await simplifyLine(target.vertices.map((v) => ({ n: v.n, e: v.e })), eps);
    cad.updateLinework(target.id, { vertices: simplified.map((v) => ({ n: v.n, e: v.e })) });
    log(
      `Simplified ${target.vertices.length} → ${simplified.length} vertices at ${eps} m (${lastGeomBackend()}).`,
    );
  }, [cad, model.linework, log]);

  // ── Reprojection (GeoRust proj on desktop, Karney fallback on web) ─────────

  const reprojectDrawing = useCallback(async () => {
    if (!model.points.length && !model.linework.length && !model.texts.length && !model.surfaces.length) {
      log("Reproject: nothing to transform.", "error");
      return;
    }
    // Build a "from → to" selection from the available CRS presets. Keep the
    // prompt simple: a number for source and target from the preset list.
    const menu = PROJECTION_PRESETS.map((p, i) => `${i + 1}. ${p.label}`).join("\n");
    const fromRaw = window.prompt(`Source CRS:\n${menu}`, "1");
    if (fromRaw == null) return;
    const toRaw = window.prompt(`Target CRS:\n${menu}`, "6");
    if (toRaw == null) return;
    const fromIdx = parseInt(fromRaw, 10) - 1;
    const toIdx = parseInt(toRaw, 10) - 1;
    const from = PROJECTION_PRESETS[fromIdx];
    const to = PROJECTION_PRESETS[toIdx];
    if (!from || !to) {
      log("Reproject: invalid CRS selection.", "error");
      return;
    }
    if (from.id === to.id) {
      log("Reproject: source and target CRS are the same.", "info");
      return;
    }

    type ReprojTarget =
      | { type: "point"; id: string }
      | { type: "linework"; id: string; index: number }
      | { type: "text"; id: string }
      | { type: "surface"; id: string; index: number };

    const input: { n: number; e: number; target: ReprojTarget }[] = [];
    for (const p of model.points) input.push({ n: p.n, e: p.e, target: { type: "point", id: p.id } });
    for (const lw of model.linework) {
      lw.vertices.forEach((v, i) => input.push({ n: v.n, e: v.e, target: { type: "linework", id: lw.id, index: i } }));
    }
    for (const t of model.texts) input.push({ n: t.n, e: t.e, target: { type: "text", id: t.id } });
    for (const s of model.surfaces) {
      s.points.forEach((p, i) => input.push({ n: p.n, e: p.e, target: { type: "surface", id: s.id, index: i } }));
    }

    try {
      const coords = input.map((x) => ({ n: x.n, e: x.e }));
      const out = await reproject(from, to, coords);
      // Buffer updates so each entity is written once.
      const lineworkPatches = new Map<string, { n: number; e: number }[]>();
      const surfacePatches = new Map<string, { n: number; e: number; z: number }[]>();
      let count = 0;
      out.forEach((v, i) => {
        const t = input[i].target;
        count += 1;
        if (t.type === "point") {
          cad.updatePoint(t.id, { n: v.n, e: v.e });
        } else if (t.type === "linework") {
          const verts = lineworkPatches.get(t.id) ?? [...model.linework.find((l) => l.id === t.id)!.vertices];
          verts[t.index] = { n: v.n, e: v.e };
          lineworkPatches.set(t.id, verts);
        } else if (t.type === "text") {
          cad.updateText(t.id, { n: v.n, e: v.e });
        } else {
          const pts = surfacePatches.get(t.id) ?? [...model.surfaces.find((s) => s.id === t.id)!.points];
          pts[t.index] = { ...pts[t.index], n: v.n, e: v.e };
          surfacePatches.set(t.id, pts);
        }
      });
      for (const [id, vertices] of lineworkPatches) cad.updateLinework(id, { vertices });
      for (const [id, points] of surfacePatches) cad.updateSurface(id, { points });
      log(
        `Reprojected ${count} vertex/entity(ies): ${from.label} → ${to.label} (${lastReprojectBackend()}).`,
      );
      if (lastReprojectBackend() === "karney") {
        log(
          "Used the in-app projection (no datum shift). Build the desktop app with PROJ for full datum transforms.",
          "info",
        );
      }
      fitExtents();
    } catch (err) {
      log(`Reproject failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [model.points, model.linework, model.texts, model.surfaces, cad, log, fitExtents]);

  // ── Surface (TIN / contours / volumes) ─────────────────────────────────────

  /** 3D points usable for a surface: those with an elevation. */
  const surfacePoints = useCallback((): SurfacePoint3[] => {
    return model.points
      .filter((p) => p.z != null && Number.isFinite(p.z))
      .map((p) => ({ n: p.n, e: p.e, z: p.z as number }));
  }, [model.points]);

  const buildSurface = useCallback(async () => {
    const pts = surfacePoints();
    if (pts.length < 3) {
      log("Build TIN: need at least 3 points with elevations (Z).", "error");
      return;
    }
    log("Building TIN surface…");
    const tin = await buildTin(pts);
    if (tin.triangles.length === 0) {
      log("Build TIN: triangulation produced no triangles (collinear points?).", "error");
      return;
    }
    const name = `Surface ${model.surfaces.length + 1}`;
    cad.ensureLayerById("TOPO");
    cad.addSurface({ name, points: tin.points, triangles: tin.triangles, layerId: "TOPO" });
    log(`${name}: ${tin.triangles.length} triangles from ${tin.points.length} points (${lastBackend()}).`);
    fitExtents();
  }, [surfacePoints, cad, model.surfaces.length, log, fitExtents]);

  // ── Field to finish: join coded points into linework strings ────────────────
  const processLinework = useCallback(() => {
    const table = buildCodeTable();
    const { strings, strungPoints } = buildFeatureStrings(model.points, table);
    if (strings.length === 0) {
      log("Process linework: no stringable coded points found (e.g. FL, EK, WALL, BLDG).", "info");
      return;
    }
    let drawn = 0;
    for (const s of strings) {
      cad.ensureLayerById(s.def.layerId);
      cad.addLinework({
        kind: s.closed ? "boundary" : "polyline",
        vertices: s.vertices.map((v) => ({ n: v.n, e: v.e })),
        closed: s.closed,
        layerId: s.def.layerId,
      });
      drawn += 1;
    }
    fitExtents();
    log(
      `Field-to-finish: drew ${drawn} linework string(s) from ${strungPoints} coded point(s). ` +
        `Breakline strings are honoured by Build TIN + Breaklines.`,
    );
  }, [model.points, cad, log, fitExtents]);

  // ── Breakline- and boundary-constrained TIN ─────────────────────────────────
  const buildSurfaceWithBreaklines = useCallback(async () => {
    const pts = surfacePoints();
    if (pts.length < 3) {
      log("Build TIN + Breaklines: need at least 3 points with elevations (Z).", "error");
      return;
    }

    // Breaklines come from the coded stringable+breakline points.
    const table = buildCodeTable();
    const { strings } = buildFeatureStrings(model.points, table);
    const breaklines: SurfaceConstraint[] = strings
      .filter((s) => s.breakline)
      .map((s) => ({ vertices: s.vertices.map((v) => ({ n: v.n, e: v.e })) }));

    // Clip boundary: the currently selected closed linework, if any.
    const sel = cad.selection;
    const selLw = sel.type === "linework" && sel.id
      ? model.linework.find((l) => l.id === sel.id)
      : undefined;
    const boundary: SurfaceConstraint | undefined =
      selLw && selLw.closed && selLw.vertices.length >= 3
        ? { vertices: selLw.vertices.map((v) => ({ n: v.n, e: v.e })) }
        : undefined;

    log("Building constrained TIN surface…");
    const tin = await buildConstrainedTin(pts, { breaklines, boundary });
    if (tin.triangles.length === 0) {
      log("Build TIN + Breaklines: no triangles produced (check points / boundary).", "error");
      return;
    }
    const name = `Surface ${model.surfaces.length + 1} (constrained)`;
    cad.ensureLayerById("TOPO");
    cad.addSurface({ name, points: tin.points, triangles: tin.triangles, layerId: "TOPO" });
    log(
      `${name}: ${tin.triangles.length} triangles, ${breaklines.length} breakline(s)` +
        `${boundary ? ", clipped to selected boundary" : ""} (${lastBackend()}).`,
    );
    fitExtents();
  }, [surfacePoints, model.points, model.linework, model.surfaces.length, cad, log, fitExtents]);

  const buildContours = useCallback(async () => {
    const surface = model.surfaces[model.surfaces.length - 1];
    if (!surface) {
      log("Contours: build a TIN surface first (Surface ▸ Build TIN).", "error");
      return;
    }
    const intervalRaw = window.prompt("Contour interval (m):", "1");
    if (intervalRaw == null) return;
    const interval = parseFloat(intervalRaw);
    if (!Number.isFinite(interval) || interval <= 0) {
      log("Contours: interval must be a positive number.", "error");
      return;
    }
    // Every Nth contour is an "index" contour — drawn heavier and labelled,
    // exactly like a topographic sheet. Default 5 (the survey convention).
    const everyRaw = window.prompt("Index contour every N intervals (heavier + labelled):", "5");
    if (everyRaw == null) return;
    const indexEvery = Math.max(1, Math.round(parseFloat(everyRaw) || 5));
    log("Generating contours…");
    const lines = await generateContours(
      { points: surface.points, triangles: surface.triangles },
      interval,
      0,
      2, // Chaikin smoothing passes for clean, survey-grade curves.
    );
    if (lines.length === 0) {
      log("Contours: none generated for that interval.", "error");
      return;
    }
    let indexCount = 0;
    cad.ensureLayerById("CONTOURS");
    cad.ensureLayerById("CONTOURS_INDEX");
    for (const line of lines) {
      // A contour is an index contour when its elevation is a whole multiple of
      // (interval × indexEvery). Rounded comparison avoids float drift.
      const steps = Math.round(line.elevation / interval);
      const isIndex = steps % indexEvery === 0;
      if (isIndex) indexCount += 1;
      cad.addLinework({
        kind: "polyline",
        vertices: line.vertices.map((v) => ({ n: v.n, e: v.e })),
        closed: false,
        layerId: isIndex ? "CONTOURS_INDEX" : "CONTOURS",
        // Every contour records its elevation in `label` so the 3D view can
        // lift it to the correct RL. The 2D renderer only *shows* the label on
        // index contours (CONTOURS_INDEX layer), matching topo cartography.
        label: `${line.elevation.toFixed(2)}`,
      });
    }
    log(
      `Generated ${lines.length} contour(s) at ${interval} m — ` +
        `${indexCount} index (every ${indexEvery}) labelled, ${lines.length - indexCount} intermediate (${lastBackend()}).`,
    );
  }, [model.surfaces, cad, log]);

  const computeVolumeToElevation = useCallback(async () => {
    const surface = model.surfaces[model.surfaces.length - 1];
    if (!surface) { log("Volume: build a TIN surface first.", "error"); return; }
    const rlRaw = window.prompt("Reference level / RL (m):", "0");
    if (rlRaw == null) return;
    const reference = parseFloat(rlRaw);
    if (!Number.isFinite(reference)) { log("Volume: invalid reference level.", "error"); return; }
    const tin = { points: surface.points, triangles: surface.triangles };
    const v = await volumeToElevation(tin, reference);
    // Build a coloured 3D earthworks model from the per-triangle cut/fill, so
    // the volume result is visible in the 3D view (red = cut, blue = fill).
    const cf = cutFillToElevation(tin, reference);
    cad.addSurface({
      name: `Cut/Fill vs RL ${reference} m`,
      points: surface.points,
      triangles: surface.triangles,
      layerId: surface.layerId,
      cutFill: { ...cf, mode: "elevation", reference },
    });
    settingsApi.update({ view3d: true });
    fitExtents();
    log(
      `Volume vs RL ${reference} m — cut ${v.cut.toFixed(2)} m³ · fill ${v.fill.toFixed(2)} m³ · ` +
      `net ${v.net.toFixed(2)} m³ · plan ${fmtArea(v.planArea)} (${lastBackend()}). ` +
      `Cut/Fill model shown in 3D.`,
    );
  }, [model.surfaces, cad, settingsApi, fitExtents, log]);

  const computeVolumeBetween = useCallback(async () => {
    if (model.surfaces.length < 2) {
      log("Volume Δ: need two TIN surfaces (build a second one).", "error");
      return;
    }
    const top = model.surfaces[model.surfaces.length - 1];
    const base = model.surfaces[model.surfaces.length - 2];
    const topTin = { points: top.points, triangles: top.triangles };
    const baseTin = { points: base.points, triangles: base.triangles };
    const v = await volumeBetween(topTin, baseTin);
    // Coloured 3D earthworks model on the top surface (red = cut, blue = fill).
    const cf = cutFillBetween(topTin, baseTin);
    cad.addSurface({
      name: `Cut/Fill "${top.name}" vs "${base.name}"`,
      points: top.points,
      triangles: top.triangles,
      layerId: top.layerId,
      cutFill: { ...cf, mode: "between" },
    });
    settingsApi.update({ view3d: true });
    fitExtents();
    log(
      `Volume "${top.name}" vs "${base.name}" — cut ${v.cut.toFixed(2)} m³ · ` +
      `fill ${v.fill.toFixed(2)} m³ · net ${v.net.toFixed(2)} m³ (${lastBackend()}). ` +
      `Cut/Fill model shown in 3D.`,
    );
  }, [model.surfaces, cad, settingsApi, fitExtents, log]);

  // ── Terrain analysis (slope / aspect / 3D area) ────────────────────────────

  const analyseSurfaceTerrain = useCallback(async () => {
    const surface = model.surfaces.find((s) => !s.cutFill && !s.slopeShade)
      ?? model.surfaces[model.surfaces.length - 1];
    if (!surface) {
      log("Terrain: build a TIN surface first (Surface ▸ Build TIN).", "error");
      return;
    }
    const tin = { points: surface.points, triangles: surface.triangles };
    log("Analysing terrain…");
    const [tris, stats] = await Promise.all([analyseTerrain(tin), terrainStats(tin)]);
    if (!stats || tris.length === 0) {
      log("Terrain: analysis produced no triangles.", "error");
      return;
    }
    const maxSlope = stats.maxSlopeDeg > 0 ? stats.maxSlopeDeg : 1;
    const shadeTris = tris.map((t) => {
      const tri = surface.triangles[t.index];
      return {
        a: tri.a,
        b: tri.b,
        c: tri.c,
        slopeDeg: t.slopeDeg,
        color: slopeColor(t.slopeDeg, maxSlope),
      };
    });
    cad.addSurface({
      name: `Slope shade — ${surface.name}`,
      points: surface.points,
      triangles: surface.triangles,
      layerId: surface.layerId,
      slopeShade: { triangles: shadeTris, maxSlope },
    });
    settingsApi.update({ view3d: true });
    fitExtents();
    log(
      `Terrain "${surface.name}" — mean slope ${stats.meanSlopeDeg.toFixed(2)}° ` +
        `(${stats.minSlopeDeg.toFixed(1)}–${stats.maxSlopeDeg.toFixed(1)}°), ` +
        `3D area ${fmtArea(stats.surfaceArea)} vs plan ${fmtArea(stats.planArea)} (${lastTerrainBackend()}). ` +
        `Slope shade shown in 3D.`,
    );
    const body = buildTerrainReport(activeProject.name, activeProject.id, surface.name, stats);
    openReportWindow(`Terrain Analysis — ${activeProject.name}`, body);
  }, [model.surfaces, cad, settingsApi, fitExtents, log, activeProject.name, activeProject.id]);

  // ── Annotation (boundary labels, area label) ────────────────────────────────

  const labelBoundarySegments = useCallback(() => {
    const sel = cad.selection;
    const lw = sel.type === "linework" && sel.id
      ? model.linework.find((l) => l.id === sel.id)
      : undefined;
    if (!lw) {
      log("Label boundary: select a polyline or boundary first.", "error");
      return;
    }
    const verts = lw.vertices;
    const segs = lw.closed ? verts.length : verts.length - 1;
    let placed = 0;
    for (let i = 0; i < segs; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      const r = inverse(a, b);
      const midN = (a.n + b.n) / 2;
      const midE = (a.e + b.e) / 2;
      const text = `${fmtBearing(r.azimuth, bearingFormat)}  ${fmtDistance(r.distance)} m`;
      cad.ensureLayerById("TEXT");
    cad.addText({ n: midN, e: midE, text, layerId: "TEXT" });
      placed += 1;
    }
    log(`Labelled ${placed} segment(s) with bearing & distance.`);
  }, [cad, model.linework, bearingFormat, log]);

  const labelArea = useCallback(() => {
    const sel = cad.selection;
    const lw = sel.type === "linework" && sel.id
      ? model.linework.find((l) => l.id === sel.id)
      : undefined;
    if (!lw || !lw.closed) {
      log("Label area: select a closed boundary first.", "error");
      return;
    }
    const area = polygonArea(lw.vertices);
    const perimeter = polylineLength(lw.vertices) +
      (lw.closed ? inverse(lw.vertices[lw.vertices.length - 1], lw.vertices[0]).distance : 0);
    const cN = lw.vertices.reduce((s, v) => s + v.n, 0) / lw.vertices.length;
    const cE = lw.vertices.reduce((s, v) => s + v.e, 0) / lw.vertices.length;
    cad.ensureLayerById("TEXT");
    cad.addText({ n: cN, e: cE, text: `Area: ${fmtArea(area)}`, layerId: "TEXT" });
    cad.addText({ n: cN - 3, e: cE, text: `Perimeter: ${fmtDistance(perimeter)} m`, layerId: "TEXT" });
    log(`Area label placed — ${fmtArea(area)}, perimeter ${fmtDistance(perimeter)} m.`);
  }, [cad, model.linework, log]);

  const handleRibbonAction = useCallback(
    (actionId: string) => {
      const [group, sub] = actionId.split(":");
      switch (group) {
        case "tool":
          changeTool(sub as CadToolId);
          break;
        case "zoom":
          if (sub === "extents") { fitExtents(); log("Zoom extents."); }
          break;
        case "edit":
          if (sub === "delete") deleteSelection();
          else if (sub === "undo") { if (cad.undo()) log("Undo."); else log("Nothing to undo.", "info"); }
          else if (sub === "redo") { if (cad.redo()) log("Redo."); else log("Nothing to redo.", "info"); }
          break;
        case "import":
          if (sub === "csv") fileInputRef.current?.click();
          else if (sub === "geojson") geojsonInputRef.current?.click();
          break;
        case "f2f":
          if (sub === "linework") processLinework();
          else log(`Unhandled action: ${actionId}`, "error");
          break;
        case "plot":
          if (sub === "layout") openLayout();
          break;
        case "export":
          if (sub === "dxf") exportDxf();
          else if (sub === "csv") exportCsv();
          else if (sub === "report") exportReport();
          else if (sub === "geojson") void exportGeoJson();
          break;
        case "geom":
          if (sub === "hull") void computeConvexHull();
          else if (sub === "simplify") void simplifySelection();
          else if (sub === "reproject") void reprojectDrawing();
          else log(`Unhandled action: ${actionId}`, "error");
          break;
        case "cogo":
          if (sub === "intersection") runIntersection();
          else if (sub === "bearing-distance" || sub === "inverse" || sub === "traverse" || sub === "area") {
            log(`Switch to the COGO panel (right) to run "${sub}".`, "info");
          } else log(`Unhandled action: ${actionId}`, "error");
          break;
        case "surface":
          if (sub === "tin") void buildSurface();
          else if (sub === "tin-breaklines") void buildSurfaceWithBreaklines();
          else if (sub === "contours") void buildContours();
          else if (sub === "volume-elevation") void computeVolumeToElevation();
          else if (sub === "volume-between") void computeVolumeBetween();
          else if (sub === "terrain") void analyseSurfaceTerrain();
          else if (sub === "cutfill-report") exportCutFillReport();
          else if (sub === "clear-contours") {
            const contours = model.linework.filter(
              (lw) => lw.layerId === "CONTOURS" || lw.layerId === "CONTOURS_INDEX",
            );
            if (contours.length === 0) { log("No contours to clear.", "info"); break; }
            for (const lw of contours) cad.deleteLinework(lw.id);
            log(`Cleared ${contours.length} contour line(s).`);
          } else if (sub === "clear-surfaces") {
            const surfaces = [...model.surfaces];
            if (surfaces.length === 0) { log("No surfaces to clear.", "info"); break; }
            for (const s of surfaces) cad.deleteSurface(s.id);
            log(`Cleared ${surfaces.length} surface(s).`);
          }
          else log(`Unhandled action: ${actionId}`, "error");
          break;
        case "annotate":
          if (sub === "label-boundary") labelBoundarySegments();
          else if (sub === "label-area") labelArea();
          else log(`Unhandled action: ${actionId}`, "error");
          break;
        default:
          log(`Unhandled action: ${actionId}`, "error");
      }
    },
    [
      changeTool, fitExtents, deleteSelection, exportDxf, exportCsv, exportReport,
      exportGeoJson, computeConvexHull, simplifySelection, reprojectDrawing,
      runIntersection, buildSurface, buildSurfaceWithBreaklines, processLinework,
      buildContours, computeVolumeToElevation,
      computeVolumeBetween, exportCutFillReport, analyseSurfaceTerrain,
      labelBoundarySegments, labelArea, log, cad, openLayout,
      model.points.length, model.linework.length, model.texts.length, model.surfaces.length,
    ],
  );

  const handleCommandSubmit = useCallback(
    (raw: string) => {
      log(raw, "input");
      runCommand(raw, {
        cad,
        bearingFormat,
        setTool: changeTool,
        log,
        fitExtents,
        layout: {
          toModel: () => layoutApi.setActive(MODEL_TAB),
          toLayout: openLayout,
          newLayout: handleAddLayout,
          plot: requestPlot,
          names: () => layoutApi.layouts.map((l) => l.name),
        },
      });
    },
    [cad, bearingFormat, changeTool, log, fitExtents, layoutApi, openLayout, handleAddLayout, requestPlot],
  );

  const handleToggle = useCallback((key: "snap" | "ortho" | "grid" | "osnap") => {
    settingsApi.toggle(key === "grid" ? "showGrid" : key);
  }, [settingsApi]);

  const handleMenuAction = useCallback(
    (action: CadMenuAction) => {
      switch (action) {
        case "file:import-csv":
          fileInputRef.current?.click();
          break;
        case "file:import-geojson":
          geojsonInputRef.current?.click();
          break;
        case "file:export-dxf":
          exportDxf();
          break;
        case "file:export-csv":
          exportCsv();
          break;
        case "file:export-geojson":
          void exportGeoJson();
          break;
        case "edit:undo":
          if (cad.undo()) log("Undo.");
          else log("Nothing to undo.", "info");
          break;
        case "edit:redo":
          if (cad.redo()) log("Redo.");
          else log("Nothing to redo.", "info");
          break;
        case "edit:delete":
          deleteSelection();
          break;
        case "view:zoom-extents":
          fitExtents();
          log("Zoom extents.");
          break;
        case "view:grid":
          handleToggle("grid");
          break;
        case "view:snap":
          handleToggle("snap");
          break;
        case "view:osnap":
          handleToggle("osnap");
          break;
        case "view:ortho":
          handleToggle("ortho");
          break;
        case "view:3d":
          settingsApi.toggle("view3d");
          break;
        case "plot:layout":
          openLayout();
          break;
        default:
          break;
      }
    },
    [cad, deleteSelection, exportCsv, exportDxf, exportGeoJson, fileInputRef, fitExtents, geojsonInputRef, handleToggle, log, openLayout, settingsApi],
  );

  const handleKeyDown = useCallback(
    (ev: React.KeyboardEvent) => {
      const target = ev.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;

      // Undo / redo (AutoCAD: Ctrl+Z / Ctrl+Y; also Ctrl+Shift+Z for redo)
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
        ev.preventDefault();
        if (ev.shiftKey) {
          if (cad.redo()) log("Redo."); else log("Nothing to redo.", "info");
        } else if (pendingVertices.length > 0) {
          // Mid-draw: undo the last picked vertex first, AutoCAD-style.
          setPendingVertices((v) => v.slice(0, -1));
        } else if (cad.undo()) {
          log("Undo.");
        } else {
          log("Nothing to undo.", "info");
        }
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "y") {
        ev.preventDefault();
        if (cad.redo()) log("Redo."); else log("Nothing to redo.", "info");
        return;
      }

      // Ctrl+A — select all (AutoCAD convention)
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") {
        ev.preventDefault();
        selectAll();
        return;
      }

      // F-key toggles (AutoCAD convention)
      if (ev.key === "F3") { ev.preventDefault(); handleToggle("osnap"); return; }
      if (ev.key === "F7") { ev.preventDefault(); handleToggle("grid"); return; }
      if (ev.key === "F8") { ev.preventDefault(); handleToggle("ortho"); return; }
      if (ev.key === "F9") { ev.preventDefault(); handleToggle("snap"); return; }

      if (ev.key === "Enter") { commitPending(false); return; }
      if (ev.key === "Escape") { cancelPending(); cad.setSelection({ type: null, id: null, items: [] }); return; }
      if (ev.key === "Delete") { deleteSelection(); return; }
      if (ev.key === "Backspace") {
        // While drawing, Backspace undoes the last picked vertex (AutoCAD U).
        if (pendingVertices.length > 0) {
          setPendingVertices((v) => v.slice(0, -1));
          return;
        }
        deleteSelection();
        return;
      }
      // Close the current chain (AutoCAD "C") when drawing linework.
      if (ev.key.toLowerCase() === "c" && pendingVertices.length >= 2 &&
          (tool === "line" || tool === "polyline" || tool === "boundary")) {
        commitPending(true);
        return;
      }
      // Space repeats last tool (AutoCAD convention)
      if (ev.key === " ") {
        ev.preventDefault();
        if (lastTool !== tool) repeatLastTool();
        return;
      }
      const map: Record<string, CadToolId> = {
        s: "select", p: "pan", o: "point", l: "line",
        y: "polyline", b: "boundary", t: "text", m: "measure",
      };
      const t = map[ev.key.toLowerCase()];
      if (t) changeTool(t);
    },
    [commitPending, cancelPending, deleteSelection, selectAll, changeTool, handleToggle, pendingVertices, cad, lastTool, tool, repeatLastTool],
  );

  const handleContextMenu = useCallback((ev: React.MouseEvent) => {
    ev.preventDefault();
    if (isDrawingTool) {
      commitPending();
    }
  }, [isDrawingTool, commitPending]);

  const scaleLabelMemo = useMemo(() => scaleLabel, [scaleLabel]);
  const drawingStats = useMemo(
    () => [
      { label: "PTS", value: model.points.length },
      { label: "LINES", value: model.linework.length },
      { label: "TEXT", value: model.texts.length },
      { label: "SURF", value: model.surfaces.length },
    ],
    [model.linework.length, model.points.length, model.texts.length, model.surfaces.length],
  );

  const commandPrompt = useMemo(() => {
    if (tool === "line") {
      return pendingVertices.length === 0
        ? "LINE Specify first point:"
        : "Specify next point or [Close/Undo] — Enter to finish:";
    }
    if (tool === "polyline") {
      return pendingVertices.length === 0
        ? "PLINE Specify start point:"
        : "Specify next point or [Close/Undo] — Enter to finish:";
    }
    if (tool === "boundary") {
      return pendingVertices.length === 0
        ? "BOUNDARY Specify first corner point:"
        : "Specify next corner or [Close/Undo] — Enter to close:";
    }
    if (tool === "measure") return pendingVertices.length === 0 ? "Specify first point:" : "Specify second point:";
    return "Command:";
  }, [tool, pendingVertices.length]);

  return (
    <section
      className="cad-workspace-shell"
      aria-label="Engineering Surveyor CAD workspace"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.txt"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImportCsv(f);
          e.target.value = "";
        }}
      />
      <input
        ref={geojsonInputRef}
        type="file"
        accept=".geojson,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImportGeoJson(f);
          e.target.value = "";
        }}
      />

      <header className="cad-topbar">
        <div className="cad-topbar-left">
          <button className="hub-mobile-menu-btn" style={{ marginRight: "8px" }} onClick={() => setProjectMobileMenuOpen(true)} type="button">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="cad-brand-lockup">
            <strong className="cad-title">Engineering Surveyor CAD</strong>
            <span className="cad-project-ref hide-on-mobile">{activeProject.id} · {activeProject.name}</span>
          </div>
        </div>
        <div className="cad-topbar-center hide-on-mobile">
          <CadToolDropdown tool={tool} onToolChange={changeTool} />
          <span className="cad-topbar-center-divider" />
          <span className="cad-topbar-center-stats" aria-label="Drawing summary">
            {drawingStats.map((stat) => (
              <span className="cad-stat-pill" key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </span>
            ))}
          </span>
        </div>
        <div className="cad-topbar-actions">
          <div className="cad-layer-control" title="Set active layer">
            <span
              className="cad-layer-swatch-inline"
              style={{ background: model.layers.find((l) => l.id === model.activeLayerId)?.color ?? "#888" }}
            />
            <select
              value={model.activeLayerId}
              onChange={(e) => cad.setActiveLayer(e.target.value)}
              aria-label="Active layer"
            >
              {model.layers.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          <div
            className="cad-layer-control"
            title={
              (cad.selection.items?.length ?? (cad.selection.id ? 1 : 0)) > 0
                ? "Set colour of selected objects"
                : "Drawing colour for new objects"
            }
          >
            <span
              className="cad-layer-swatch-inline"
              style={{
                background: activeColor ?? "transparent",
                backgroundImage: activeColor
                  ? undefined
                  : "linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%),linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%)",
                backgroundSize: "6px 6px",
                backgroundPosition: "0 0, 3px 3px",
              }}
            />
            <select
              value={activeColor ?? "bylayer"}
              aria-label="Drawing colour"
              onChange={(e) => {
                const val = e.target.value === "bylayer" ? null : e.target.value;
                setActiveColor(val);
                const n = cad.setColorOfSelection(val);
                if (n > 0) log(`Set colour on ${n} object${n === 1 ? "" : "s"}.`);
              }}
            >
              {CAD_COLORS.map((c) => (
                <option key={c.label} value={c.value ?? "bylayer"}>{c.label}</option>
              ))}
            </select>
          </div>

          <div className="cad-view-toggle" role="group" aria-label="View mode (2D / 3D)">
            <button
              type="button"
              className={`cad-view-toggle-btn ${!view3d ? "active" : ""}`}
              onClick={() => { if (view3d) { settingsApi.toggle("view3d"); log("Switched to 2D plan view."); } }}
              title="2D plan view (top-down)"
              aria-pressed={!view3d}
            >
              <Square size={13} /> 2D
            </button>
            <button
              type="button"
              className={`cad-view-toggle-btn ${view3d ? "active" : ""}`}
              onClick={() => { if (!view3d) { settingsApi.toggle("view3d"); log("Switched to true-3D orbit view — drag to orbit, right/two-finger drag to pan, wheel to zoom."); } }}
              title="True 3D orbit view (uses point and surface elevations)"
              aria-pressed={view3d}
            >
              <Box size={13} /> 3D
            </button>
          </div>

          <div className="cad-settings-anchor">
            <button
              type="button"
              className={`cad-settings-btn ${settingsOpen ? "active" : ""}`}
              onClick={() => setSettingsOpen((v) => !v)}
              title="Drawing settings — units, precision, snap & display"
              aria-label="Drawing settings"
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
            >
              <SlidersHorizontal size={16} />
            </button>
            {settingsOpen && (
              <CadSettingsPopover
                settingsApi={settingsApi}
                onApplyScale={applyScale}
                onFitExtents={fitExtents}
                onClose={() => setSettingsOpen(false)}
              />
            )}
          </div>

          <span
            className={`cad-sync-status ${cad.syncStatus}`}
            title={cad.syncError ?? undefined}
          >
            <span className="cad-sync-dot" aria-hidden="true" />
            {cad.syncStatus === "loading" && "Loading…"}
            {cad.syncStatus === "saving" && "Saving…"}
            {cad.syncStatus === "saved" && "All changes saved"}
            {cad.syncStatus === "error" && "Offline — saved locally"}
          </span>
          <button className="cad-exit-btn" type="button" onClick={exitCadWorkspace}>Exit CAD</button>
        </div>
      </header>

      <CadMenuBar onAction={handleMenuAction} />

      <CadRibbon
        activeTab={ribbonTab}
        onTabChange={setRibbonTab}
        onAction={handleRibbonAction}
        datum={datum}
        tool={tool}
        canUndo={cad.canUndo}
        canRedo={cad.canRedo}
      />

      <div className="cad-workspace-body">
        {view3d ? (
          <Cad3dViewport
            model={model}
            zScale={settings.zScale}
            coordDecimals={settings.coordDecimals}
            axisConvention={settings.axisConvention}
            showPointLabels={settings.showPointLabels}
            fitSignal={fitSignal}
            selection={selection}
            tool={tool}
            projectId={activeProject.id}
            onCursorMove={(w) => setCursor({ n: w.n, e: w.e })}
          />
        ) : (
          <CadViewport
            model={model}
            tool={tool}
            selection={selection}
            bearingFormat={bearingFormat}
            snap={snap}
            ortho={ortho}
            showGrid={showGrid}
            osnap={osnap}
            snapAuto={settings.snapAuto}
            snapSpacing={settings.snapSpacing}
            coordDecimals={settings.coordDecimals}
            axisConvention={settings.axisConvention}
            showPointLabels={settings.showPointLabels}
            showSegmentLabels={settings.showSegmentLabels}
            scaleSignal={scaleSignal}
            scaleTarget={scaleTarget}
            onCursorMove={setCursor}
            onPickPoint={handlePickPoint}
            onSelectEntity={handleSelectEntity}
            pendingVertices={pendingVertices}
            fitSignal={fitSignal}
            onScaleChange={setScaleLabel}
            onCommit={commitPending}
            onContextMenu={handleContextMenu}
            onKeyDown={(ev) => {
              // The viewport holds focus after a pick, so handle keys here and
              // stop them bubbling to the section to avoid double handling.
              handleKeyDown(ev);
              ev.stopPropagation();
            }}
          />
        )}

        <CadRightPanel
          cad={cad}
          model={model}
          selection={selection}
          bearingFormat={bearingFormat}
          angleEntry={settings.angleEntry}
          log={log}
        />
      </div>

      <CadCommandLine
        prompt={commandPrompt}
        log={commandLog}
        onSubmit={handleCommandSubmit}
      />

      <CadStatusBar
        cursor={cursor}
        snap={snap}
        ortho={ortho}
        showGrid={showGrid}
        osnap={osnap}
        onToggle={handleToggle}
        scaleLabel={scaleLabelMemo}
        datum={datum}
        coordDecimals={settings.coordDecimals}
        axisConvention={settings.axisConvention}
        scaleDenominator={settings.scaleDenominator}
        layouts={layoutApi.layouts}
        activeTab={layoutApi.active}
        onSelectTab={handleSelectTab}
        onAddLayout={handleAddLayout}
        onRenameLayout={layoutApi.rename}
        onDuplicateLayout={layoutApi.duplicate}
        onDeleteLayout={layoutApi.remove}
      />

      {/* Paper space: the active layout's to-scale sheet (AutoCAD layout tab). */}
      {layoutApi.inLayout && layoutApi.activeLayout && (
        <CadPlotDialog
          key={layoutApi.activeLayout.id}
          model={model}
          bearingFormat={bearingFormat}
          axisConvention={settings.axisConvention}
          initialOptions={layoutApi.activeLayout.options}
          fileStem={`${activeProject.id.replace(/[^a-z0-9_-]/gi, "_")}_${layoutApi.activeLayout.name.replace(/[^a-z0-9_-]/gi, "_")}`}
          layoutName={layoutApi.activeLayout.name}
          onClose={() => layoutApi.setActive(MODEL_TAB)}
          onOptionsChange={(opts) => layoutApi.updateOptions(layoutApi.activeLayout!.id, opts)}
          log={log}
        />
      )}

      {/* Ad-hoc one-off plot (ribbon Plot button, unbound to a layout). */}
      {plotOpen && (
        <CadPlotDialog
          model={model}
          bearingFormat={bearingFormat}
          axisConvention={settings.axisConvention}
          initialOptions={plotOptions}
          fileStem={activeProject.id.replace(/[^a-z0-9_-]/gi, "_")}
          onClose={() => setPlotOpen(false)}
          log={log}
        />
      )}
    </section>
  );
}
