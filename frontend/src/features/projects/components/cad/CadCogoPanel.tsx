import { useMemo, useState } from "react";
import type { CadModelState, SurveyPoint } from "./cadModel.ts";
import type { UseCadModel } from "./useCadModel.ts";
import {
  forward,
  inverse,
  intersectionBearingBearing,
  intersectionDistanceDistance,
  resectionTienstra,
  computeTraverse,
  reduceAngularTraverse,
  stakeOut,
  polygonArea,
  polylineLength,
  type TraverseAngleMode,
} from "./survey/cogo.ts";
import { stakeHorizontalCurve } from "./survey/alignmentBridge.ts";
import {
  lineLine,
  lineArc,
  arcArc,
  fitCircle,
  freeStation,
  type NE,
  type Observation,
  type FreeStationResult,
  type CircleFit,
} from "./survey/cogoBridge.ts";
import {
  fitHelmert,
  fitAffine,
  applyHelmert,
  applyAffine,
  helmertDiagnostics,
  affineDiagnostics,
  detectOutliers,
  type HelmertTransform,
  type AffineTransform,
  type TransformDiagnostics,
} from "./survey/transformBridge.ts";
import {
  fmtBearing,
  fmtCoord,
  fmtDistance,
  fmtArea,
  fmtPointRef,
  parseBearing,
  angleEntryToDeg,
  type BearingFormat,
  type AngleEntryMode,
} from "./survey/format.ts";
import {
  projectForward,
  projectInverse,
  nearestLoBelt,
  PROJECTION_PRESETS,
  type ProjectionDef,
} from "./survey/projection.ts";
import { axisBadgeLabels, type AxisConvention } from "./cadSettings.ts";

type AxisLabels = ReturnType<typeof axisBadgeLabels>;

interface CadCogoPanelProps {
  cad: UseCadModel;
  model: CadModelState;
  selection: { type: "point" | "linework" | "text" | "surface" | null; id: string | null };
  bearingFormat: BearingFormat;
  /** Coordinate axis label convention for readouts and input labels. */
  axisConvention?: AxisConvention;
  /** Angle entry convention used to interpret typed directions. */
  angleEntry?: AngleEntryMode;
  /** Decimal places used for coordinate readouts in point lists and results. */
  coordDecimals?: number;
  log: (text: string, kind?: "info" | "error") => void;
}

/**
 * Parse a typed direction honouring the user's angle-entry convention.
 * Quadrant strings (N45°30'E) are always accepted via `parseBearing`; if that
 * fails, fall back to the configured entry mode (packed DD.MMSS, gon, decimal
 * or D M S) so numeric input matches what the surveyor expects.
 */
function parseDirection(raw: string, mode: AngleEntryMode = "packed"): number | null {
  const viaBearing = parseBearing(raw);
  if (viaBearing != null) return viaBearing;
  return angleEntryToDeg(mode, raw);
}

type CogoMode =
  | "forward"
  | "inverse"
  | "stakeout"
  | "intersection-bb"
  | "intersection-dd"
  | "resection"
  | "traverse"
  | "angular-traverse"
  | "alignment-h"
  | "projection"
  | "area"
  | "line-line"
  | "line-arc"
  | "arc-arc"
  | "circle-fit"
  | "free-station"
  | "transform-helmert"
  | "transform-affine";

const MODE_LABELS: Record<CogoMode, string> = {
  forward: "Forward (Bearing + Dist)",
  inverse: "Inverse",
  stakeout: "Stake-out / Set-out",
  "intersection-bb": "Bearing–Bearing Intersection",
  "intersection-dd": "Distance–Distance Intersection",
  resection: "Resection (Tienstra)",
  traverse: "Traverse + Bowditch",
  "angular-traverse": "Angular Traverse Reduction",
  "alignment-h": "Horizontal Curve (set-out)",
  projection: "Geographic ↔ Grid (Lo./UTM)",
  area: "Area / Perimeter",
  "line-line": "Line–Line Intersection",
  "line-arc": "Line–Arc Intersection",
  "arc-arc": "Arc–Arc Intersection",
  "circle-fit": "Best-Fit Circle",
  "free-station": "Free-Station Resection",
  "transform-helmert": "Helmert Transform",
  "transform-affine": "Affine Transform",
};

const MODE_GROUPS: { label: string; modes: CogoMode[] }[] = [
  {
    label: "Basic",
    modes: ["forward", "inverse", "stakeout"],
  },
  {
    label: "Intersections",
    modes: ["intersection-bb", "intersection-dd", "line-line", "line-arc", "arc-arc", "resection", "free-station"],
  },
  {
    label: "Traverse",
    modes: ["traverse", "angular-traverse"],
  },
  {
    label: "Alignment",
    modes: ["alignment-h"],
  },
  {
    label: "Transform",
    modes: ["projection", "transform-helmert", "transform-affine"],
  },
  {
    label: "Geometry",
    modes: ["area", "circle-fit"],
  },
];

function findPoint(model: CadModelState, pno: string): SurveyPoint | null {
  return model.points.find((p) => p.pointNo === pno.trim()) ?? null;
}

/** Return the next numeric point number without relying on synchronous state updates. */
function nextPointBase(model: CadModelState): number {
  const nums = model.points
    .map((p) => parseInt(p.pointNo, 10))
    .filter((n) => Number.isFinite(n));
  return nums.length ? Math.max(...nums) + 1 : 1001;
}

function pointRef(model: CadModelState, p: SurveyPoint | null, axisConvention: AxisConvention = "yx"): string {
  return p ? fmtPointRef(p, 3, axisConvention) : "—";
}

