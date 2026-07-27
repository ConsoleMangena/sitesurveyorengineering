import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { UseCadSettings } from "./useCadSettings.ts";
import { COORD_DECIMALS_MAX, COORD_DECIMALS_MIN, type AxisConvention } from "./cadSettings.ts";
import type { BearingFormat, AngleEntryMode } from "./survey/format.ts";
import { RotateCcw, Maximize2 } from "lucide-react";
import { CadPopoverTemplate } from "@/components/templates/CadPopoverTemplate.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Button } from "@/components/ui/button.tsx";

const AXIS_OPTIONS: { value: AxisConvention; label: string }[] = [
  { value: "yx", label: "Y = East, X = North — Gauss Conform (Zimbabwe / RSA)" },
  { value: "xy", label: "X = East, Y = North — UTM / international" },
];

const BEARING_OPTIONS: { value: BearingFormat; label: string }[] = [
  { value: "azimuth", label: "WCB / Forward Bearing (D°M'S\")" },
  { value: "quadrant", label: "Reduced Bearing (N/S .. E/W)" },
  { value: "gon", label: "Gon / Grad (400)" },
];

const ANGLE_ENTRY_OPTIONS: { value: AngleEntryMode; label: string }[] = [
  { value: "packed", label: "Packed DD.MMSS" },
  { value: "dms", label: "D M S fields" },
  { value: "decimal", label: "Decimal degrees" },
  { value: "gon", label: "Gon / Grad" },
];

interface CadSettingsPopoverProps {
  settingsApi: UseCadSettings;
  /** Apply a plotting scale (1:denominator) to the viewport. */
  onApplyScale: (denominator: number) => void;
  /** Zoom the viewport to the drawing extents. */
  onFitExtents: () => void;
  /** Close the popover. */
  onClose: () => void;
}

/**
 * Drafting-settings popover, anchored to the top-bar gear button. Holds the
 * workstation-level display / precision / snap preferences that used to live in
 * the right-panel "Settings" tab. Closes on Escape or an outside click.
 */
