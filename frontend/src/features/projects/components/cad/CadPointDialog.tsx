import { useEffect, useRef, useState } from "react";
import { DialogTemplate } from "@/components/templates/DialogTemplate.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { MapPin } from "lucide-react";

export interface CadPointDialogValue {
  pointNo: string;
  code: string;
  z: number | null;
}

interface CadPointDialogProps {
  open: boolean;
  initialPointNo: string;
  initialCode?: string;
  initialElevation?: string;
  title?: string;
  onSubmit: (value: CadPointDialogValue) => void;
  onCancel: () => void;
}

export function CadPointDialog({
  open,
  initialPointNo,
  initialCode = "",
  initialElevation = "",
  title = "Place Survey Point",
  onSubmit,
  onCancel,
}: CadPointDialogProps) {
  const [pointNo, setPointNo] = useState(initialPointNo);
  const [code, setCode] = useState(initialCode);
  const [elev, setElev] = useState(initialElevation);
  const pointNoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      setPointNo(String(initialPointNo));
      setCode(initialCode);
      setElev(initialElevation);
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, initialPointNo, initialCode, initialElevation]);

  const submit = () => {
    const pno = pointNo.trim();
    if (pno === "") return;
    const z = elev.trim() === "" ? null : parseFloat(elev);
    if (elev.trim() !== "" && !Number.isFinite(z)) return;
    onSubmit({ pointNo: pno, code: code.trim(), z: z as number | null });
  };

  return (
    <DialogTemplate
      open={open}
      onOpenChange={(v) => { if (!v) onCancel(); }}
      title={
        <span className="flex items-center gap-2 text-sm font-semibold">
          <MapPin size={16} className="text-primary" />
          {title}
        </span>
      }
      description="Set the point number, feature code and elevation (RL). Leave RL blank for a 2D marker."
      size="sm"
      className="cad-dialog-content"
      responsiveFooter={false}
      footer={
        <>
          <Button variant="outline" size="sm" type="button" onClick={onCancel}>Cancel</Button>
          <Button size="sm" type="button" onClick={submit}>Place Point</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-3 items-center gap-2">
          <Label htmlFor="cad-point-no" className="text-xs">Point #</Label>
          <Input
            id="cad-point-no"
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
          <Label htmlFor="cad-point-code" className="text-xs">Code</Label>
          <Input
            id="cad-point-code"
            className="col-span-2 h-8 text-xs"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. FL, TREE, MH"
            onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
          />
        </div>
        <div className="grid grid-cols-3 items-center gap-2">
          <Label htmlFor="cad-point-rl" className="text-xs">RL (m)</Label>
          <Input
            id="cad-point-rl"
            className="col-span-2 h-8 text-xs"
            value={elev}
            onChange={(e) => setElev(e.target.value)}
            inputMode="decimal"
            placeholder="optional"
            onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
          />
        </div>
      </div>
    </DialogTemplate>
  );
}
