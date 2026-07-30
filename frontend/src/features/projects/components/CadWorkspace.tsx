import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAsyncAction } from "../../../hooks/useAsyncAction.ts";
import type { HubProject } from "../../../pages/shared/ProjectHubPage.tsx";
import "../../../styles/cad.css";
import "../../../styles/cad-admin-theme.css";

import type { CadSelection, CadToolId, SurveySurface } from "./cad/cadModel.ts";
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
import { CadViewport } from "./cad/CadViewport.tsx";
import { Cad3dViewport } from "./cad/Cad3dViewport.tsx";
import { CadRightPanel } from "./cad/CadRightPanel.tsx";
import { CadSettingsPopover } from "./cad/CadSettingsPanel.tsx";
import { CadStatusBar } from "./cad/CadStatusBar.tsx";
import { CadCommandLine, type CommandLogEntry } from "./cad/CadCommandLine.tsx";
import { CadPlotDialog } from "./cad/CadPlotDialog.tsx";
import { CadPointDialog } from "./cad/CadPointDialog.tsx";
import { CadControlPointDialog } from "./cad/CadControlPointDialog.tsx";
import { CadProjectPointsSelector } from "./cad/CadProjectPointsSelector.tsx";
import { CadImportDxfDialog } from "./cad/CadImportDxfDialog.tsx";
import { CadReportDialog } from "./cad/CadReportDialog.tsx";
import { parseCadFile, lastCadBackend } from "./cad/survey/cadBridge.ts";
import { CadDialogProvider } from "./cad/CadDialogProvider.tsx";
import { useCadDialog } from "./cad/cadDialogContext.ts";
import {
  DEFAULT_PLOT_OPTIONS,
  DEFAULT_TITLE_BLOCK,
  buildPlotSvg,
  openPlotWindow,
  type PlotOptions,
} from "./cad/io/plot.ts";
import { SlidersHorizontal, Box, Square, ChevronDown } from "lucide-react";

