import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Crosshair } from "lucide-react";
import { axisBadgeLabels, type AxisConvention } from "./cadSettings.ts";

export interface CadControlPointValue {
  pointNo: string;
  e: number;
  n: number;
  z: number | null;
  code: string;
}

interface CadControlPointDialogProps {
  open: boolean;
  initialPointNo: string;
  initialCode?: string;
  axisConvention?: AxisConvention;
  onSubmit: (value: CadControlPointValue) => void;
  onCancel: () => void;
}

export function CadControlPointDialog({
  open,
  initialPointNo,
  initialCode = "CP",
  axisConvention = "yx",
  onSubmit,
  onCancel,
}: CadControlPointDialogProps) {
  const axis = axisBadgeLabels(axisConvention);
  const [pointNo, setPointNo] = useState(initialPointNo);
  const [easting, setEasting] = useState("");
  const [northing, setNorthing] = useState("");
  const [elev, setElev] = useState("");
  const [code, setCode] = useState(initialCode);
  const pointNoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPointNo(String(initialPointNo));
      setCode(initialCode);
      // Keep typed coordinates so sequential entry is faster; focus point #.
      pointNoRef.current?.focus();
    }
  }, [open, initialPointNo, initialCode]);

  const submit = () => {
    const pno = pointNo.trim();
    if (pno === "") return;
    const e = parseFloat(easting.trim());
    const n = parseFloat(northing.trim());
    if (!Number.isFinite(e) || !Number.isFinite(n)) return;
    const z = elev.trim() === "" ? null : parseFloat(elev.trim());
    if (elev.trim() !== "" && !Number.isFinite(z)) return;
    onSubmit({ pointNo: pno, e, n, z: z as number | null, code: code.trim() || "CP" });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="cad-dialog-content sm:max-w-sm gap-4">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2">
            <Crosshair size={16} className="text-primary" />
            <DialogTitle className="text-sm font-semibold">Place Control Point</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-foreground/70">
            Enter exact coordinates. Control points are stored on the CONTROL layer.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-3 items-center gap-2">
            <Label htmlFor="cad-cp-no" className="text-xs">Point #</Label>
            <Input
              id="cad-cp-no"
              ref={pointNoRef}
              className="col-span-2 h-8 text-xs"
              value={pointNo}
              onChange={(e) => setPointNo(e.target.value)}
              inputMode="numeric"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
            />
          </div>
          <div className="grid grid-cols-3 items-center gap-2">
            <Label htmlFor="cad-cp-e" className="text-xs">{axis.first}</Label>
            <Input
              id="cad-cp-e"
              className="col-span-2 h-8 text-xs"
              value={easting}
              onChange={(e) => setEasting(e.target.value)}
              inputMode="decimal"
              placeholder="required"
              onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
            />
          </div>
          <div className="grid grid-cols-3 items-center gap-2">
            <Label htmlFor="cad-cp-n" className="text-xs">{axis.second}</Label>
            <Input
              id="cad-cp-n"
              className="col-span-2 h-8 text-xs"
              value={northing}
              onChange={(e) => setNorthing(e.target.value)}
              inputMode="decimal"
              placeholder="required"
              onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
            />
          </div>
          <div className="grid grid-cols-3 items-center gap-2">
            <Label htmlFor="cad-cp-rl" className="text-xs">RL (m)</Label>
            <Input
              id="cad-cp-rl"
              className="col-span-2 h-8 text-xs"
              value={elev}
              onChange={(e) => setElev(e.target.value)}
              inputMode="decimal"
              placeholder="optional"
              onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
            />
          </div>
          <div className="grid grid-cols-3 items-center gap-2">
            <Label htmlFor="cad-cp-code" className="text-xs">Code</Label>
            <Input
              id="cad-cp-code"
              className="col-span-2 h-8 text-xs"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="CP"
              onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" type="button" onClick={onCancel}>Cancel</Button>
          <Button size="sm" type="button" onClick={submit}>Place Control Point</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
