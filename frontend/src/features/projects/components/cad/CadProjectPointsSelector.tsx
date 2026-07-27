import { useMemo, useState } from "react";
import { MapPin, CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { DialogTemplate } from "@/components/templates/DialogTemplate.tsx";
import { Input } from "@/components/ui/input.tsx";
import { useProjectPoints } from "../../tools/calculators/projectPoints.ts";

interface CadProjectPointsSelectorProps {
  projectId?: string;
  onImport: (rows: { pointNo: string; n: number; e: number; z: number | null; code: string }[]) => void;
  onClose: () => void;
}

export function CadProjectPointsSelector({ projectId, onImport, onClose }: CadProjectPointsSelectorProps) {
  const { points } = useProjectPoints(projectId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return points;
    return points.filter(
      (p) =>
        p.pointNo.toLowerCase().includes(q) ||
        (p.code ?? "").toLowerCase().includes(q),
    );
  }, [points, filter]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((p) => p.id)));
  };

  const selectedRows = points
    .filter((p) => selected.has(p.id))
    .map((p) => ({ pointNo: p.pointNo, n: p.n, e: p.e, z: p.z ?? null, code: p.code ?? "" }));

  return (
    <DialogTemplate
      open
      onOpenChange={(open) => !open && onClose()}
      title={
        <span className="flex items-center gap-2">
          <MapPin size={18} /> Project Coordinates
        </span>
      }
      description="Select coordinates from the project workspace to bring into the CAD drawing. Duplicates are skipped."
      size="full"
      className="sm:max-w-2xl"
      footer={
        <>
          <span className="text-sm text-muted-foreground mr-auto">
            {selected.size} selected
          </span>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => onImport(selectedRows)} disabled={selectedRows.length === 0}>
            Import {selectedRows.length}
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search point no. or code"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-9"
        />
        <Button variant="outline" size="sm" className="gap-2 shrink-0" onClick={toggleAll}>
          {selected.size === filtered.length && filtered.length > 0 ? <CheckSquare size={16} /> : <Square size={16} />}
          {selected.size === filtered.length && filtered.length > 0 ? "Deselect all" : "Select all"}
        </Button>
      </div>

      <div className="overflow-auto border rounded-md flex-1 min-h-[200px]">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left sticky top-0">
            <tr>
              <th className="px-3 py-2 w-10"></th>
              <th className="px-3 py-2">Point no.</th>
              <th className="px-3 py-2">Easting</th>
              <th className="px-3 py-2">Northing</th>
              <th className="px-3 py-2">RL</th>
              <th className="px-3 py-2">Code</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.id}
                className="border-b last:border-b-0 hover:bg-muted/30 cursor-pointer"
                onClick={() => toggle(p.id)}
              >
                <td className="px-3 py-2">
                  {selected.has(p.id) ? <CheckSquare size={16} className="text-accent" /> : <Square size={16} />}
                </td>
                <td className="px-3 py-2 font-medium">{p.pointNo}</td>
                <td className="px-3 py-2 tabular-nums">{p.e.toFixed(3)}</td>
                <td className="px-3 py-2 tabular-nums">{p.n.toFixed(3)}</td>
                <td className="px-3 py-2 tabular-nums">{p.z == null ? "—" : p.z.toFixed(3)}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.code || "—"}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No project coordinates found. Add or import them in Project Hub → Coordinates.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DialogTemplate>
  );
}
