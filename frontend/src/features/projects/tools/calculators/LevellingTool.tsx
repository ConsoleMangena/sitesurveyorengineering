import { useMemo, useState } from "react";
import {
  reduceLevelling,
  type LevellingReading,
  type StaffKind,
} from "../../components/cad/survey/cogo.ts";
import { ToolGuidePanel, type ToolGuide } from "./ToolGuide.tsx";

const LEVELLING_GUIDE: ToolGuide = {
  summary: "Reduce a line of levels: turn staff readings (BS/IS/FS) into reduced levels (Z), with the arithmetic check and misclosure adjustment done for you.",
  steps: [
    { title: "Choose the method", body: "Rise & Fall or Height of Plane of Collimation (HPC). Both give the same levels; pick the one you book with." },
    { title: "Enter the start level", body: "Type the known reduced level (RL) of the first benchmark." },
    { title: "Add the readings in order", body: "For each row set BS, IS or FS and the staff reading. A backsight starts a setup; a foresight ends it." },
    { title: "Add a closing RL (optional)", body: "Enter a known closing RL to compute the misclosure and distribute it across setups." },
    { title: "Read the results", body: "Reduced levels, the arithmetic check and any misclosure adjustment update live." },
  ],
};

interface Row {
  id: number;
  label: string;
  kind: StaffKind;
  reading: string;
}

let rid = 0;
const newRow = (label = "", kind: StaffKind = "IS", reading = ""): Row => ({
  id: ++rid,
  label,
  kind,
  reading,
});

const SAMPLE: Row[] = [
  newRow("BM1", "BS", "1.500"),
  newRow("A", "IS", "1.200"),
  newRow("B", "IS", "1.800"),
  newRow("TP1", "FS", "1.000"),
  newRow("TP1", "BS", "0.900"),
  newRow("C", "IS", "1.350"),
  newRow("BM2", "FS", "1.100"),
];

const num = (v: string): number => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