import { pointsToCsv } from "./cad/io/csv.ts";
import { modelToDxf, downloadText } from "./cad/io/dxf.ts";
import { addProjectOutput } from "../tools/calculators/projectOutputs.ts";
import { buildSurveyReport, buildCutFillReport, openReportWindow } from "./cad/io/report.ts";
import { modelFromGeoJson, toGeoModel } from "./cad/io/geojson.ts";
import {
  modelToGeoJson,
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
import { forward, inverse, polygonArea, polylineLength, circularArcParams } from "./cad/survey/cogo.ts";
import { buildTerrainReport } from "./cad/io/report.ts";
import { fmtArea, fmtBearing, fmtCoord, fmtDistance, parseDistanceBearing } from "./cad/survey/format.ts";
import { axisBadgeLabels } from "./cad/cadSettings.ts";

function cadCrsLabel(project: HubProject): string {
  if (project.crsType === 'projected') return project.crsEpsg ? `EPSG:${project.crsEpsg}` : 'Projected';
  if (project.crsType === 'local') return 'Local';
  return 'Other';
}

function cadCrsTooltip(project: HubProject): string {
  if (project.crsType === 'local') {
    return `Local site grid. Origin offset: E ${project.localOriginE}, N ${project.localOriginN}`;
  }
  if (project.crsType === 'projected') {
    return `Projected CRS${project.crsEpsg ? ` — EPSG:${project.crsEpsg}` : ''}`;
  }
  return 'Coordinate system: other / unspecified';
}

interface CadWorkspaceProps {
  activeProject: HubProject;
  workspaceId: string;
  setProjectMobileMenuOpen: (v: boolean) => void;
  exitCadWorkspace: () => void;
}

interface DialogPrompts {
  alert: (message: string) => Promise<void>;
  confirm: (message: string) => Promise<boolean>;
  prompt: (message: string, defaultValue?: string) => Promise<string | null>;
  select: (message: string, options: string[]) => Promise<string | null>;
}

async function pickSurface(
  surfaces: SurveySurface[],
  dialog: DialogPrompts,
  title: string,
): Promise<SurveySurface | null> {
  if (surfaces.length === 1) return surfaces[0];
  const options = surfaces.map((s, i) => `${i + 1}. ${s.name}`);
  const raw = await dialog.select(title, options);
  if (raw == null) return null;
  const idx = parseInt(raw, 10) - 1;
  return surfaces[idx] ?? null;
}

/** Pick a sensible, round contour interval for a given elevation range. */
function autoContourInterval(range: number): number {
  if (range <= 0 || !Number.isFinite(range)) return 1;
  const target = range / 10;
  const pow10 = 10 ** Math.floor(Math.log10(target));
  const mult = target / pow10;
  if (mult <= 1) return pow10;
  if (mult <= 2) return 2 * pow10;
  if (mult <= 5) return 5 * pow10;
  return 10 * pow10;
}

/** Tools that build multi-vertex linework, committed on double-click / Enter / right-click. */
const LINEWORK_TOOLS: Record<string, "line" | "boundary"> = {
  line: "line",
  boundary: "boundary",
};

const MODIFY_TOOLS: CadToolId[] = ["move", "copy", "rotate", "scale", "mirror", "offset"];

let logCounter = 0;

export function CadWorkspace(props: CadWorkspaceProps) {
  return (
    <CadDialogProvider>
      <CadWorkspaceContent {...props} />
    </CadDialogProvider>
  );
}

function CadWorkspaceContent({
  activeProject,
  workspaceId,
  setProjectMobileMenuOpen,
  exitCadWorkspace,
}: CadWorkspaceProps) {
  useEffect(() => {
    document.body.classList.add("cad-admin-scope");
    return () => document.body.classList.remove("cad-admin-scope");
  }, []);

  const cad = useCadModel(activeProject.dbId, workspaceId);
  const { model, selection } = cad;

  const settingsApi = useCadSettings(activeProject.dbId);
  const { settings, update: updateSettings } = settingsApi;
  const { bearingFormat, snap, ortho, showGrid, osnap, view3d } = settings;

  // Keep project-controlled drafting conventions in sync with the Project Hub.
  // Project hub settings are the source of truth for the whole project.
  useEffect(() => {
    const projectConvention = activeProject.axisConvention === 'xy' ? 'xy' : 'yx';
    const updates: Partial<typeof settings> = {};
    if (settings.axisConvention !== projectConvention) updates.axisConvention = projectConvention;

    const projectBearing = activeProject.bearingFormat || 'azimuth';
    if (settings.bearingFormat !== projectBearing) updates.bearingFormat = projectBearing as typeof settings.bearingFormat;

    const projectAngle = activeProject.angleEntry || 'packed';
    if (settings.angleEntry !== projectAngle) updates.angleEntry = projectAngle as typeof settings.angleEntry;

    const projectDecimals = typeof activeProject.coordDecimals === 'number' ? activeProject.coordDecimals : 3;
    if (settings.coordDecimals !== projectDecimals) updates.coordDecimals = projectDecimals;

    if (Object.keys(updates).length > 0) updateSettings(updates);
  }, [
    activeProject.axisConvention,
    activeProject.bearingFormat,
    activeProject.angleEntry,
    activeProject.coordDecimals,
    settings.axisConvention,
    settings.bearingFormat,
    settings.angleEntry,
    settings.coordDecimals,
    settings,
    updateSettings,
  ]);

  const [tool, setTool] = useState<CadToolId>("select");
  const [pendingTool, setPendingTool] = useState<CadToolId | null>(null);
  const [ribbonTab, setRibbonTab] = useState<string>("Home");

  /** Active drawing colour for new geometry. null = ByLayer (AutoCAD default). */
  const [activeColor, setActiveColor] = useState<string | null>(null);

  /** Whether the drawing-settings popover (anchored to the top-bar gear) is open. */
  const [settingsOpen, setSettingsOpen] = useState(false);

  /** Whether the plot/layout dialog is open. */
  const [plotOpen, setPlotOpen] = useState(false);

  /** Point-placement form that appears when the Point / Control Point tool is clicked. */
  const [pointForm, setPointForm] = useState<{
    open: boolean;
    world: { n: number; e: number } | null;
    pointNo: string;
    code: string;
    elev: string;
    layerId: string;
    title: string;
  }>({ open: false, world: null, pointNo: "1", code: "", elev: "", layerId: "POINTS", title: "Place Survey Point" });

  /** Control-point form with manual coordinate entry (accurate placement). */
  const [controlPointForm, setControlPointForm] = useState<{
    open: boolean;
    pointNo: string;
    code: string;
  }>({ open: false, pointNo: "1", code: "CP" });

  const dialog = useCadDialog();

  const [cursor, setCursor] = useState<{ n: number; e: number } | null>(null);
  const [scaleLabel, setScaleLabel] = useState("1 m");
  const [fitSignal, setFitSignal] = useState(0);
  /** Bumped to push a target scale (px per survey unit) into the viewport. */
  const [scaleSignal, setScaleSignal] = useState(0);
  const [scaleTarget, setScaleTarget] = useState<number | undefined>(undefined);

  const [pendingVertices, setPendingVertices] = useState<{ n: number; e: number }[]>([]);
  /**
   * The LINE tool now behaves like an open polyline so the whole chain can be
   * selected and deleted as one object. This holds the id of the running
   * polyline while the command is active.
   */
  const [runningLineId, setRunningLineId] = useState<string | null>(null);
  /** True while the running-LINE transaction (single undo step) is open. */
  const lineTxActiveRef = useRef(false);
  const [projectPointsOpen, setProjectPointsOpen] = useState(false);
  const [importDxfOpen, setImportDxfOpen] = useState(false);
  const [reportDialog, setReportDialog] = useState<{ open: boolean; title: string; html: string } | null>(null);
  const [lastTool, setLastTool] = useState<CadToolId>("select");
  const [commandLog, setCommandLog] = useState<CommandLogEntry[]>([
    { id: ++logCounter, kind: "info", text: `Engineering Surveyor CAD ready — ${activeProject.name}` },
    { id: ++logCounter, kind: "info", text: "Pick a tool or type a command. Enter / right-click to finish linework." },
  ]);

  /** Keep the LINE tool's running polyline in sync with pending vertices. */
  const syncRunningLine = useCallback(async () => {
    if (tool !== "line") {
      // Tool switched away mid-draw: discard the open transaction instead of
      // leaving committed chain fragments behind.
      if (lineTxActiveRef.current) {
        cad.discardTransaction();
        lineTxActiveRef.current = false;
      }
      setRunningLineId(null);
      return;
    }
    if (pendingVertices.length < 2) {
      if (lineTxActiveRef.current) {
        cad.discardTransaction();
        lineTxActiveRef.current = false;
        setRunningLineId(null);
      }
      return;
    }
    if (runningLineId == null) {
      cad.beginTransaction();
      lineTxActiveRef.current = true;
      const created = cad.addLinework({
        kind: "polyline",
        vertices: pendingVertices,
        closed: false,
        color: activeColor,
      });
      setRunningLineId(created.id);
    } else {
      cad.updateLinework(runningLineId, { vertices: pendingVertices });
    }
  }, [tool, pendingVertices, cad, activeColor, runningLineId]);

  useAsyncAction(syncRunningLine, [syncRunningLine]);

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
      model.surfaces.length > 0 ||
      model.arcs.length > 0 ||
      model.circles.length > 0 ||
      model.ellipses.length > 0 ||
      model.dimensions.length > 0 ||
      model.hatches.length > 0,
    [
      model.points.length,
      model.linework.length,
      model.texts.length,
      model.surfaces.length,
      model.arcs.length,
      model.circles.length,
      model.ellipses.length,
      model.dimensions.length,
      model.hatches.length,
    ],
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

  const isDrawingTool = LINEWORK_TOOLS[tool] != null || tool === "point" || tool === "control-point" || tool === "text" || tool === "measure";

  const commitPending = useCallback(
    (closeChain = false) => {
      // LINE: the running polyline was already created when the second point was
      // picked. Finishing the command just leaves it in the model and selects
      // it. If only a start point was picked, treat it as a cancellation.
      if (tool === "line") {
        setPendingVertices((verts) => {
          if (verts.length < 2) {
            if (verts.length > 0) log("Cancelled (a line needs at least 2 points).", "info");
            if (lineTxActiveRef.current) {
              cad.discardTransaction();
              lineTxActiveRef.current = false;
            }
          } else if (runningLineId) {
            log(`Line created (${verts.length} vertices).`);
            cad.setSelection({ type: "linework", id: runningLineId });
          }
          return [];
        });
        if (lineTxActiveRef.current) {
          cad.endTransaction();
          lineTxActiveRef.current = false;
        }
        setRunningLineId(null);
        return;
      }

      const kind = tool === "boundary" ? "boundary" : null;
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
    [tool, cad, log, activeColor, runningLineId],
  );

  /** AutoCAD-style dynamic input: accept distance<bearing while drawing a chain. */
  const handleDynInput = useCallback(
    (raw: string) => {
      if (pendingVertices.length === 0) return;
      const parsed = parseDistanceBearing(raw, settings.angleEntry);
      if (!parsed) {
        log("Invalid entry. Use distance<bearing, e.g. 50<30 or @25<N45E", "error");
        return;
      }
      const start = pendingVertices[pendingVertices.length - 1];
      const end = forward(start, parsed.azimuthDeg, parsed.distance);
      setPendingVertices((verts) => [...verts, end]);
      const axis = axisBadgeLabels(settings.axisConvention);
      log(
        `Segment ${fmtDistance(parsed.distance)} m @ ${fmtBearing(parsed.azimuthDeg, bearingFormat)} ` +
          `→ ${axis.first} ${fmtCoord(end.e)} ${axis.second} ${fmtCoord(end.n)}`,
      );
    },
    [pendingVertices, settings.angleEntry, settings.axisConvention, bearingFormat, log],
  );

  const cancelPending = useCallback(() => {
    if (tool === "line" && lineTxActiveRef.current) {
      // Discard restores the model from before the chain was started — no
      // "ghost" polyline can be resurrected by the next undo.
      cad.discardTransaction();
      lineTxActiveRef.current = false;
      log("Line cancelled.");
    } else if (tool === "line" && runningLineId) {
      cad.deleteLinework(runningLineId);
      log("Line cancelled.");
    } else {
      setPendingVertices((verts) => {
        if (verts.length) log("Cancelled.", "info");
        return [];
      });
    }
    setPendingVertices([]);
    setRunningLineId(null);
  }, [tool, runningLineId, cad, log]);

  const handlePickPoint = useCallback(
    async (world: { n: number; e: number }) => {
      // Block drawing onto a locked active layer (AutoCAD convention).
      const drawsToActiveLayer =
        tool === "point" || tool === "text" || tool === "line" || tool === "boundary" || tool === "circle" || tool === "arc";
      if (drawsToActiveLayer) {
        const active = cad.layerById(model.activeLayerId);
        if (active?.locked) {
          log(`Layer "${active.name}" is locked. Unlock it or pick another active layer to draw.`, "error");
          return;
        }
      }
      if (tool === "point") {
        setPointForm((prev) => ({
          open: true,
          world,
          pointNo: cad.nextPointNo(),
          code: prev.code,
          elev: prev.elev,
          layerId: model.activeLayerId,
          title: "Place Survey Point",
        }));
        return;
      }
      if (tool === "control-point") {
        cad.ensureLayerById("CONTROL");
        const controlLayer = cad.layerById("CONTROL");
        if (controlLayer?.locked) {
          log(`Layer "${controlLayer.name}" is locked. Unlock it to place control points.`, "error");
          return;
        }
        setControlPointForm({ open: true, pointNo: cad.nextPointNo(), code: "CP" });
        return;
      }
      if (tool === "text") {
        const value = await dialog.prompt("Annotation text:");
        if (value && value.trim()) {
          cad.addText({ n: world.n, e: world.e, text: value.trim(), color: activeColor });
          log(`Text placed: "${value.trim()}"`);
        }
        return;
      }
      // AutoCAD-style Line / Polyline / Boundary: build a continuous chain of
      // vertices. The LINE tool creates a single open polyline immediately when
      // the second point is picked, so the whole chain can be selected and
      // deleted as one object; polyline/boundary previews stay pending until
      // Enter / right-click.
      if (tool === "line" || tool === "boundary") {
        setPendingVertices((verts) => [...verts, world]);
        return;
      }

      // CIRCLE: pick centre, then a point on the circumference.
      if (tool === "circle") {
        setPendingVertices((verts) => {
          const next = [...verts, world];
          if (next.length === 2) {
            const [center, rim] = next;
            const radius = Math.hypot(rim.e - center.e, rim.n - center.n);
            if (radius <= 0) {
              log("Circle: radius must be greater than zero.", "error");
              return [];
            }
            const created = cad.addCircle({ center, radius, color: activeColor });
            log(`Circle created — radius ${radius.toFixed(3)} m.`);
            cad.setSelection({ type: "circle", id: created.id });
            return [];
          }
          log("Specify point on circumference:");
          return next;
        });
        return;
      }

      // ARC: pick start, second, and end points.
      if (tool === "arc") {
        setPendingVertices((verts) => {
          const next = [...verts, world];
          if (next.length === 3) {
            const params = circularArcParams(next[0], next[1], next[2]);
            if (!params) {
              log("Arc: three selected points are collinear or coincident.", "error");
              return [];
            }
            const created = cad.addArc({
              center: params.center,
              radius: params.radius,
              startAngle: params.startAngle,
              endAngle: params.endAngle,
              color: activeColor,
            });
            log(`Arc created — r ${params.radius.toFixed(3)} m.`);
            cad.setSelection({ type: "arc", id: created.id });
            return [];
          }
          if (next.length === 1) log("Specify second point on arc:");
          else log("Specify end point of arc:");
          return next;
        });
        return;
      }
      // AutoCAD-style MOVE / COPY: pick a base point, then a destination.
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

      // ROTATE / SCALE / MIRROR / OFFSET: operate on the current selection.
      if (tool === "rotate") {
        const hasSel = (cad.selection.items?.length ?? (cad.selection.id ? 1 : 0)) > 0;
        if (!hasSel) {
          log("Rotate: select objects first (use Select), then pick base point.", "error");
          return;
        }
        setPendingVertices((verts) => {
          const next = [...verts, world];
          if (next.length === 2) {
            const base = next[0];
            const ref = next[1];
            const angle = Math.atan2(ref.n - base.n, ref.e - base.e);
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const count = cad.mapSelection((p) => {
              const dx = p.e - base.e;
              const dy = p.n - base.n;
              return { e: base.e + dx * cos - dy * sin, n: base.n + dx * sin + dy * cos };
            }, false, { rotateDeg: (angle * 180) / Math.PI });
            log(`Rotated ${count} object${count === 1 ? "" : "s"} ${((angle * 180) / Math.PI).toFixed(3)}° around base.`);
            return [];
          }
          log("Specify rotation angle (second point):");
          return next;
        });
        return;
      }

      if (tool === "scale") {
        const hasSel = (cad.selection.items?.length ?? (cad.selection.id ? 1 : 0)) > 0;
        if (!hasSel) {
          log("Scale: select objects first (use Select), then pick base point.", "error");
          return;
        }
        setPendingVertices((verts) => {
          if (verts.length === 0) {
            log("Enter scale factor after picking the base point.");
            return [world];
          }
          return verts;
        });
        const base = world;
        const raw = await dialog.prompt("Scale factor:", "1");
        setPendingVertices([]);
        if (raw == null) return;
        const factor = parseFloat(raw);
        if (!Number.isFinite(factor)) {
          log("Scale: invalid factor.", "error");
          return;
        }
        const count = cad.mapSelection((p) => ({
          e: base.e + (p.e - base.e) * factor,
          n: base.n + (p.n - base.n) * factor,
        }), false, { scaleFactor: factor });
        log(`Scaled ${count} object${count === 1 ? "" : "s"} by ${factor.toFixed(3)}x.`);
        return;
      }

      if (tool === "mirror") {
        const hasSel = (cad.selection.items?.length ?? (cad.selection.id ? 1 : 0)) > 0;
        if (!hasSel) {
          log("Mirror: select objects first (use Select), then pick mirror line.", "error");
          return;
        }
        setPendingVertices((verts) => {
          const next = [...verts, world];
          if (next.length === 2) {
            const a = next[0];
            const b = next[1];
            const dx = b.e - a.e;
            const dy = b.n - a.n;
            const len2 = dx * dx + dy * dy;
            if (len2 === 0) return next;
            const count = cad.mapSelection((p) => {
              const t = ((p.e - a.e) * dx + (p.n - a.n) * dy) / len2;
              const projE = a.e + t * dx;
              const projN = a.n + t * dy;
              return { e: projE * 2 - p.e, n: projN * 2 - p.n };
            }, false, { mirrorAngleDeg: (Math.atan2(dy, dx) * 180) / Math.PI });
            log(`Mirrored ${count} object${count === 1 ? "" : "s"} across mirror line.`);
            return [];
          }
          log("Specify second point of mirror line:");
          return next;
        });
        return;
      }

      if (tool === "offset") {
        const sel = cad.selection;
        const lwId = sel.type === "linework" && sel.id ? sel.id : undefined;
        if (!lwId) {
          log("Offset: select a single polyline/boundary first.", "error");
          return;
        }
        const raw = await dialog.prompt("Offset distance (positive = left side):", "1");
        if (raw == null) return;
        const distance = parseFloat(raw);
        if (!Number.isFinite(distance)) {
          log("Offset: invalid distance.", "error");
          return;
        }
        const copy = cad.offsetLinework(lwId, distance);
        if (copy) {
          log(`Offset ${distance.toFixed(3)} m created — ${copy.vertices.length} vertices.`);
        } else {
          log("Offset: could not create offset.", "error");
        }
        return;
      }

      if (tool === "dim-linear") {
        setPendingVertices((verts) => {
          const next = [...verts, world];
          if (next.length === 2) {
            const a = next[0];
            const b = next[1];
            const dn = b.n - a.n;
            const de = b.e - a.e;
            const dist = Math.hypot(dn, de);
            const midN = (a.n + b.n) / 2;
            const midE = (a.e + b.e) / 2;
            const angle = Math.atan2(de, dn) * (180 / Math.PI);
            cad.ensureLayerById("DIMENSIONS");
            const created = cad.addDimension({
              kind: "linear",
              text: `${dist.toFixed(settings.coordDecimals)}`,
              textPosition: { n: midN, e: midE },
              defPoints: [a, b],
              angle,
              color: activeColor,
            });
            log(`Linear dimension: ${dist.toFixed(3)} m placed.`);
            cad.setSelection({ type: "dimension", id: created.id });
            return [];
          }
          return next;
        });
        return;
      }

      if (tool === "spot-height") {
        cad.ensureLayerById("SPOT_HEIGHTS");
        let z: number | undefined;

        // 1) Prefer sampling a TIN surface — chosen explicitly when more than
        // one exists (was silently the LAST surface in the list).
        if (model.surfaces.length > 0) {
          const surface = model.surfaces.length === 1
            ? model.surfaces[0]
            : await pickSurface(model.surfaces, dialog, "Choose surface to sample for the spot height");
          if (!surface) return;
          const sampled = sampleZ({ points: surface.points, triangles: surface.triangles }, world.n, world.e);
          if (sampled !== null) z = sampled;
        }

        // 2) Fallback: a surveyed point within 0.5 m of the click.
        if (z === undefined) {
          const nearby = model.points
            .filter((p) => p.z != null && Number.isFinite(p.z))
            .sort((a, b) => {
              const da = Math.hypot(a.n - world.n, a.e - world.e);
              const db = Math.hypot(b.n - world.n, b.e - world.e);
              return da - db;
            })[0];
          if (nearby && Math.hypot(nearby.n - world.n, nearby.e - world.e) <= 0.5) {
            z = nearby.z!;
          }
        }

        // 3) Last resort: let the surveyor type the RL.
        if (z === undefined) {
          const raw = await dialog.prompt("Spot elevation (RL m):", "");
          if (raw == null) return;
          const parsed = parseFloat(raw);
          if (!Number.isFinite(parsed)) {
            log("Spot Height: invalid elevation.", "error");
            return;
          }
          z = parsed;
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
    [tool, cad, dialog, log, activeColor, model.activeLayerId, model.points, model.surfaces, settings.coordDecimals],
  );

  const handleSelectEntity = useCallback(
    (sel: CadSelection) => {
      cad.setSelection(sel);
      const count = sel.items?.length ?? (sel.type ? 1 : 0);
      if (pendingTool && count > 0) {
        const t = pendingTool;
        setPendingTool(null);
        setLastTool(t);
        setTool(t);
        log(`${t}: selection ready — tool resumed.`);
        return;
      }
      if (count > 1) log(`Selected ${count} objects.`);
      else if (sel.type) log(`Selected ${sel.type}.`);
    },
    [cad, log, pendingTool],
  );

  const hasSelection = useCallback(() => {
    const sel = cad.selection;
    return (sel.items && sel.items.length > 0) || (!!sel.type && !!sel.id);
  }, [cad.selection]);

  const changeTool = useCallback((t: CadToolId) => {
    setPendingVertices([]);
    setRunningLineId(null);
    setPendingTool(null);
    if (MODIFY_TOOLS.includes(t) && !hasSelection()) {
      setPendingTool(t);
      setTool("select");
      log(`${t}: select objects first, then the tool will resume.`);
      return;
    }
    setLastTool(t);
    setTool(t);
  }, [hasSelection, log]);

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
    // One logical delete = one undo step (batch into a transaction).
    cad.beginTransaction();
    try {
      for (const it of items) {
        if (it.type === "point") cad.deletePoint(it.id);
        else if (it.type === "linework") cad.deleteLinework(it.id);
        else if (it.type === "text") cad.deleteText(it.id);
        else if (it.type === "surface") cad.deleteSurface(it.id);
        else if (it.type === "arc") cad.deleteArc(it.id);
        else if (it.type === "circle") cad.deleteCircle(it.id);
        else if (it.type === "ellipse") cad.deleteEllipse(it.id);
        else if (it.type === "dimension") cad.deleteDimension(it.id);
        else if (it.type === "hatch") cad.deleteHatch(it.id);
      }
    } finally {
      cad.endTransaction();
    }
    log(`Deleted ${items.length} object${items.length === 1 ? "" : "s"}.`);
  }, [cad, log]);

  /** Break selected polylines/boundaries into individual line segments. */
  const explodeSelection = useCallback(() => {
    const sel = cad.selection;
    const items = sel.items && sel.items.length
      ? sel.items
      : sel.type && sel.id
        ? [{ type: sel.type, id: sel.id }]
        : [];
    const lwIds = items.filter((i) => i.type === "linework").map((i) => i.id);
    if (lwIds.length === 0) {
      log("Explode: select polylines / boundaries first.", "error");
      return;
    }
    let created = 0;
    const newIds: string[] = [];
    cad.beginTransaction();
    try {
      for (const id of lwIds) {
        const lw = model.linework.find((l) => l.id === id);
        if (!lw || lw.vertices.length < 2) continue;
        const segCount = lw.closed ? lw.vertices.length : lw.vertices.length - 1;
        for (let i = 0; i < segCount; i++) {
          const a = lw.vertices[i];
          const b = lw.vertices[(i + 1) % lw.vertices.length];
          const seg = cad.addLinework({
            kind: "line",
            vertices: [a, b],
            closed: false,
            layerId: lw.layerId,
            color: lw.color,
            // Only the first segment carries the parent's label (contour RL
            // etc.) — copying it to every segment spams the drawing.
            label: i === 0 ? lw.label : undefined,
          });
          newIds.push(seg.id);
          created += 1;
        }
        cad.deleteLinework(id);
      }
    } finally {
      cad.endTransaction();
    }
    if (created > 0) {
      cad.setSelection({
        type: "linework",
        id: newIds[newIds.length - 1],
        items: newIds.map((id) => ({ type: "linework" as const, id })),
      });
    }
    log(`Exploded ${lwIds.length} linework object(s) into ${created} line segment(s).`);
  }, [cad, model.linework, log]);

  /** Select every visible entity (Ctrl+A). */
  const selectAll = useCallback(() => {
    const items = [
      ...model.points.map((p) => ({ type: "point" as const, id: p.id })),
      ...model.linework.map((l) => ({ type: "linework" as const, id: l.id })),
      ...model.texts.map((t) => ({ type: "text" as const, id: t.id })),
      ...model.surfaces.map((s) => ({ type: "surface" as const, id: s.id })),
      ...model.arcs.map((a) => ({ type: "arc" as const, id: a.id })),
      ...model.circles.map((c) => ({ type: "circle" as const, id: c.id })),
      ...model.ellipses.map((el) => ({ type: "ellipse" as const, id: el.id })),
      ...model.dimensions.map((d) => ({ type: "dimension" as const, id: d.id })),
      ...model.hatches.map((h) => ({ type: "hatch" as const, id: h.id })),
    ];
    if (items.length === 0) { log("Nothing to select.", "info"); return; }
    const primary = items[items.length - 1];
    cad.setSelection({ type: primary.type, id: primary.id, items });
    log(`Selected ${items.length} object${items.length === 1 ? "" : "s"}.`);
  }, [model.points, model.linework, model.texts, model.surfaces, model.arcs, model.circles, model.ellipses, model.dimensions, model.hatches, cad, log]);

  const findPoint = useCallback(
    (pno: string): NE | null => {
      const p = model.points.find((x) => x.pointNo === pno.trim());
      return p ? { n: p.n, e: p.e } : null;
    },
    [model.points],
  );

  const runIntersection = useCallback(async () => {
    const mode = await dialog.prompt("Intersection type — 'BB' (bearing-bearing) or 'DD' (distance-distance):", "BB");
    if (!mode) return;
    const m = mode.trim().toUpperCase();
    if (m === "BB") {
      const p1no = await dialog.prompt("From point 1 (Pt #):");
      const az1 = await dialog.prompt("Bearing from point 1 (deg):");
      const p2no = await dialog.prompt("From point 2 (Pt #):");
      const az2 = await dialog.prompt("Bearing from point 2 (deg):");
      const p1 = p1no ? findPoint(p1no) : null;
      const p2 = p2no ? findPoint(p2no) : null;
      if (!p1 || !p2 || az1 == null || az2 == null) { log("Intersection: invalid input.", "error"); return; }
      const res = intersectionBearingBearing(p1, parseFloat(az1), p2, parseFloat(az2));
      if (!res) { log("Intersection: rays are parallel.", "error"); return; }
      const created = cad.addPoint({ pointNo: cad.nextPointNo(), n: res.n, e: res.e, z: null, code: "INT", color: activeColor });
      log(`Intersection point ${created.pointNo}: N ${res.n.toFixed(3)} E ${res.e.toFixed(3)}`);
    } else if (m === "DD") {
      const p1no = await dialog.prompt("From point 1 (Pt #):");
      const r1 = await dialog.prompt("Distance from point 1 (m):");
      const p2no = await dialog.prompt("From point 2 (Pt #):");
      const r2 = await dialog.prompt("Distance from point 2 (m):");
      const p1 = p1no ? findPoint(p1no) : null;
      const p2 = p2no ? findPoint(p2no) : null;
      if (!p1 || !p2 || r1 == null || r2 == null) { log("Intersection: invalid input.", "error"); return; }
      const sols = intersectionDistanceDistance(p1, parseFloat(r1), p2, parseFloat(r2));
      if (!sols.length) { log("Intersection: circles do not intersect.", "error"); return; }
      // Batch-created points must not share a number — count locally from the
      // model snapshot (nextPointNo() would report the same base for both
      // solutions because state hasn't updated between the two creations).
      let solPtNo = (() => {
        let max = 1000;
        for (const p of model.points) {
          const n = parseInt(p.pointNo, 10);
          if (Number.isFinite(n) && n > max) max = n;
        }
        return max + 1;
      })();
      for (const s of sols) {
        const created = cad.addPoint({ pointNo: String(solPtNo++), n: s.n, e: s.e, z: null, code: "INT", color: activeColor });
        log(`Intersection point ${created.pointNo}: N ${s.n.toFixed(3)} E ${s.e.toFixed(3)}`);
      }
    } else {
      log("Intersection: choose BB or DD.", "error");
    }
  }, [cad, dialog, findPoint, log, activeColor, model.points]);

  /** COGO inverse: needs exactly two selected points. */
  const runInverse = useCallback(() => {
    const items = cad.selection.items ?? [];
    const ptIds = items.filter((i) => i.type === "point").map((i) => i.id);
    const pts = model.points.filter((p) => ptIds.includes(p.id)).slice(0, 2);
    if (ptIds.length !== 2 || pts.length !== 2) {
      log("Inverse: select exactly two points.", "error");
      return;
    }
    const inv = inverse(pts[0], pts[1]);
    log(`Inverse ${pts[0].pointNo} → ${pts[1].pointNo}: dist ${fmtDistance(inv.distance)}, bearing ${fmtBearing(inv.azimuth, bearingFormat)}, dN ${(pts[1].n - pts[0].n).toFixed(3)}, dE ${(pts[1].e - pts[0].e).toFixed(3)}`);
  }, [cad.selection, model.points, log, bearingFormat]);

  /** COGO area: needs one selected closed boundary/linework. */
  const runArea = useCallback(() => {
    const items = cad.selection.items ?? [];
    const lwIds = items.filter((i) => i.type === "linework").map((i) => i.id);
    const lw = model.linework.find((l) => lwIds.includes(l.id));
    if (!lw || !lw.closed || lw.vertices.length < 3) {
      log("Area: select a closed polygon/boundary.", "error");
      return;
    }
    const area = polygonArea(lw.vertices);
    let perimeter = polylineLength(lw.vertices);
    if (lw.closed && lw.vertices.length >= 2) {
      const a = lw.vertices[lw.vertices.length - 1];
      const b = lw.vertices[0];
      perimeter += Math.hypot(b.e - a.e, b.n - a.n);
    }
    log(`Area: ${fmtArea(area)}, perimeter ${fmtDistance(perimeter)} (${lw.vertices.length} vertices)`);
  }, [cad.selection, model.linework, log]);

  const importProjectPoints = useCallback(
    (rows: { pointNo: string; n: number; e: number; z: number | null; code: string }[]) => {
      const existingNos = new Set(cad.model.points.map((p) => p.pointNo.trim()));
      const toImport = rows.filter((r) => !existingNos.has(r.pointNo.trim()));
      if (toImport.length === 0) {
        log("No new project points to import — all selected point numbers already exist.", "info");
        return;
      }
      cad.ensureLayerById("PROJECT");
      const count = cad.importPoints(toImport, "PROJECT");
      log(`Imported ${count} project point(s) from workspace.`);
      fitExtents();
    },
    [cad, log, fitExtents],
  );

  const exportDxf = useCallback(() => {
    if (!model.points.length && !model.linework.length && !model.texts.length) {
      log("Nothing to export.", "error");
      return;
    }
    const dxf = modelToDxf(model);
    const safe = activeProject.id.replace(/[^a-z0-9_-]/gi, "_");
    downloadText(`${safe}.dxf`, dxf, "application/dxf");
    addProjectOutput(activeProject.dbId, {
      label: "CAD DXF Export",
      description: `${model.points.length} point(s), ${model.linework.length} line object(s)`,
      fileName: `${safe}.dxf`,
      mimeType: "application/dxf",
      content: dxf,
    });
    log("Exported DXF.");
  }, [model, activeProject.id, activeProject.dbId, log]);

  const exportCsv = useCallback(() => {
    if (!model.points.length) { log("No points to export.", "error"); return; }
    const csv = pointsToCsv(model.points);
    const safe = activeProject.id.replace(/[^a-z0-9_-]/gi, "_");
    downloadText(`${safe}_points.csv`, csv, "text/csv");
    addProjectOutput(activeProject.dbId, {
      label: "CAD Points CSV",
      description: `${model.points.length} point(s)`,
      fileName: `${safe}_points.csv`,
      mimeType: "text/csv",
      content: csv,
    });
    log(`Exported ${model.points.length} point(s) to CSV.`);
  }, [model, activeProject.id, activeProject.dbId, log]);

  const exportReport = useCallback(() => {
    const body = buildSurveyReport(activeProject.name, activeProject.id, model, settings.axisConvention);
    openReportWindow(`Survey Report — ${activeProject.name}`, body);
    log("Generated survey report.");
  }, [model, activeProject.name, activeProject.id, settings.axisConvention, log]);

  const exportCutFillReport = useCallback(async () => {
    const cutFillSurfaces = model.surfaces.filter((s) => s.cutFill);
    if (cutFillSurfaces.length === 0) {
      await dialog.alert("No cut/fill data found. Run Vol → RL or Vol Δ first to generate volume data.");
      return;
    }
    const body = buildCutFillReport(activeProject.name, activeProject.id, model);
    setReportDialog({ open: true, title: `Cut/Fill Report — ${activeProject.name}`, html: body });
    log("Generated cut/fill volume report.");
  }, [model, activeProject.name, activeProject.id, dialog, log]);

  // ── GeoJSON (GeoRust geojson) ──────────────────────────────────────────────

  const exportGeoJson = useCallback(async () => {
    if (!model.points.length && !model.linework.length) {
      log("Nothing to export to GeoJSON.", "error");
      return;
    }
    const geojson = await modelToGeoJson(toGeoModel(model.points, model.linework));
    const safe = activeProject.id.replace(/[^a-z0-9_-]/gi, "_");
    downloadText(`${safe}.geojson`, geojson, "application/geo+json");
    addProjectOutput(activeProject.dbId, {
      label: "CAD GeoJSON Export",
      description: `${model.points.length} point(s), ${model.linework.length} line object(s)`,
      fileName: `${safe}.geojson`,
      mimeType: "application/geo+json",
      content: geojson,
    });
    log(
      `Exported ${model.points.length} point(s) and ${model.linework.length} line(s) to GeoJSON (${lastGeomBackend()}).`,
    );
  }, [model, activeProject.id, activeProject.dbId, log]);

  // ── GeoJSON import ────────────────────────────────────────────────────────

  const importGeoJson = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".geojson,.json,application/geo+json,application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void (async () => {
        try {
          const text = await file.text();
          const parsed = modelFromGeoJson(text);
          for (const w of parsed.warnings) log(`GeoJSON: ${w}`, "info");
          for (const e of parsed.errors) log(`GeoJSON: ${e}`, "error");
          const entityCount = parsed.points.length + parsed.linework.length;
          if (entityCount === 0) return;

          cad.beginTransaction();
          try {
            let pNo = (() => {
              let max = 1000;
              for (const p of model.points) {
                const n = parseInt(p.pointNo, 10);
                if (Number.isFinite(n) && n > max) max = n;
              }
              return max + 1;
            })();
            const gjLayerOf = (raw: string) => {
              const slug = raw.replace(/[^a-zA-Z0-9_-]/g, "_").toUpperCase();
              return slug ? cad.ensureLayerById(slug).id : cad.ensureLayerById("GJ_IMPORT").id;
            };
            for (const p of parsed.points) {
              const pno = p.pointNo && !findPoint(p.pointNo) ? p.pointNo : String(pNo++);
              cad.addPoint({
                pointNo: pno,
                n: p.n,
                e: p.e,
                z: p.z ?? null,
                code: p.code ?? "",
                layerId: gjLayerOf(p.layerId ?? ""),
              });
            }
            for (const lw of parsed.linework) {
              if (lw.vertices.length < 2) continue;
              cad.addLinework({
                kind: lw.closed ? "boundary" : "polyline",
                vertices: lw.vertices.map((v) => ({ n: v.n, e: v.e })),
                closed: lw.closed,
                layerId: gjLayerOf(lw.layerId ?? ""),
              });
            }
          } finally {
            cad.endTransaction();
          }
          fitExtents();
          log(`GeoJSON import (${file.name}): ${parsed.points.length} point(s), ${parsed.linework.length} line object(s).`);
        } catch (err) {
          log(err instanceof Error ? err.message : "GeoJSON import failed.", "error");
        }
      })();
    };
    input.click();
  }, [cad, model.points, findPoint, fitExtents, log]);

  // ── DXF / DWG import from workspace files ─────────────────────────────────
  const importCadFile = useCallback(
    async (file: File) => {
      cad.beginTransaction();
      try {
        const result = await parseCadFile(file);
        const layerIdByName = new Map<string, string>();
        const layerIdPrefix = "CAD_";

        for (const layerName of result.layerNames) {
          const slug =
            layerName === "0"
              ? "0"
              : `${layerIdPrefix}${layerName.replace(/[^a-zA-Z0-9_-]/g, "_").toUpperCase()}`;
          const layer = cad.ensureLayerById(slug);
          const updates: Partial<{ name: string; color: string }> = {};
          if (layer.name !== layerName && layerName !== "0") {
            updates.name = layerName;
          }
          const layerStyle = result.layerStyles[layerName];
          if (layerStyle?.color && layerStyle.color.startsWith("#")) {
            updates.color = layerStyle.color.toLowerCase() === "#ffffff" ? "#000000" : layerStyle.color;
          }
          if (Object.keys(updates).length > 0) {
            cad.updateLayer(layer.id, updates);
          }
          layerIdByName.set(layerName, layer.id);
        }

        let pointCount = 0;
        let lineCount = 0;
        let textCount = 0;
        let skippedPaper = 0;

        const toColor = (style?: { color?: string | null }): string | undefined => {
          const c = style?.color;
          if (!c?.startsWith("#")) return undefined;
          // Pure white is invisible on the light CAD canvas; map to black.
          return c.toLowerCase() === "#ffffff" ? "#000000" : c;
        };

        // Batch-created points must not share a number: cad.nextPointNo() is
        // a stale closure that reports the pre-import maximum for every new
        // point. Count locally from the model snapshot.
        let importedPtNo = (() => {
          let max = 1000;
          for (const p of model.points) {
            const n = parseInt(p.pointNo, 10);
            if (Number.isFinite(n) && n > max) max = n;
          }
          return max + 1;
        })();

        for (const p of result.points) {
          if (p.paperSpace) {
            skippedPaper++;
            continue;
          }
          if (!Number.isFinite(p.n) || !Number.isFinite(p.e)) continue;
          cad.addPoint({
            pointNo: String(importedPtNo++),
            n: p.n,
            e: p.e,
            z: p.z,
            code: p.code || "CAD",
            layerId: layerIdByName.get(p.layerName) ?? "0",
            color: toColor(p.style),
          });
          pointCount++;
        }

        for (const lw of result.linework) {
          if (lw.paperSpace) {
            skippedPaper++;
            continue;
          }
          const vertices = lw.vertices.filter((v) => Number.isFinite(v.n) && Number.isFinite(v.e));
          if (vertices.length === 0) continue;
          cad.addLinework({
            kind: lw.kind === "line" ? "line" : "polyline",
            vertices: vertices.map((v) => ({ n: v.n, e: v.e })),
            closed: lw.closed,
            layerId: layerIdByName.get(lw.layerName) ?? "0",
            color: toColor(lw.style),
          });
          lineCount++;
        }

        for (const t of result.texts) {
          if (t.paperSpace) {
            skippedPaper++;
            continue;
          }
          if (!Number.isFinite(t.n) || !Number.isFinite(t.e)) continue;
          cad.addText({
            n: t.n,
            e: t.e,
            text: t.text,
            layerId: layerIdByName.get(t.layerName) ?? "0",
            height: t.height,
            rotation: t.rotation,
            color: toColor(t.style),
          });
          textCount++;
        }

        for (const a of result.arcs) {
          if (a.paperSpace) {
            skippedPaper++;
            continue;
          }
          if (!Number.isFinite(a.centerN) || !Number.isFinite(a.centerE)) continue;
          cad.addArc({
            center: { n: a.centerN, e: a.centerE },
            radius: a.radius,
            startAngle: a.startAngle,
            endAngle: a.endAngle,
            layerId: layerIdByName.get(a.layerName) ?? "0",
            color: toColor(a.style),
          });
        }

        for (const c of result.circles) {
          if (c.paperSpace) {
            skippedPaper++;
            continue;
          }
          if (!Number.isFinite(c.centerN) || !Number.isFinite(c.centerE)) continue;
          cad.addCircle({
            center: { n: c.centerN, e: c.centerE },
            radius: c.radius,
            layerId: layerIdByName.get(c.layerName) ?? "0",
            color: toColor(c.style),
          });
        }

        for (const h of result.hatches) {
          if (h.paperSpace) {
            skippedPaper++;
            continue;
          }
          const outer = h.vertices.filter((v) => Number.isFinite(v.n) && Number.isFinite(v.e));
          if (outer.length < 3) continue;
          cad.addHatch({
            vertices: outer.map((v) => ({ n: v.n, e: v.e })),
            holes: h.holes
              ?.map((hole) => hole.filter((v) => Number.isFinite(v.n) && Number.isFinite(v.e)))
              .filter((hole) => hole.length >= 3),
            pattern: h.pattern ?? null,
            patternScale: h.patternScale ?? null,
            patternAngle: h.patternAngle ?? null,
            layerId: layerIdByName.get(h.layerName) ?? "0",
            color: toColor(h.style),
          });
        }

        for (const d of result.dimensions) {
          if (d.paperSpace) {
            skippedPaper++;
            continue;
          }
          if (!Number.isFinite(d.textN) || !Number.isFinite(d.textE)) continue;
          cad.addDimension({
            kind: d.kind === "angular" || d.kind === "radial" || d.kind === "diameter"
              ? (d.kind as "linear" | "angular" | "radial" | "diameter")
              : "linear",
            text: d.text,
            textPosition: { n: d.textN, e: d.textE },
            defPoints: d.defPoints.filter((p) => Number.isFinite(p.n) && Number.isFinite(p.e)).map((p) => ({ n: p.n, e: p.e })),
            angle: d.angle ?? null,
            layerId: layerIdByName.get(d.layerName) ?? "0",
            color: toColor(d.style),
          });
        }

        for (const el of result.ellipses) {
          if (el.paperSpace) {
            skippedPaper++;
            continue;
          }
          if (!Number.isFinite(el.centerN) || !Number.isFinite(el.centerE)) continue;
          cad.addEllipse({
            center: { n: el.centerN, e: el.centerE },
            semiMajor: el.semiMajor,
            semiMinor: el.semiMinor,
            rotation: el.rotation,
            layerId: layerIdByName.get(el.layerName) ?? "0",
            color: toColor(el.style),
          });
        }

        for (const ins of result.inserts) {
          if (ins.paperSpace) {
            skippedPaper++;
            continue;
          }
          if (!Number.isFinite(ins.n) || !Number.isFinite(ins.e)) continue;
          cad.addText({
            n: ins.n,
            e: ins.e,
            text: ins.blockName,
            layerId: layerIdByName.get(ins.layerName) ?? "0",
            color: toColor(ins.style),
          });
          textCount++;
        }

        fitExtents();
        const backend = lastCadBackend();
        const parts = [
          `${pointCount} point(s)`,
          `${lineCount} line object(s)`,
          `${textCount} text object(s)`,
          `${result.circles.length} circle(s)`,
          `${result.arcs.length} arc(s)`,
          `${result.ellipses.length} ellipse(s)`,
          `${result.hatches.length} hatch(es)`,
          `${result.dimensions.length} dimension(s)`,
          `${result.inserts.length} block insert(s)`,
        ];
        log(`Imported ${file.name} (${backend}): ${parts.join(", ")}.`);
        if (skippedPaper > 0) {
          log(`Skipped ${skippedPaper} paper-space entity approximation(s).`, "info");
        }

        // Print a quick extents summary so users/devs can see where the geometry landed.
        const nVals = result.points.map((p) => p.n)
          .concat(result.linework.flatMap((lw) => lw.vertices.map((v) => v.n)))
          .concat(result.circles.map((c) => c.centerN))
          .concat(result.ellipses.map((el) => el.centerN))
          .concat(result.inserts.map((ins) => ins.n));
        const eVals = result.points.map((p) => p.e)
          .concat(result.linework.flatMap((lw) => lw.vertices.map((v) => v.e)))
          .concat(result.circles.map((c) => c.centerE))
          .concat(result.ellipses.map((el) => el.centerE))
          .concat(result.inserts.map((ins) => ins.e));
        if (nVals.length > 0 && eVals.length > 0) {
          // Running min/max — spreading a large import's coordinates into
          // Math.min(...vals) overflows the call stack.
          let minN = Infinity, maxN = -Infinity, minE = Infinity, maxE = -Infinity;
          for (const v of nVals) {
            if (!Number.isFinite(v)) continue;
            if (v < minN) minN = v;
            if (v > maxN) maxN = v;
          }
          for (const v of eVals) {
            if (!Number.isFinite(v)) continue;
            if (v < minE) minE = v;
            if (v > maxE) maxE = v;
          }
          if (Number.isFinite(minN) && Number.isFinite(minE)) {
            log(
              `Extents: N ${minN.toFixed(2)}..${maxN.toFixed(2)} · E ${minE.toFixed(2)}..${maxE.toFixed(2)}`,
              "info",
            );
          }
        }

        const unsupported = [...new Set(result.unsupported)];
        if (unsupported.length > 0) {
          log(
            `Skipped unsupported entities: ${unsupported.slice(0, 5).join(", ")}${unsupported.length > 5 ? "..." : ""}`,
            "info",
          );
        }
      } catch (err) {
        log(err instanceof Error ? err.message : "Failed to parse CAD file.", "error");
      } finally {
        cad.endTransaction();
      }
    },
    [cad, fitExtents, log, model.points],
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
    const epsRaw = await dialog.prompt("Simplify tolerance (m):", "0.5");
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
  }, [cad, dialog, model.linework, log]);

  // ── Reprojection (GeoRust proj on desktop, Karney fallback on web) ─────────

  const reprojectDrawing = useCallback(async () => {
    if (!model.points.length && !model.linework.length && !model.texts.length && !model.surfaces.length) {
      log("Reproject: nothing to transform.", "error");
      return;
    }
    // Build a "from → to" selection from the available CRS presets. Keep the
    // prompt simple: a number for source and target from the preset list.
    const menu = PROJECTION_PRESETS.map((p, i) => `${i + 1}. ${p.label}`).join("\n");
    const fromRaw = await dialog.prompt(`Source CRS:\n${menu}`, "1");
    if (fromRaw == null) return;
    const toRaw = await dialog.prompt(`Target CRS:\n${menu}`, "6");
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
  }, [model.points, model.linework, model.texts, model.surfaces, cad, dialog, log, fitExtents]);

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
    // Replace any previous TOPO surface so repeated clicks do not pile triangles.
    model.surfaces.filter((s) => s.layerId === "TOPO").forEach((s) => cad.deleteSurface(s.id));
    const nonTopoCount = model.surfaces.filter((s) => s.layerId !== "TOPO").length;
    const name = `Surface ${nonTopoCount + 1}`;
    cad.ensureLayerById("TOPO");
    cad.addSurface({ name, points: tin.points, triangles: tin.triangles, layerId: "TOPO" });
    log(`${name}: ${tin.triangles.length} triangles from ${tin.points.length} points (${lastBackend()}).`);
    fitExtents();
  }, [surfacePoints, cad, model.surfaces, log, fitExtents]);

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

    // Breaklines come from coded stringable points and from any selected linework.
    const table = buildCodeTable();
    const { strings } = buildFeatureStrings(model.points, table);
    const breaklines: SurfaceConstraint[] = strings
      .filter((s) => s.breakline)
      .map((s) => ({ vertices: s.vertices.map((v) => ({ n: v.n, e: v.e })) }));

    // Selected linework can act as manual breaklines (and one closed ring as the clip boundary).
    const sel = cad.selection;
    const selectedLwIds = new Set(
      (sel.items ?? [])
        .filter((i) => i.type === "linework")
        .map((i) => i.id)
        .filter(Boolean) as string[],
    );
    if (sel.type === "linework" && sel.id) selectedLwIds.add(sel.id);
    const selectedLws = model.linework.filter((l) => selectedLwIds.has(l.id));

    // Prefer the first selected closed ring as the boundary; remaining selected linework becomes breaklines.
    const boundaryLw = selectedLws.find((l) => l.closed && l.vertices.length >= 3);
    const boundary: SurfaceConstraint | undefined = boundaryLw
      ? { vertices: boundaryLw.vertices.map((v) => ({ n: v.n, e: v.e })) }
      : undefined;
    selectedLws
      .filter((l) => l.id !== boundaryLw?.id)
      .forEach((l) => {
        if (l.vertices.length >= 2) {
          breaklines.push({ vertices: l.vertices.map((v) => ({ n: v.n, e: v.e })) });
        }
      });

    if (breaklines.length === 0 && !boundary) {
      log(
        "Build TIN + Breaklines: no breaklines selected and no coded breakline strings found. " +
          "Process linework from coded points or select breakline linework first.",
        "info",
      );
    }

    log("Building constrained TIN surface…");
    const tin = await buildConstrainedTin(pts, { breaklines, boundary });
    if (tin.triangles.length === 0) {
      log("Build TIN + Breaklines: no triangles produced (check points / boundary).", "error");
      return;
    }
    // Replace any previous TOPO surface so repeated clicks do not pile triangles.
    model.surfaces.filter((s) => s.layerId === "TOPO").forEach((s) => cad.deleteSurface(s.id));
    const nonTopoCount = model.surfaces.filter((s) => s.layerId !== "TOPO").length;
    const name = `Surface ${nonTopoCount + 1} (constrained)`;
    cad.ensureLayerById("TOPO");
    cad.addSurface({ name, points: tin.points, triangles: tin.triangles, layerId: "TOPO" });
    log(
      `${name}: ${tin.triangles.length} triangles, ${breaklines.length} breakline(s)` +
        `${boundary ? ", clipped to selected boundary" : ""} (${lastBackend()}).`,
    );
    fitExtents();
  }, [surfacePoints, model.points, model.linework, model.surfaces, cad, log, fitExtents]);

  /** TIN clipped to the currently selected closed boundary (no breaklines). */
  const buildBoundarySurface = useCallback(async () => {
    const pts = surfacePoints();
    if (pts.length < 3) {
      log("Boundary Surface: need at least 3 points with elevations (Z).", "error");
      return;
    }
    const sel = cad.selection;
    const selLw = sel.type === "linework" && sel.id
      ? model.linework.find((l) => l.id === sel.id)
      : undefined;
    if (!selLw || !selLw.closed || selLw.vertices.length < 3) {
      log("Boundary Surface: select a closed boundary (polyline or boundary) to clip the TIN.", "error");
      return;
    }
    const boundary: SurfaceConstraint = { vertices: selLw.vertices.map((v) => ({ n: v.n, e: v.e })) };
    log("Building boundary-clipped TIN surface…");
    const tin = await buildConstrainedTin(pts, { breaklines: [], boundary });
    if (tin.triangles.length === 0) {
      log("Boundary Surface: no triangles produced (check points / boundary).", "error");
      return;
    }
    // Replace any previous TOPO surface so repeated clicks do not pile triangles.
    model.surfaces.filter((s) => s.layerId === "TOPO").forEach((s) => cad.deleteSurface(s.id));
    const nonTopoCount = model.surfaces.filter((s) => s.layerId !== "TOPO").length;
    const name = `Surface ${nonTopoCount + 1} (boundary)`;
    cad.ensureLayerById("TOPO");
    cad.addSurface({ name, points: tin.points, triangles: tin.triangles, layerId: "TOPO" });
    log(`${name}: ${tin.triangles.length} triangles clipped to selected boundary (${lastBackend()}).`);
    fitExtents();
  }, [surfacePoints, model.linework, model.surfaces, cad, log, fitExtents]);

  const buildContours = useCallback(async () => {
    if (model.surfaces.length === 0) {
      log("Contours: build a TIN surface first (Surface ▸ Build TIN).", "error");
      return;
    }
    const surface = await pickSurface(model.surfaces, dialog, "Choose surface for contours");
    if (!surface) return;

    const zValues = surface.points
      .map((p) => p.z)
      .filter((z): z is number => z != null && Number.isFinite(z));
    if (zValues.length === 0) { log("Contours: selected surface has no valid elevations.", "error"); return; }
    let zMin = Infinity, zMax = -Infinity;
    for (const z of zValues) { if (z < zMin) zMin = z; if (z > zMax) zMax = z; }
    const defaultInterval = autoContourInterval(zMax - zMin);

    const intervalRaw = await dialog.prompt(
      `Contour interval (m). Surface RL range ${zMin.toFixed(2)}–${zMax.toFixed(2)}:`,
      String(defaultInterval),
    );
    if (intervalRaw == null) return;
    const interval = parseFloat(intervalRaw);
    if (!Number.isFinite(interval) || interval <= 0) {
      log("Contours: interval must be a positive number.", "error");
      return;
    }

    // Every Nth contour is an "index" contour — drawn heavier and labelled,
    // exactly like a topographic sheet. Default 5 (the survey convention).
    // 0 disables index contours entirely (all intermediate).
    const everyRaw = await dialog.prompt("Index contour every N intervals (heavier + labelled; 0 = none):", "5");
    if (everyRaw == null) return;
    const indexEvery = Math.max(0, Math.round(parseFloat(everyRaw) ?? 5));

    const suggestedBase = Math.floor(zMin / interval) * interval;
    const baseRaw = await dialog.prompt(
      `Lowest contour elevation (m). Surface RL range ${zMin.toFixed(2)}–${zMax.toFixed(2)}, suggested base ${suggestedBase.toFixed(3)}:`,
      String(suggestedBase),
    );
    if (baseRaw == null) return;
    const base = parseFloat(baseRaw);
    if (!Number.isFinite(base)) {
      log("Contours: invalid base elevation.", "error");
      return;
    }

    const smoothRaw = await dialog.prompt("Smoothing passes (0 = raw chords):", "2");
    if (smoothRaw == null) return;
    const smooth = Math.max(0, Math.round(parseFloat(smoothRaw) || 0));

    log("Generating contours…");
    const lines = await generateContours(
      { points: surface.points, triangles: surface.triangles },
      interval,
      base,
      smooth,
    );
    if (lines.length === 0) {
      log("Contours: none generated for that interval.", "error");
      return;
    }
    let indexCount = 0;
    cad.ensureLayerById("CONTOURS");
    cad.ensureLayerById("CONTOURS_INDEX");
    cad.beginTransaction();
    try {
      for (const line of lines) {
        // A contour is an index contour when its step from the base is a whole
        // multiple of indexEvery. Rounded comparison avoids float drift. The
        // base must be subtracted first — a non-integral base shifts ALL
        // contours off the index elevations otherwise.
        const steps = Math.round((line.elevation - base) / interval);
        const isIndex = indexEvery > 0 && steps % indexEvery === 0;
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
    } finally {
      cad.endTransaction();
    }
    log(
      `Generated ${lines.length} contour(s) at ${interval} m — ` +
        (indexEvery > 0
          ? `${indexCount} index (every ${indexEvery}) labelled, ${lines.length - indexCount} intermediate (${lastBackend()}).`
          : `no index contours (${lastBackend()}).`),
    );
  }, [model.surfaces, cad, dialog, log]);

  const computeVolumeToElevation = useCallback(async () => {
    if (model.surfaces.length === 0) { log("Volume: build a TIN surface first.", "error"); return; }
    const surface = await pickSurface(model.surfaces, dialog, "Choose surface for volume calculation");
    if (!surface) return;

    const zValues = surface.points.map((p) => p.z).filter((z): z is number => z != null && Number.isFinite(z));
    if (zValues.length === 0) { log("Volume: selected surface has no valid elevations.", "error"); return; }
    let zMin = Infinity, zMax = -Infinity;
    for (const z of zValues) { if (z < zMin) zMin = z; if (z > zMax) zMax = z; }
    const zMean = zValues.reduce((a, b) => a + b, 0) / zValues.length;

    const optionValues: Record<string, number> = {
      [`Lowest (${zMin.toFixed(3)} m)`]: zMin,
      [`Highest (${zMax.toFixed(3)} m)`]: zMax,
      [`Mean (${zMean.toFixed(3)} m)`]: zMean,
    };
    const options = [...Object.keys(optionValues), "Custom value…"];
    const chosen = await dialog.select(
      `Choose a reference level for the volume calculation. Surface RL range ${zMin.toFixed(2)}–${zMax.toFixed(2)} m:`,
      options,
    );
    if (chosen == null) return;

    let reference: number;
    if (optionValues[chosen] != null) {
      reference = optionValues[chosen];
    } else {
      const rlRaw = await dialog.prompt(
        `Reference level / RL (m). Surface RL range ${zMin.toFixed(2)}–${zMax.toFixed(2)} m:`,
        zMean.toFixed(3),
      );
      if (rlRaw == null) return;
      reference = parseFloat(rlRaw);
      if (!Number.isFinite(reference)) { log("Volume: invalid reference level.", "error"); return; }
    }
    const tin = { points: surface.points, triangles: surface.triangles };
    const v = await volumeToElevation(tin, reference);
    // Build a coloured 3D earthworks model from the per-triangle cut/fill, so
    // the volume result is visible in the 3D view (red = cut, blue = fill).
    const cf = cutFillToElevation(tin, reference);
    cad.ensureLayerById("CUT_FILL");
    cad.addSurface({
      name: `Cut/Fill vs RL ${reference} m`,
      points: surface.points,
      triangles: surface.triangles,
      layerId: "CUT_FILL",
      cutFill: { ...cf, mode: "elevation", reference },
    });
    settingsApi.update({ view3d: true });
    fitExtents();
    log(
      `Volume vs RL ${reference} m — cut ${v.cut.toFixed(2)} m³ · fill ${v.fill.toFixed(2)} m³ · ` +
      `net ${v.net.toFixed(2)} m³ · plan ${fmtArea(v.planArea)} (${lastBackend()}). ` +
      `Cut/Fill model shown in 3D.`,
    );
  }, [model.surfaces, cad, dialog, settingsApi, fitExtents, log]);

  const computeVolumeBetween = useCallback(async () => {
    if (model.surfaces.length < 2) {
      log("Volume Δ: need two TIN surfaces (build a second one).", "error");
      return;
    }
    const top = await pickSurface(model.surfaces, dialog, "Choose the TOP (design/existing) surface");
    if (!top) return;
    const base = await pickSurface(
      model.surfaces.filter((s) => s.id !== top.id),
      dialog,
      "Choose the BASE (comparison) surface",
    );
    if (!base) return;
    const modeChoice = await dialog.select(
      "Footprint handling where the top surface extends beyond the base surface:",
      [
        "Overlap only — compute over the shared area (top points outside base are ignored)",
        "Strict — report an error if any top point lies outside the base footprint",
      ],
    );
    if (modeChoice == null) return;
    const footprintMode = modeChoice.startsWith("Strict") ? "strict" as const : "overlap" as const;
    const topTin = { points: top.points, triangles: top.triangles };
    const baseTin = { points: base.points, triangles: base.triangles };
    let v;
    try {
      v = await volumeBetween(topTin, baseTin, footprintMode);
    } catch (err) {
      log(err instanceof Error ? err.message : "Volume Δ failed.", "error");
      return;
    }
    // Coloured 3D earthworks model on the top surface (red = cut, blue = fill).
    const cf = cutFillBetween(topTin, baseTin);
    cad.ensureLayerById("CUT_FILL");
    cad.addSurface({
      name: `Cut/Fill "${top.name}" vs "${base.name}"`,
      points: top.points,
      triangles: top.triangles,
      layerId: "CUT_FILL",
      cutFill: { ...cf, mode: "between" },
    });
    settingsApi.update({ view3d: true });
    fitExtents();
    log(
      `Volume "${top.name}" vs "${base.name}" — cut ${v.cut.toFixed(2)} m³ · ` +
      `fill ${v.fill.toFixed(2)} m³ · net ${v.net.toFixed(2)} m³ (${lastBackend()}). ` +
      `Cut/Fill model shown in 3D.`,
    );
  }, [model.surfaces, cad, dialog, settingsApi, fitExtents, log]);

// ── Aspect shading palette (8-wind sector, conventional N…NW ramp) ──────────

function aspectColor(aspectDeg: number | null): string {
  // Flat triangles (null aspect) render neutral grey.
  if (aspectDeg == null || !Number.isFinite(aspectDeg)) return "#64748b";
  const ASPECT_COLORS = [
    "#dc2626", // N
    "#f97316", // NE
    "#eab308", // E
    "#84cc16", // SE
    "#16a34a", // S
    "#0d9488", // SW
    "#3b82f6", // W
    "#8b5cf6", // NW
  ];
  const sector = Math.floor((((aspectDeg % 360) + 360) % 360 + 22.5) / 45) % 8;
  return ASPECT_COLORS[sector];
}

  // ── Terrain analysis (slope / aspect / 3D area) ────────────────────────────

  const analyseSurfaceTerrain = useCallback(async () => {
    const surface = model.surfaces.find((s) => !s.cutFill && !s.slopeShade)
      ?? model.surfaces[model.surfaces.length - 1];
    if (!surface) {
      log("Terrain: build a TIN surface first (Surface ▸ Build TIN).", "error");
      return;
    }
    const tin = { points: surface.points, triangles: surface.triangles };
    const mode = await dialog.select(
      "Terrain shading mode:",
      ["Slope shading (steepness ramp)", "Aspect shading (8-wind sector)"],
    );
    if (mode == null) return;
    const asAspect = mode.startsWith("Aspect");

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
        color: asAspect ? aspectColor(t.aspectDeg) : slopeColor(t.slopeDeg, maxSlope),
      };
    });
    cad.addSurface({
      name: `${asAspect ? "Aspect" : "Slope"} shade — ${surface.name}`,
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
  }, [model.surfaces, cad, dialog, settingsApi, fitExtents, log, activeProject.name, activeProject.id]);

  // ── Long-section (chainage / level profile) extraction ────────────────────

  const extractProfile = useCallback(async () => {
    if (model.surfaces.length === 0) { log("Profile: build a TIN surface first (Surface ▸ Build TIN).", "error"); return; }
    const sel = cad.selection;
    const lw = sel.type === "linework" && sel.id
      ? model.linework.find((l) => l.id === sel.id)
      : undefined;
    if (!lw || lw.vertices.length < 2) {
      log("Profile: select a polyline or boundary to section along.", "error");
      return;
    }
    const surface = model.surfaces.length === 1
      ? model.surfaces[0]
      : await pickSurface(model.surfaces, dialog, "Choose surface to sample for the long section");
    if (!surface) return;
    const tin = { points: surface.points, triangles: surface.triangles };

    const totalLen = polylineLength(lw.vertices);
    const defInterval = Math.max(1, Math.round(totalLen / 60));
    const intRaw = await dialog.prompt(
      `Sampling interval (m). Chain length ${totalLen.toFixed(2)} m:`,
      String(defInterval),
    );
    if (intRaw == null) return;
    const interval = parseFloat(intRaw);
    if (!Number.isFinite(interval) || interval <= 0) {
      log("Profile: invalid interval.", "error");
      return;
    }

    // Walk the chain: sample at every even interval AND at every vertex
    // chainage (bends must appear in the profile).
    const stations: { ch: number; z: number | null }[] = [];
    let chain = 0;
    for (let i = 0; i < lw.vertices.length; i++) {
      if (i > 0) chain += inverse(lw.vertices[i - 1], lw.vertices[i]).distance;
      stations.push({ ch: chain, z: sampleZ(tin, lw.vertices[i].n, lw.vertices[i].e) });
      if (i + 1 < lw.vertices.length) {
        const segLen = inverse(lw.vertices[i], lw.vertices[i + 1]).distance;
        if (segLen <= 0) continue;
        for (let s = Math.ceil((chain + 1e-6) / interval) * interval; s < chain + segLen - 1e-9; s += interval) {
          const t = (s - chain) / segLen;
          const vx = lw.vertices[i];
          const vy = lw.vertices[i + 1];
          stations.push({ ch: s, z: sampleZ(tin, vx.n + (vy.n - vx.n) * t, vx.e + (vy.e - vx.e) * t) });
        }
      }
    }
    stations.sort((a, b) => a.ch - b.ch);
    const sampled = stations.filter((s) => s.z != null);
    if (sampled.length < 2) {
      log("Profile: the section line falls (mostly) outside the surface — fewer than 2 samples.", "error");
      return;
    }

    let zMin = Infinity, zMax = -Infinity, chMax = 0;
    for (const s of sampled) {
      if (s.z! < zMin) zMin = s.z!;
      if (s.z! > zMax) zMax = s.z!;
      if (s.ch > chMax) chMax = s.ch;
    }
    const zPad = Math.max(0.5, (zMax - zMin) * 0.1);
    zMin -= zPad; zMax += zPad;

    // Build a long-section chart as inline SVG for the report window.
    const W = 960, H = 360, ml = 70, mr = 24, mt = 26, mb = 46;
    const px = (ch: number) => ml + (chMax > 0 ? (ch / chMax) : 0) * (W - ml - mr);
    const py = (z: number) => mt + (1 - (z - zMin) / (zMax - zMin)) * (H - mt - mb);
    const zTicks: number[] = [];
    const zStep = (zMax - zMin) / 5;
    for (let i = 0; i <= 5; i++) zTicks.push(zMin + i * zStep);
    const grid = zTicks.map((z) =>
      `<line x1="${ml}" y1="${py(z)}" x2="${W - mr}" y2="${py(z)}" stroke="#d7dde5" stroke-width="0.8"/>` +
      `<text x="${ml - 8}" y="${py(z) + 3.5}" text-anchor="end" font-size="10" fill="#475569">${z.toFixed(2)}</text>`
    ).join("");
    const chTickStep = Math.max(interval * 2, chMax / 8);
    const chTicks: string[] = [];
    for (let ch = 0; ch <= chMax + 1e-6; ch += chTickStep) {
      chTicks.push(
        `<line x1="${px(ch)}" y1="${H - mb}" x2="${px(ch)}" y2="${H - mb + 5}" stroke="#94a3b8" stroke-width="1"/>` +
        `<text x="${px(ch)}" y="${H - mb + 18}" text-anchor="middle" font-size="10" fill="#475569">${ch.toFixed(0)}</text>`,
      );
    }
    // Break the chain into runs of valid samples (gaps stay gaps).
    const runs: string[] = [];
    let run: string[] = [];
    const flush = () => { if (run.length >= 2) runs.push(run.join(" ")); run = []; };
    for (const s of stations) {
      if (s.z == null || s.ch > chMax + 1) { flush(); continue; }
      run.push(`${px(s.ch).toFixed(1)},${py(s.z).toFixed(1)}`);
    }
    flush();
    const paths = runs
      .map((r) => `<polyline points="${r}" fill="none" stroke="#0369a1" stroke-width="1.8" stroke-linejoin="round"/>`)
      .join("");
    const svg =
      `<svg viewBox="0 0 ${W} ${H}" width="100%" style="background:#fff;border:1px solid #d7dde5;border-radius:8px">` +
      grid + chTicks.join("") +
      `<line x1="${ml}" y1="${H - mb}" x2="${W - mr}" y2="${H - mb}" stroke="#334155" stroke-width="1"/>` +
      `<line x1="${ml}" y1="${mt}" x2="${ml}" y2="${H - mb}" stroke="#334155" stroke-width="1"/>` +
      paths +
      `<text x="${ml - 46}" y="${mt - 8}" font-size="11" font-weight="bold" fill="#0f172a">RL (m)</text>` +
      `<text x="${W - mr}" y="${H - mb + 32}" text-anchor="end" font-size="11" font-weight="bold" fill="#0f172a">Chainage (m)</text>` +
      `</svg>`;

    const name = `Long Section — "${surface.name}"`;
    const body =
      `<h1>${name}</h1>` +
      `<p class="muted">Surface: ${surface.name} · interval ${interval} m · ${sampled.length} of ${stations.length} samples inside footprint · ` +
      `RL range ${zMin.toFixed(3)}–${zMax.toFixed(3)} m · chainage ${chMax.toFixed(3)} m</p>` +
      svg +
      `<table><thead><tr><th>Chainage (m)</th><th>RL (m)</th></tr></thead><tbody>` +
      stations
        .map((s) => `<tr><td>${s.ch.toFixed(3)}</td><td>${s.z == null ? "—" : s.z.toFixed(3)}</td></tr>`)
        .join("") +
      `</tbody></table>`;
    openReportWindow(name, body);

    // CSV via the project outputs store (and a direct download).
    const csv = ["Chainage,RL", ...stations.map((s) => `${s.ch.toFixed(3)},${s.z == null ? "" : s.z.toFixed(3)}`)].join("\n");
    downloadText("long-section.csv", csv, "text/csv");
    addProjectOutput(activeProject.dbId, {
      label: "Long Section (Chainage/Level)",
      description: `${stations.length} stations, interval ${interval} m`,
      fileName: `long-section-${activeProject.dbId}.csv`,
      mimeType: "text/csv",
      content: csv,
    });
    log(`Long section: ${sampled.length}/${stations.length} samples, RL ${zMin.toFixed(2)}–${zMax.toFixed(2)} m — chart opened + CSV saved.`);
  }, [model.surfaces, model.linework, cad, dialog, log, activeProject.dbId]);

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
    cad.beginTransaction();
    try {
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
    } finally {
      cad.endTransaction();
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

  const labelCoordinates = useCallback(() => {
    const sel = cad.selection;
    const items = sel.items && sel.items.length
      ? sel.items
      : sel.type && sel.id
        ? [{ type: sel.type, id: sel.id }]
        : [];
    const ptIds = new Set(items.filter((i) => i.type === "point").map((i) => i.id));
    const pts = model.points.filter((p) => ptIds.has(p.id));
    if (pts.length === 0) {
      log("Coord label: select one or more points first.", "error");
      return;
    }
    cad.ensureLayerById("TEXT");
    for (const p of pts) {
      const text = `${p.e.toFixed(settings.coordDecimals)}, ${p.n.toFixed(settings.coordDecimals)}`;
      cad.addText({ n: p.n, e: p.e + 2, text, layerId: "TEXT", color: activeColor });
    }
    log(`Placed ${pts.length} coordinate label(s).`);
  }, [cad, model.points, settings.coordDecimals, activeColor, log]);

  const commandCtx = useMemo(
    () => ({
      cad,
      bearingFormat,
      axisConvention: settings.axisConvention,
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
    }),
    [cad, bearingFormat, settings.axisConvention, changeTool, log, fitExtents, layoutApi, openLayout, handleAddLayout, requestPlot],
  );

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
          else if (sub === "explode") explodeSelection();
          break;
        case "project":
          if (sub === "points") setProjectPointsOpen(true);
          break;
        case "import":
          if (sub === "dxf") setImportDxfOpen(true);
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
          else if (sub === "inverse") runInverse();
          else if (sub === "area") runArea();
          else if (sub === "bearing-distance" || sub === "traverse") {
            log(`Switch to the COGO panel (right) to run "${sub}".`, "info");
          } else log(`Unhandled action: ${actionId}`, "error");
          break;
        case "surface":
          if (sub === "tin") void buildSurface();
          else if (sub === "tin-breaklines") void buildSurfaceWithBreaklines();
          else if (sub === "boundary") void buildBoundarySurface();
          else if (sub === "contours") void buildContours();
          else if (sub === "volume-elevation") void computeVolumeToElevation();
          else if (sub === "volume-between") void computeVolumeBetween();
          else if (sub === "terrain") void analyseSurfaceTerrain();
          else if (sub === "profile") void extractProfile();
          else if (sub === "cutfill-report") void exportCutFillReport();
          else if (sub === "clear-contours") {
            const contours = model.linework.filter(
              (lw) => lw.layerId === "CONTOURS" || lw.layerId === "CONTOURS_INDEX",
            );
            if (contours.length === 0) { log("No contours to clear.", "info"); break; }
            cad.beginTransaction();
            try {
              for (const lw of contours) cad.deleteLinework(lw.id);
            } finally {
              cad.endTransaction();
            }
            log(`Cleared ${contours.length} contour line(s).`);
          } else if (sub === "clear-surfaces") {
            const surfaces = [...model.surfaces];
            if (surfaces.length === 0) { log("No surfaces to clear.", "info"); break; }
            cad.beginTransaction();
            try {
              for (const s of surfaces) cad.deleteSurface(s.id);
            } finally {
              cad.endTransaction();
            }
            log(`Cleared ${surfaces.length} surface(s).`);
          }
          else log(`Unhandled action: ${actionId}`, "error");
          break;
        case "annotate":
          if (sub === "label-boundary") labelBoundarySegments();
          else if (sub === "label-area") labelArea();
          else if (sub === "label-coord") labelCoordinates();
          else log(`Unhandled action: ${actionId}`, "error");
          break;
        case "cmd":
          if (sub === "hatch") runCommand("HATCH", commandCtx);
          else log(`Unhandled action: ${actionId}`, "error");
          break;
        default:
          log(`Unhandled action: ${actionId}`, "error");
      }
    },
    [
      changeTool, fitExtents, deleteSelection, explodeSelection, exportDxf, exportCsv, exportReport,
      exportGeoJson, computeConvexHull, simplifySelection, reprojectDrawing,
      runIntersection, runInverse, runArea, buildSurface, buildSurfaceWithBreaklines, buildBoundarySurface, processLinework,
      buildContours, computeVolumeToElevation,
      computeVolumeBetween, exportCutFillReport, analyseSurfaceTerrain, extractProfile,
      labelBoundarySegments, labelArea, labelCoordinates, log, cad, openLayout,
      model.linework, model.surfaces, commandCtx,
    ],
  );

  const handleCommandSubmit = useCallback(
    (raw: string) => {
      log(raw, "input");

      // AutoCAD-style distance<angle entry while drawing lines/boundaries.
      if (
        pendingVertices.length > 0 &&
        (tool === "line" || tool === "boundary")
      ) {
        const parsed = parseDistanceBearing(raw, settings.angleEntry);
        if (parsed) {
          const start = pendingVertices[pendingVertices.length - 1];
          const end = forward(start, parsed.azimuthDeg, parsed.distance);
          setPendingVertices((verts) => [...verts, end]);
          const axis = axisBadgeLabels(settings.axisConvention);
          log(
            `Segment ${fmtDistance(parsed.distance)} m @ ${fmtBearing(parsed.azimuthDeg, bearingFormat)} ` +
              `→ ${axis.first} ${fmtCoord(end.e)} ${axis.second} ${fmtCoord(end.n)}`,
          );
          return;
        }
      }

      runCommand(raw, commandCtx);
    },
    [commandCtx, settings.angleEntry, settings.axisConvention, tool, pendingVertices, setPendingVertices, bearingFormat, log],
  );

  const handleToggle = useCallback((key: "snap" | "ortho" | "grid" | "osnap") => {
    settingsApi.toggle(key === "grid" ? "showGrid" : key);
  }, [settingsApi]);

  const handleMenuAction = useCallback(
    (action: CadMenuAction) => {
      switch (action) {
        case "file:project-points":
          setProjectPointsOpen(true);
          break;
        case "file:import-dxf":
          setImportDxfOpen(true);
          break;
        case "file:export-dxf":
          exportDxf();
          break;
        case "file:import-geojson":
          importGeoJson();
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
    [cad, deleteSelection, exportCsv, exportDxf, exportGeoJson, fitExtents, handleToggle, importGeoJson, log, openLayout, settingsApi],
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
        // The running LINE polyline is kept in sync by the effect above.
        if ((tool === "line" || tool === "boundary") && pendingVertices.length > 0) {
          setPendingVertices((v) => v.slice(0, -1));
          if (tool === "line" && pendingVertices.length <= 1) {
            log("Line cancelled.");
          }
          return;
        }
        deleteSelection();
        return;
      }
      // Close the current chain (AutoCAD "C") when drawing linework.
      if (ev.key.toLowerCase() === "c" && pendingVertices.length >= 2 &&
          (tool === "line" || tool === "boundary")) {
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
        b: "boundary", t: "text", m: "measure",
      };
      const t = map[ev.key.toLowerCase()];
      if (t) changeTool(t);
    },
    [commitPending, cancelPending, deleteSelection, selectAll, changeTool, handleToggle, pendingVertices, cad, lastTool, tool, repeatLastTool, log],
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
      { label: "CRS", value: cadCrsLabel(activeProject), title: cadCrsTooltip(activeProject) },
      { label: "PTS", value: model.points.length },
      { label: "LINES", value: model.linework.length },
      { label: "TEXT", value: model.texts.length },
      { label: "SURF", value: model.surfaces.length },
    ],
    [model.linework.length, model.points.length, model.texts.length, model.surfaces.length, activeProject],
  );

  const commandPrompt = useMemo(() => {
    if (tool === "line") {
      return pendingVertices.length === 0
        ? "LINE Specify first point:"
        : "Specify next point, type distance<bearing, or [Close/Undo] — Enter to finish:";
    }
    if (tool === "boundary") {
      return pendingVertices.length === 0
        ? "BOUNDARY Specify first corner point:"
        : "Specify next corner or [Close/Undo] — Enter to close:";
    }
    if (tool === "measure") return pendingVertices.length === 0 ? "Specify first point:" : "Specify second point:";
    if (tool === "circle") return pendingVertices.length === 0 ? "CIRCLE Specify centre point:" : "Specify point on circumference:";
    if (tool === "arc") {
      return pendingVertices.length === 0
        ? "ARC Specify start point:"
        : pendingVertices.length === 1
          ? "Specify second point on arc:"
          : "Specify end point of arc:";
    }
    if (tool === "rotate") return pendingVertices.length === 0 ? "ROTATE Specify base point:" : "Specify rotation angle (second point):";
    if (tool === "scale") return pendingVertices.length === 0 ? "SCALE Specify base point:" : "Scale factor applied.";
    if (tool === "mirror") return pendingVertices.length === 0 ? "MIRROR Specify first point of mirror line:" : "Specify second point of mirror line:";
    if (tool === "offset") return "OFFSET Specify signed offset distance (positive = left):";
    if (tool === "dim-linear") return pendingVertices.length === 0 ? "DIMLINEAR Specify first extension line origin:" : "Specify second extension line origin:";
    return "Command:";
  }, [tool, pendingVertices.length]);

  return (
    <section
      className="cad-workspace-shell"
      aria-label="Engineering Surveyor CAD workspace"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {projectPointsOpen && (
        <CadProjectPointsSelector
          projectId={activeProject.dbId}
          onImport={importProjectPoints}
          onClose={() => setProjectPointsOpen(false)}
        />
      )}

      <CadImportDxfDialog
        open={importDxfOpen}
        workspaceId={workspaceId}
        projectId={activeProject.dbId}
        onClose={() => setImportDxfOpen(false)}
        onImport={importCadFile}
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
            <span className="cad-project-ref hide-on-mobile">{activeProject.id} · {activeProject.name}</span>
          </div>
        </div>
        <div className="cad-topbar-center hide-on-mobile">
          <span className="cad-topbar-center-stats" aria-label="Drawing summary">
            {drawingStats.map((stat) => (
              <span className="cad-stat-pill" key={stat.label} title={stat.title ?? ''}>
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
            <div className="cad-layer-select-wrap">
              <select
                value={model.activeLayerId}
                onChange={(e) => cad.setActiveLayer(e.target.value)}
                aria-label="Active layer"
              >
                {model.layers.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <ChevronDown size={12} className="cad-layer-select-arrow" aria-hidden="true" />
            </div>
          </div>

          <div
            className="cad-layer-control"
            title={
              activeColor
                ? ((cad.selection.items?.length ?? (cad.selection.id ? 1 : 0)) > 0
                  ? "Set colour of selected objects"
                  : "Drawing colour for new objects")
                : "ByLayer — follows active layer colour"
            }
          >
            <span
              className={`cad-layer-swatch-inline ${activeColor ? "" : "bylayer"}`}
              style={{
                background: activeColor ?? "transparent",
                ...(activeColor ? {} : {
                  backgroundImage: "linear-gradient(45deg,#999 25%,transparent 25%,transparent 75%,#999 75%),linear-gradient(45deg,#999 25%,transparent 25%,transparent 75%,#999 75%)",
                  backgroundSize: "6px 6px",
                  backgroundPosition: "0 0, 3px 3px",
                }),
              }}
            />
            <div className="cad-layer-select-wrap">
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
              <ChevronDown size={12} className="cad-layer-select-arrow" aria-hidden="true" />
            </div>
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
          <button className="cad-exit-btn" type="button" onClick={exitCadWorkspace} title="Exit CAD workspace">Exit</button>
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
            projectId={activeProject.dbId}
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
            showPointElevations={settings.showPointElevations}
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
            onDynInput={handleDynInput}
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
          axisConvention={settings.axisConvention}
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

      <CadPointDialog
        open={pointForm.open}
        initialPointNo={pointForm.pointNo}
        initialCode={pointForm.code}
        initialElevation={pointForm.elev}
        title={pointForm.title}
        onSubmit={(v) => {
          if (!pointForm.world) return;
          const created = cad.addPoint({
            pointNo: v.pointNo,
            n: pointForm.world.n,
            e: pointForm.world.e,
            z: v.z,
            code: v.code,
            layerId: pointForm.layerId,
            color: activeColor,
          });
          const zText = v.z == null ? "no RL" : `RL ${v.z.toFixed(settings.coordDecimals)}`;
          const axis1 = axisBadgeLabels(settings.axisConvention);
          log(`Point ${created.pointNo} placed: ${axis1.first} ${fmtCoord(pointForm.world.e)} ${axis1.second} ${fmtCoord(pointForm.world.n)} · ${zText}`);
          setPointForm((prev) => ({
            ...prev,
            open: false,
            world: null,
            code: v.code,
            elev: v.z == null ? "" : String(v.z),
          }));
        }}
        onCancel={() => setPointForm((prev) => ({ ...prev, open: false, world: null }))}
      />

      <CadControlPointDialog
        open={controlPointForm.open}
        initialPointNo={controlPointForm.pointNo}
        initialCode={controlPointForm.code}
        axisConvention={settings.axisConvention}
        onSubmit={(v) => {
          const created = cad.addPoint({
            pointNo: v.pointNo,
            n: v.n,
            e: v.e,
            z: v.z,
            code: v.code,
            layerId: "CONTROL",
            color: activeColor,
          });
          const zText = v.z == null ? "no RL" : `RL ${v.z.toFixed(settings.coordDecimals)}`;
          const axis2 = axisBadgeLabels(settings.axisConvention);
          log(`Control point ${created.pointNo} placed: ${axis2.first} ${fmtCoord(v.e)} ${axis2.second} ${fmtCoord(v.n)} · ${zText}`);
          setControlPointForm({ open: true, pointNo: cad.nextPointNo(), code: v.code });
        }}
        onCancel={() => {
          setControlPointForm((prev) => ({ ...prev, open: false }));
          changeTool("select");
        }}
      />

      <CadReportDialog
        open={reportDialog?.open ?? false}
        title={reportDialog?.title ?? ""}
        html={reportDialog?.html ?? ""}
        onClose={() => setReportDialog(null)}
      />
    </section>
  );
}
