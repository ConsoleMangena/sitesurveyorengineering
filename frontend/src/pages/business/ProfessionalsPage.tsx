import { useState, useEffect, useCallback } from "react";
import {
  createProfessional,
  deleteProfessional,
  listProfessionals,
  updateProfessional,
} from "../../lib/repositories/professionals.ts";
import type { ProfessionalRow } from "../../lib/repositories/professionals.ts";
import PageLoader from "@/components/PageLoader.tsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/DashboardShell.tsx";
import {
  Plus,
  MapPin,
  Clock,
  Star,
  Search,
  Pencil,
  Trash2,
  Loader2,
  X,
} from "lucide-react";

const availabilityVariant: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  Available: "success",
  Busy: "destructive",
  "Available Soon": "warning",
};

const DISCIPLINES = [
  "Land Surveying",
  "Geomatics",
  "Engineering Surveying",
  "Geodesy",
  "Hydrographic Surveying",
  "Mine Surveying",
];

type DisciplineFilter =
  | "all"
  | "Land Surveying"
  | "Geomatics"
  | "Engineering Surveying"
  | "Geodesy"
  | "Hydrographic Surveying"
  | "Mine Surveying";

interface ProfessionalsPageProps {
  workspaceId: string;
  isPlatformAdmin?: boolean;
}

