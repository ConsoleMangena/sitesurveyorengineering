import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import { FileUp } from "lucide-react";
import { axisBadgeLabels, type AxisConvention } from "./cadSettings.ts";

export interface CsvColumnMapping {
  pointNo: number;
  easting: number;
  northing: number;
  elevation: number | null;
  code: number | null;
}

interface CadCsvImportDialogProps {
  open: boolean;
  fileName: string;
  csvText: string;
  axisConvention?: AxisConvention;
  onImport: (mapping: CsvColumnMapping, hasHeader: boolean) => void;
  onCancel: () => void;
}

function targets(axis: ReturnType<typeof axisBadgeLabels>) {
  return [
    { key: "pointNo" as const, label: "Point #", required: true },
    { key: "easting" as const, label: axis.first, required: true },
    { key: "northing" as const, label: axis.second, required: true },
    { key: "elevation" as const, label: "Z / RL", required: false },
    { key: "code" as const, label: "Code", required: false },
  ];
}

function looksNumeric(v: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(v.trim());
}

function detectHeader(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const first = rows[0];
  // A header row has mostly non-numeric leading values.
  const numericCount = first.filter(looksNumeric).length;
  return numericCount < first.length / 2;
}

function detectMapping(rows: string[][], hasHeader: boolean): CsvColumnMapping {
  if (rows.length === 0 || (hasHeader && rows.length === 1)) {
    return { pointNo: 0, easting: 0, northing: 0, elevation: null, code: null };
  }
  const sample = hasHeader && rows.length > 1 ? rows[1] : rows[0];
  const headers = hasHeader ? rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, "")) : [];
  const colCount = sample.length;
  const byHeader = (candidates: string[]): number => {
    for (const c of candidates) {
      const idx = headers.indexOf(c);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const firstNumeric = (skip = 0): number => {
    for (let i = skip; i < colCount; i++) {
      if (hasHeader) {
        if (looksNumeric(rows[1][i] ?? "")) return i;
      } else if (looksNumeric(rows[0][i] ?? "")) {
        return i;
      }
    }
    return Math.min(skip, colCount - 1);
  };

  const pointNoCol = byHeader(["pointno", "ptno", "point", "pt", "id", "name"]) ?? 0;
  const eastingCol = byHeader(["easting", "east", "y", "e"]) ?? firstNumeric(1);
  const northingCol = byHeader(["northing", "north", "x", "n"]) ?? firstNumeric(Math.max(eastingCol + 1, 1));
  const elevationCol = byHeader(["elevation", "elev", "z", "rl", "height", "h"]);
  const codeCol = byHeader(["code", "feature", "desc", "description"]);

  return {
    pointNo: Math.max(0, Math.min(pointNoCol, colCount - 1)),
    easting: Math.max(0, Math.min(eastingCol, colCount - 1)),
    northing: Math.max(0, Math.min(northingCol, colCount - 1)),
    elevation: elevationCol >= 0 ? elevationCol : null,
    code: codeCol >= 0 ? codeCol : null,
  };
}

export function CadCsvImportDialog({
  open,
  fileName,
  csvText,
  axisConvention = "yx",
  onImport,
  onCancel,
}: CadCsvImportDialogProps) {
  const axis = axisBadgeLabels(axisConvention);
  const TARGETS = targets(axis);
  const rows = useMemo(() => {
    return csvText
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map((l) => l.split(/[,\t;]/).map((c) => c.trim()))
      .filter((r) => r.length >= 2);
  }, [csvText]);

  const [hasHeader, setHasHeader] = useState(() => detectHeader(rows));
  const [mapping, setMapping] = useState<CsvColumnMapping>(() => detectMapping(rows, detectHeader(rows)));

  const previewRows = useMemo(() => {
    const start = hasHeader ? 1 : 0;
    return rows.slice(start, start + 5);
  }, [rows, hasHeader]);

  const colCount = rows.length > 0 ? rows[0].length : 0;
  const colOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    for (let i = 0; i < colCount; i++) {
      const header = hasHeader ? rows[0][i] : undefined;
      opts.push({
        value: String(i),
        label: header ? `Col ${i + 1}: ${header}` : `Col ${i + 1}`,
      });
    }
    return opts;
  }, [colCount, rows, hasHeader]);

  const valid = mapping.easting !== mapping.northing && mapping.easting !== mapping.pointNo && mapping.northing !== mapping.pointNo;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="cad-dialog-content sm:max-w-md gap-4">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2">
            <FileUp size={16} className="text-primary" />
            <DialogTitle className="text-sm font-semibold">Import CSV Columns</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-foreground/70">
            Map the columns in <strong>{fileName}</strong>. The first row is {hasHeader ? "detected as a header" : "detected as data"}.
          </DialogDescription>
        </DialogHeader>

        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={hasHeader}
            onChange={(e) => {
              const next = e.target.checked;
              setHasHeader(next);
              setMapping(detectMapping(rows, next));
            }}
          />
          First row is a header
        </label>

        <div className="grid gap-2">
          {TARGETS.map((t) => {
            const val = mapping[t.key];
            return (
              <div key={t.key} className="grid grid-cols-4 items-center gap-2">
                <Label className="text-xs">{t.label} {t.required && <span className="text-red-500">*</span>}</Label>
                <select
                  className="input-field col-span-3 h-8 text-xs"
                  value={val == null ? "" : String(val)}
                  onChange={(e) => {
                    const v = e.target.value === "" ? null : parseInt(e.target.value, 10);
                    setMapping((m) => ({ ...m, [t.key]: v }));
                  }}
                >
                  <option value="">{t.required ? "Select column" : "(ignore)"}</option>
                  {colOptions.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        {rows.length > 0 && (
          <div className="overflow-auto border rounded p-2 bg-muted/30">
            <table className="w-full text-[10px]">
              <thead>
                <tr>
                  {rows[0].map((_, i) => (
                    <th key={i} className="text-left px-1 font-semibold">Col {i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hasHeader && (
                  <tr className="text-foreground/70">
                    {rows[0].map((c, i) => <td key={i} className="px-1">{c}</td>)}
                  </tr>
                )}
                {previewRows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, ci) => <td key={ci} className="px-1">{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!valid && <p className="text-[10px] text-red-500">Point #, {axis.first} and {axis.second} must use different columns.</p>}

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" type="button" onClick={onCancel}>Cancel</Button>
          <Button size="sm" type="button" disabled={!valid} onClick={() => onImport(mapping, hasHeader)}>Import Points</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
