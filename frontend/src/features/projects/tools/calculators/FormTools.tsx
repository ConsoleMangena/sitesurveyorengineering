import { useState } from "react";
import {
  forward,
  inverse,
  resectionTienstra,
  intersectionBearingBearing,
  intersectionDistanceDistance,
  type NE,
} from "../../components/cad/survey/cogo.ts";
import { fmtBearing, parseBearing, type BearingFormat } from "../../components/cad/survey/format.ts";
import { AngleInput } from "./AngleInput.tsx";
import {
  PolarDiagram,
  JoinDiagram,
  IntersectionDiagram,
  ResectionDiagram,
} from "./Diagrams.tsx";
import { ToolGuidePanel, type ToolGuide } from "./ToolGuide.tsx";

const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; };

/** Format a decimal-degree angle as the packed DD.MMSS surveyor shorthand. */
function packedString(deg: number): string {
  const sign = deg < 0 ? "-" : "";
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const minF = (abs - d) * 60;
  const m = Math.floor(minF);
  const s = Math.round((minF - m) * 60);
  let mm = m, ss = s, dd = d;
  if (ss === 60) { ss = 0; mm += 1; }
  if (mm === 60) { mm = 0; dd += 1; }
  return `${sign}${dd}.${String(mm).padStart(2, "0")}${String(ss).padStart(2, "0")}`;
}

