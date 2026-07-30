import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CadModelState } from "./cadModel.ts";
import type { BearingFormat } from "./survey/format.ts";
import type { AxisConvention } from "./cadSettings.ts";
import {
  buildPlotSvg,
  openPlotWindow,
  type PaperSize,
  type PaperOrientation,
  type PlotOptions,
  type TitleBlock,
} from "./io/plot.ts";
import {
  Printer,
  Download,
  ZoomIn,
  ZoomOut,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Maximize2,
  Hand,
  RotateCcw,
} from "lucide-react";
import { downloadText } from "./io/dxf.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Label } from "@/components/ui/label.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import { DialogTemplate } from "@/components/templates/DialogTemplate.tsx";

/** Survey-coordinate span of the visible geometry (for a sensible pan step). */
function modelSpan(model: CadModelState): number {
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  const visit = (n: number, e: number) => {
    if (e < minE) minE = e; if (e > maxE) maxE = e;
    if (n < minN) minN = n; if (n > maxN) maxN = n;
  };
  for (const p of model.points) visit(p.n, p.e);
  for (const l of model.linework) for (const v of l.vertices) visit(v.n, v.e);
  for (const t of model.texts) visit(t.n, t.e);
  for (const a of model.arcs) {
    visit(a.center.n + a.radius, a.center.e);
    visit(a.center.n - a.radius, a.center.e);
    visit(a.center.n, a.center.e + a.radius);
    visit(a.center.n, a.center.e - a.radius);
  }
  for (const c of model.circles) {
    visit(c.center.n + c.radius, c.center.e);
    visit(c.center.n - c.radius, c.center.e);
    visit(c.center.n, c.center.e + c.radius);
    visit(c.center.n, c.center.e - c.radius);
  }
  for (const el of model.ellipses) {
    const rot = el.rotation * (Math.PI / 180);
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2;
      const x = el.semiMajor * Math.cos(t);
      const y = el.semiMinor * Math.sin(t);
      visit(el.center.n + x * sinR + y * cosR, el.center.e + x * cosR - y * sinR);
    }
  }
  for (const d of model.dimensions) {
    visit(d.textPosition.n, d.textPosition.e);
    for (const v of d.defPoints) visit(v.n, v.e);
  }
  for (const h of model.hatches) {
    for (const v of h.vertices) visit(v.n, v.e);
    for (const hole of h.holes ?? []) for (const v of hole) visit(v.n, v.e);
  }
  if (!Number.isFinite(minE)) return 100;
  return Math.max(maxE - minE, maxN - minN, 1);
}

const DEFAULT_VIEW = { offsetE: 0, offsetN: 0, zoom: 1 };

interface CadPlotDialogProps {
  model: CadModelState;
  bearingFormat: BearingFormat;
  /** Axis-label convention (from CAD settings) applied to the graticule. */
  axisConvention?: AxisConvention;
  /** Seed for the title block / sheet defaults. */
  initialOptions: PlotOptions;
  /** Filename stem for SVG export. */
  fileStem: string;
  onClose: () => void;
  log: (text: string, kind?: "info" | "error") => void;
  /**
   * When set, the dialog persists every option change back to the owning
   * layout (paper space), so the sheet configuration is remembered — exactly
   * like editing a layout in AutoCAD.
   */
  onOptionsChange?: (options: PlotOptions) => void;
  /** Optional title shown in the header (e.g. the layout name). */
  layoutName?: string;
}

const PAPERS: PaperSize[] = ["A4", "A3", "A2", "A1", "A0"];
const SCALE_PRESETS = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];

/**
 * AutoCAD-style plot dialog: configure the sheet (paper, scale, title block,
 * furniture) and either print to PDF or export the print-ready SVG. A live
 * preview renders the exact sheet that will be printed.
 */
