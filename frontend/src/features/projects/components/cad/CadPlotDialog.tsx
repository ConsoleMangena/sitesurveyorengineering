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
import { Separator } from "@/components/ui/separator.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";

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

  // ── Interactive preview pan / zoom ─────────────────────────────────────────
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; offsetE: number; offsetN: number } | null>(null);

  const toSurveyDelta = (dxPx: number, dyPx: number) => {
    const wrap = previewWrapRef.current;
    if (!wrap || result.mmPerUnit <= 0) return { dE: 0, dN: 0 };
    const rect = wrap.getBoundingClientRect();
    const mmPerPx = result.paperW / rect.width;
    return {
      dE: (dxPx * mmPerPx) / result.mmPerUnit,
      dN: (-dyPx * mmPerPx) / result.mmPerUnit,
    };
  };

  const handlePreviewMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragStart.current = { x: e.clientX, y: e.clientY, offsetE: view.offsetE, offsetN: view.offsetN };
    setDragging(true);
  };

  const handlePreviewMouseMove = (e: React.MouseEvent) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    const { dE, dN } = toSurveyDelta(dx, dy);
    setView({
      offsetE: dragStart.current.offsetE - dE,
      offsetN: dragStart.current.offsetN - dN,
    });
  };

  const endPreviewDrag = () => {
    dragStart.current = null;
    setDragging(false);
  };

  const handlePreviewWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomBy(factor);
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
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-7xl h-[90vh] p-0 gap-0 overflow-hidden flex flex-col border border-border/50 bg-background">
        <DialogHeader className="px-5 py-4 border-b border-border/60 shrink-0">
          <DialogTitle className="text-base">
            {layoutName ? `${layoutName} — paper space` : "Plot layout — printed format"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Configure the sheet and drag or wheel the preview to position the drawing.
          </DialogDescription>
        </DialogHeader>

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
              className={`absolute inset-0 flex items-center justify-center overflow-hidden ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
              onMouseDown={handlePreviewMouseDown}
              onMouseMove={handlePreviewMouseMove}
              onMouseUp={endPreviewDrag}
              onMouseLeave={endPreviewDrag}
              onWheel={handlePreviewWheel}
            >
              <div
                className="cad-plot-preview-sheet shadow-2xl"
                dangerouslySetInnerHTML={{ __html: result.svg }}
              />
            </div>
            <div className="absolute top-3 left-3 rounded-md bg-black/60 backdrop-blur-sm px-2.5 py-1 text-xs text-white/90 border border-white/10">
              {opts.paper} · {opts.orientation} · 1:{result.denominator}
            </div>
            <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md bg-black/60 backdrop-blur-sm px-2.5 py-1 text-xs text-white/70 border border-white/10" aria-hidden="true">
              <Hand size={12} /> Drag to pan · Wheel to zoom
            </div>
          </div>
        </div>

        <DialogFooter className="px-5 py-3 border-t border-border/60 shrink-0 gap-2">
          <span className="text-xs text-muted-foreground mr-auto">
            {result.paperW} × {result.paperH} mm · scale 1:{result.denominator}
          </span>
          <Button type="button" variant="outline" size="sm" className="gap-1 text-xs" onClick={handleExportSvg}>
            <Download size={13} /> Export SVG
          </Button>
          <Button type="button" size="sm" className="gap-1 text-xs" onClick={handlePrint}>
            <Printer size={14} /> Print / PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