function Shell({ title, blurb, form, result, diagram, guide }: { title: string; blurb: string; form: React.ReactNode; result: string | null; diagram?: React.ReactNode; guide?: ToolGuide }) {
  return (
    <div className="svt-shell">
      <div className="svt-header"><div><h2>{title}</h2><p>{blurb}</p></div></div>
      {guide && <ToolGuidePanel guide={guide} />}
      <div className="svt-grid-layout">
        <div className="svt-card">
          <div className="svt-card-title">Inputs</div>
          {form}
        </div>
        <div style={{ display: "grid", gap: 16 }}>
          <div className="svt-card">
            <div className="svt-card-title">Result</div>
            {result ? <pre className="svt-result">{result}</pre> : <p style={{ padding: 14, fontSize: 13, color: "var(--text-muted)" }}>Enter values and compute.</p>}
          </div>
          <div className="svt-card">
            <div className="svt-card-title">Diagram</div>
            {diagram ?? <p style={{ padding: 14, fontSize: 13, color: "var(--text-muted)" }}>The geometry will be drawn here after you compute.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Input({ label, value, set, placeholder }: { label: string; value: string; set: (v: string) => void; placeholder?: string }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input className="input-field" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

/** Group two related inputs (e.g. an X / Y coordinate pair) side by side. */
function Pair({ children }: { children: React.ReactNode }) {
  return <div className="svt-pair">{children}</div>;
}

// ── Tool guides ─────────────────────────────────────────────────────────────
const POLAR_GUIDE: ToolGuide = {
  summary: "Compute the coordinates of a NEW point from a KNOWN point, a bearing/azimuth and a distance (known point → new point).",
  steps: [
    { title: "Enter the known start point", body: "Type the Start Y and Start X of the point you are setting out from." },
    { title: "Enter the direction", body: "Set the bearing/azimuth to the new point. Use the angle field’s mode button for DMS, decimal or gon." },
    { title: "Enter the distance", body: "Type the horizontal distance in metres from the known point to the new point." },
    { title: "Compute", body: "Press Compute to read the new point’s Y, X and see the leg drawn in the diagram." },
  ],
  tips: ["Azimuth is measured clockwise from north (grid)."],
};

const JOIN_GUIDE: ToolGuide = {
  summary: "Compute the bearing and distance BETWEEN two known points (point 1 → point 2).",
  steps: [
    { title: "Enter point 1", body: "Type the Y, X of the first known point (the from / start point)." },
    { title: "Enter point 2", body: "Type the Y, X of the second known point (the to / target point)." },
    { title: "Pick the bearing format", body: "Choose azimuth (DMS), quadrant or gon for how the direction is reported." },
    { title: "Compute", body: "Press Compute to read the distance and the bearing from point 1 to point 2." },
  ],
};

const INTERSECTION_GUIDE: ToolGuide = {
  summary: "Fix a NEW point from TWO known stations, using either two bearings or two distances.",
  steps: [
    { title: "Pick the method", body: "Choose Bearing–Bearing (rays from each station) or Distance–Distance (radii from each station)." },
    { title: "Enter the two stations", body: "Type the Y, X of Station A and Station B." },
    { title: "Enter the observations", body: "For bearings, enter the direction from each station; for distances, enter the measured distance from each station." },
    { title: "Compute", body: "Press Compute. Distance–Distance can give two solutions — pick the one on the correct side of the baseline." },
  ],
};

const RESECTION_GUIDE: ToolGuide = {
  summary: "Fix the OBSERVER’s position from horizontal angles measured to THREE known stations (Tienstra three-point resection).",
  steps: [
    { title: "Enter the three stations", body: "Type the Y, X of known stations A, B and C." },
    { title: "Enter the observed angles", body: "α = angle BPC, β = angle CPA, γ = angle APB, all measured at the observer P." },
    { title: "Check the angle sum", body: "α + β + γ must total 360°. The tool warns if they do not." },
    { title: "Resect", body: "Press Resect to read the observer’s Y, X." },
  ],
  tips: ["Avoid placing the observer on or near the circle through A, B and C (the “danger circle”), where the fix is weak."],
};

const ANGLE_GUIDE: ToolGuide = {
  summary: "Convert a single direction between azimuth (DMS), decimal degrees, packed DD.MMSS, quadrant bearing, gon and radians.",
  steps: [
    { title: "Enter the direction", body: "Type a value in any supported form, e.g. 45.3020, 123.456 or N45°30'E." },
    { title: "Convert", body: "Press Convert to see the same direction expressed in every other format at once." },
  ],
  tips: ["For packed DD.MMSS input inside the computation tools, use their structured angle fields instead."],
};

// ── Polar / Forward ───────────────────────────────────────────────────────
export function PolarForwardTool() {
  const [y0, setY0] = useState("1000"), [x0, setX0] = useState("1000");
  const [az, setAz] = useState<number | null>(45), [d, setD] = useState("100");
  const [res, setRes] = useState<string | null>(null);
  const [geom, setGeom] = useState<{ start: NE; end: NE } | null>(null);
  const run = () => {
    const dist = num(d), sy = num(y0), sx = num(x0);
    if (![sy, sx, dist].every(Number.isFinite) || az == null) { setGeom(null); return setRes("⚠ Enter a valid start Y, X, bearing and distance."); }
    const start: NE = { n: sx, e: sy };
    const p = forward(start, az, dist);
    setGeom({ start, end: p });
    setRes(`New point\n  Y:  ${p.e.toFixed(3)}\n  X:  ${p.n.toFixed(3)}\n\nAzimuth: ${fmtBearing(az)} (${az.toFixed(4)}°)`);
  };
  return <Shell title="Polar / Forward Computation" blurb="Compute the Y, X of a new point from a known point, a bearing/azimuth and a horizontal distance. (Y, X follow the Zimbabwe/Southern-African Gauss convention; for UTM read Y as Easting and X as Northing.)"
    guide={POLAR_GUIDE}
    result={res}
    diagram={geom ? <PolarDiagram start={geom.start} end={geom.end} /> : undefined}
    form={<><div className="svt-form">
      <Pair>
        <Input label="Start Y" value={y0} set={setY0} />
        <Input label="Start X" value={x0} set={setX0} />
      </Pair>
      <Pair>
        <AngleInput label="Bearing / Azimuth" valueDeg={az} onChange={setAz} />
        <Input label="Distance (m)" value={d} set={setD} />
      </Pair>
    </div><div className="svt-grid-actions"><button className="btn btn-primary btn-sm" onClick={run}>Compute</button></div></>} />;
}

// ── Join / Inverse ──────────────────────────────────────────────────────────
export function JoinInverseTool() {
  const [y1, setY1] = useState("1000"), [x1, setX1] = useState("1000");
  const [y2, setY2] = useState("1100"), [x2, setX2] = useState("1100");
  const [fmt, setFmt] = useState<BearingFormat>("azimuth");
  const [res, setRes] = useState<string | null>(null);
  const [geom, setGeom] = useState<{ a: NE; b: NE } | null>(null);
  const run = () => {
    const f: NE = { n: num(x1), e: num(y1) }, t: NE = { n: num(x2), e: num(y2) };
    if (![f.n, f.e, t.n, t.e].every(Number.isFinite)) { setGeom(null); return setRes("⚠ Enter valid Y, X for both points."); }
    const { azimuth, distance } = inverse(f, t);
    setGeom({ a: f, b: t });
    setRes(`Distance: ${distance.toFixed(3)} m\nBearing:  ${fmtBearing(azimuth, fmt)}\nAzimuth:  ${azimuth.toFixed(4)}°`);
  };
  return <Shell title="Join / Inverse (Polar)" blurb="Compute the bearing and distance between two known Y, X coordinates."
    guide={JOIN_GUIDE}
    result={res}
    diagram={geom ? <JoinDiagram a={geom.a} b={geom.b} /> : undefined}
    form={<><div className="svt-form">
      <Pair>
        <Input label="Point 1 Y" value={y1} set={setY1} />
        <Input label="Point 1 X" value={x1} set={setX1} />
      </Pair>
      <Pair>
        <Input label="Point 2 Y" value={y2} set={setY2} />
        <Input label="Point 2 X" value={x2} set={setX2} />
      </Pair>
      <div className="form-group"><label className="form-label">Bearing format</label>
        <select className="input-field" value={fmt} onChange={(e) => setFmt(e.target.value as BearingFormat)}>
          <option value="azimuth">Azimuth (D°M'S")</option><option value="quadrant">Quadrant</option><option value="gon">Gon</option>
        </select></div>
    </div><div className="svt-grid-actions"><button className="btn btn-primary btn-sm" onClick={run}>Compute</button></div></>} />;
}

// ── Intersection ──────────────────────────────────────────────────────────
export function IntersectionTool() {
  const [mode, setMode] = useState<"bearing" | "distance">("bearing");
  const [y1, setY1] = useState("0"), [x1, setX1] = useState("0"), [y2, setY2] = useState("100"), [x2, setX2] = useState("0");
  const [a1, setA1] = useState<number | null>(45), [a2, setA2] = useState<number | null>(315), [d1, setD1] = useState("70.71"), [d2, setD2] = useState("70.71");
  const [res, setRes] = useState<string | null>(null);
  const [geom, setGeom] = useState<{ a: NE; b: NE; fix: NE | null; mode: "bearing" | "distance"; r1?: number; r2?: number } | null>(null);
  const run = () => {
    const p1: NE = { n: num(x1), e: num(y1) }, p2: NE = { n: num(x2), e: num(y2) };
    if (![p1.n, p1.e, p2.n, p2.e].every(Number.isFinite)) { setGeom(null); return setRes("⚠ Enter valid Y, X for both stations."); }
    if (mode === "bearing") {
      if (a1 == null || a2 == null) { setGeom(null); return setRes("⚠ Enter valid bearings."); }
      const p = intersectionBearingBearing(p1, a1, p2, a2);
      setGeom({ a: p1, b: p2, fix: p, mode: "bearing" });
      return setRes(p ? `Intersection\n  Y: ${p.e.toFixed(3)}\n  X: ${p.n.toFixed(3)}` : "⚠ Rays are parallel — no intersection.");
    }
    const r1 = num(d1), r2 = num(d2);
    if (![r1, r2].every(Number.isFinite)) { setGeom(null); return setRes("⚠ Enter valid distances."); }
    const sols = intersectionDistanceDistance(p1, r1, p2, r2);
    setGeom({ a: p1, b: p2, fix: sols[0] ?? null, mode: "distance", r1, r2 });
    setRes(sols.length === 0 ? "⚠ Circles do not intersect."
      : "Solution(s):\n" + sols.map((s, i) => `  ${i + 1}: Y ${s.e.toFixed(3)}, X ${s.n.toFixed(3)}`).join("\n")
        + (sols.length > 1 ? "\n\nPick the solution on the correct side of the baseline." : ""));
  };
  return <Shell title="Intersection" blurb="Fix a new point from two known stations using bearing-bearing or distance-distance observations."
    guide={INTERSECTION_GUIDE}
    result={res}
    diagram={geom ? <IntersectionDiagram a={geom.a} b={geom.b} fix={geom.fix} mode={geom.mode} r1={geom.r1} r2={geom.r2} /> : undefined}
    form={<><div className="svt-form">
      <div className="form-group"><label className="form-label">Method</label>
        <select className="input-field" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="bearing">Bearing – Bearing</option><option value="distance">Distance – Distance</option>
        </select></div>
      <Pair>
        <Input label="Station A — Y" value={y1} set={setY1} /><Input label="Station A — X" value={x1} set={setX1} />
      </Pair>
      <Pair>
        <Input label="Station B — Y" value={y2} set={setY2} /><Input label="Station B — X" value={x2} set={setX2} />
      </Pair>
      {mode === "bearing"
        ? <Pair><AngleInput label="Bearing from A" valueDeg={a1} onChange={setA1} /><AngleInput label="Bearing from B" valueDeg={a2} onChange={setA2} /></Pair>
        : <Pair><Input label="Distance from A (m)" value={d1} set={setD1} /><Input label="Distance from B (m)" value={d2} set={setD2} /></Pair>}
    </div><div className="svt-grid-actions"><button className="btn btn-primary btn-sm" onClick={run}>Compute</button></div></>} />;
}

// ── Resection ───────────────────────────────────────────────────────────────
export function ResectionTool() {
  const [ay, setAy] = useState("0"), [ax, setAx] = useState("0");
  const [by, setBy] = useState("1000"), [bx, setBx] = useState("0");
  const [cy, setCy] = useState("500"), [cx, setCx] = useState("1000");
  const [al, setAl] = useState<number | null>(null), [be, setBe] = useState<number | null>(null), [ga, setGa] = useState<number | null>(null);
  const [res, setRes] = useState<string | null>(null);
  const [geom, setGeom] = useState<{ a: NE; b: NE; c: NE; p: NE | null } | null>(null);
  const run = () => {
    const A: NE = { n: num(ax), e: num(ay) }, B: NE = { n: num(bx), e: num(by) }, C: NE = { n: num(cx), e: num(cy) };
    if (![A.n, A.e, B.n, B.e, C.n, C.e].every(Number.isFinite)) { setGeom(null); return setRes("⚠ Enter valid Y, X for A, B, C."); }
    if (al == null || be == null || ga == null) { setGeom(null); return setRes("⚠ Enter the three observed angles α, β, γ."); }
    if (Math.abs(al + be + ga - 360) > 0.5) { setGeom(null); return setRes(`⚠ α + β + γ should total 360° (got ${(al + be + ga).toFixed(3)}°).`); }
    const p = resectionTienstra(A, B, C, al, be, ga);
    setGeom({ a: A, b: B, c: C, p });
    setRes(p ? `Observer position P\n  Y: ${p.e.toFixed(3)}\n  X: ${p.n.toFixed(3)}` : "⚠ Degenerate geometry — cannot resect.");
  };
  return <Shell title="Resection (Three-Point, Tienstra)" blurb="Fix the observer's Y, X from horizontal angles observed to three known stations. α = angle BPC, β = angle CPA, γ = angle APB; they must total 360°."
    guide={RESECTION_GUIDE}
    result={res}
    diagram={geom ? <ResectionDiagram a={geom.a} b={geom.b} c={geom.c} p={geom.p} /> : undefined}
    form={<><div className="svt-form">
      <Pair>
        <Input label="A — Y" value={ay} set={setAy} /><Input label="A — X" value={ax} set={setAx} />
      </Pair>
      <Pair>
        <Input label="B — Y" value={by} set={setBy} /><Input label="B — X" value={bx} set={setBx} />
      </Pair>
      <Pair>
        <Input label="C — Y" value={cy} set={setCy} /><Input label="C — X" value={cx} set={setCx} />
      </Pair>
      <AngleInput label="α (BPC)" valueDeg={al} onChange={setAl} />
      <Pair>
        <AngleInput label="β (CPA)" valueDeg={be} onChange={setBe} /><AngleInput label="γ (APB)" valueDeg={ga} onChange={setGa} />
      </Pair>
    </div><div className="svt-grid-actions"><button className="btn btn-primary btn-sm" onClick={run}>Resect</button></div></>} />;
}


// ── Bearing / angle converter ───────────────────────────────────────────────
export function AngleConverterTool() {
  const [input, setInput] = useState("45");
  const [res, setRes] = useState<string | null>(null);
  const run = () => {
    const az = parseBearing(input);
    if (az == null) return setRes("⚠ Enter an azimuth, quadrant bearing (N45°30'E) or decimal degrees. For packed DD.MMSS use the structured angle fields in the computation tools.");
    setRes(`Azimuth (DMS):    ${fmtBearing(az, "azimuth")}\nDecimal degrees:  ${az.toFixed(6)}°\nPacked DD.MMSS:   ${packedString(az)}\nQuadrant bearing: ${fmtBearing(az, "quadrant")}\nGon / grad:       ${((az / 360) * 400).toFixed(4)} gon\nRadians:          ${((az * Math.PI) / 180).toFixed(6)}`);
  };
  return <Shell title="Bearing / Angle Converter" blurb="Convert any direction between azimuth (DMS), packed DD.MMSS, decimal degrees, quadrant bearing, gon and radians."
    guide={ANGLE_GUIDE}
    result={res}
    form={<><div className="svt-form">
      <Input label="Direction" value={input} set={setInput} placeholder="45.3020, 123.456, N45°30'E or S30W" />
    </div><div className="svt-grid-actions"><button className="btn btn-primary btn-sm" onClick={run}>Convert</button></div></>} />;
}
