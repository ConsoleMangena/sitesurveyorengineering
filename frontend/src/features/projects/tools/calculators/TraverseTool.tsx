import { useMemo, useState } from "react";
import {
  computeTraverse,
  forward,
  type TraverseLeg,
  type TraverseType,
} from "../../components/cad/survey/cogo.ts";
import { parseBearing } from "../../components/cad/survey/format.ts";
import { ToolGuidePanel, type ToolGuide } from "./ToolGuide.tsx";

interface Leg { id: number; bearing: string; distance: string }

const TRAVERSE_GUIDE: ToolGuide = {
  summary: "Compute and balance a traverse: from a known start point, walk leg by leg to get coordinates, check the misclosure, then distribute it with the Bowditch (compass) rule.",
  steps: [
    { title: "Pick the traverse type", body: "Closed loop returns to the start, closed link ends on a second known point, open has no closure (no adjustment)." },
    { title: "Enter the start point", body: "Type the Start X and Start Y. For a link traverse also enter the known closing X, Y." },
    { title: "Add the legs", body: "For each leg enter the bearing and distance in order around the traverse." },
    { title: "Read the results", body: "Misclosure, accuracy (1:X) and the balanced coordinates update live as you type." },
  ],
  tips: ["Open traverses cannot be checked or balanced — coordinates are raw computed values only."],
};

const TRAVERSE_TYPES: { id: TraverseType; label: string; blurb: string }[] = [
  {
    id: "closed-loop",
    label: "Closed loop (polygon)",
    blurb: "Begins and ends on the same known point. Misclosure is start − computed end.",
  },
  {
    id: "closed-link",
    label: "Closed link (connecting)",
    blurb: "Begins on one known point and ends on a different known point. Enter the known closing X, Y.",
  },
  {
    id: "open",
    label: "Open",
    blurb: "Begins on a known point and ends on an unknown point. No closure check or adjustment.",
  },
];

let lid = 0;
const newLeg = (bearing = "", distance = ""): Leg => ({ id: ++lid, bearing, distance });

const SAMPLE: Leg[] = [
  newLeg("90", "100.00"),
  newLeg("0", "100.00"),
  newLeg("270", "100.00"),
  newLeg("180", "99.00"),
];

const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; };