export function LevellingTool() {
  const [method, setMethod] = useState<"rise-fall" | "hpc">("rise-fall");
  const [startRL, setStartRL] = useState("100.000");
  const [closingRL, setClosingRL] = useState("");
  const [rows, setRows] = useState<Row[]>(SAMPLE);

  const update = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, newRow()]);
  const delRow = (id: number) => setRows((rs) => rs.filter((r) => r.id !== id));

  const { result, error } = useMemo(() => {
    const z0 = num(startRL);
    let err: string | null = null;
    let res: ReturnType<typeof reduceLevelling> | null = null;
    if (!Number.isFinite(z0)) {
      err = "Enter a valid starting reduced level (Z).";
    } else {
      const readings: LevellingReading[] = [];
      for (const r of rows) {
        if (!r.label.trim() && !r.reading.trim()) continue;
        const reading = num(r.reading);
        if (!Number.isFinite(reading)) { err = `Invalid reading for "${r.label || "?"}".`; break; }
        readings.push({ label: r.label || "—", kind: r.kind, reading });
      }
      if (!err && readings.length < 2) err = "Add at least two readings.";
      if (!err && readings[0]?.kind !== "BS") err = "The first reading must be a backsight (BS) on the benchmark.";
      if (!err) {
        const known = closingRL.trim() ? num(closingRL) : null;
        res = reduceLevelling(readings, z0, method, known);
      }
    }
    return { result: res, error: err };
  }, [rows, startRL, closingRL, method]);

  const adjusted = closingRL.trim() !== "" && result?.misclose != null;

  return (
    <div className="svt-shell">
      <div className="svt-header">
        <div>
          <h2>Levelling — Rise &amp; Fall / Height of Plane of Collimation</h2>
          <p>
            Enter staff readings (BS/IS/FS) to reduce levels (Z). The reduction method, arithmetic
            checks and misclosure adjustment update live. Provide a known closing RL to distribute
            misclosure across instrument setups.
          </p>
          <ToolGuidePanel guide={LEVELLING_GUIDE} />
        </div>
        <div className="svt-toolbar">
          <label className="form-label">Method</label>
          <select className="input-field" style={{ width: 220 }} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="rise-fall">Rise &amp; Fall</option>
            <option value="hpc">Height of Plane of Collimation</option>
          </select>
        </div>
      </div>

      <div className="svt-toolbar">
        <label className="form-label">Start RL / Z (m)</label>
        <input className="input-field" style={{ width: 130 }} value={startRL} onChange={(e) => setStartRL(e.target.value)} />
        <label className="form-label">Known closing RL (optional)</label>
        <input className="input-field" style={{ width: 150 }} value={closingRL} onChange={(e) => setClosingRL(e.target.value)} placeholder="blank if none" />
      </div>

      {error && <div className="svt-error">⚠ {error}</div>}

      <div className="svt-grid-layout">
        {/* Reduction table */}
        <div className="svt-card">
          <div className="svt-card-title"><span>Field book &amp; reduction</span><span>{rows.length} rows</span></div>
          <div className="svt-table-wrap">
            <table className="svt-table">
              <thead>
                <tr>
                  <th>Station</th>
                  <th>BS</th>
                  <th>IS</th>
                  <th>FS</th>
                  {method === "hpc" ? <th>HPC</th> : <><th>Rise</th><th>Fall</th></>}
                  <th>RL (Z)</th>
                  {adjusted && <th>Adj. RL</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const out = result?.rows[matchIndex(result, rows, i)] ?? null;
                  const f = (v: number | null | undefined) => (v == null ? "" : v.toFixed(3));
                  return (
                    <tr key={r.id}>
                      <td>
                        <input className="svt-cell-input text" value={r.label} onChange={(e) => update(r.id, { label: e.target.value })} placeholder="pt" />
                      </td>
                      <td>{r.kind === "BS"
                        ? <input className="svt-cell-input" value={r.reading} onChange={(e) => update(r.id, { reading: e.target.value })} />
                        : <span className="svt-cell-muted">—</span>}</td>
                      <td>{r.kind === "IS"
                        ? <input className="svt-cell-input" value={r.reading} onChange={(e) => update(r.id, { reading: e.target.value })} />
                        : <span className="svt-cell-muted">—</span>}</td>
                      <td>{r.kind === "FS"
                        ? <input className="svt-cell-input" value={r.reading} onChange={(e) => update(r.id, { reading: e.target.value })} />
                        : <span className="svt-cell-muted">—</span>}</td>
                      {method === "hpc"
                        ? <td className="svt-cell-derived">{f(out?.hpc)}</td>
                        : <><td className="svt-cell-derived">{f(out?.rise)}</td><td className="svt-cell-derived">{f(out?.fall)}</td></>}
                      <td className="svt-cell-derived">{f(out?.rl)}</td>
                      {adjusted && <td className="svt-cell-derived">{f(out?.adjustedRl)}</td>}
                      <td>
                        <select className="svt-cell-input" style={{ minWidth: 56 }} value={r.kind} onChange={(e) => update(r.id, { kind: e.target.value as StaffKind })}>
                          <option value="BS">BS</option>
                          <option value="IS">IS</option>
                          <option value="FS">FS</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {result && (
                <tfoot>
                  <tr>
                    <td>Σ</td>
                    <td>{result.sumBS.toFixed(3)}</td>
                    <td></td>
                    <td>{result.sumFS.toFixed(3)}</td>
                    {method === "hpc" ? <td></td> : <><td>{result.sumRise.toFixed(3)}</td><td>{result.sumFall.toFixed(3)}</td></>}
                    <td></td>
                    {adjusted && <td></td>}
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <div className="svt-grid-actions">
            <button className="btn btn-outline btn-sm" onClick={addRow}>+ Add row</button>
            {rows.length > 0 && <button className="btn btn-outline btn-sm" onClick={() => delRow(rows[rows.length - 1].id)}>− Remove last</button>}
            <button className="btn btn-outline btn-sm" onClick={() => setRows(SAMPLE)}>Reset sample</button>
            <button className="btn btn-outline btn-sm" onClick={() => setRows([newRow("BM1", "BS", "")])}>Clear</button>
          </div>
        </div>

        {/* Summary + checks + profile */}
        <div style={{ display: "grid", gap: 16 }}>
          <div className="svt-card">
            <div className="svt-card-title">Summary &amp; checks</div>
            {result ? (
              <>
                <div className="svt-summary">
                  <Row2 label="ΣBS − ΣFS" v={result.bsMinusFs} />
                  {method === "rise-fall" && <Row2 label="ΣRise − ΣFall" v={result.riseMinusFall} />}
                  <Row2 label="Last − First RL" v={result.lastMinusFirst} />
                  {result.misclose != null && <Row2 label="Closing misclosure (m)" v={result.misclose} />}
                </div>
                <div className={`svt-check ${result.checkOk ? "pass" : "fail"}`}>
                  {result.checkOk ? "✓ Arithmetic check PASSES" : "✗ Arithmetic check FAILS — review readings"}
                </div>
              </>
            ) : (
              <p style={{ padding: 14, fontSize: 13, color: "var(--text-muted)" }}>Enter valid readings to see the summary.</p>
            )}
          </div>

          <div className="svt-card">
            <div className="svt-card-title">Levelling profile (RL vs station)</div>
            {result ? <Profile result={result} adjusted={adjusted} /> : <p style={{ padding: 14, fontSize: 13, color: "var(--text-muted)" }}>No data.</p>}
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

/** Map an input row index to its reduced-output row (skipping blank rows). */
function matchIndex(result: ReturnType<typeof reduceLevelling>, rows: Row[], inputIdx: number): number {
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const blank = !r.label.trim() && !r.reading.trim();
    if (blank) { if (i === inputIdx) return -1; continue; }
    if (i === inputIdx) return Math.min(count, result.rows.length - 1);
    count++;
  }
  return -1;
}

function Profile({ result, adjusted }: { result: ReturnType<typeof reduceLevelling>; adjusted: boolean }) {
  const W = 320, H = 180, padL = 38, padB = 26, padT = 12, padR = 12;
  const rls = result.rows.map((r) => (adjusted ? r.adjustedRl : r.rl));
  if (rls.length < 2) return <p style={{ padding: 14, fontSize: 13, color: "var(--text-muted)" }}>Need 2+ points.</p>;
  const min = Math.min(...rls), max = Math.max(...rls);
  const span = max - min || 1;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const x = (i: number) => padL + (i / (rls.length - 1)) * innerW;
  const y = (v: number) => padT + (1 - (v - min) / span) * innerH;
  const path = rls.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  return (
    <svg className="svt-plot" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Levelling profile">
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="var(--border)" />
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="var(--border)" />
      <text x={4} y={y(max) + 4} fontSize="9" fill="var(--text-muted)">{max.toFixed(2)}</text>
      <text x={4} y={y(min) + 4} fontSize="9" fill="var(--text-muted)">{min.toFixed(2)}</text>
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" />
      {rls.map((v, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(v)} r="3" fill="var(--accent)" />
          <text x={x(i)} y={H - padB + 12} fontSize="8" fill="var(--text-muted)" textAnchor="middle">
            {result.rows[i].label.slice(0, 6)}
          </text>
        </g>
      ))}
    </svg>
  );
}