export function CadCogoPanel({ cad, model, selection, bearingFormat, axisConvention = "yx", angleEntry = "packed", coordDecimals = 3, log }: CadCogoPanelProps) {
  const [mode, setMode] = useState<CogoMode>("forward");
  const axis = axisBadgeLabels(axisConvention);

  return (
    <div className="cad-panel-block cad-cogo-panel">
      <div className="cad-cogo-field" data-primary>
        <span>Tool</span>
        <select className="input-field" value={mode} onChange={(e) => setMode(e.target.value as CogoMode)}>
          {MODE_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.modes.map((m) => (
                <option key={m} value={m}>{MODE_LABELS[m]}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {mode === "forward" && <ForwardForm {...{ model, bearingFormat, angleEntry, axis, cad, log }} />}
      {mode === "inverse" && <InverseForm {...{ model, bearingFormat, axis, log }} />}
      {mode === "stakeout" && <StakeOutForm {...{ model, bearingFormat, axis, log }} />}
      {mode === "intersection-bb" && <IntersectionBbForm {...{ model, bearingFormat, angleEntry, axis, cad, log }} />}
      {mode === "intersection-dd" && <IntersectionDdForm {...{ model, axis, cad, log }} />}
      {mode === "resection" && <ResectionForm {...{ model, axis, cad, log }} />}
      {mode === "traverse" && <TraverseForm {...{ model, cad, axis, log }} />}
      {mode === "angular-traverse" && <AngularTraverseForm {...{ model, cad, bearingFormat, axis, log }} />}
      {mode === "alignment-h" && <HorizontalCurveForm {...{ model, cad, bearingFormat, axis, log }} />}
      {mode === "projection" && <ProjectionForm {...{ axis, cad, log }} />}
      {mode === "area" && <AreaForm {...{ model, selection, log, cad }} />}
      {mode === "line-line" && <LineLineForm {...{ model, axis, cad, log }} />}
      {mode === "line-arc" && <LineArcForm {...{ model, axis, cad, log }} />}
      {mode === "arc-arc" && <ArcArcForm {...{ model, axis, cad, log }} />}
      {mode === "circle-fit" && <CircleFitForm {...{ model, cad, log }} />}
      {mode === "free-station" && <FreeStationForm {...{ model, cad, bearingFormat, angleEntry, axis, log }} />}
      {mode === "transform-helmert" && <TransformForm kind="helmert" {...{ model, axis, cad, log }} />}
      {mode === "transform-affine" && <TransformForm kind="affine" {...{ model, axis, cad, log }} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Forward
// ─────────────────────────────────────────────────────────────────────────────
function ForwardForm({
  model,
  bearingFormat,
  angleEntry = "packed",
  axis,
  cad,
  log,
}: Pick<CadCogoPanelProps, "model" | "bearingFormat" | "angleEntry" | "cad" | "log"> & { axis: AxisLabels }) {
  const [fromPno, setFromPno] = useState("");
  const [brg, setBrg] = useState("");
  const [dist, setDist] = useState("");

  const compute = () => {
    const start = findPoint(model, fromPno);
    if (!start) { log("Forward: start point not found.", "error"); return; }
    const az = parseDirection(brg, angleEntry);
    if (az == null) { log("Forward: invalid bearing.", "error"); return; }
    const d = parseFloat(dist);
    if (!Number.isFinite(d) || d <= 0) { log("Forward: distance must be positive.", "error"); return; }
    const res = forward(start, az, d);
    const p = cad.addPoint({
      pointNo: cad.nextPointNo(),
      n: res.n,
      e: res.e,
      z: start.z,
      code: "FWD",
    });
    log(
      `Forward point ${p.pointNo}: ${axis.first} ${fmtCoord(res.e, 3)} ${axis.second} ${fmtCoord(res.n, 3)} ` +
        `from ${start.pointNo} @ ${fmtBearing(az, bearingFormat)} · ${fmtDistance(d)} m`,
    );
  };

  return (
    <fieldset className="cad-cogo-group">
      <legend>Forward computation</legend>
      <PointNumber label="From point" value={fromPno} onChange={setFromPno} model={model} axis={axis} />
      <TextRow label="Bearing" value={brg} onChange={setBrg} placeholder={`123.456 or N45°30'20"E`} />
      <NumberRow label="Distance (m)" value={dist} onChange={setDist} />
      <button className="cad-chip-btn" type="button" onClick={compute}>Compute &amp; place point</button>
    </fieldset>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inverse
// ─────────────────────────────────────────────────────────────────────────────
function InverseForm({
  model,
  bearingFormat,
  axis,
  log,
}: Pick<CadCogoPanelProps, "model" | "bearingFormat" | "log"> & { axis: AxisLabels }) {
  const [fromPno, setFromPno] = useState("");
  const [toPno, setToPno] = useState("");
  const [result, setResult] = useState<{ azimuth: number; distance: number; dX: number; dY: number } | null>(null);

  const compute = () => {
    const a = findPoint(model, fromPno);
    const b = findPoint(model, toPno);
    if (!a || !b) { log("Inverse: both points must exist.", "error"); return; }
    const r = inverse(a, b);
    setResult({ azimuth: r.azimuth, distance: r.distance, dX: b.n - a.n, dY: b.e - a.e });
    log(`Inverse ${a.pointNo}→${b.pointNo}: ${fmtBearing(r.azimuth, bearingFormat)} · ${fmtDistance(r.distance)} m`);
  };

  return (
    <fieldset className="cad-cogo-group">
      <legend>Inverse computation</legend>
      <PointNumber label="From point" value={fromPno} onChange={setFromPno} model={model} axis={axis} />
      <PointNumber label="To point" value={toPno} onChange={setToPno} model={model} axis={axis} />
      <button className="cad-chip-btn" type="button" onClick={compute}>Compute</button>
      {result && (
        <div className="cad-prop-list">
          <div><span>Bearing</span><strong>{fmtBearing(result.azimuth, bearingFormat)}</strong></div>
          <div><span>Distance</span><strong>{fmtDistance(result.distance)} m</strong></div>
          <div><span>Δ{axis.second}</span><strong>{fmtCoord(result.dX, 3)}</strong></div>
          <div><span>Δ{axis.first}</span><strong>{fmtCoord(result.dY, 3)}</strong></div>
        </div>
      )}
    </fieldset>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stake-out / set-out
// ─────────────────────────────────────────────────────────────────────────────
function StakeOutForm({
  model,
  bearingFormat,
  axis,
  log,
}: Pick<CadCogoPanelProps, "model" | "bearingFormat" | "log"> & { axis: AxisLabels }) {
  const [occ, setOcc] = useState("");
  const [bs, setBs] = useState("");
  const [target, setTarget] = useState("");
  const [result, setResult] = useState<ReturnType<typeof stakeOut> | null>(null);

  const compute = () => {
    const o = findPoint(model, occ);
    const b = findPoint(model, bs);
    const t = findPoint(model, target);
    if (!o || !b || !t) { log("Stake-out: occupied, backsight and target points must all exist.", "error"); return; }
    const res = stakeOut(o, b, t, o.z, t.z);
    setResult(res);
    log(
      `Stake ${t.pointNo} from ${o.pointNo} (BS ${b.pointNo}): ` +
        `turn ${fmtBearing(res.angleRight, bearingFormat)} right · ${fmtDistance(res.distance)} m`,
    );
  };

  return (
    <fieldset className="cad-cogo-group">
      <legend>Stake-out (set-out)</legend>
      <PointNumber label="Occupied station" value={occ} onChange={setOcc} model={model} axis={axis} />
      <PointNumber label="Backsight station" value={bs} onChange={setBs} model={model} axis={axis} />
      <PointNumber label="Design / target point" value={target} onChange={setTarget} model={model} axis={axis} />
      <p className="cad-panel-hint">
        Occupy a known point, orient on the backsight, then turn the angle-right and set the distance to the target.
      </p>
      <button className="cad-chip-btn" type="button" onClick={compute}>Compute set-out</button>
      {result && (
        <div className="cad-prop-list" style={{ marginTop: 8 }}>
          <div><span>Azimuth to target</span><strong>{fmtBearing(result.azimuth, bearingFormat)}</strong></div>
          <div><span>Backsight azimuth</span><strong>{fmtBearing(result.backsightAzimuth, bearingFormat)}</strong></div>
          <div><span>Angle right</span><strong>{fmtBearing(result.angleRight, bearingFormat)}</strong></div>
          <div><span>Distance</span><strong>{fmtDistance(result.distance)} m</strong></div>
          <div><span>Along line</span><strong>{fmtCoord(result.along, 3)} m</strong></div>
          <div><span>Offset (+R/−L)</span><strong>{fmtCoord(result.offset, 3)} m</strong></div>
          {result.deltaZ != null && <div><span>ΔH (cut/fill)</span><strong>{fmtCoord(result.deltaZ, 3)} m</strong></div>}
        </div>
      )}
    </fieldset>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bearing–Bearing intersection
// ─────────────────────────────────────────────────────────────────────────────
function IntersectionBbForm({
  model,
  bearingFormat,
  angleEntry = "packed",
  axis,
  cad,
  log,
}: Pick<CadCogoPanelProps, "model" | "bearingFormat" | "angleEntry" | "cad" | "log"> & { axis: AxisLabels }) {
  const [p1, setP1] = useState("");
  const [brg1, setBrg1] = useState("");
  const [p2, setP2] = useState("");
  const [brg2, setBrg2] = useState("");

  const compute = () => {
    const a = findPoint(model, p1);
    const b = findPoint(model, p2);
    if (!a || !b) { log("Intersection BB: both points must exist.", "error"); return; }
    const az1 = parseDirection(brg1, angleEntry);
    const az2 = parseDirection(brg2, angleEntry);
    if (az1 == null || az2 == null) { log("Intersection BB: invalid bearing.", "error"); return; }
    const res = intersectionBearingBearing(a, az1, b, az2);
    if (!res) { log("Intersection BB: rays are parallel.", "error"); return; }
    const pt = cad.addPoint({ pointNo: cad.nextPointNo(), n: res.n, e: res.e, z: null, code: "INT-BB" });
    log(
      `Intersection BB point ${pt.pointNo}: ${axis.first} ${fmtCoord(res.e, 3)} ${axis.second} ${fmtCoord(res.n, 3)} ` +
        `(${fmtBearing(az1, bearingFormat)} from ${a.pointNo}, ${fmtBearing(az2, bearingFormat)} from ${b.pointNo})`,
    );
  };

  return (
    <fieldset className="cad-cogo-group">
      <legend>Bearing–bearing intersection</legend>
      <PointNumber label="Point 1" value={p1} onChange={setP1} model={model} axis={axis} />
      <TextRow label="Bearing 1" value={brg1} onChange={setBrg1} />
      <PointNumber label="Point 2" value={p2} onChange={setP2} model={model} axis={axis} />
      <TextRow label="Bearing 2" value={brg2} onChange={setBrg2} />
      <button className="cad-chip-btn" type="button" onClick={compute}>Compute &amp; place point</button>
    </fieldset>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Distance–Distance intersection
// ─────────────────────────────────────────────────────────────────────────────
function IntersectionDdForm({
  model,
  axis,
  cad,
  log,
}: Pick<CadCogoPanelProps, "model" | "cad" | "log"> & { axis: AxisLabels }) {
  const [p1, setP1] = useState("");
  const [r1, setR1] = useState("");
  const [p2, setP2] = useState("");
  const [r2, setR2] = useState("");

  const compute = () => {
    const a = findPoint(model, p1);
    const b = findPoint(model, p2);
    if (!a || !b) { log("Intersection DD: both points must exist.", "error"); return; }
    const d1 = parseFloat(r1);
    const d2 = parseFloat(r2);
    if (!Number.isFinite(d1) || !Number.isFinite(d2)) { log("Intersection DD: invalid distance.", "error"); return; }
    const sols = intersectionDistanceDistance(a, d1, b, d2);
    if (sols.length === 0) { log("Intersection DD: circles do not intersect.", "error"); return; }
    let pno = nextPointBase(model);
    for (const s of sols) {
      const pt = cad.addPoint({ pointNo: String(pno++), n: s.n, e: s.e, z: null, code: "INT-DD" });
      log(`Intersection DD point ${pt.pointNo}: ${axis.first} ${fmtCoord(s.e, 3)} ${axis.second} ${fmtCoord(s.n, 3)}`);
    }
  };

  return (
    <fieldset className="cad-cogo-group">
      <legend>Distance–distance intersection</legend>
      <PointNumber label="Point 1" value={p1} onChange={setP1} model={model} axis={axis} />
      <NumberRow label="Distance 1 (m)" value={r1} onChange={setR1} />
      <PointNumber label="Point 2" value={p2} onChange={setP2} model={model} axis={axis} />
      <NumberRow label="Distance 2 (m)" value={r2} onChange={setR2} />
      <button className="cad-chip-btn" type="button" onClick={compute}>Compute &amp; place point(s)</button>
    </fieldset>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Resection (Tienstra)
// ─────────────────────────────────────────────────────────────────────────────
function ResectionForm({
  model,
  axis,
  cad,
  log,
}: Pick<CadCogoPanelProps, "model" | "cad" | "log"> & { axis: AxisLabels }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [c, setC] = useState("");
  const [alpha, setAlpha] = useState("");
  const [beta, setBeta] = useState("");
  const [gamma, setGamma] = useState("");

  const compute = () => {
    const A = findPoint(model, a);
    const B = findPoint(model, b);
    const Cp = findPoint(model, c);
    if (!A || !B || !Cp) { log("Resection: all three reference points must exist.", "error"); return; }
    const angA = parseFloat(alpha);
    const angB = parseFloat(beta);
    const angC = parseFloat(gamma);
    if ([angA, angB, angC].some((x) => !Number.isFinite(x))) {
      log("Resection: angles must be numeric (decimal degrees).", "error"); return;
    }
    const res = resectionTienstra(A, B, Cp, angA, angB, angC);
    if (!res) { log("Resection: geometry is degenerate.", "error"); return; }
    const pt = cad.addPoint({ pointNo: cad.nextPointNo(), n: res.n, e: res.e, z: null, code: "RESECT" });
    log(`Resection point ${pt.pointNo}: ${axis.first} ${fmtCoord(res.e, 3)} ${axis.second} ${fmtCoord(res.n, 3)}`);
  };

  return (
    <fieldset className="cad-cogo-group">
      <legend>Three-point resection (Tienstra)</legend>
      <PointNumber label="Station A" value={a} onChange={setA} model={model} axis={axis} />
      <PointNumber label="Station B" value={b} onChange={setB} model={model} axis={axis} />
      <PointNumber label="Station C" value={c} onChange={setC} model={model} axis={axis} />
      <NumberRow label="Angle BPC (α)" value={alpha} onChange={setAlpha} />
      <NumberRow label="Angle CPA (β)" value={beta} onChange={setBeta} />
      <NumberRow label="Angle APB (γ)" value={gamma} onChange={setGamma} />
      <p className="cad-panel-hint">Angles in decimal degrees. α + β + γ must equal 360°.</p>
      <button className="cad-chip-btn" type="button" onClick={compute}>Compute &amp; place point</button>
    </fieldset>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Traverse
// ─────────────────────────────────────────────────────────────────────────────
function TraverseForm({
  model,
  cad,
  axis,
  log,
}: Pick<CadCogoPanelProps, "model" | "cad" | "log"> & { axis: AxisLabels }) {
  const [type, setType] = useState<"closed-loop" | "closed-link" | "open">("closed-loop");
  const [startPno, setStartPno] = useState("");
  const [closePno, setClosePno] = useState("");
  const [legs, setLegs] = useState<{ azimuth: string; distance: string }[]>([
    { azimuth: "", distance: "" },
  ]);
  const [result, setResult] = useState<ReturnType<typeof computeTraverse> | null>(null);

  const addLeg = () => setLegs((prev) => [...prev, { azimuth: "", distance: "" }]);
  const removeLeg = (idx: number) => setLegs((prev) => prev.filter((_, i) => i !== idx));
  const updateLeg = (idx: number, key: keyof (typeof legs)[number], value: string) =>
    setLegs((prev) => prev.map((leg, i) => (i === idx ? { ...leg, [key]: value } : leg)));

  const compute = () => {
    const start = findPoint(model, startPno);
    if (!start) { log("Traverse: start point not found.", "error"); return; }
    const parsedLegs = legs.map((leg, i) => {
      const az = parseBearing(leg.azimuth);
      const dist = parseFloat(leg.distance);
      if (az == null) { log(`Traverse: invalid bearing on leg ${i + 1}.`, "error"); return null; }
      if (!Number.isFinite(dist) || dist <= 0) { log(`Traverse: invalid distance on leg ${i + 1}.`, "error"); return null; }
      return { azimuth: az, distance: dist };
    });
    if (parsedLegs.some((l) => l == null)) return;

    let closingPoint: { n: number; e: number } | undefined;
    if (type === "closed-link") {
      const cp = findPoint(model, closePno);
      if (!cp) { log("Traverse: closing point not found.", "error"); return; }
      closingPoint = cp;
    }

    const res = computeTraverse(start, parsedLegs as { azimuth: number; distance: number }[], {
      type,
      closingPoint,
    });
    setResult(res);

    // Create traverse points and linework from adjusted coordinates.
    const vertices: { n: number; e: number }[] = [start];
    let pno = nextPointBase(model);
    for (let i = 1; i < res.adjusted.length; i++) {
      const coord = res.adjusted[i];
      cad.addPoint({ pointNo: String(pno++), n: coord.n, e: coord.e, z: null, code: "TRV" });
      vertices.push(coord);
    }
    cad.ensureLayerById("TRAVERSE");
    cad.addLinework({
      kind: "polyline",
      vertices,
      closed: type === "closed-loop",
      layerId: "TRAVERSE",
    });

    const prec = Number.isFinite(res.precision) ? `1:${Math.round(res.precision).toLocaleString()}` : "exact";
    log(
      `${type} traverse computed — ${res.perimeter.toFixed(2)} m perimeter, ` +
        `misclosure ${res.linearMisclosure.toFixed(3)} m, precision ${prec}`,
    );
  };

  return (
    <fieldset className="cad-cogo-group">
      <legend>Traverse computation</legend>
      <PointNumber label="Start point" value={startPno} onChange={setStartPno} model={model} axis={axis} />
      <div className="cad-cogo-field">
        <span>Type</span>
        <select className="input-field" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="closed-loop">Closed loop</option>
          <option value="closed-link">Closed link</option>
          <option value="open">Open</option>
        </select>
      </div>
      {type === "closed-link" && (
        <PointNumber label="Closing point" value={closePno} onChange={setClosePno} model={model} axis={axis} />
      )}

      <div className="cad-cogo-table-wrap">
        <table className="cad-cogo-table">
          <thead>
            <tr><th>Leg</th><th>Bearing</th><th>Dist (m)</th><th /></tr>
          </thead>
          <tbody>
            {legs.map((leg, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <input
                    className="input-field"
                    value={leg.azimuth}
                    onChange={(e) => updateLeg(i, "azimuth", e.target.value)}
                    placeholder="Bearing (dd.d or N45°E)"
                  />
                </td>
                <td>
                  <input
                    className="input-field"
                    type="number"
                    value={leg.distance}
                    onChange={(e) => updateLeg(i, "distance", e.target.value)}
                  />
                </td>
                <td>
                  <button type="button" className="cad-mini-icon-btn" onClick={() => removeLeg(i)} title="Remove leg">×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="cad-chip-btn" onClick={addLeg}>Add leg</button>
      <button type="button" className="cad-chip-btn" onClick={compute}>Compute traverse</button>

      {result && (
        <div className="cad-prop-list" style={{ marginTop: 8 }}>
          <div><span>Perimeter</span><strong>{fmtDistance(result.perimeter)} m</strong></div>
          <div><span>Misclosure</span><strong>{fmtDistance(result.linearMisclosure)} m</strong></div>
          <div><span>Precision</span><strong>{Number.isFinite(result.precision) ? `1:${Math.round(result.precision).toLocaleString()}` : "exact"}</strong></div>
        </div>
      )}
    </fieldset>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Angular traverse reduction (observed angles → balanced azimuths → coords)
// ─────────────────────────────────────────────────────────────────────────────
function AngularTraverseForm({
  model,
  cad,
  bearingFormat,
  axis,
  log,
}: Pick<CadCogoPanelProps, "model" | "cad" | "bearingFormat" | "log"> & { axis: AxisLabels }) {
  const [startPno, setStartPno] = useState("");
  const [startAz, setStartAz] = useState("");
  const [angleMode, setAngleMode] = useState<TraverseAngleMode>("interior");
  const [closed, setClosed] = useState(true);
  const [rows, setRows] = useState<{ angle: string; distance: string }[]>([
    { angle: "", distance: "" },
  ]);
  const [result, setResult] = useState<ReturnType<typeof reduceAngularTraverse> | null>(null);

  const addRow = () => setRows((prev) => [...prev, { angle: "", distance: "" }]);
  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx));
  const updateRow = (idx: number, key: "angle" | "distance", value: string) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));

  const compute = () => {
    const start = findPoint(model, startPno);
    if (!start) { log("Angular traverse: start point not found.", "error"); return; }
    const az0 = parseBearing(startAz) ?? parseFloat(startAz);
    if (!Number.isFinite(az0)) { log("Angular traverse: invalid starting azimuth.", "error"); return; }
    const obs = rows.map((r, i) => {
      const angle = parseBearing(r.angle) ?? parseFloat(r.angle);
      const distance = parseFloat(r.distance);
      if (!Number.isFinite(angle)) { log(`Angular traverse: invalid angle on row ${i + 1}.`, "error"); return null; }
      if (!Number.isFinite(distance) || distance <= 0) { log(`Angular traverse: invalid distance on row ${i + 1}.`, "error"); return null; }
      return { angle, distance };
    });
    if (obs.some((o) => o == null)) return;

    const ang = reduceAngularTraverse(az0, obs as { angle: number; distance: number }[], angleMode, closed);
    setResult(ang);

    // Feed balanced azimuths into the linear traverse computation & draw it.
    const tr = computeTraverse(start, ang.legs, { type: closed ? "closed-loop" : "open" });
    const vertices: { n: number; e: number }[] = [start];
    let pno = nextPointBase(model);
    for (let i = 1; i < tr.adjusted.length; i++) {
      const coord = tr.adjusted[i];
      cad.addPoint({ pointNo: String(pno++), n: coord.n, e: coord.e, z: null, code: "TRV" });
      vertices.push(coord);
    }
    cad.addLinework({ kind: "polyline", vertices, closed, layerId: "TRAVERSE" });

    const prec = Number.isFinite(tr.precision) ? `1:${Math.round(tr.precision).toLocaleString()}` : "exact";
    log(
      `Angular traverse — angular misclosure ${ang.angularMisclosure.toFixed(4)}° ` +
        `(${ang.perAngleCorrection >= 0 ? "+" : ""}${ang.perAngleCorrection.toFixed(4)}°/angle), ` +
        `linear misclosure ${tr.linearMisclosure.toFixed(3)} m, precision ${prec}`,
    );
  };

  return (
    <fieldset className="cad-cogo-group">
      <legend>Angular traverse reduction</legend>
      <PointNumber label="Start point" value={startPno} onChange={setStartPno} model={model} axis={axis} />
      <TextRow label="Start azimuth" value={startAz} onChange={setStartAz} placeholder="Orientation of first leg (e.g. 45.3020)" />
      <div className="cad-cogo-field">
        <span>Angle type</span>
        <select className="input-field" value={angleMode} onChange={(e) => setAngleMode(e.target.value as TraverseAngleMode)}>
          <option value="interior">Interior angles</option>
          <option value="deflection">Deflection angles (+R/−L)</option>
          <option value="angle-right">Angle right (from back station)</option>
        </select>
      </div>
      <label className="cad-cogo-field" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
        <span>Closed loop (check &amp; balance angular misclosure)</span>
      </label>

      <div className="cad-cogo-table-wrap">
        <table className="cad-cogo-table">
          <thead>
            <tr><th>Stn</th><th>Angle</th><th>Leg dist (m)</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><input className="input-field" value={r.angle} onChange={(e) => updateRow(i, "angle", e.target.value)} placeholder="deg or dd.mmss" /></td>
                <td><input className="input-field" type="number" value={r.distance} onChange={(e) => updateRow(i, "distance", e.target.value)} /></td>
                <td><button type="button" className="cad-mini-icon-btn" onClick={() => removeRow(i)} title="Remove">×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="cad-chip-btn" onClick={addRow}>Add station</button>
      <button type="button" className="cad-chip-btn" onClick={compute}>Reduce &amp; draw</button>

      {result && (
        <div className="cad-prop-list" style={{ marginTop: 8 }}>
          <div><span>Σ angles</span><strong>{result.angleSum.toFixed(4)}°</strong></div>
          {result.hasAngularClosure && (
            <>
              <div><span>Theoretical Σ</span><strong>{result.theoreticalSum.toFixed(4)}°</strong></div>
              <div><span>Angular misclose</span><strong>{result.angularMisclosure.toFixed(4)}°</strong></div>
              <div><span>Correction / angle</span><strong>{result.perAngleCorrection.toFixed(4)}°</strong></div>
            </>
          )}
          <div><span>First leg azimuth</span><strong>{fmtBearing(result.azimuths[0] ?? 0, bearingFormat)}</strong></div>
        </div>
      )}
    </fieldset>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Horizontal circular curve set-out
// ─────────────────────────────────────────────────────────────────────────────
function HorizontalCurveForm({
  model,
  cad,
  bearingFormat,
  axis,
  log,
}: Pick<CadCogoPanelProps, "model" | "cad" | "bearingFormat" | "log"> & { axis: AxisLabels }) {
  const [piPno, setPiPno] = useState("");
  const [backAz, setBackAz] = useState("");
  const [fwdAz, setFwdAz] = useState("");
  const [radius, setRadius] = useState("");
  const [interval, setInterval] = useState("10");
  const [result, setResult] = useState<Awaited<ReturnType<typeof stakeHorizontalCurve>>>(null);

  const compute = async () => {
    const pi = findPoint(model, piPno);
    if (!pi) { log("Horizontal curve: PI point not found.", "error"); return; }
    const ba = parseBearing(backAz) ?? parseFloat(backAz);
    const fa = parseBearing(fwdAz) ?? parseFloat(fwdAz);
    const r = parseFloat(radius);
    const iv = parseFloat(interval);
    if (!Number.isFinite(ba) || !Number.isFinite(fa)) { log("Horizontal curve: invalid tangent azimuth.", "error"); return; }
    if (!Number.isFinite(r) || r <= 0) { log("Horizontal curve: radius must be positive.", "error"); return; }
    const res = await stakeHorizontalCurve(pi, ba, fa, r, Number.isFinite(iv) && iv > 0 ? iv : 0);
    if (!res) { log("Horizontal curve: degenerate geometry (deflection 0° or 180°).", "error"); return; }
    setResult(res);

    const { curve, stations } = res;
    // Place PC / PT / stake points, and draw the curve as a polyline.
    let pno = nextPointBase(model);
    const verts: { n: number; e: number }[] = [];
    cad.addPoint({ pointNo: String(pno++), n: curve.pc.n, e: curve.pc.e, z: null, code: "PC" });
    cad.addPoint({ pointNo: String(pno++), n: curve.pt.n, e: curve.pt.e, z: null, code: "PT" });
    for (const s of stations) {
      cad.addPoint({ pointNo: String(pno++), n: s.point.n, e: s.point.e, z: null, code: "CURVE" });
      verts.push({ n: s.point.n, e: s.point.e });
    }
    if (verts.length >= 2) {
      cad.ensureLayerById("SETOUT");
      cad.addLinework({ kind: "polyline", vertices: verts, closed: false, layerId: "SETOUT" });
    }
    log(
      `Horizontal curve R${curve.radius} Δ${curve.deflection.toFixed(4)}° — ` +
        `T ${fmtDistance(curve.tangent)} m, L ${fmtDistance(curve.length)} m, ${stations.length} stake pts.`,
    );
  };

  return (
    <fieldset className="cad-cogo-group">
      <legend>Horizontal circular curve</legend>
      <PointNumber label="PI (intersection point)" value={piPno} onChange={setPiPno} model={model} axis={axis} />
      <TextRow label="Back tangent azimuth" value={backAz} onChange={setBackAz} placeholder="e.g. 0 or N30°E" />
      <TextRow label="Forward tangent azimuth" value={fwdAz} onChange={setFwdAz} placeholder="e.g. 90" />
      <NumberRow label="Radius (m)" value={radius} onChange={setRadius} />
      <NumberRow label="Stake interval (m)" value={interval} onChange={setInterval} />
      <button className="cad-chip-btn" type="button" onClick={() => void compute()}>Solve &amp; stake curve</button>
      {result && (
        <div className="cad-prop-list" style={{ marginTop: 8 }}>
          <div><span>Deflection Δ</span><strong>{fmtBearing(result.curve.deflection, bearingFormat)}</strong></div>
          <div><span>Tangent T</span><strong>{fmtDistance(result.curve.tangent)} m</strong></div>
          <div><span>Arc length L</span><strong>{fmtDistance(result.curve.length)} m</strong></div>
          <div><span>External E</span><strong>{fmtDistance(result.curve.external)} m</strong></div>
          <div><span>Mid-ordinate M</span><strong>{fmtDistance(result.curve.middleOrdinate)} m</strong></div>
          <div><span>Long chord</span><strong>{fmtDistance(result.curve.longChord)} m</strong></div>
          <div><span>Stake points</span><strong>{result.stations.length}</strong></div>
        </div>
      )}
    </fieldset>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Geographic ↔ Grid projection (Zimbabwe Lo. belts / UTM)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Convert between GNSS geographic coordinates (lat/lon) and projected grid
 * coordinates using the Zimbabwe Gauss Conform (Lo.) belts or UTM. This is the
 * daily reduction for an engineering surveyor here: a handheld/RTK fix in
 * lat/lon must be brought onto the project's Lo. grid (Y = Easting/westing,
 * X = Northing/southing) before any setting-out or COGO work.
 */
function ProjectionForm({
  axis,
  cad,
  log,
}: Pick<CadCogoPanelProps, "cad" | "log"> & { axis: AxisLabels }) {
  // "auto" lets the engine snap to the nearest odd-meridian Lo. belt from the
  // entered longitude — what a surveyor expects when they just type a fix.
  const [projId, setProjId] = useState<string>("auto");

  // Geographic → grid inputs (decimal degrees; south & west are negative).
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");

  // Grid → geographic inputs.
  const [gridE, setGridE] = useState("");
  const [gridN, setGridN] = useState("");

  const [fwdResult, setFwdResult] = useState<
    { e: number; n: number; k: number; convergenceDeg: number; belt: string } | null
  >(null);
  const [invResult, setInvResult] = useState<{ lat: number; lon: number; belt: string } | null>(null);

  const resolveProjection = (lonDeg: number | null): ProjectionDef | null => {
    if (projId === "auto") {
      if (lonDeg == null || !Number.isFinite(lonDeg)) return null;
      return nearestLoBelt(lonDeg);
    }
    return PROJECTION_PRESETS.find((p) => p.id === projId) ?? null;
  };

  const computeForward = () => {
    const la = parseFloat(lat);
    const lo = parseFloat(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) {
      log("Projection: latitude and longitude must be numeric (decimal degrees).", "error");
      return;
    }
    const proj = resolveProjection(lo);
    if (!proj) { log("Projection: could not resolve a projection/belt.", "error"); return; }
    const r = projectForward(proj, { lat: la, lon: lo });
    setFwdResult({ e: r.e, n: r.n, k: r.k, convergenceDeg: r.convergenceDeg, belt: proj.label });
    // Place the projected position as a survey point on the grid.
    const pt = cad.addPoint({ pointNo: cad.nextPointNo(), n: r.n, e: r.e, z: null, code: "GNSS" });
    log(
      `Projected point ${pt.pointNo} (${proj.label}): ${axis.first} ${fmtCoord(r.e, 3)} ${axis.second} ${fmtCoord(r.n, 3)} · ` +
        `k=${r.k.toFixed(8)}, convergence ${fmtBearing(Math.abs(r.convergenceDeg))}`,
    );
  };

  const computeInverse = () => {
    const e = parseFloat(gridE);
    const n = parseFloat(gridN);
    if (!Number.isFinite(e) || !Number.isFinite(n)) {
      log(`Projection: grid ${axis.first}/${axis.second} must be numeric.`, "error");
      return;
    }
    // For the inverse a belt must be chosen explicitly (we have no longitude to
    // snap from). "auto" cannot resolve, so require a concrete selection.
    const proj = projId === "auto" ? null : PROJECTION_PRESETS.find((p) => p.id === projId) ?? null;
    if (!proj) { log("Projection: select a specific belt/zone for grid → geographic.", "error"); return; }
    const ll = projectInverse(proj, n, e);
    setInvResult({ lat: ll.lat, lon: ll.lon, belt: proj.label });
    log(`Inverse projection (${proj.label}): lat ${ll.lat.toFixed(8)}°, lon ${ll.lon.toFixed(8)}°`);
  };

  return (
    <fieldset className="cad-cogo-group">
      <legend>Geographic ↔ Grid (Zimbabwe Lo. / UTM)</legend>

      <label className="cad-cogo-field">
        <span>Projection / belt</span>
        <select className="input-field" value={projId} onChange={(e) => setProjId(e.target.value)}>
          <option value="auto">Auto (nearest Lo. belt)</option>
          {PROJECTION_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>

      <p className="cad-panel-hint">
        Decimal degrees. South latitude and west longitude are negative
        (Zimbabwe is roughly lat −15 to −22, lon 25 to 33).
      </p>

      <TextRow label="Latitude (°)" value={lat} onChange={setLat} placeholder="-17.829" />
      <TextRow label="Longitude (°)" value={lon} onChange={setLon} placeholder="29.210" />
      <button type="button" className="cad-chip-btn" onClick={computeForward}>
        Geographic → grid &amp; place point
      </button>
      {fwdResult && (
        <div className="cad-prop-list" style={{ marginTop: 8 }}>
          <div><span>Belt</span><strong>{fwdResult.belt}</strong></div>
          <div><span>{axis.first}</span><strong>{fmtCoord(fwdResult.e, 3)}</strong></div>
          <div><span>{axis.second}</span><strong>{fmtCoord(fwdResult.n, 3)}</strong></div>
          <div><span>Point scale factor</span><strong>{fwdResult.k.toFixed(8)}</strong></div>
          <div><span>Convergence</span><strong>{fmtBearing(Math.abs(fwdResult.convergenceDeg))}</strong></div>
        </div>
      )}

      <hr style={{ borderColor: "var(--cad-bg-2)", margin: "12px 0" }} />

      <NumberRow label={`Grid ${axis.first} (m)`} value={gridE} onChange={setGridE} />
      <NumberRow label={`Grid ${axis.second} (m)`} value={gridN} onChange={setGridN} />
      <button type="button" className="cad-chip-btn" onClick={computeInverse}>
        Grid → geographic
      </button>
      {invResult && (
        <div className="cad-prop-list" style={{ marginTop: 8 }}>
          <div><span>Belt</span><strong>{invResult.belt}</strong></div>
          <div><span>Latitude</span><strong>{invResult.lat.toFixed(8)}°</strong></div>
          <div><span>Longitude</span><strong>{invResult.lon.toFixed(8)}°</strong></div>
        </div>
      )}
    </fieldset>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Area / perimeter
// ─────────────────────────────────────────────────────────────────────────────
function AreaForm({
  model,
  selection,
  cad,
  log,
}: Pick<CadCogoPanelProps, "model" | "selection" | "cad" | "log">) {
  const selectedLw = useMemo(() => {
    if (selection.type !== "linework" || !selection.id) return null;
    return model.linework.find((lw) => lw.id === selection.id) ?? null;
  }, [model.linework, selection]);

  const [pnoList, setPnoList] = useState("");
  const [result, setResult] = useState<{ area: number; perimeter: number; points: { n: number; e: number }[] } | null>(null);

  const compute = () => {
    const pnos = pnoList.split(",").map((s) => s.trim()).filter(Boolean);
    const pts: { n: number; e: number }[] = [];
    for (const pno of pnos) {
      const p = findPoint(model, pno);
      if (!p) { log(`Area: point ${pno} not found.`, "error"); return; }
      pts.push({ n: p.n, e: p.e });
    }
    if (pts.length < 3) { log("Area: need at least 3 points.", "error"); return; }
    const area = polygonArea(pts);
    const perimeter = polylineLength(pts);
    setResult({ area, perimeter, points: pts });
    log(`Polygon (${pts.length} pts) — area ${fmtArea(area)} · perimeter ${fmtDistance(perimeter)} m`);
  };

  const createBoundary = () => {
    if (!result) return;
    cad.ensureLayerById("BOUNDARY");
    cad.addLinework({ kind: "boundary", vertices: result.points, closed: true, layerId: "BOUNDARY" });
    log("Created boundary from point list.");
  };

  return (
    <fieldset className="cad-cogo-group">
      <legend>Area &amp; perimeter</legend>
      {selectedLw && (
        <div className="cad-prop-list" style={{ marginBottom: 10 }}>
          <div><span>Selected</span><strong>{selectedLw.kind}</strong></div>
          <div><span>Vertices</span><strong>{selectedLw.vertices.length}</strong></div>
          <div><span>Closed</span><strong>{selectedLw.closed ? "Yes" : "No"}</strong></div>
          <div><span>Perimeter</span><strong>{fmtDistance(polylineLength(selectedLw.vertices))} m</strong></div>
          {selectedLw.closed && <div><span>Area</span><strong>{fmtArea(polygonArea(selectedLw.vertices))}</strong></div>}
        </div>
      )}
      <TextRow
        label="Point numbers (comma-separated)"
        value={pnoList}
        onChange={setPnoList}
        placeholder="1001, 1002, 1003, 1004"
      />
      <button type="button" className="cad-chip-btn" onClick={compute}>Compute</button>
      {result && (
        <>
          <div className="cad-prop-list" style={{ marginTop: 8 }}>
            <div><span>Perimeter</span><strong>{fmtDistance(result.perimeter)} m</strong></div>
            <div><span>Area</span><strong>{fmtArea(result.area)}</strong></div>
          </div>
          <button type="button" className="cad-chip-btn" onClick={createBoundary} style={{ marginTop: 6 }}>
            Create boundary
          </button>
        </>
      )}
    </fieldset>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 hard-problem COGO tools
// ─────────────────────────────────────────────────────────────────────────────

function LineLineForm({ model, axis, cad, log }: Pick<CadCogoPanelProps, "model" | "cad" | "log"> & { axis: AxisLabels }) {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [p3, setP3] = useState("");
  const [p4, setP4] = useState("");

  const compute = async () => {
    const a = findPoint(model, p1);
    const b = findPoint(model, p2);
    const c = findPoint(model, p3);
    const d = findPoint(model, p4);
    if (!a || !b || !c || !d) { log("Line–Line: all four points must exist.", "error"); return; }
    const res = await lineLine(a, b, c, d);
    if (!res) { log("Line–Line: lines are parallel.", "error"); return; }
    const pt = cad.addPoint({ pointNo: cad.nextPointNo(), n: res.n, e: res.e, z: null, code: "INT-LL" });
    log(`Line–Line intersection ${pt.pointNo}: ${axis.first} ${fmtCoord(res.e, 3)} ${axis.second} ${fmtCoord(res.n, 3)}`);
  };

  return (
    <fieldset className="cad-cogo-group">
      <legend>Line–line intersection</legend>
      <PointNumber label="Line 1 start" value={p1} onChange={setP1} model={model} axis={axis} />
      <PointNumber label="Line 1 end" value={p2} onChange={setP2} model={model} axis={axis} />
      <PointNumber label="Line 2 start" value={p3} onChange={setP3} model={model} axis={axis} />
      <PointNumber label="Line 2 end" value={p4} onChange={setP4} model={model} axis={axis} />
      <button type="button" className="cad-chip-btn primary" onClick={() => void compute()}>Compute &amp; place point</button>
    </fieldset>
  );
}

function LineArcForm({ model, axis, cad, log }: Pick<CadCogoPanelProps, "model" | "cad" | "log"> & { axis: AxisLabels }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [centrePno, setCentrePno] = useState("");
  const [radius, setRadius] = useState("");

  const compute = async () => {
    const start = findPoint(model, a);
    const end = findPoint(model, b);
    const centre = findPoint(model, centrePno);
    if (!start || !end || !centre) { log("Line–Arc: all three points must exist.", "error"); return; }
    const r = parseFloat(radius);
    if (!Number.isFinite(r) || r <= 0) { log("Line–Arc: radius must be positive.", "error"); return; }
    const sols = await lineArc(start, end, centre, r);
    if (sols.length === 0) { log("Line–Arc: line does not intersect the circle.", "error"); return; }
    let pno = nextPointBase(model);
    for (const s of sols) {
      const pt = cad.addPoint({ pointNo: String(pno++), n: s.n, e: s.e, z: null, code: "INT-LA" });
      log(`Line–Arc intersection ${pt.pointNo}: ${axis.first} ${fmtCoord(s.e, 3)} ${axis.second} ${fmtCoord(s.n, 3)}`);
    }
  };

  return (
    <fieldset className="cad-cogo-group">
      <legend>Line–arc / line–circle intersection</legend>
      <PointNumber label="Point on line" value={a} onChange={setA} model={model} axis={axis} />
      <PointNumber label="Second point on line" value={b} onChange={setB} model={model} axis={axis} />
      <PointNumber label="Circle centre" value={centrePno} onChange={setCentrePno} model={model} axis={axis} />
      <NumberRow label="Radius (m)" value={radius} onChange={setRadius} />
      <button type="button" className="cad-chip-btn primary" onClick={() => void compute()}>Compute &amp; place point(s)</button>
    </fieldset>
  );
}

function ArcArcForm({ model, axis, cad, log }: Pick<CadCogoPanelProps, "model" | "cad" | "log"> & { axis: AxisLabels }) {
  const [c1, setC1] = useState("");
  const [r1, setR1] = useState("");
  const [c2, setC2] = useState("");
  const [r2, setR2] = useState("");

  const compute = async () => {
    const a = findPoint(model, c1);
    const b = findPoint(model, c2);
    if (!a || !b) { log("Arc–Arc: both centre points must exist.", "error"); return; }
    const radius1 = parseFloat(r1);
    const radius2 = parseFloat(r2);
    if (!Number.isFinite(radius1) || !Number.isFinite(radius2) || radius1 <= 0 || radius2 <= 0) {
      log("Arc–Arc: radii must be positive.", "error"); return;
    }
    const sols = await arcArc(a, radius1, b, radius2);
    if (sols.length === 0) { log("Arc–Arc: circles do not intersect.", "error"); return; }
    let pno = nextPointBase(model);
    for (const s of sols) {
      const pt = cad.addPoint({ pointNo: String(pno++), n: s.n, e: s.e, z: null, code: "INT-AA" });
      log(`Arc–Arc intersection ${pt.pointNo}: ${axis.first} ${fmtCoord(s.e, 3)} ${axis.second} ${fmtCoord(s.n, 3)}`);
    }
  };

  return (
    <fieldset className="cad-cogo-group">
      <legend>Arc–arc / circle–circle intersection</legend>
      <PointNumber label="Centre 1" value={c1} onChange={setC1} model={model} axis={axis} />
      <NumberRow label="Radius 1 (m)" value={r1} onChange={setR1} />
      <PointNumber label="Centre 2" value={c2} onChange={setC2} model={model} axis={axis} />
      <NumberRow label="Radius 2 (m)" value={r2} onChange={setR2} />
      <button type="button" className="cad-chip-btn primary" onClick={() => void compute()}>Compute &amp; place point(s)</button>
    </fieldset>
  );
}

function CircleFitForm({ model, cad, log }: Pick<CadCogoPanelProps, "model" | "cad" | "log">) {
  const [pnoList, setPnoList] = useState("");
  const [result, setResult] = useState<CircleFit | null>(null);

  const compute = async () => {
    const pnos = pnoList.split(",").map((s) => s.trim()).filter(Boolean);
    const pts: NE[] = [];
    for (const pno of pnos) {
      const p = findPoint(model, pno);
      if (!p) { log(`Circle fit: point ${pno} not found.`, "error"); return; }
      pts.push({ n: p.n, e: p.e });
    }
    const fit = await fitCircle(pts);
    if (!fit) { log("Circle fit: need 3+ non-collinear points.", "error"); return; }
    setResult(fit);
    const centrePt = cad.addPoint({ pointNo: cad.nextPointNo(), n: fit.centre.n, e: fit.centre.e, z: null, code: "CIRCLE-CN" });

    // Draw the fitted circle as a dense polyline on the CONTROL layer.
    cad.ensureLayerById("CONTROL");
    const verts: { n: number; e: number }[] = [];
    const steps = 64;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      verts.push({ n: fit.centre.n + fit.radius * Math.cos(a), e: fit.centre.e + fit.radius * Math.sin(a) });
    }
    cad.addLinework({ kind: "polyline", vertices: verts, closed: true, layerId: "CONTROL" });
    log(
      `Best-fit circle centre ${centrePt.pointNo}: R ${fit.radius.toFixed(4)} m, RMSE ${fit.rmse.toFixed(4)} m`,
    );
  };

  return (
    <fieldset className="cad-cogo-group">
      <legend>Best-fit circle</legend>
      <TextRow
        label="Point numbers (comma-separated)"
        value={pnoList}
        onChange={setPnoList}
        placeholder="1001, 1002, 1003, ..."
      />
      <button type="button" className="cad-chip-btn primary" onClick={() => void compute()}>Fit circle &amp; draw</button>
      {result && (
        <div className="cad-prop-list" style={{ marginTop: 8 }}>
          <div><span>Radius</span><strong>{fmtDistance(result.radius)} m</strong></div>
          <div><span>Centre Y</span><strong>{fmtCoord(result.centre.e, 3)}</strong></div>
          <div><span>Centre X</span><strong>{fmtCoord(result.centre.n, 3)}</strong></div>
          <div><span>RMSE</span><strong>{fmtDistance(result.rmse)} m</strong></div>
        </div>
      )}
    </fieldset>
  );
}

function FreeStationForm({
  model,
  cad,
  bearingFormat,
  angleEntry = "packed",
  axis,
  log,
}: Pick<CadCogoPanelProps, "model" | "cad" | "bearingFormat" | "angleEntry" | "log"> & { axis: AxisLabels }) {
  const [rows, setRows] = useState<{ pno: string; bearing: string; distance: string; weight: string }[]>([
    { pno: "", bearing: "", distance: "", weight: "1" },
  ]);
  const [result, setResult] = useState<FreeStationResult | null>(null);

  const addRow = () => setRows((prev) => [...prev, { pno: "", bearing: "", distance: "", weight: "1" }]);
  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx));
  const updateRow = (idx: number, key: keyof (typeof rows)[number], value: string) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));

  const compute = async () => {
    const obs: Observation[] = rows
      .map((r) => {
        const st = findPoint(model, r.pno);
        if (!st) return null;
        const o: Observation = { station: st, weight: Number(r.weight) || 1 };
        if (r.bearing.trim()) {
          o.azimuthDeg = parseDirection(r.bearing, angleEntry) ?? parseFloat(r.bearing);
        }
        if (r.distance.trim()) {
          o.distance = parseFloat(r.distance);
        }
        if (o.azimuthDeg == null && o.distance == null) return null;
        if (o.azimuthDeg != null && !Number.isFinite(o.azimuthDeg)) return null;
        if (o.distance != null && !Number.isFinite(o.distance)) return null;
        return o;
      })
      .filter((o): o is Observation => o != null);

    if (obs.length < 2) { log("Free-station: need at least two valid observations.", "error"); return; }
    const res = await freeStation(obs);
    if (!res) { log("Free-station: could not solve.", "error"); return; }
    setResult(res);
    const pt = cad.addPoint({ pointNo: cad.nextPointNo(), n: res.position.n, e: res.position.e, z: null, code: "FREE-STN" });
    log(
      `Free-station ${pt.pointNo}: ${axis.first} ${fmtCoord(res.position.e, 3)} ${axis.second} ${fmtCoord(res.position.n, 3)} — ` +
        `${res.iterations} iters, RMSE ${res.rmse.toFixed(4)} m`,
    );
  };

  return (
    <fieldset className="cad-cogo-group">
      <legend>Free-station resection</legend>
      <div className="cad-cogo-table-wrap">
        <table className="cad-cogo-table">
          <thead>
            <tr><th>Station</th><th>Bearing</th><th>Distance</th><th>Wt</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><input className="input-field" list="cogo-pts-free-stn" value={r.pno} onChange={(e) => updateRow(i, "pno", e.target.value)} placeholder="#" /></td>
                <td><input className="input-field" value={r.bearing} onChange={(e) => updateRow(i, "bearing", e.target.value)} placeholder="Bearing" /></td>
                <td><input className="input-field" type="number" value={r.distance} onChange={(e) => updateRow(i, "distance", e.target.value)} placeholder="m" /></td>
                <td><input className="input-field" type="number" value={r.weight} onChange={(e) => updateRow(i, "weight", e.target.value)} style={{ width: 50 }} /></td>
                <td><button type="button" className="cad-mini-icon-btn" onClick={() => removeRow(i)} title="Remove row">×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <datalist id="cogo-pts-free-stn">
        {model.points.map((p) => (
          <option key={p.id} value={p.pointNo}>{p.pointNo} {axis.first} {fmtCoord(p.e, 3)} {axis.second} {fmtCoord(p.n, 3)}</option>
        ))}
      </datalist>
      <div className="cad-cogo-toolbar">
        <button type="button" className="cad-chip-btn ghost" onClick={addRow}>Add observation</button>
        <button type="button" className="cad-chip-btn primary" onClick={() => void compute()}>Solve &amp; place</button>
      </div>
      {result && (
        <div className="cad-prop-list" style={{ marginTop: 8 }}>
          <div><span>Position {axis.first}</span><strong>{fmtCoord(result.position.e, 3)}</strong></div>
          <div><span>Position {axis.second}</span><strong>{fmtCoord(result.position.n, 3)}</strong></div>
          <div><span>Iterations</span><strong>{result.iterations}</strong></div>
          <div><span>RMSE</span><strong>{fmtDistance(result.rmse)} m</strong></div>
        </div>
      )}
    </fieldset>
  );
}

function TransformForm({
  kind,
  model,
  cad,
  axis,
  log,
}: {
  kind: "helmert" | "affine";
} & Pick<CadCogoPanelProps, "model" | "cad" | "log"> & { axis: AxisLabels }) {
  const [sourceList, setSourceList] = useState("");
  const [targetList, setTargetList] = useState("");
  const [transform, setTransform] = useState<HelmertTransform | AffineTransform | null>(null);
  const [diagnostics, setDiagnostics] = useState<TransformDiagnostics | null>(null);
  const [outliers, setOutliers] = useState<number[] | null>(null);
  const [applyPno, setApplyPno] = useState("");

  const parsePairList = (raw: string): NE[] | null => {
    const out: NE[] = [];
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length % 2 !== 0) return null;
    for (let i = 0; i < parts.length; i += 2) {
      const n = parseFloat(parts[i]);
      const e = parseFloat(parts[i + 1]);
      if (!Number.isFinite(n) || !Number.isFinite(e)) return null;
      out.push({ n, e });
    }
    return out;
  };

  const compute = async () => {
    const source = parsePairList(sourceList);
    const target = parsePairList(targetList);
    if (!source || !target || source.length !== target.length || source.length < (kind === "helmert" ? 2 : 3)) {
      log(`Transform: need ${kind === "helmert" ? "2+" : "3+"} matching (${axis.first},${axis.second}) pairs.`, "error");
      return;
    }
    if (kind === "helmert") {
      const t = await fitHelmert(source, target);
      if (!t) { log("Helmert: could not fit transform.", "error"); return; }
      setTransform(t);
      const d = await helmertDiagnostics(t, source, target);
      setDiagnostics(d);
    } else {
      const t = await fitAffine(source, target);
      if (!t) { log("Affine: could not fit transform.", "error"); return; }
      setTransform(t);
      const d = await affineDiagnostics(t, source, target);
      setDiagnostics(d);
    }
    setOutliers(null);
  };

  const checkOutliers = async () => {
    const source = parsePairList(sourceList);
    const target = parsePairList(targetList);
    if (!source || !target) { log("Outliers: invalid coordinate lists.", "error"); return; }
    const list = await detectOutliers(source, target, 2);
    setOutliers(list ?? []);
  };

  const apply = async () => {
    const p = findPoint(model, applyPno);
    if (!p) { log("Transform: point to transform not found.", "error"); return; }
    if (!transform) { log("Transform: fit a transform first.", "error"); return; }
    let res: NE;
    if (kind === "helmert") {
      res = await applyHelmert(p, transform as HelmertTransform);
    } else {
      res = await applyAffine(p, transform as AffineTransform);
    }
    const pt = cad.addPoint({ pointNo: cad.nextPointNo(), n: res.n, e: res.e, z: p.z, code: "TRANSFORM" });
    log(`Transformed ${p.pointNo} → ${pt.pointNo}: ${axis.first} ${fmtCoord(res.e, 3)} ${axis.second} ${fmtCoord(res.n, 3)}`);
  };

  return (
    <fieldset className="cad-cogo-group">
      <legend>{kind === "helmert" ? "Helmert (4-param) transform" : "Affine (6-param) transform"}</legend>
      <TextRow
        label={`Source ${axis.first},${axis.second} list`}
        value={sourceList}
        onChange={setSourceList}
        placeholder={`${axis.second}1,${axis.first}1,${axis.second}2,${axis.first}2,…`}
      />
      <TextRow
        label={`Target ${axis.first},${axis.second} list`}
        value={targetList}
        onChange={setTargetList}
        placeholder={`${axis.second}1,${axis.first}1,${axis.second}2,${axis.first}2,…`}
      />
      <div className="cad-cogo-toolbar">
        <button type="button" className="cad-chip-btn primary" onClick={() => void compute()}>Fit {kind === "helmert" ? "Helmert" : "Affine"}</button>
        <button type="button" className="cad-chip-btn ghost" onClick={() => void checkOutliers()}>Detect outliers</button>
      </div>

      {transform && diagnostics && (
        <>
          <div className="cad-prop-list" style={{ marginTop: 8 }}>
            {kind === "helmert" && (
              <>
                <div><span>Scale</span><strong>{(transform as HelmertTransform).scale.toFixed(8)}</strong></div>
                <div><span>Rotation</span><strong>{(transform as HelmertTransform).rotationDeg.toFixed(6)}°</strong></div>
              </>
            )}
            <div><span>RMSE</span><strong>{fmtDistance(diagnostics.rmse)} m</strong></div>
            <div><span>Max offset</span><strong>{fmtDistance(diagnostics.maxOffset)} m</strong></div>
            <div><span>Worst point</span><strong>pair {diagnostics.maxIndex + 1}</strong></div>
          </div>

          {outliers && (
            <div className="cad-cogo-result" style={{ marginTop: 8 }}>
              <div className="cad-cogo-result-header">Outliers (threshold 2×RMSE)</div>
              <div className="cad-prop-list">
                {outliers.length === 0 ? (
                  <div><span>Status</span><strong>None detected</strong></div>
                ) : (
                  outliers.map((idx) => <div key={idx}><span>Pair {idx + 1}</span><strong className="cad-error-text">flagged</strong></div>)
                )}
              </div>
            </div>
          )}

          <div className="cad-cogo-field" style={{ flexDirection: "row", gap: 6, alignItems: "center", marginTop: 10 }}>
            <PointNumber label="Apply to point" value={applyPno} onChange={setApplyPno} model={model} axis={axis} />
            <button type="button" className="cad-chip-btn" onClick={() => void apply()}>Apply &amp; place</button>
          </div>
        </>
      )}
    </fieldset>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reusable field helpers
// ─────────────────────────────────────────────────────────────────────────────
function TextRow({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="cad-cogo-field">
      <span>{label}</span>
      <input className="input-field" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

function NumberRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="cad-cogo-field">
      <span>{label}</span>
      <input className="input-field" type="number" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function PointNumber({
  label,
  value,
  onChange,
  model,
  axis,
  decimals = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  model: CadModelState;
  axis: AxisLabels;
  decimals?: number;
}) {
  const resolved = useMemo(() => findPoint(model, value), [model, value]);
  const listId = `cogo-pts-${label.replace(/\s+/g, "-").toLowerCase()}`;
  const resolvedLabel = resolved
    ? `${resolved.pointNo} (${axis.first} ${fmtCoord(resolved.e, decimals)}, ${axis.second} ${fmtCoord(resolved.n, decimals)}${resolved.z != null ? ` H ${fmtCoord(resolved.z, decimals)}` : ""})`
    : "—";
  return (
    <label className="cad-cogo-field">
      <span>{label}</span>
      <input
        className="input-field"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Point #"
      />
      <datalist id={listId}>
        {model.points.map((p) => (
          <option key={p.id} value={p.pointNo}>
            {p.pointNo} {axis.first} {fmtCoord(p.e, decimals)} {axis.second} {fmtCoord(p.n, decimals)}
          </option>
        ))}
      </datalist>
      <span style={{ fontSize: 10, color: "var(--cad-text-dim)" }}>{resolvedLabel}</span>
    </label>
  );
}