export function TraverseTool() {
  const [type, setType] = useState<TraverseType>("closed-loop");
  const [x0, setX0] = useState("1000.000");
  const [y0, setY0] = useState("1000.000");
  const [cx, setCx] = useState("1000.000");
  const [cy, setCy] = useState("1000.000");
  const [legsState, setLegsState] = useState<Leg[]>(SAMPLE);

  const activeType = TRAVERSE_TYPES.find((t) => t.id === type)!;

  const update = (id: number, patch: Partial<Leg>) =>
    setLegsState((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLeg = () => setLegsState((ls) => [...ls, newLeg()]);
  const delLeg = (id: number) => setLegsState((ls) => ls.filter((l) => l.id !== id));

  const { result, error } = useMemo(() => {
    const sx = num(x0), sy = num(y0);
    let err: string | null = null;
    let res: ReturnType<typeof computeTraverse> | null = null;
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
      err = "Enter a valid start X, Y.";
    } else {
      const legs: TraverseLeg[] = [];
      for (const l of legsState) {
        if (!l.bearing.trim() && !l.distance.trim()) continue;
        const az = parseBearing(l.bearing);
        const d = num(l.distance);
        if (az == null || !Number.isFinite(d)) { err = `Invalid leg (bearing "${l.bearing}", distance "${l.distance}").`; break; }
        legs.push({ azimuth: az, distance: d });
      }
      const minLegs = type === "open" ? 1 : type === "closed-loop" ? 3 : 1;
      if (!err && legs.length < minLegs) {
        err =
          type === "closed-loop"
            ? "A closed-loop traverse needs at least 3 legs."
            : "Enter at least one valid leg.";
      }
      let closingPoint: { n: number; e: number } | undefined;
      if (!err && type === "closed-link") {
        const ex = num(cx), ey = num(cy);
        if (!Number.isFinite(ex) || !Number.isFinite(ey)) {
          err = "Enter a valid known closing X, Y for a link traverse.";
        } else {
          closingPoint = { n: ey, e: ex };
        }
      }
      if (!err) res = computeTraverse({ n: sy, e: sx }, legs, { type, closingPoint });
    }
    return { result: res, error: err };
  }, [type, x0, y0, cx, cy, legsState]);

  return (
    <div className="svt-shell">
      <div className="svt-header">
        <div>
          <h2>Traverse Computation &amp; Balancing (Bowditch)</h2>
          <p>{activeType.blurb} Latitudes/departures (ΔY/ΔX), misclosure, accuracy and the compass-rule (Bowditch) balanced coordinates update live.</p>
          <ToolGuidePanel guide={TRAVERSE_GUIDE} />
        </div>
        <div className="svt-toolbar" style={{ flexWrap: "wrap" }}>
          <label className="form-label">Type</label>
          <select
            className="input-field"
            style={{ width: 220 }}
            value={type}
            onChange={(e) => setType(e.target.value as TraverseType)}
          >
            {TRAVERSE_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <label className="form-label">Start X</label>
          <input className="input-field" style={{ width: 120 }} value={x0} onChange={(e) => setX0(e.target.value)} />
          <label className="form-label">Start Y</label>
          <input className="input-field" style={{ width: 120 }} value={y0} onChange={(e) => setY0(e.target.value)} />
          {type === "closed-link" && (
            <>
              <label className="form-label">Close X</label>
              <input className="input-field" style={{ width: 120 }} value={cx} onChange={(e) => setCx(e.target.value)} />
              <label className="form-label">Close Y</label>
              <input className="input-field" style={{ width: 120 }} value={cy} onChange={(e) => setCy(e.target.value)} />
            </>
          )}
        </div>
      </div>

      {error && <div className="svt-error">⚠ {error}</div>}

      <div className="svt-grid-layout">
        <div className="svt-card">
          <div className="svt-card-title"><span>Legs &amp; balanced coordinates</span><span>{legsState.length} legs</span></div>
          <div className="svt-table-wrap">
            <table className="svt-table">
              <thead>
                <tr>
                  <th>Stn</th><th>Bearing</th><th>Dist</th>
                  <th>ΔX</th><th>ΔY</th><th>X (raw)</th><th>Y (raw)</th>
                  <th>X (adj)</th><th>Y (adj)</th><th></th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>0</td><td className="svt-cell-muted">—</td><td className="svt-cell-muted">—</td>
                  <td className="svt-cell-muted">—</td><td className="svt-cell-muted">—</td>
                  <td className="svt-cell-derived">{num(x0).toFixed(3)}</td>
                  <td className="svt-cell-derived">{num(y0).toFixed(3)}</td>
                  <td className="svt-cell-derived">{result ? result.adjusted[0].e.toFixed(3) : ""}</td>
                  <td className="svt-cell-derived">{result ? result.adjusted[0].n.toFixed(3) : ""}</td>
                  <td></td>
                </tr>
                {legsState.map((l, i) => {
                  const raw = result?.computed[i + 1];
                  const adj = result?.adjusted[i + 1];
                  const az = parseBearing(l.bearing);
                  const d = num(l.distance);
                  const prev = result?.computed[i];
                  let dx = NaN, dy = NaN;
                  if (az != null && Number.isFinite(d) && prev) {
                    const p = forward(prev, az, d);
                    dx = p.e - prev.e; dy = p.n - prev.n;
                  }
                  const f = (v: number | undefined | null) => (v == null || !Number.isFinite(v) ? "" : v.toFixed(3));
                  return (
                    <tr key={l.id}>
                      <td>{i + 1}</td>
                      <td><input className="svt-cell-input" value={l.bearing} onChange={(e) => update(l.id, { bearing: e.target.value })} placeholder="90 or N45E" /></td>
                      <td><input className="svt-cell-input" value={l.distance} onChange={(e) => update(l.id, { distance: e.target.value })} /></td>
                      <td className="svt-cell-derived">{f(dx)}</td>
                      <td className="svt-cell-derived">{f(dy)}</td>
                      <td className="svt-cell-derived">{f(raw?.e)}</td>
                      <td className="svt-cell-derived">{f(raw?.n)}</td>
                      <td className="svt-cell-derived">{f(adj?.e)}</td>
                      <td className="svt-cell-derived">{f(adj?.n)}</td>
                      <td><button className="svt-row-del" onClick={() => delLeg(l.id)} aria-label="Delete leg">×</button></td>
                    </tr>
                  );
                })}
              </tbody>
              {result && (
                <tfoot>
                  <tr>
                    <td>Σ</td><td></td><td>{result.perimeter.toFixed(3)}</td>
                    <td>{result.misclosureE.toFixed(3)}</td>
                    <td>{result.misclosureN.toFixed(3)}</td>
                    <td colSpan={4}></td><td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <div className="svt-grid-actions">
            <button className="btn btn-outline btn-sm" onClick={addLeg}>+ Add leg</button>
            <button className="btn btn-outline btn-sm" onClick={() => setLegsState(SAMPLE)}>Reset sample</button>
            <button className="btn btn-outline btn-sm" onClick={() => setLegsState([newLeg()])}>Clear</button>
          </div>
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          <div className="svt-card">
            <div className="svt-card-title">Misclosure &amp; accuracy</div>
            {result ? (
              result.hasClosure ? (
                <div className="svt-summary">
                  <Row2 label="Total length (m)" v={result.perimeter} />
                  <Row2 label="Misclosure ΔX (m)" v={result.misclosureE} />
                  <Row2 label="Misclosure ΔY (m)" v={result.misclosureN} />
                  <Row2 label="Linear misclosure (m)" v={result.linearMisclosure} />
                  <div className="svt-summary-row">
                    <span className="svt-summary-label">Accuracy</span>
                    <span className="svt-summary-val">{Number.isFinite(result.precision) ? `1:${Math.round(result.precision).toLocaleString()}` : "Exact"}</span>
                  </div>
                </div>
              ) : (
                <div className="svt-summary">
                  <Row2 label="Total length (m)" v={result.perimeter} />
                  <div className="svt-summary-row">
                    <span className="svt-summary-label">Closure</span>
                    <span className="svt-summary-val">Open — no check</span>
                  </div>
                  <p style={{ padding: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                    An open traverse cannot be checked or balanced. Coordinates are computed (raw) only.
                  </p>
                </div>
              )
            ) : <p style={{ padding: 14, fontSize: 13, color: "var(--text-muted)" }}>Enter the legs to compute.</p>}
          </div>
          <div className="svt-card">
            <div className="svt-card-title">{result?.hasClosure ? "Traverse plan (balanced)" : "Traverse plan (computed)"}</div>
            {result ? <PlanPlot pts={result.adjusted} closed={result.type === "closed-loop"} /> : <p style={{ padding: 14, fontSize: 13, color: "var(--text-muted)" }}>No data.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row2({ label, v }: { label: string; v: number }) {
  return (
    <div className="svt-summary-row">
      <span className="svt-summary-label">{label}</span>
      <span className="svt-summary-val">{v.toFixed(4)}</span>
    </div>
  );
}

function PlanPlot({ pts, closed }: { pts: { n: number; e: number }[]; closed: boolean }) {
  const W = 320, H = 240, pad = 20;
  if (pts.length < 2) return <p style={{ padding: 14, fontSize: 13, color: "var(--text-muted)" }}>No data.</p>;
  // Only a closed-loop traverse draws the closing segment back to the start.
  const ring = closed ? [...pts, pts[0]] : pts;
  const es = ring.map((p) => p.e), ns = ring.map((p) => p.n);
  const minE = Math.min(...es), maxE = Math.max(...es), minN = Math.min(...ns), maxN = Math.max(...ns);
  const spanE = maxE - minE || 1, spanN = maxN - minN || 1;
  const innerW = W - pad * 2, innerH = H - pad * 2;
  const x = (e: number) => pad + ((e - minE) / spanE) * innerW;
  const y = (n: number) => pad + (1 - (n - minN) / spanN) * innerH; // Y up = North up
  const path = ring.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.e).toFixed(1)} ${y(p.n).toFixed(1)}`).join(" ");
  return (
    <svg className="svt-plot" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Traverse plan">
      <path d={path} fill={closed ? "color-mix(in oklab, var(--accent) 12%, transparent)" : "none"} stroke="var(--accent)" strokeWidth="2" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={x(p.e)} cy={y(p.n)} r="3" fill="var(--accent)" />
          <text x={x(p.e) + 4} y={y(p.n) - 4} fontSize="9" fill="var(--text-muted)">{i}</text>
        </g>
      ))}
    </svg>
  );
}
