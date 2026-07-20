import { useState } from "react";
import {
  angleEntryToDeg,
  dmsToDeg,
  type AngleEntryMode,
} from "../../components/cad/survey/format.ts";

interface AngleInputProps {
  label: string;
  /** Current value in DECIMAL DEGREES (the canonical internal unit), or null. */
  valueDeg: number | null;
  /** Called with the parsed decimal-degree value (or null when incomplete). */
  onChange: (deg: number | null) => void;
  /** Initial entry mode. Defaults to the Zimbabwe/SA packed DD.MMSS shorthand. */
  defaultMode?: AngleEntryMode;
}

const MODE_LABELS: Record<AngleEntryMode, string> = {
  dms: "D M S",
  packed: "DD.MMSS",
  decimal: "Decimal°",
  gon: "Gon",
};

/**
 * Angle entry that mirrors professional field software: surveyors never type
 * °'" symbols. They pick a mode and key the numbers. Three discrete
 * Deg/Min/Sec boxes for "dms", or a single box for packed DD.MMSS (the
 * Southern-African default), decimal degrees, or gon.
 *
 * The component is uncontrolled in its text but reports a canonical decimal
 * degree value upward via onChange.
 */
export function AngleInput({ label, valueDeg, onChange, defaultMode = "packed" }: AngleInputProps) {
  const [mode, setMode] = useState<AngleEntryMode>(defaultMode);
  // Free text for single-box modes.
  const [text, setText] = useState("");
  // Discrete components for DMS mode.
  const [d, setD] = useState("");
  const [m, setM] = useState("");
  const [s, setS] = useState("");

  const emitText = (next: string) => {
    setText(next);
    onChange(angleEntryToDeg(mode, next));
  };

  const emitDms = (nd: string, nm: string, ns: string) => {
    setD(nd);
    setM(nm);
    setS(ns);
    if (!nd && !nm && !ns) return onChange(null);
    const dn = Number(nd || 0);
    const mn = Number(nm || 0);
    const sn = Number(ns || 0);
    if (![dn, mn, sn].every(Number.isFinite) || mn >= 60 || sn >= 60) return onChange(null);
    onChange(dmsToDeg(dn, mn, sn));
  };

  const switchMode = (next: AngleEntryMode) => {
    setMode(next);
    // Re-seed the new mode's fields from the current canonical value so the
    // displayed angle is preserved across a mode switch.
    if (valueDeg == null || !Number.isFinite(valueDeg)) {
      setText("");
      setD(""); setM(""); setS("");
      return;
    }
    if (next === "decimal") {
      setText(valueDeg.toFixed(6));
    } else if (next === "gon") {
      setText(((valueDeg / 360) * 400).toFixed(4));
    } else if (next === "packed") {
      const sign = valueDeg < 0 ? "-" : "";
      const abs = Math.abs(valueDeg);
      const deg = Math.floor(abs);
      const minF = (abs - deg) * 60;
      const min = Math.floor(minF);
      const sec = Math.round((minF - min) * 60);
      setText(`${sign}${deg}.${String(min).padStart(2, "0")}${String(sec).padStart(2, "0")}`);
    } else {
      const sign = valueDeg < 0 ? -1 : 1;
      const abs = Math.abs(valueDeg);
      const deg = Math.floor(abs);
      const minF = (abs - deg) * 60;
      const min = Math.floor(minF);
      const sec = (minF - min) * 60;
      setD(String(sign * deg)); setM(String(min)); setS(sec.toFixed(2));
    }
  };

  return (
    <div className="form-group svt-angle-input">
      <label className="form-label">
        {label}
        <select
          className="svt-angle-mode"
          value={mode}
          onChange={(e) => switchMode(e.target.value as AngleEntryMode)}
          aria-label={`${label} entry mode`}
        >
          {(Object.keys(MODE_LABELS) as AngleEntryMode[]).map((k) => (
            <option key={k} value={k}>{MODE_LABELS[k]}</option>
          ))}
        </select>
      </label>

      {mode === "dms" ? (
        <div className="svt-dms-row">
          <input className="input-field" inputMode="numeric" placeholder="°" value={d} onChange={(e) => emitDms(e.target.value, m, s)} aria-label={`${label} degrees`} />
          <span className="svt-dms-sep">°</span>
          <input className="input-field" inputMode="numeric" placeholder="′" value={m} onChange={(e) => emitDms(d, e.target.value, s)} aria-label={`${label} minutes`} />
          <span className="svt-dms-sep">′</span>
          <input className="input-field" inputMode="decimal" placeholder="″" value={s} onChange={(e) => emitDms(d, m, e.target.value)} aria-label={`${label} seconds`} />
          <span className="svt-dms-sep">″</span>
        </div>
      ) : (
        <input
          className="input-field"
          inputMode="decimal"
          value={text}
          onChange={(e) => emitText(e.target.value)}
          placeholder={
            mode === "packed" ? "45.3020 → 45°30′20″" : mode === "gon" ? "gradians" : "decimal degrees"
          }
        />
      )}
    </div>
  );
}