export function CadPlotDialog({
  model,
  bearingFormat,
  axisConvention = "yx",
  initialOptions,
  fileStem,
  onClose,
  log,
  onOptionsChange,
  layoutName,
}: CadPlotDialogProps) {
  const [opts, setOpts] = useState<PlotOptions>({ ...initialOptions, bearingFormat, axisConvention });

  // Persist option edits back to the owning layout (debounced via effect).
  useEffect(() => {
    onOptionsChange?.(opts);
    // Only react to local option edits; the callback identity is stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts]);

  const set = <K extends keyof PlotOptions>(key: K, value: PlotOptions[K]) =>
    setOpts((o) => ({ ...o, [key]: value }));

  const setTb = <K extends keyof TitleBlock>(key: K, value: TitleBlock[K]) =>
    setOpts((o) => ({ ...o, titleBlock: { ...o.titleBlock, [key]: value } }));

  // ── Layout viewport (AutoCAD pan/zoom inside paper space) ──────────────────
  const span = useMemo(() => modelSpan(model), [model]);
  const view = opts.view ?? DEFAULT_VIEW;

  const setView = (next: Partial<typeof DEFAULT_VIEW>) =>
    setOpts((o) => ({ ...o, view: { ...(o.view ?? DEFAULT_VIEW), ...next } }));

  /** Pan the sheet by a fraction of the drawing span (screen-relative). */
  const pan = (dxFrac: number, dyFrac: number) => {
    const step = (span / Math.max(view.zoom, 0.1)) * 0.15;
    setView({ offsetE: view.offsetE + dxFrac * step, offsetN: view.offsetN + dyFrac * step });
  };
  const zoomBy = (factor: number) =>
    setView({ zoom: Math.min(50, Math.max(0.02, view.zoom * factor)) });
  const resetView = () => setOpts((o) => ({ ...o, view: { ...DEFAULT_VIEW } }));
  const viewModified = view.offsetE !== 0 || view.offsetN !== 0 || view.zoom !== 1;

  const result = useMemo(() => buildPlotSvg(model, opts), [model, opts]);

  // ── Paper sheet canvas pan / zoom ──────────────────────────────────────────
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const [sheetPan, setSheetPan] = useState({ x: 0, y: 0 });
  const [sheetZoom, setSheetZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // Recenter paper sheet view whenever sheet paper size or orientation changes.
  useEffect(() => {
    setSheetPan({ x: 0, y: 0 });
    setSheetZoom(1);
  }, [opts.paper, opts.orientation]);

  // Measure the preview pane so the sheet can be sized to the largest fit.
  const [paneSize, setPaneSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    const wrap = previewWrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setPaneSize({ w: rect.width, h: rect.height });
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  const PREVIEW_PAD = 24; // px breathing room around the sheet
  const fitScale = useMemo(() => {
    if (paneSize.w <= 0 || paneSize.h <= 0) return 0;
    return Math.max(
      0,
      Math.min(
        (paneSize.w - PREVIEW_PAD) / result.paperW,
        (paneSize.h - PREVIEW_PAD) / result.paperH,
      ),
    );
  }, [paneSize, result.paperW, result.paperH]);

  const handlePreviewMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragStart.current = { x: e.clientX, y: e.clientY, panX: sheetPan.x, panY: sheetPan.y };
    setDragging(true);
  };

  const handlePreviewMouseMove = (e: React.MouseEvent) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setSheetPan({
      x: dragStart.current.panX + dx,
      y: dragStart.current.panY + dy,
    });
  };

  const endPreviewDrag = () => {
    dragStart.current = null;
    setDragging(false);
  };

  const zoomSheetBy = (factor: number, mx = 0, my = 0) => {
    setSheetZoom((prev) => {
      const next = Math.min(5, Math.max(0.2, prev * factor));
      const actual = next / prev;
      setSheetPan((p) => ({
        x: p.x * actual + mx * (1 - actual),
        y: p.y * actual + my * (1 - actual),
      }));
      return next;
    });
  };

  const handlePreviewWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey) {
      // Zoom at cursor (Pinch on trackpad, or Ctrl+Wheel)
      const wrap = previewWrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const mx = e.clientX - cx;
      const my = e.clientY - cy;
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomSheetBy(factor, mx, my);
    } else {
      // Pan/scroll the sheet (Standard mouse wheel or 2-finger swipe)
      // Browsers often convert Shift+Wheel to deltaX automatically.
      setSheetPan((p) => ({
        x: p.x - e.deltaX,
        y: p.y - e.deltaY,
      }));
    }
  };

  const resetSheetView = () => {
    setSheetPan({ x: 0, y: 0 });
    setSheetZoom(1);
  };

  const handleFitExtents = () => {
    resetView();
    log("Viewport reset to fit extents.");
  };

  const handlePrint = () => {
    openPlotWindow(result, `${opts.titleBlock.drawingTitle} — ${opts.titleBlock.projectName}`);
    log(`Plot opened — ${opts.paper} ${opts.orientation}, 1:${result.denominator}. Use the print dialog to save as PDF.`);
  };

  const handleExportSvg = () => {
    downloadText(`${fileStem}_plot.svg`, result.svg, "image/svg+xml");
    log(`Exported plot sheet to SVG (${opts.paper}, 1:${result.denominator}).`);
  };

  const tb = opts.titleBlock;

  return (
    <DialogTemplate
      open
      onOpenChange={onClose}
      title={layoutName ? `${layoutName} — paper space` : "Plot layout — printed format"}
      description="Configure the sheet and drag or wheel the preview to position the drawing."
      size="screen"
      className="p-0! gap-0 overflow-hidden border border-border/50 bg-background"
      contentClassName="p-0 overflow-hidden flex-1 min-h-0 flex flex-col"
      footer={
        <>
          <span className="text-xs text-muted-foreground mr-auto">
            {result.paperW} × {result.paperH} mm · scale 1:{result.denominator}
          </span>
          <Button type="button" variant="outline" size="sm" className="gap-1 text-xs" onClick={handleExportSvg}>
            <Download size={13} /> Export SVG
          </Button>
          <Button type="button" size="sm" className="gap-1 text-xs" onClick={handlePrint}>
            <Printer size={14} /> Print / PDF
          </Button>
        </>
      }
    >
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Controls ─────────────────────────────────────────────── */}
        <ScrollArea className="w-80 border-r border-border/60 bg-muted/20 shrink-0">
          <div className="p-4 space-y-5">
            <ControlSection title="Sheet">
              <FieldRow label="Paper size">
                <select
                  className="input-field"
                  value={opts.paper}
                  onChange={(e) => set("paper", e.target.value as PaperSize)}
                >
                  {PAPERS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </FieldRow>

              <FieldRow label="Orientation">
                <select
                  className="input-field"
                  value={opts.orientation}
                  onChange={(e) => set("orientation", e.target.value as PaperOrientation)}
                >
                  <option value="landscape">Landscape</option>
                  <option value="portrait">Portrait</option>
                </select>
              </FieldRow>

              <FieldRow label="Scale 1:">
                <select
                  className="input-field"
                  value={opts.scaleDenominator === "fit" ? "fit" : String(opts.scaleDenominator)}
                  onChange={(e) => set("scaleDenominator", e.target.value === "fit" ? "fit" : Number(e.target.value))}
                >
                  <option value="fit">Fit to sheet ({result.denominator})</option>
                  {SCALE_PRESETS.map((s) => <option key={s} value={s}>1:{s}</option>)}
                </select>
              </FieldRow>

              <FieldRow label="Margin (mm)">
                <Input
                  type="number"
                  min={4}
                  max={30}
                  className="h-8 text-xs"
                  value={opts.marginMm}
                  onChange={(e) => set("marginMm", Math.max(4, Math.min(30, Number(e.target.value) || 10)))}
                />
              </FieldRow>
            </ControlSection>

            <ControlSection title="Viewport (pan / zoom)">
              <div className="cad-plot-viewport-pad" role="group" aria-label="Pan and zoom the layout viewport">
                <Button type="button" size="icon" variant="outline" className="cad-vp-btn cad-vp-up h-8 w-8" title="Pan up" aria-label="Pan up" onClick={() => pan(0, 1)}>
                  <ArrowUp size={13} />
                </Button>
                <Button type="button" size="icon" variant="outline" className="cad-vp-btn cad-vp-left h-8 w-8" title="Pan left" aria-label="Pan left" onClick={() => pan(-1, 0)}>
                  <ArrowLeft size={13} />
                </Button>
                <Button type="button" size="icon" variant="outline" className="cad-vp-btn cad-vp-center h-8 w-8" title="Reset view" aria-label="Reset view" onClick={handleFitExtents}>
                  <Maximize2 size={12} />
                </Button>
                <Button type="button" size="icon" variant="outline" className="cad-vp-btn cad-vp-right h-8 w-8" title="Pan right" aria-label="Pan right" onClick={() => pan(1, 0)}>
                  <ArrowRight size={13} />
                </Button>
                <Button type="button" size="icon" variant="outline" className="cad-vp-btn cad-vp-down h-8 w-8" title="Pan down" aria-label="Pan down" onClick={() => pan(0, -1)}>
                  <ArrowDown size={13} />
                </Button>
              </div>

              <div className="flex items-center justify-between gap-2 mt-3">
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => zoomBy(1 / 1.25)}>
                  <ZoomOut size={13} /> Out
                </Button>
                <span className="text-xs font-medium tabular-nums text-muted-foreground" title="Viewport zoom factor">
                  {(view.zoom * 100).toFixed(0)}%
                </span>
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => zoomBy(1.25)}>
                  <ZoomIn size={13} /> In
                </Button>
              </div>

              {viewModified && (
                <Button type="button" variant="ghost" size="sm" className="w-full mt-2 h-7 text-xs gap-1" onClick={handleFitExtents}>
                  <RotateCcw size={12} /> Reset to extents
                </Button>
              )}
            </ControlSection>

            <ControlSection title="Sheet elements">
              <Toggle label="North arrow" checked={opts.showNorthArrow} onChange={(v) => set("showNorthArrow", v)} />
              <Toggle label="Scale bar" checked={opts.showScaleBar} onChange={(v) => set("showScaleBar", v)} />
              <Toggle label="Legend" checked={opts.showLegend} onChange={(v) => set("showLegend", v)} />
              <Toggle label="Coordinate grid" checked={opts.showGrid} onChange={(v) => set("showGrid", v)} />
              <Toggle label="Point labels" checked={opts.showPointLabels} onChange={(v) => set("showPointLabels", v)} />
              <Toggle label="Segment labels" checked={opts.showSegmentLabels} onChange={(v) => set("showSegmentLabels", v)} />
            </ControlSection>

            <ControlSection title="Title block">
              <TextField label="Drawing title" value={tb.drawingTitle} onChange={(v) => setTb("drawingTitle", v)} />
              <TextField label="Project" value={tb.projectName} onChange={(v) => setTb("projectName", v)} />
              <TextField label="Client" value={tb.client} onChange={(v) => setTb("client", v)} />
              <TextField label="Datum / CRS" value={tb.datum} onChange={(v) => setTb("datum", v)} />
              <TextField label="Surveyor" value={tb.surveyor} onChange={(v) => setTb("surveyor", v)} />
              <TextField label="Drawing No." value={tb.drawingNo} onChange={(v) => setTb("drawingNo", v)} />
              <TextField label="Sheet" value={tb.sheet} onChange={(v) => setTb("sheet", v)} />
              <TextField label="Revision" value={tb.revision} onChange={(v) => setTb("revision", v)} />
              <TextField label="Date" value={tb.date} onChange={(v) => setTb("date", v)} />
            </ControlSection>
          </div>
        </ScrollArea>

        {/* ── Live preview ─────────────────────────────────────────── */}
        <div className="flex-1 relative bg-[#0c0e12] flex flex-col min-w-0">
          <div
            ref={previewWrapRef}
            className={`absolute inset-0 flex items-center justify-center overflow-hidden select-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
            onMouseDown={handlePreviewMouseDown}
            onMouseMove={handlePreviewMouseMove}
            onMouseUp={endPreviewDrag}
            onMouseLeave={endPreviewDrag}
            onWheel={handlePreviewWheel}
          >
            <div
              className="cad-plot-preview-sheet shadow-2xl transition-transform duration-75 ease-out"
              style={
                fitScale > 0
                  ? {
                      width: result.paperW * fitScale * sheetZoom,
                      height: result.paperH * fitScale * sheetZoom,
                      transform: `translate3d(${sheetPan.x}px, ${sheetPan.y}px, 0)`,
                    }
                  : undefined
              }
              dangerouslySetInnerHTML={{ __html: result.svg }}
            />
          </div>
          <div className="absolute top-3 left-3 rounded-md bg-black/60 backdrop-blur-sm px-2.5 py-1 text-xs text-white/90 border border-white/10 z-10">
            {opts.paper} · {opts.orientation} · 1:{result.denominator}
          </div>
          <div className="absolute top-3 right-3 flex items-center gap-1 rounded-md bg-black/60 backdrop-blur-sm p-1 text-xs text-white/90 border border-white/10 z-10">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-white hover:bg-white/20"
              title="Zoom out sheet"
              onClick={() => zoomSheetBy(1 / 1.25)}
            >
              <ZoomOut size={12} />
            </Button>
            <button
              type="button"
              className="px-1.5 py-0.5 text-[11px] font-medium text-white/80 hover:text-white"
              title="Reset sheet view"
              onClick={resetSheetView}
            >
              {Math.round(sheetZoom * 100)}%
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-white hover:bg-white/20"
              title="Zoom in sheet"
              onClick={() => zoomSheetBy(1.25)}
            >
              <ZoomIn size={12} />
            </Button>
          </div>
          <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md bg-black/60 backdrop-blur-sm px-2.5 py-1 text-xs text-white/70 border border-white/10 z-10" aria-hidden="true">
            <Hand size={12} /> Drag or scroll to pan · Ctrl+Scroll to zoom
          </div>
        </div>
      </div>
    </DialogTemplate>
  );
}

function ControlSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2.5">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h4>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="cad-edit-row">
      <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = `plot-toggle-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className="cad-edit-row">
      <Label htmlFor={id} className="text-xs font-normal cursor-pointer">{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="cad-edit-row">
      <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
      <Input className="h-8 text-xs" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
