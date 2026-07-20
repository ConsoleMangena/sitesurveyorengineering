import { useState } from "react";
import {
  stakeOut,
  type NE,
} from "../../components/cad/survey/cogo.ts";
import { stakeHorizontalCurve, verticalCurve } from "../../components/cad/survey/alignmentBridge.ts";
import { fmtBearing, parseBearing } from "../../components/cad/survey/format.ts";
import { ToolGuidePanel, type ToolGuide } from "./ToolGuide.tsx";

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

/** Parse a direction that may be a decimal degree or a bearing string. */
function parseAz(raw: string): number {
  const b = parseBearing(raw);
  if (b != null) return b;
  return num(raw);
}

function Shell({
  title,
  blurb,
  form,
  result,
  guide,
}: {
  title: string;
  blurb: string;
  form: React.ReactNode;
  result: string | null;
  guide?: ToolGuide;
}) {
  return (
    <div className="svt-shell">
      <div className="svt-header"><div><h2>{title}</h2><p>{blurb}</p></div></div>
      {guide && <ToolGuidePanel guide={guide} />}
      <div className="svt-grid-layout">
        <div className="svt-card">
          <div className="svt-card-title">Inputs</div>
          {form}
        </div>
        <div className="svt-card">
          <div className="svt-card-title">Result</div>
          {result ? (
            <pre className="svt-result">{result}</pre>
          ) : (
            <p style={{ padding: 14, fontSize: 13, color: "var(--text-muted)" }}>Enter values and compute.</p>
          )}
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

function Pair({ children }: { children: React.ReactNode }) {
  return <div className="svt-pair">{children}</div>;
}

const STAKEOUT_GUIDE: ToolGuide = {
  summary: "Compute the angle-right, distance and offsets to set out a design point from an occupied station oriented on a backsight.",
  steps: [
    { title: "Enter the occupied station", body: "Type the Y, X (and RL) of the point the instrument is set up on." },
    { title: "Enter the backsight", body: "Type the Y, X of the reference station you orient on (sets the circle zero)." },
    { title: "Enter the design point", body: "Type the Y, X (and RL) of the point to set out." },
    { title: "Compute", body: "Read the angle to turn right from the backsight and the distance to set." },
  ],
  tips: ["Along/offset are relative to the occupied→backsight line: +offset is to the right of that line."],
};

const HCURVE_GUIDE: ToolGuide = {
  summary: "Solve a simple horizontal circular curve and generate deflection-angle stake-out stations.",
  steps: [
    { title: "Enter the PI", body: "The point of intersection of the two tangents (Y, X)." },
    { title: "Enter the tangent azimuths", body: "Back tangent (incoming) and forward tangent (outgoing) azimuths." },
    { title: "Enter radius & interval", body: "Curve radius and the arc interval between stake points." },
    { title: "Compute", body: "Read T, L, E, M, chord and the per-station deflection angles from the PC." },
  ],
};

const VCURVE_GUIDE: ToolGuide = {
  summary: "Design an equal-tangent vertical parabolic curve and tabulate reduced levels along it.",
  steps: [
    { title: "Enter the BVC RL", body: "Reduced level at the start (beginning of vertical curve)." },
    { title: "Enter the grades", body: "Incoming grade g₁ and outgoing grade g₂, in percent (e.g. +2.5, −1.0)." },
    { title: "Enter length & interval", body: "Curve length and the chainage interval for the RL table." },
    { title: "Compute", body: "Read BVC/EVC, high/low point and the chainage–RL table." },
  ],
};

// ── Stake-out ────────────────────────────────────────────────────────────────
export function StakeOutTool() {
  const [oy, setOy] = useState("1000"), [ox, setOx] = useState("1000"), [oz, setOz] = useState("");
  const [by, setBy] = useState("1000"), [bx, setBx] = useState("1100");
  const [ty, setTy] = useState("1080"), [tx, setTx] = useState("1060"), [tz, setTz] = useState("");
  const [res, setRes] = useState<string | null>(null);

  const run = () => {
    const occ: NE = { n: num(ox), e: num(oy) };
    const bs: NE = { n: num(bx), e: num(by) };
    const target: NE = { n: num(tx), e: num(ty) };
    if (![occ.n, occ.e, bs.n, bs.e, target.n, target.e].every(Number.isFinite)) {
      return setRes("⚠ Enter valid Y, X for the occupied, backsight and target points.");
    }
    const ozv = oz.trim() === "" ? null : num(oz);
    const tzv = tz.trim() === "" ? null : num(tz);
    const r = stakeOut(occ, bs, target, ozv, tzv);
    setRes(
      `Angle right (from BS): ${fmtBearing(r.angleRight)} (${r.angleRight.toFixed(4)}°)\n` +
        `Azimuth to target:     ${fmtBearing(r.azimuth)}\n` +
        `Backsight azimuth:     ${fmtBearing(r.backsightAzimuth)}\n` +
        `Distance:              ${r.distance.toFixed(3)} m\n` +
        `Along line:            ${r.along.toFixed(3)} m\n` +
        `Offset (+R / −L):      ${r.offset.toFixed(3)} m` +
        (r.deltaZ != null ? `\nΔH (cut +/fill −):     ${r.deltaZ.toFixed(3)} m` : ""),
    );
  };

  return (
    <Shell
      title="Stake-out / Set-out"
      blurb="Compute the field elements (angle right, distance, offsets) to set out a design point from an occupied station oriented on a backsight."
      guide={STAKEOUT_GUIDE}
      result={res}
      form={
        <>
          <div className="svt-form">
            <Pair><Input label="Occupied Y" value={oy} set={setOy} /><Input label="Occupied X" value={ox} set={setOx} /></Pair>
            <Input label="Occupied RL (optional)" value={oz} set={setOz} />
            <Pair><Input label="Backsight Y" value={by} set={setBy} /><Input label="Backsight X" value={bx} set={setBx} /></Pair>
            <Pair><Input label="Target Y" value={ty} set={setTy} /><Input label="Target X" value={tx} set={setTx} /></Pair>
            <Input label="Target RL (optional)" value={tz} set={setTz} />
          </div>
          <div className="svt-grid-actions"><button className="btn btn-primary btn-sm" onClick={run}>Compute</button></div>
        </>
      }
    />
  );
}

// ── Horizontal circular curve ────────────────────────────────────────────────
export function HorizontalCurveTool() {
  const [py, setPy] = useState("1000"), [px, setPx] = useState("1000");
  const [back, setBack] = useState("0"), [fwd, setFwd] = useState("90");
  const [radius, setRadius] = useState("100"), [interval, setInterval] = useState("10");
  const [res, setRes] = useState<string | null>(null);

  const run = async () => {
    const pi: NE = { n: num(px), e: num(py) };
    const ba = parseAz(back), fa = parseAz(fwd), r = num(radius), iv = num(interval);
    if (![pi.n, pi.e, ba, fa, r].every(Number.isFinite)) return setRes("⚠ Enter valid PI, tangent azimuths and radius.");
    if (r <= 0) return setRes("⚠ Radius must be positive.");
    const out = await stakeHorizontalCurve(pi, ba, fa, r, Number.isFinite(iv) && iv > 0 ? iv : 0);
    if (!out) return setRes("⚠ Degenerate curve (deflection 0° or 180°).");
    const { curve, stations } = out;
    let table = "\n  Arc(m)    Deflection      Y            X\n";
    for (const s of stations) {
      table +=
        `  ${s.arcFromPc.toFixed(2).padStart(7)}  ${fmtBearing(s.deflection).padStart(12)}  ` +
        `${s.point.e.toFixed(3).padStart(11)}  ${s.point.n.toFixed(3).padStart(11)}\n`;
    }
    setRes(
      `Deflection Δ: ${fmtBearing(curve.deflection)} (${curve.deflection.toFixed(4)}°)\n` +
        `Tangent  T:   ${curve.tangent.toFixed(3)} m\n` +
        `Arc      L:   ${curve.length.toFixed(3)} m\n` +
        `External E:   ${curve.external.toFixed(3)} m\n` +
        `Mid-ord  M:   ${curve.middleOrdinate.toFixed(3)} m\n` +
        `Long chord:   ${curve.longChord.toFixed(3)} m\n` +
        `PC:  Y ${curve.pc.e.toFixed(3)}  X ${curve.pc.n.toFixed(3)}\n` +
        `PT:  Y ${curve.pt.e.toFixed(3)}  X ${curve.pt.n.toFixed(3)}\n` +
        `Turns: ${curve.turnsRight ? "right" : "left"}\n` +
        (stations.length ? `\nStake-out stations (deflection from PC):${table}` : ""),
    );
  };

  return (
    <Shell
      title="Horizontal Curve Set-out"
      blurb="Solve a simple circular curve from the PI and tangent azimuths, then generate deflection-angle stake-out stations from the PC."
      guide={HCURVE_GUIDE}
      result={res}
      form={
        <>
          <div className="svt-form">
            <Pair><Input label="PI Y" value={py} set={setPy} /><Input label="PI X" value={px} set={setPx} /></Pair>
            <Pair><Input label="Back tangent azimuth" value={back} set={setBack} placeholder="e.g. 0 or N30°E" /><Input label="Forward tangent azimuth" value={fwd} set={setFwd} /></Pair>
            <Pair><Input label="Radius (m)" value={radius} set={setRadius} /><Input label="Stake interval (m)" value={interval} set={setInterval} /></Pair>
          </div>
          <div className="svt-grid-actions"><button className="btn btn-primary btn-sm" onClick={() => void run()}>Compute</button></div>
        </>
      }
    />
  );
}

// ── Vertical parabolic curve ─────────────────────────────────────────────────
export function VerticalCurveTool() {
  const [bvc, setBvc] = useState("100"), [g1, setG1] = useState("2.5"), [g2, setG2] = useState("-1.5");
  const [length, setLength] = useState("120"), [interval, setInterval] = useState("20");
  const [res, setRes] = useState<string | null>(null);

  const run = async () => {
    const b = num(bvc), gg1 = num(g1), gg2 = num(g2), len = num(length), iv = num(interval);
    if (![b, gg1, gg2, len].every(Number.isFinite)) return setRes("⚠ Enter valid BVC RL, grades and length.");
    if (len <= 0) return setRes("⚠ Length must be positive.");
    const c = await verticalCurve(b, gg1, gg2, len, Number.isFinite(iv) && iv > 0 ? iv : 0);
    if (!c) return setRes("⚠ Invalid curve parameters.");
    let table = "\n  Chainage(m)     RL(m)\n";
    for (const s of c.stations) {
      table += `  ${s.chainage.toFixed(2).padStart(10)}  ${s.elevation.toFixed(3).padStart(10)}\n`;
    }
    setRes(
      `BVC RL: ${c.bvcElevation.toFixed(3)} m\n` +
        `EVC RL: ${c.evcElevation.toFixed(3)} m\n` +
        `Grade change A: ${c.gradeChange.toFixed(3)} %\n` +
        `Turning point: ${c.turningChainage != null ? `${c.turningChainage.toFixed(2)} m @ RL ${c.turningElevation?.toFixed(3)} m` : "outside curve"}\n` +
        (c.stations.length ? table : ""),
    );
  };

  return (
    <Shell
      title="Vertical Curve Set-out"
      blurb="Design an equal-tangent parabolic curve between two grades and tabulate reduced levels along it."
      guide={VCURVE_GUIDE}
      result={res}
      form={
        <>
          <div className="svt-form">
            <Input label="BVC elevation (m)" value={bvc} set={setBvc} />
            <Pair><Input label="Grade in g₁ (%)" value={g1} set={setG1} /><Input label="Grade out g₂ (%)" value={g2} set={setG2} /></Pair>
            <Pair><Input label="Curve length L (m)" value={length} set={setLength} /><Input label="Chainage interval (m)" value={interval} set={setInterval} /></Pair>
          </div>
          <div className="svt-grid-actions"><button className="btn btn-primary btn-sm" onClick={() => void run()}>Compute</button></div>
        </>
      }
    />
  );
}