export function CadSettingsPopover({
  settingsApi,
  onApplyScale,
  onFitExtents,
  onClose,
}: CadSettingsPopoverProps) {
  const { settings, update, toggle, reset } = settingsApi;
  const [scaleText, setScaleText] = useState(String(settings.scaleDenominator));
  const [spacingText, setSpacingText] = useState(String(settings.snapSpacing));
  const popRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});

  useLayoutEffect(() => {
    function updatePosition() {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const vw = document.documentElement.clientWidth;
      setPopoverStyle({
        position: "fixed",
        top: rect.bottom + 8,
        right: vw - rect.right,
      });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, []);

  // Keep the local scale text in sync when the denominator changes elsewhere
  // (e.g. via the Apply-scale command or the ribbon). Adjust-state-during-render
  // pattern, avoiding a setState-in-effect cascade.
  const [lastDenom, setLastDenom] = useState(settings.scaleDenominator);
  if (lastDenom !== settings.scaleDenominator) {
    setLastDenom(settings.scaleDenominator);
    setScaleText(String(settings.scaleDenominator));
  }

  // Close on Escape or a click outside the popover.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    // Defer so the opening click does not immediately close the popover.
    const id = window.setTimeout(() => document.addEventListener("mousedown", onClick), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
      window.clearTimeout(id);
    };
  }, [onClose]);

  return (
    <>
      <span ref={anchorRef} className="cad-settings-anchor-marker" aria-hidden="true" />
      {createPortal(
        <CadPopoverTemplate
          className="cad-settings-popover border"
          ref={popRef as React.RefObject<HTMLDivElement>}
          title="Drawing settings"
          onClose={onClose}
          contentClassName="cad-settings text-xs"
          style={popoverStyle}
        >
            <div className="cad-settings-group">
              <div className="cad-settings-group-title">Units &amp; precision</div>

          <label className="cad-edit-row">
            <span>Direction</span>
            <select
              className="input-field"
              value={settings.bearingFormat}
              disabled
              title="Controlled by Project Hub settings"
            >
              {BEARING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <p className="cad-settings-note">Project setting — change it in Project Hub → Settings.</p>

          <label className="cad-edit-row">
            <span>Axis labels</span>
            <select
              className="input-field"
              value={settings.axisConvention}
              disabled
              title="Controlled by Project Hub settings"
            >
              {AXIS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <p className="cad-settings-note">Project setting — change it in Project Hub → Settings.</p>

          <label className="cad-edit-row">
            <span>Angle entry</span>
            <select
              className="input-field"
              value={settings.angleEntry}
              disabled
              title="Controlled by Project Hub settings"
            >
              {ANGLE_ENTRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <p className="cad-settings-note">Project setting — change it in Project Hub → Settings.</p>

          <label className="cad-edit-row">
            <span>Coordinate decimals</span>
            <input
              className="input-field"
              type="number"
              min={COORD_DECIMALS_MIN}
              max={COORD_DECIMALS_MAX}
              value={settings.coordDecimals}
              disabled
              title="Controlled by Project Hub settings"
              onChange={() => {}}
            />
          </label>
          <p className="cad-settings-note">Project setting — change it in Project Hub → Settings.</p>
        </div>

        <div className="cad-settings-group">
          <div className="cad-settings-group-title">Scale</div>
          <label className="cad-edit-row">
            <span>Plot scale 1:</span>
            <input
              className="input-field"
              type="number"
              min={1}
              value={scaleText}
              onChange={(e) => setScaleText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onApplyScale(parseFloat(scaleText)); }}
            />
          </label>
          <div className="cad-settings-actions">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onApplyScale(parseFloat(scaleText))}>
              Apply scale
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onFitExtents} title="Zoom to drawing extents">
              <Maximize2 size={12} /> Fit extents
            </Button>
          </div>
        </div>

        <div className="cad-settings-group">
          <div className="cad-settings-group-title">Snap &amp; drafting aids</div>

          <ToggleRow label="Object snap (OSNAP)" checked={settings.osnap} onChange={() => toggle("osnap")} />
          <ToggleRow label="Ortho mode" checked={settings.ortho} onChange={() => toggle("ortho")} />
          <ToggleRow label="Show grid" checked={settings.showGrid} onChange={() => toggle("showGrid")} />
          <ToggleRow label="Grid snap (SNAP)" checked={settings.snap} onChange={() => toggle("snap")} />
          <ToggleRow
            label="Auto snap spacing (by zoom)"
            checked={settings.snapAuto}
            onChange={() => update({ snapAuto: !settings.snapAuto })}
          />
          {!settings.snapAuto && (
            <label className="cad-edit-row">
              <span>Snap spacing (m)</span>
              <input
                className="input-field"
                type="number"
                min={0}
                step="any"
                value={spacingText}
                onChange={(e) => setSpacingText(e.target.value)}
                onBlur={() => {
                  const v = parseFloat(spacingText);
                  if (Number.isFinite(v) && v > 0) update({ snapSpacing: v });
                  else setSpacingText(String(settings.snapSpacing));
                }}
              />
            </label>
          )}
        </div>

        <div className="cad-settings-group">
          <div className="cad-settings-group-title">Display</div>
          <ToggleRow
            label="Point number / code labels"
            checked={settings.showPointLabels}
            onChange={() => update({ showPointLabels: !settings.showPointLabels })}
          />
          <ToggleRow
            label="Segment bearing / distance labels"
            checked={settings.showSegmentLabels}
            onChange={() => update({ showSegmentLabels: !settings.showSegmentLabels })}
          />
        </div>

        <Button size="sm" variant="ghost" className="w-fit gap-1 text-xs h-7" onClick={reset}>
          <RotateCcw size={12} /> Reset to defaults
        </Button>
        <p className="cad-panel-hint">
          Settings are saved per project on this device. They control display and drafting aids only — the drawing
          geometry is unchanged.
        </p>
        </CadPopoverTemplate>,
        document.body,
      )}
    </>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  const id = `cad-toggle-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className="cad-edit-row cad-settings-toggle">
      <Label htmlFor={id} className="cursor-pointer text-xs font-normal text-inherit">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="data-[state=checked]:bg-primary" />
    </div>
  );
}
