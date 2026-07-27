import { useMemo, useRef, useState } from "react";
import {
  Upload,
  Download,
  Plus,
  Trash2,
  MapPin,
  ChevronDown,
  ChevronRight,
  Pencil,
  FolderPlus,
  GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { DialogTemplate } from "@/components/templates/DialogTemplate.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { parsePointsCsv, type CsvColumnMapping } from "./cad/io/csv.ts";
import {
  useProjectPoints,
  type ProjectPoint,
  type CoordinateSection,
  exportPointsCsv,
} from "../tools/calculators/projectPoints.ts";
import { useProjectOutputs } from "../tools/calculators/projectOutputs.ts";
import { downloadCsv } from "../tools/calculators/calcUtils.ts";

interface ProjectPointsManagerProps {
  projectId?: string;
}

function formatNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  return v.toFixed(3);
}

const FIELD_OPTIONS: { value: keyof CsvColumnMapping | "ignore"; label: string }[] = [
  { value: "ignore", label: "— Ignore —" },
  { value: "pointNo", label: "Point Number" },
  { value: "easting", label: "Easting (Y)" },
  { value: "northing", label: "Northing (X)" },
  { value: "elevation", label: "Elevation / RL (Z)" },
  { value: "code", label: "Code" },
];

function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const counts = {
    ",": (first.match(/,/g) || []).length,
    "\t": (first.match(/\t/g) || []).length,
    ";": (first.match(/;/g) || []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function parseCsvPreview(text: string, delimiter: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(0, 6)
    .map((l) => l.split(delimiter).map((c) => c.trim()));
}

function inferMapping(columns: string[]): CsvColumnMapping | null {
  let pointNo = -1;
  let easting = -1;
  let northing = -1;
  let elevation: number | null = null;
  let code: number | null = null;

  const normalized = columns.map((c) => c.toLowerCase().replace(/[^a-z0-9]/g, ""));

  normalized.forEach((c, i) => {
    if (pointNo === -1 && /^(point|pt|pointno|ptno|name|id|number|no|pnt)$/.test(c)) {
      pointNo = i;
    }
    if (easting === -1 && /^(easting|east|e|y|coordy|ycoord)$/.test(c)) {
      easting = i;
    }
    if (northing === -1 && /^(northing|north|n|x|coordx|xcoord)$/.test(c)) {
      northing = i;
    }
    if (elevation === null && /^(elevation|elev|z|rl|height|h|level)$/.test(c)) {
      elevation = i;
    }
    if (code === null && /^(code|desc|description|label|feature|type)$/.test(c)) {
      code = i;
    }
  });

  if (pointNo === -1 || easting === -1 || northing === -1) return null;
  return { pointNo, easting, northing, elevation, code };
}

function buildMapping(
  selections: (keyof CsvColumnMapping | "ignore")[],
): { mapping: CsvColumnMapping; hasHeader: boolean } | null {
  const indices: Partial<Record<keyof CsvColumnMapping, number>> = {};
  for (let i = 0; i < selections.length; i++) {
    const sel = selections[i];
    if (!sel || sel === "ignore") continue;
    if (indices[sel] !== undefined) {
      // duplicate field selection
      return null;
    }
    indices[sel] = i;
  }
  if (
    indices.pointNo == null ||
    indices.easting == null ||
    indices.northing == null
  ) {
    return null;
  }
  return {
    mapping: {
      pointNo: indices.pointNo,
      easting: indices.easting,
      northing: indices.northing,
      elevation: indices.elevation ?? null,
      code: indices.code ?? null,
    },
    hasHeader: false,
  };
}

interface CsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (params: {
    text: string;
    delimiter: string;
    mapping: CsvColumnMapping;
    hasHeader: boolean;
    sectionId: string | null;
  }) => void;
  sections: CoordinateSection[];
}

function CsvImportDialog({ open, onOpenChange, onImport, sections }: CsvImportDialogProps) {
  const [fileText, setFileText] = useState("");
  const [delimiter, setDelimiter] = useState(",");
  const [selections, setSelections] = useState<(keyof CsvColumnMapping | "ignore")[]>([]);
  const [hasHeader, setHasHeader] = useState(false);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const preview = useMemo(() => parseCsvPreview(fileText, delimiter), [fileText, delimiter]);
  const dataRows = hasHeader && preview.length > 1 ? preview.slice(1) : preview;
  const maxCols = Math.max(0, ...preview.map((r) => r.length));

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const detected = detectDelimiter(text);
      setDelimiter(detected);
      setFileText(text);
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const firstLineCols = lines[0]?.split(detected).map((c) => c.trim()) ?? [];
      const inferred = inferMapping(firstLineCols);
      if (inferred) {
        const sel: (keyof CsvColumnMapping | "ignore")[] = firstLineCols.map((_, i) => {
          if (i === inferred.pointNo) return "pointNo";
          if (i === inferred.easting) return "easting";
          if (i === inferred.northing) return "northing";
          if (inferred.elevation != null && i === inferred.elevation) return "elevation";
          if (inferred.code != null && i === inferred.code) return "code";
          return "ignore";
        });
        setSelections(sel);
        setHasHeader(true);
      } else {
        const blank = firstLineCols.map(() => "ignore" as const);
        setSelections(blank);
        setHasHeader(false);
      }
      setError(null);
    };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleImport = () => {
    if (!fileText.trim()) {
      setError("Choose a CSV file first.");
      return;
    }
    const result = buildMapping(selections);
    if (!result) {
      setError("Map Point Number, Easting and Northing columns.");
      return;
    }
    onImport({
      text: fileText,
      delimiter,
      mapping: result.mapping,
      hasHeader,
      sectionId,
    });
    reset();
  };

  const reset = () => {
    setFileText("");
    setDelimiter(",");
    setSelections([]);
    setHasHeader(false);
    setSectionId(null);
    setError(null);
    onOpenChange(false);
  };

  return (
    <DialogTemplate
      open={open}
      onOpenChange={(open) => {
        if (!open) reset();
      }}
      title="Import Coordinates from CSV"
      description="Choose the file, then tell SiteSurveyor which column is which."
      size="2xl"
      className="sm:max-w-3xl"
      footer={
        <>
          <Button variant="outline" onClick={reset}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!fileText}>
            Import Coordinates
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            Choose CSV File
          </Button>
          {fileText && (
            <span className="text-sm text-muted-foreground">
              {fileText.split(/\r?\n/).filter((l) => l.trim().length > 0).length} rows detected
            </span>
          )}
        </div>

        {fileText && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Delimiter</Label>
                <Select value={delimiter} onValueChange={setDelimiter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=",">Comma</SelectItem>
                    <SelectItem value="\t">Tab</SelectItem>
                    <SelectItem value=";">Semicolon</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Target section</Label>
                <Select
                  value={sectionId ?? "__none__"}
                  onValueChange={(v) => setSectionId(v === "__none__" ? null : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No section" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No section</SelectItem>
                    {sections.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 flex items-end">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasHeader}
                    onChange={(e) => setHasHeader(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  First row is header
                </label>
              </div>
            </div>

            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead className="bg-muted/50">
                  <tr>
                    {Array.from({ length: maxCols }).map((_, i) => (
                      <th key={i} className="px-2 py-1.5 text-left font-medium min-w-[120px]">
                        <Select
                          value={selections[i] ?? "ignore"}
                          onValueChange={(v) => {
                            setSelections((prev) => {
                              const next = [...prev];
                              next[i] = v as keyof CsvColumnMapping | "ignore";
                              return next;
                            });
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FIELD_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dataRows.slice(0, 5).map((row, ridx) => (
                    <tr key={ridx} className="border-t">
                      {Array.from({ length: maxCols }).map((_, cidx) => (
                        <td key={cidx} className="px-2 py-1.5 text-xs text-muted-foreground">
                          {row[cidx] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {error && <div className="text-sm text-destructive">⚠ {error}</div>}
      </div>
    </DialogTemplate>
  );
}

interface CoordinateRowProps {
  point: ProjectPoint;
  sections: CoordinateSection[];
  draft: Partial<ProjectPoint> | undefined;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onDraftChange: (patch: Partial<ProjectPoint>) => void;
  onCommit: () => void;
  onRemove: () => void;
  onSectionChange: (sectionId: string | null) => void;
}

function CoordinateRow({
  point,
  sections,
  draft,
  selected,
  onSelect,
  onDraftChange,
  onCommit,
  onRemove,
  onSectionChange,
}: CoordinateRowProps) {
  return (
    <tr className="border-b last:border-b-0">
      <td className="px-2 py-1 align-middle">
        <Checkbox
          checked={selected}
          onCheckedChange={onSelect}
          aria-label={`Select coordinate ${point.pointNo}`}
        />
      </td>
      <td className="px-2 py-1">
        <Input
          className="h-8 w-full min-w-0"
          value={draft?.pointNo ?? point.pointNo}
          onChange={(e) => onDraftChange({ pointNo: e.target.value })}
          onBlur={onCommit}
        />
      </td>
      <td className="px-2 py-1">
        <Input
          className="h-8 w-full min-w-0"
          value={draft?.e != null ? String(draft.e) : formatNum(point.e)}
          onChange={(e) => onDraftChange({ e: parseFloat(e.target.value) })}
          onBlur={onCommit}
        />
      </td>
      <td className="px-2 py-1">
        <Input
          className="h-8 w-full min-w-0"
          value={draft?.n != null ? String(draft.n) : formatNum(point.n)}
          onChange={(e) => onDraftChange({ n: parseFloat(e.target.value) })}
          onBlur={onCommit}
        />
      </td>
      <td className="px-2 py-1">
        <Input
          className="h-8 w-full min-w-0"
          value={draft?.z != null ? (draft.z === null ? "" : String(draft.z)) : formatNum(point.z)}
          placeholder="RL"
          onChange={(e) => {
            const raw = e.target.value;
            onDraftChange({ z: raw.trim() === "" ? null : parseFloat(raw) });
          }}
          onBlur={onCommit}
        />
      </td>
      <td className="px-2 py-1">
        <Input
          className="h-8 w-full min-w-0"
          value={draft?.code ?? point.code}
          placeholder="Code"
          onChange={(e) => onDraftChange({ code: e.target.value })}
          onBlur={onCommit}
        />
      </td>
      <td className="px-2 py-1">
        <Select
          value={point.sectionId ?? "__none__"}
          onValueChange={(v) => onSectionChange(v === "__none__" ? null : v)}
        >
          <SelectTrigger className="h-8 text-xs w-full min-w-0 truncate">
            <SelectValue placeholder="No section" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No section</SelectItem>
            {sections.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-2 py-1 text-right">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive"
          onClick={onRemove}
          aria-label={`Delete coordinate ${point.pointNo}`}
        >
          <Trash2 size={15} />
        </Button>
      </td>
    </tr>
  );
}

export function ProjectPointsManager({ projectId }: ProjectPointsManagerProps) {
  const {
    points,
    sections,
    add,
    remove,
    update,
    addSection,
    updateSection,
    removeSection,
    setPointSection,
  } = useProjectPoints(projectId);
  const { add: addOutput } = useProjectOutputs(projectId);
  const [drafts, setDrafts] = useState<Record<string, Partial<ProjectPoint>>>({});
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSectionName, setEditingSectionName] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const sorted = useMemo(
    () =>
      [...points].sort((a, b) => {
        const na = parseInt(a.pointNo, 10);
        const nb = parseInt(b.pointNo, 10);
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return a.pointNo.localeCompare(b.pointNo);
      }),
    [points],
  );

  const grouped = useMemo(() => {
    const map = new Map<string | null, ProjectPoint[]>();
    map.set(null, []);
    for (const s of sections) map.set(s.id, []);
    for (const p of sorted) {
      const key = p.sectionId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return { sections: sections.map((s) => ({ ...s, points: map.get(s.id) ?? [] })), ungrouped: map.get(null) ?? [] };
  }, [sorted, sections]);

  const commitDraft = (id: string) => {
    const d = drafts[id];
    if (!d || !projectId) return;
    update(id, d);
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const setDraft = (id: string, patch: Partial<ProjectPoint>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const handleImport = (params: {
    text: string;
    delimiter: string;
    mapping: CsvColumnMapping;
    hasHeader: boolean;
    sectionId: string | null;
  }) => {
    if (!projectId) return;
    const result = parsePointsCsv(params.text, params.mapping, params.hasHeader);
    if (result.errors.length) {
      setImportError(result.errors.slice(0, 3).join("; "));
      setImportSuccess(null);
      return;
    }
    let added = 0;
    for (const p of result.points) {
      add({
        e: p.e,
        n: p.n,
        z: p.z ?? null,
        code: p.code ?? "",
        pointNo: p.pointNo,
        sectionId: params.sectionId,
      });
      added++;
    }
    setImportError(null);
    const skippedMsg = result.skipped ? ` Skipped ${result.skipped} rows.` : "";
    setImportSuccess(`Imported ${added} coordinate${added === 1 ? "" : "s"}.${skippedMsg}`);
    setTimeout(() => setImportSuccess(null), 3000);
  };

  const handleExport = () => {
    const content = exportPointsCsv(points);
    downloadCsv("project-coordinates.csv", content);
    addOutput({
      label: "Project Coordinates CSV",
      description: `${points.length} coordinate${points.length === 1 ? "" : "s"}`,
      fileName: `project-coordinates-${projectId ?? "unknown"}.csv`,
      mimeType: "text/csv",
      content,
    });
  };

  const handleAdd = () => {
    if (!projectId) return;
    add({ e: 0, n: 0, z: null, code: "" });
  };

  const handleAddSection = () => {
    if (!projectId || !newSectionName.trim()) return;
    addSection(newSectionName.trim());
    setNewSectionName("");
  };

  const startEditSection = (section: CoordinateSection) => {
    setEditingSectionId(section.id);
    setEditingSectionName(section.name);
  };

  const commitEditSection = () => {
    if (!editingSectionId || !editingSectionName.trim()) {
      setEditingSectionId(null);
      return;
    }
    updateSection(editingSectionId, { name: editingSectionName.trim() });
    setEditingSectionId(null);
    setEditingSectionName("");
  };

  const toggleSection = (id: string) => {
    setCollapsedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleAll = () => {
    const allIds = sections.map((s) => s.id);
    const allCollapsed = allIds.every((id) => collapsedSections[id]);
    const next: Record<string, boolean> = {};
    for (const id of allIds) next[id] = !allCollapsed;
    setCollapsedSections(next);
  };

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleSelectAll = (ids: string[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const allPointIds = useMemo(() => points.map((p) => p.id), [points]);
  const allSelected = allPointIds.length > 0 && allPointIds.every((id) => selectedIds.has(id));

  const bulkDelete = () => {
    for (const id of selectedIds) remove(id);
    setSelectedIds(new Set());
  };

  const bulkAssignSection = (sectionId: string | null) => {
    for (const id of selectedIds) setPointSection(id, sectionId);
    setSelectedIds(new Set());
  };

  if (!projectId) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Open a project to manage its coordinates.
        </CardContent>
      </Card>
    );
  }

  const hasSections = grouped.sections.length > 0 || grouped.ungrouped.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MapPin size={18} /> Coordinates
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Coordinates imported here are shared with COGO & Computation tools and the CAD workspace.
            Import a CSV and map the columns to the coordinate fields.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" onClick={handleAdd} className="gap-2">
              <Plus size={16} /> Add coordinate
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => setImportOpen(true)}
            >
              <Upload size={16} /> Import CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={handleExport}
              disabled={points.length === 0}
            >
              <Download size={16} /> Export CSV
            </Button>
            <span className="text-sm text-muted-foreground">
              {points.length} coordinate{points.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="flex flex-wrap items-end gap-3 border-t pt-4">
            <div className="space-y-1.5 flex-1 min-w-[200px]">
              <Label className="text-xs">New section</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. Control Points"
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddSection();
                  }}
                />
                <Button variant="outline" onClick={handleAddSection} disabled={!newSectionName.trim()}>
                  <FolderPlus size={16} />
                </Button>
              </div>
            </div>
            {sections.length > 0 && (
              <Button variant="ghost" size="sm" onClick={toggleAll}>
                {sections.every((s) => collapsedSections[s.id]) ? "Expand all" : "Collapse all"}
              </Button>
            )}
          </div>

          {importError && <div className="text-sm text-destructive">⚠ {importError}</div>}
          {importSuccess && <div className="text-sm text-emerald-600">{importSuccess}</div>}
        </CardContent>
      </Card>

      {selectedIds.size > 0 && (
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="py-3 px-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">
                {selectedIds.size} selected
              </span>
              <Select
                value=""
                onValueChange={(v) => {
                  if (v === "__none__") bulkAssignSection(null);
                  else if (v.startsWith("section:")) bulkAssignSection(v.replace("section:", ""));
                }}
              >
                <SelectTrigger className="h-8 w-[180px] text-xs">
                  <SelectValue placeholder="Assign section" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No section</SelectItem>
                  {sections.map((s) => (
                    <SelectItem key={s.id} value={`section:${s.id}`}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="destructive" size="sm" onClick={bulkDelete}>
                <Trash2 size={14} className="mr-1.5" /> Delete selected
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                Clear
              </Button>
              <label className="flex items-center gap-2 text-sm cursor-pointer ml-auto">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) => toggleSelectAll(allPointIds, checked === true)}
                />
                Select all
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {hasSections && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[850px] table-fixed">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-2 py-2 w-10">
                      <Checkbox
                        checked={
                          grouped.ungrouped.length > 0 &&
                          grouped.ungrouped.every((p) => selectedIds.has(p.id))
                        }
                        onCheckedChange={(checked) =>
                          toggleSelectAll(
                            grouped.ungrouped.map((p) => p.id),
                            checked === true,
                          )
                        }
                        aria-label="Select all ungrouped coordinates"
                      />
                    </th>
                    <th className="px-2 py-2 font-medium w-[15%]">Point no.</th>
                    <th className="px-2 py-2 font-medium w-[15%]">Easting (Y)</th>
                    <th className="px-2 py-2 font-medium w-[15%]">Northing (X)</th>
                    <th className="px-2 py-2 font-medium w-[14%]">RL (Z)</th>
                    <th className="px-2 py-2 font-medium w-[16%]">Code</th>
                    <th className="px-2 py-2 font-medium w-[18%]">Section</th>
                    <th className="px-2 py-2 font-medium text-right w-[7%]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.ungrouped.map((p) => (
                    <CoordinateRow
                      key={p.id}
                      point={p}
                      sections={sections}
                      draft={drafts[p.id]}
                      selected={selectedIds.has(p.id)}
                      onSelect={(checked) => toggleSelect(p.id, checked)}
                      onDraftChange={(patch) => setDraft(p.id, patch)}
                      onCommit={() => commitDraft(p.id)}
                      onRemove={() => remove(p.id)}
                      onSectionChange={(sectionId) => setPointSection(p.id, sectionId)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {grouped.sections.map((section) => {
        const isCollapsed = !!collapsedSections[section.id];
        return (
          <Card key={section.id} className="overflow-hidden">
            <CardHeader className="py-3 px-4">
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <button
                  type="button"
                  className="flex items-center gap-2 flex-1 text-left"
                  onClick={() => toggleSection(section.id)}
                >
                  {isCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                  <GripVertical size={16} className="text-muted-foreground" />
                  {editingSectionId === section.id ? (
                    <Input
                      className="h-8 flex-1"
                      value={editingSectionName}
                      onChange={(e) => setEditingSectionName(e.target.value)}
                      onBlur={commitEditSection}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEditSection();
                      }}
                      autoFocus
                    />
                  ) : (
                    <span className="truncate">{section.name}</span>
                  )}
                  <span className="text-muted-foreground font-normal text-xs ml-2">
                    {section.points.length} coordinate{section.points.length === 1 ? "" : "s"}
                  </span>
                </button>
                <div className="flex items-center gap-1 print:hidden">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => startEditSection(section)}
                    aria-label={`Rename section ${section.name}`}
                  >
                    <Pencil size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => removeSection(section.id)}
                    aria-label={`Delete section ${section.name}`}
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            {!isCollapsed && section.points.length > 0 && (
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[850px] table-fixed">
                    <thead className="bg-muted/30 text-left">
                      <tr>
                        <th className="px-2 py-2 w-10">
                          <Checkbox
                            checked={
                              section.points.length > 0 &&
                              section.points.every((p) => selectedIds.has(p.id))
                            }
                            onCheckedChange={(checked) =>
                              toggleSelectAll(
                                section.points.map((p) => p.id),
                                checked === true,
                              )
                            }
                            aria-label={`Select all coordinates in ${section.name}`}
                          />
                        </th>
                        <th className="px-2 py-2 font-medium w-[15%]">Point no.</th>
                        <th className="px-2 py-2 font-medium w-[15%]">Easting (Y)</th>
                        <th className="px-2 py-2 font-medium w-[15%]">Northing (X)</th>
                        <th className="px-2 py-2 font-medium w-[14%]">RL (Z)</th>
                        <th className="px-2 py-2 font-medium w-[16%]">Code</th>
                        <th className="px-2 py-2 font-medium w-[18%]">Section</th>
                        <th className="px-2 py-2 font-medium text-right w-[7%]">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.points.map((p) => (
                        <CoordinateRow
                          key={p.id}
                          point={p}
                          sections={sections}
                          draft={drafts[p.id]}
                          selected={selectedIds.has(p.id)}
                          onSelect={(checked) => toggleSelect(p.id, checked)}
                          onDraftChange={(patch) => setDraft(p.id, patch)}
                          onCommit={() => commitDraft(p.id)}
                          onRemove={() => remove(p.id)}
                          onSectionChange={(sectionId) => setPointSection(p.id, sectionId)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            )}
            {!isCollapsed && section.points.length === 0 && (
              <CardContent className="px-4 py-6 text-center text-sm text-muted-foreground">
                No coordinates in this section yet.
              </CardContent>
            )}
          </Card>
        );
      })}

      {!hasSections && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No coordinates yet. Add one manually or import a CSV.
          </CardContent>
        </Card>
      )}

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={handleImport}
        sections={sections}
      />
    </div>
  );
}
