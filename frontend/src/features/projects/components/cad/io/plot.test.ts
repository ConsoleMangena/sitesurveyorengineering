import { describe, it, expect } from "vitest";
import { buildPlotSvg, DEFAULT_PLOT_OPTIONS, DEFAULT_TITLE_BLOCK, type PlotOptions } from "./plot.ts";
import { emptyModel, LAYER_PRESETS, type CadModelState } from "../cadModel.ts";

function sampleModel(): CadModelState {
  const m = emptyModel();
  m.layers = [
    ...m.layers,
    { id: "CONTROL", name: LAYER_PRESETS.CONTROL.name, color: LAYER_PRESETS.CONTROL.color, visible: true, locked: false },
    { id: "BOUNDARY", name: LAYER_PRESETS.BOUNDARY.name, color: LAYER_PRESETS.BOUNDARY.color, visible: true, locked: false },
  ];
  m.points = [
    { id: "p1", pointNo: "1001", n: 1000, e: 5000, z: 12.5, code: "CP", layerId: "CONTROL" },
    { id: "p2", pointNo: "1002", n: 1100, e: 5100, z: 13.0, code: "CP", layerId: "CONTROL" },
  ];
  m.linework = [
    {
      id: "l1",
      kind: "boundary",
      vertices: [
        { n: 1000, e: 5000 },
        { n: 1100, e: 5000 },
        { n: 1100, e: 5100 },
        { n: 1000, e: 5100 },
      ],
      layerId: "BOUNDARY",
      closed: true,
    },
  ];
  return m;
}

function opts(overrides: Partial<PlotOptions> = {}): PlotOptions {
  const tb = DEFAULT_TITLE_BLOCK("Riverside Estate", "RV-001", "Acme Ltd", "UTM 36S");
  return { ...DEFAULT_PLOT_OPTIONS(tb), ...overrides };
}

describe("buildPlotSvg", () => {
  it("emits a millimetre-sized SVG sheet at the chosen paper size", () => {
    const res = buildPlotSvg(sampleModel(), opts({ paper: "A3", orientation: "landscape" }));
    expect(res.paperW).toBe(420);
    expect(res.paperH).toBe(297);
    expect(res.svg).toContain('width="420mm"');
    expect(res.svg).toContain('height="297mm"');
  });

  it("includes the title-block metadata", () => {
    const res = buildPlotSvg(sampleModel(), opts());
    expect(res.svg).toContain("Riverside Estate");
    expect(res.svg).toContain("Acme Ltd");
    expect(res.svg).toContain("UTM 36S");
    expect(res.svg).toContain("SURVEY PLAN");
  });

  it("renders the north arrow, scale bar and legend when enabled", () => {
    const res = buildPlotSvg(sampleModel(), opts());
    expect(res.svg).toContain(">N<"); // north arrow label
    expect(res.svg).toContain("SCALE 1:");
    expect(res.svg).toContain("LEGEND");
  });

  it("omits furniture when toggled off", () => {
    const res = buildPlotSvg(
      sampleModel(),
      opts({ showNorthArrow: false, showScaleBar: false, showLegend: false }),
    );
    expect(res.svg).not.toContain("LEGEND");
    expect(res.svg).not.toContain("SCALE 1:");
  });

  it("computes a sensible fit scale and rounds it to a nice value", () => {
    const res = buildPlotSvg(sampleModel(), opts({ scaleDenominator: "fit" }));
    expect(res.denominator).toBeGreaterThan(0);
    // Fit scale should be one of the conventional surveying denominators.
    const nice = [1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000];
    const pow = Math.pow(10, Math.floor(Math.log10(res.denominator)));
    expect(nice.some((b) => Math.abs(b * pow - res.denominator) < 1e-6)).toBe(true);
  });

  it("honours an explicit plot scale", () => {
    const res = buildPlotSvg(sampleModel(), opts({ scaleDenominator: 500 }));
    expect(res.denominator).toBe(500);
    expect(res.svg).toContain("1:500");
  });

  it("still produces a valid sheet for an empty drawing", () => {
    const res = buildPlotSvg(emptyModel(), opts());
    expect(res.svg).toContain("<svg");
    expect(res.svg).toContain("SURVEY PLAN");
  });

  it("draws point labels only when requested", () => {
    const withLabels = buildPlotSvg(sampleModel(), opts({ showPointLabels: true }));
    expect(withLabels.svg).toContain("1001");
    const without = buildPlotSvg(sampleModel(), opts({ showPointLabels: false }));
    expect(without.svg).not.toContain("1001 CP");
  });

  it("ignores an identity viewport view", () => {
    const base = buildPlotSvg(sampleModel(), opts({ scaleDenominator: 500 }));
    const withView = buildPlotSvg(
      sampleModel(),
      opts({ scaleDenominator: 500, view: { offsetE: 0, offsetN: 0, zoom: 1 } }),
    );
    expect(withView.denominator).toBe(base.denominator);
    expect(withView.svg).toBe(base.svg);
  });

  it("keeps an explicit plot scale fixed regardless of viewport zoom", () => {
    // At a fixed scale, zoom only pans/clips — the printed ratio must not drift.
    const zoomed = buildPlotSvg(
      sampleModel(),
      opts({ scaleDenominator: 500, view: { offsetE: 0, offsetN: 0, zoom: 2 } }),
    );
    expect(zoomed.denominator).toBe(500);
  });

  it("tightens a fit scale when the viewport is zoomed in", () => {
    const fit = buildPlotSvg(sampleModel(), opts({ scaleDenominator: "fit" }));
    const zoomedIn = buildPlotSvg(
      sampleModel(),
      opts({ scaleDenominator: "fit", view: { offsetE: 0, offsetN: 0, zoom: 4 } }),
    );
    // Zooming in shows a smaller area, so the scale denominator decreases.
    expect(zoomedIn.denominator).toBeLessThan(fit.denominator);
    // Still a conventional surveying value.
    const nice = [1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];
    const pow = Math.pow(10, Math.floor(Math.log10(zoomedIn.denominator)));
    expect(nice.some((b) => Math.abs(b * pow - zoomedIn.denominator) < 1e-6)).toBe(true);
  });

  it("pans the sheet by re-centring on the view offset", () => {
    const centred = buildPlotSvg(sampleModel(), opts({ scaleDenominator: 500 }));
    const panned = buildPlotSvg(
      sampleModel(),
      opts({ scaleDenominator: 500, view: { offsetE: 50, offsetN: 50, zoom: 1 } }),
    );
    // A pan offset changes geometry placement (the SVG paths differ) without
    // altering the paper size or scale.
    expect(panned.paperW).toBe(centred.paperW);
    expect(panned.denominator).toBe(centred.denominator);
    expect(panned.svg).not.toBe(centred.svg);
  });
});