export default function ProfessionalsPage({
  workspaceId,
  isPlatformAdmin = false,
}: ProfessionalsPageProps) {
  const [search, setSearch] = useState("");
  const [discFilter, setDiscFilter] = useState<DisciplineFilter>("all");
  const [selectedPro, setSelectedPro] = useState<ProfessionalRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [professionals, setProfessionals] = useState<ProfessionalRow[]>([]);
  const [page, setPage] = useState(1);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingPro, setSavingPro] = useState(false);
  const [pName, setPName] = useState("");
  const [pTitle, setPTitle] = useState("");
  const [pDiscipline, setPDiscipline] = useState("Land Surveying");
  const [pExperience, setPExperience] = useState("");
  const [pLocation, setPLocation] = useState("");
  const [pRate, setPRate] = useState("");
  const [pRatePer, setPRatePer] = useState("hour");
  const [pCurrency, setPCurrency] = useState("USD");
  const [pAvailability, setPAvailability] = useState("Available");
  const [pRating, setPRating] = useState("0");
  const [pReviews, setPReviews] = useState("0");
  const [pBio, setPBio] = useState("");
  const [pSkills, setPSkills] = useState("");
  const [pCerts, setPCerts] = useState("");
  const [pIsGlobal, setPIsGlobal] = useState(false);

  const fetchPros = useCallback(async () => {
    try {
      setFetchError(null);
      const data = await listProfessionals(workspaceId);
      setProfessionals(data);
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : "Failed to load professionals");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchPros();
  }, [fetchPros]);

  const openCreatePro = () => {
    setEditingId(null);
    setPName("");
    setPTitle("");
    setPDiscipline("Land Surveying");
    setPExperience("");
    setPLocation("");
    setPRate("");
    setPRatePer("hour");
    setPCurrency("USD");
    setPAvailability("Available");
    setPRating("0");
    setPReviews("0");
    setPBio("");
    setPSkills("");
    setPCerts("");
    setPIsGlobal(false);
    setEditorOpen(true);
  };

  const openEditPro = (p: ProfessionalRow) => {
    setEditingId(p.id);
    setPName(p.name);
    setPTitle(p.title);
    setPDiscipline(p.discipline);
    setPExperience(p.experience);
    setPLocation(p.location);
    setPRate(String(p.rate));
    setPRatePer(p.rate_per);
    setPCurrency(p.currency);
    setPAvailability(p.availability);
    setPRating(String(p.rating ?? 0));
    setPReviews(String(p.reviews ?? 0));
    setPBio(p.bio ?? "");
    setPSkills((p.skills ?? []).join(", "));
    setPCerts((p.certifications ?? []).join(", "));
    setPIsGlobal(p.is_global ?? false);
    setEditorOpen(true);
    setSelectedPro(null);
  };

  const savePro = async () => {
    if (!pName.trim() || !pTitle.trim() || !pLocation.trim() || !pExperience.trim()) {
      setFetchError("Name, title, location, and experience are required.");
      return;
    }
    const rateNum = Number(pRate);
    if (!Number.isFinite(rateNum) || rateNum < 0) {
      setFetchError("Enter a valid rate.");
      return;
    }
    const ratingNum = Number(pRating);
    const reviewsNum = Number(pReviews);
    const skillsArr = pSkills.split(",").map((s) => s.trim()).filter(Boolean);
    const certsArr = pCerts.split(",").map((s) => s.trim()).filter(Boolean);
    setSavingPro(true);
    setFetchError(null);
    try {
      const payload = {
        name: pName.trim(),
        title: pTitle.trim(),
        discipline: pDiscipline,
        experience: pExperience.trim(),
        location: pLocation.trim(),
        rate: rateNum,
        rate_per: pRatePer.trim() || "hour",
        currency: pCurrency.trim() || "USD",
        availability: pAvailability,
        rating: Number.isFinite(ratingNum) ? ratingNum : 0,
        reviews: Number.isFinite(reviewsNum) ? Math.round(reviewsNum) : 0,
        bio: pBio.trim() || null,
        skills: skillsArr.length ? skillsArr : null,
        certifications: certsArr.length ? certsArr : null,
        is_global: isPlatformAdmin ? pIsGlobal : false,
      };
      if (editingId) {
        await updateProfessional(editingId, payload);
      } else {
        await createProfessional(workspaceId, payload);
      }
      setEditorOpen(false);
      await fetchPros();
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSavingPro(false);
    }
  };

  const removePro = async (id: string) => {
    if (!window.confirm("Remove this professional from the directory?")) return;
    setFetchError(null);
    try {
      await deleteProfessional(id);
      setSelectedPro(null);
      await fetchPros();
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to delete.");
    }
  };

  const getAvatarUrl = (name: string) =>
    `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}&radius=50&backgroundType=gradientLinear`;

  const filtered = professionals.filter((p) => {
    if (discFilter !== "all" && p.discipline !== discFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const haystack = [p.name, p.title, p.discipline, p.location, p.bio || ""]
        .concat(p.skills || [])
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    }
    return true;
  });

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, discFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  if (loading) {
    return (
      <div className="hub-body pro-body p-6">
        <PageLoader />
      </div>
    );
  }

  return (
    <DashboardShell className="hub-body pro-body">
      <DashboardHeader
        title="Professionals Directory"
        subtitle="Browse qualified surveyors and geomaticians across Zimbabwe"
        description={
          !isPlatformAdmin
            ? "Directory entries are maintained by platform administrators."
            : undefined
        }
        actions={
          isPlatformAdmin && (
            <Button onClick={openCreatePro} className="gap-2">
              <Plus size={16} />
              Add professional
            </Button>
          )
        }
      />

      {fetchError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {fetchError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(["all", ...DISCIPLINES] as DisciplineFilter[]).map((d) => (
          <Button
            key={d}
            variant={discFilter === d ? "default" : "outline"}
            size="sm"
            onClick={() => setDiscFilter(d)}
            className="capitalize"
          >
            {d === "all" ? "All" : d.replace(" Surveying", "")}
          </Button>
        ))}
        <div className="relative flex-1 min-w-[200px] max-w-sm ml-auto">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search professionals..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selectedPro} onOpenChange={(open) => !open && setSelectedPro(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-start gap-4">
              <img
                className="h-16 w-16 rounded-full object-cover border"
                src={selectedPro ? getAvatarUrl(selectedPro.name) : ""}
                alt=""
                onError={(e) => {
                  e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(
                    selectedPro?.name ?? "",
                  )}&background=6366f1&color=fff&size=128`;
                }}
              />
              <div className="flex-1 min-w-0">
                <DialogTitle className="truncate">
                  {selectedPro?.name}
                </DialogTitle>
                <DialogDescription>{selectedPro?.title}</DialogDescription>
                <div className="flex items-center gap-3 mt-2">
                  {selectedPro && (
                    <Badge variant={availabilityVariant[selectedPro.availability] ?? "secondary"}>
                      {selectedPro.availability}
                    </Badge>
                  )}
                  {selectedPro && selectedPro.rating != null && selectedPro.rating > 0 && (
                    <span className="flex items-center gap-1 text-sm text-amber-500">
                      <Star size={14} fill="currentColor" />
                      {selectedPro.rating} ({selectedPro.reviews})
                    </span>
                  )}
                </div>
              </div>
            </div>
          </DialogHeader>

          {selectedPro && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{selectedPro.bio}</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground">Rate</span>
                  <p className="font-semibold">
                    ${selectedPro.rate} / {selectedPro.rate_per}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Discipline</span>
                  <p className="font-semibold">{selectedPro.discipline}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Experience</span>
                  <p className="font-semibold">{selectedPro.experience}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Location</span>
                  <p className="font-semibold">{selectedPro.location}</p>
                </div>
              </div>

              {selectedPro.skills && selectedPro.skills.length > 0 && (
                <div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Skills
                  </span>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {selectedPro.skills.map((s) => (
                      <Badge key={s} variant="secondary">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {selectedPro.certifications && selectedPro.certifications.length > 0 && (
                <div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Certifications
                  </span>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {selectedPro.certifications.map((c) => (
                      <Badge key={c} variant="outline">
                        {c}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setSelectedPro(null)}>
              Close
            </Button>
            {isPlatformAdmin && selectedPro && (
              <>
                <Button variant="outline" onClick={() => openEditPro(selectedPro)}>
                  <Pencil size={14} className="mr-2" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void removePro(selectedPro.id)}
                >
                  <Trash2 size={14} className="mr-2" />
                  Delete
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editor Dialog */}
      <Dialog open={editorOpen} onOpenChange={(open) => !open && !savingPro && setEditorOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit professional" : "Add professional"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pro-editor-name">Name</Label>
              <Input
                id="pro-editor-name"
                value={pName}
                onChange={(e) => setPName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pro-editor-title">Title</Label>
              <Input
                id="pro-editor-title"
                value={pTitle}
                onChange={(e) => setPTitle(e.target.value)}
                placeholder="e.g. Principal Surveyor"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Discipline</Label>
              <Select value={pDiscipline} onValueChange={setPDiscipline}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISCIPLINES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pro-editor-exp">Experience</Label>
              <Input
                id="pro-editor-exp"
                value={pExperience}
                onChange={(e) => setPExperience(e.target.value)}
                placeholder="e.g. 12 years"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pro-editor-location">Location</Label>
              <Input
                id="pro-editor-location"
                value={pLocation}
                onChange={(e) => setPLocation(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pro-editor-rate">Rate</Label>
              <Input
                id="pro-editor-rate"
                type="number"
                min={0}
                step={0.01}
                value={pRate}
                onChange={(e) => setPRate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pro-editor-rate-per">Rate unit</Label>
              <Input
                id="pro-editor-rate-per"
                value={pRatePer}
                onChange={(e) => setPRatePer(e.target.value)}
                placeholder="hour, day, project…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pro-editor-currency">Currency</Label>
              <Input
                id="pro-editor-currency"
                value={pCurrency}
                onChange={(e) => setPCurrency(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Availability</Label>
              <Select value={pAvailability} onValueChange={setPAvailability}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Available">Available</SelectItem>
                  <SelectItem value="Busy">Busy</SelectItem>
                  <SelectItem value="Available Soon">Available Soon</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pro-editor-rating">Rating (0–5)</Label>
              <Input
                id="pro-editor-rating"
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={pRating}
                onChange={(e) => setPRating(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pro-editor-reviews">Review count</Label>
              <Input
                id="pro-editor-reviews"
                type="number"
                min={0}
                step={1}
                value={pReviews}
                onChange={(e) => setPReviews(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pro-editor-bio">Bio</Label>
              <textarea
                id="pro-editor-bio"
                rows={3}
                value={pBio}
                onChange={(e) => setPBio(e.target.value)}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pro-editor-skills">Skills (comma-separated)</Label>
              <Input
                id="pro-editor-skills"
                value={pSkills}
                onChange={(e) => setPSkills(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pro-editor-certs">Certifications (comma-separated)</Label>
              <Input
                id="pro-editor-certs"
                value={pCerts}
                onChange={(e) => setPCerts(e.target.value)}
              />
            </div>
            {isPlatformAdmin && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pIsGlobal}
                  onChange={(e) => setPIsGlobal(e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary accent-primary"
                />
                Visible to all accounts (global)
              </label>
            )}
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button
              variant="outline"
              disabled={savingPro}
              onClick={() => setEditorOpen(false)}
            >
              Cancel
            </Button>
            <Button disabled={savingPro} onClick={() => void savePro()}>
              {savingPro && <Loader2 size={14} className="animate-spin mr-2" />}
              {savingPro ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {filtered.length === 0 ? (
        <Card className="border-border/60">
          <CardContent className="py-10 text-center">
            <h3 className="text-base font-semibold">No professionals found</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Try adjusting your search or filter criteria.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {paginated.map((p) => (
              <Card
                key={p.id}
                className="border-border/60 overflow-hidden hover:shadow-sm transition-shadow cursor-pointer"
                onClick={() => setSelectedPro(p)}
                tabIndex={0}
                role="button"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedPro(p);
                  }
                }}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <img
                      src={getAvatarUrl(p.name)}
                      alt=""
                      className="h-12 w-12 rounded-full object-cover border"
                      onError={(e) => {
                        e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(
                          p.name,
                        )}&background=6366f1&color=fff&size=64`;
                      }}
                    />
                    <Badge variant={availabilityVariant[p.availability] ?? "secondary"}>
                      {p.availability}
                    </Badge>
                  </div>
                  <h3 className="text-sm font-semibold truncate">{p.name}</h3>
                  <p className="text-xs text-muted-foreground truncate">{p.title}</p>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5 truncate">
                      <MapPin size={12} />
                      {p.location}
                    </div>
                    <div className="flex items-center gap-1.5 truncate">
                      <Clock size={12} />
                      {p.experience}
                    </div>
                    {p.rating != null && p.rating > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Star size={12} fill="currentColor" className="text-amber-500" />
                        {p.rating} ({p.reviews ?? 0} reviews)
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-sm font-bold">
                      ${p.rate}
                      <span className="text-xs font-normal text-muted-foreground ml-1">
                        /{p.rate_per}
                      </span>
                    </span>
                    {isPlatformAdmin && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditPro(p);
                        }}
                      >
                        Edit
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {filtered.length > pageSize && (
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </DashboardShell>
  );
}
