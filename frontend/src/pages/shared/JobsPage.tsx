import { useState, useEffect, useCallback } from "react";
import {
  Mountain,
  MapPinned,
  HardHat,
  Pickaxe,
  Activity,
  Briefcase,
  Plus,
  Search,
  MapPin,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  archiveJob,
  createJob,
  listJobs,
  updateJob,
  type JobWithProject,
} from "../../lib/repositories/jobs.ts";
import { listProjects, type ProjectWithOrg } from "../../lib/repositories/projects.ts";
import { mapStatus } from "../../lib/mappers.ts";
import type { Database } from "../../lib/supabase/types.ts";
import SelectDropdown from "../../components/SelectDropdown.tsx";
import PageLoader from "../../components/PageLoader.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Label } from "../../components/ui/label.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { Card, CardContent } from "../../components/ui/card.tsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.tsx";
import { Alert, AlertDescription } from "../../components/ui/alert.tsx";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs.tsx";
import { Separator } from "../../components/ui/separator.tsx";
import { cn } from "../../lib/utils.ts";
import "../../styles/pages.css";

type JobStatus = Database["public"]["Enums"]["job_status"];

interface JobsPageProps {
  workspaceId: string;
  isPlatformAdmin?: boolean;
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type JobFilter =
  | "all"
  | "Topographical"
  | "Cadastral"
  | "Engineering"
  | "Mining"
  | "Monitoring";

const jobTypeIcons: Record<string, LucideIcon> = {
  Topographical: Mountain,
  Cadastral: MapPinned,
  Engineering: HardHat,
  Mining: Pickaxe,
  Monitoring: Activity,
};

const jobTypeColors: Record<string, string> = {
  Topographical: "bg-blue-100 text-blue-700",
  Cadastral: "bg-emerald-100 text-emerald-700",
  Engineering: "bg-amber-100 text-amber-700",
  Mining: "bg-purple-100 text-purple-700",
  Monitoring: "bg-orange-100 text-orange-700",
};

function JobTypeIcon({ type }: { type: string | null }) {
  const Icon = jobTypeIcons[type ?? ""] ?? Briefcase;
  return <Icon className="h-6 w-6" aria-hidden="true" />;
}

const statusVariant = (status: string): "default" | "secondary" | "outline" | "destructive" => {
  switch (mapStatus(status)) {
    case "Planned":
    case "Scheduled":
      return "default";
    case "In Progress":
      return "secondary";
    case "Completed":
    case "Cancelled":
      return "outline";
    default:
      return "outline";
  }
};

export default function JobsPage({
  workspaceId,
  isPlatformAdmin = false,
}: JobsPageProps) {
  const [jobs, setJobs] = useState<JobWithProject[]>([]);
  const [projects, setProjects] = useState<ProjectWithOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobEditorOpen, setJobEditorOpen] = useState(false);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [savingJob, setSavingJob] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [jobType, setJobType] = useState("");
  const [jobLocation, setJobLocation] = useState("");
  const [jobStatus, setJobStatus] = useState<JobStatus>("planned");
  const [jobProjectId, setJobProjectId] = useState("");
  const [jobScheduledStart, setJobScheduledStart] = useState("");
  const [jobScheduledEnd, setJobScheduledEnd] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<JobFilter>("all");
  const [selectedJob, setSelectedJob] = useState<JobWithProject | null>(null);
  const [page, setPage] = useState(1);

  const fetchJobs = useCallback(async () => {
    try {
      setError(null);
      const data = await listJobs(workspaceId);
      setJobs(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const fetchProjects = useCallback(async () => {
    if (!isPlatformAdmin) return;
    try {
      const data = await listProjects(workspaceId);
      setProjects(data);
    } catch {
      setProjects([]);
    }
  }, [workspaceId, isPlatformAdmin]);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  const openCreateEditor = () => {
    setEditingJobId(null);
    setJobTitle("");
    setJobDescription("");
    setJobType("");
    setJobLocation("");
    setJobStatus("planned");
    setJobProjectId("");
    setJobScheduledStart("");
    setJobScheduledEnd("");
    setJobEditorOpen(true);
  };

  const openEditEditor = (job: JobWithProject) => {
    setEditingJobId(job.id);
    setJobTitle(job.title);
    setJobDescription(job.description ?? "");
    setJobType(job.job_type ?? "");
    setJobLocation(job.location ?? "");
    setJobStatus(job.status);
    setJobProjectId(job.project_id ?? "");
    setJobScheduledStart(toDatetimeLocal(job.scheduled_start));
    setJobScheduledEnd(toDatetimeLocal(job.scheduled_end));
    setJobEditorOpen(true);
    setSelectedJob(null);
  };

  const saveJobEditor = async () => {
    if (!jobTitle.trim()) {
      setError("Job title is required.");
      return;
    }
    setError(null);
    setSavingJob(true);
    try {
      const base = {
        title: jobTitle.trim(),
        description: jobDescription.trim() || null,
        job_type: jobType.trim() || null,
        location: jobLocation.trim() || null,
        status: jobStatus,
        project_id: jobProjectId || null,
        scheduled_start: fromDatetimeLocal(jobScheduledStart),
        scheduled_end: fromDatetimeLocal(jobScheduledEnd),
      };
      if (editingJobId) {
        await updateJob(editingJobId, base);
      } else {
        await createJob(workspaceId, base);
      }
      setJobEditorOpen(false);
      await fetchJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save job.");
    } finally {
      setSavingJob(false);
    }
  };

  const handleArchiveJob = async (id: string) => {
    if (!window.confirm("Archive this job? It will be hidden from the list.")) return;
    setError(null);
    try {
      await archiveJob(id);
      setSelectedJob(null);
      await fetchJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to archive job.");
    }
  };

  const filtered = jobs.filter((job) => {
    if (
      typeFilter !== "all" &&
      (job.job_type ?? "").toLowerCase() !== typeFilter.toLowerCase()
    )
      return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return [job.title, job.project_name ?? "", job.location ?? "", job.description ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    }
    return true;
  });
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const filterTabs: { label: string; value: JobFilter }[] = [
    { label: "All", value: "all" },
    { label: "Topographical", value: "Topographical" },
    { label: "Cadastral", value: "Cadastral" },
    { label: "Engineering", value: "Engineering" },
    { label: "Mining", value: "Mining" },
    { label: "Monitoring", value: "Monitoring" },
  ];

  if (loading) {
    return (
      <div className="hub-body">
        <PageLoader />
      </div>
    );
  }

  return (
    <div className="hub-body mx-auto max-w-6xl space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1>Jobs</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            View field jobs, site visits, and survey assignments
          </p>
          {!isPlatformAdmin && (
            <p className="mt-1 text-xs text-muted-foreground">
              Job listings are maintained by platform administrators.
            </p>
          )}
        </div>
        {isPlatformAdmin && (
          <Button onClick={openCreateEditor}>
            <Plus className="mr-2 h-4 w-4" /> Add job
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={typeFilter} onValueChange={(value) => setTypeFilter(value as JobFilter)}>
          <TabsList className="h-auto flex-wrap">
            {filterTabs.map((f) => (
              <TabsTrigger key={f.value} value={f.value} className="text-xs sm:text-sm">
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative flex-1 lg:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search jobs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <Dialog open={!!selectedJob} onOpenChange={() => setSelectedJob(null)}>
        <DialogContent className="sm:max-w-[480px]">
          {selectedJob && (
            <>
              <DialogHeader>
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-lg",
                      jobTypeColors[selectedJob.job_type ?? ""] ?? "bg-muted text-primary",
                    )}
                  >
                    <JobTypeIcon type={selectedJob.job_type} />
                  </div>
                  <div>
                    <DialogTitle>{selectedJob.title}</DialogTitle>
                    <p className="text-sm text-muted-foreground">
                      {selectedJob.project_name ?? "No project"} ·{" "}
                      {selectedJob.location ?? "No location"}
                    </p>
                  </div>
                </div>
              </DialogHeader>
              <div className="flex flex-wrap gap-2">
                <Badge variant={statusVariant(selectedJob.status)}>
                  {mapStatus(selectedJob.status)}
                </Badge>
                {selectedJob.job_type && <Badge variant="outline">{selectedJob.job_type}</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">
                {selectedJob.description ?? "No description provided."}
              </p>
              <Card>
                <CardContent className="space-y-2 py-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Scheduled Start</span>
                    <span className="font-medium text-foreground">
                      {formatDate(selectedJob.scheduled_start)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Scheduled End</span>
                    <span className="font-medium text-foreground">
                      {formatDate(selectedJob.scheduled_end)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Project</span>
                    <span className="font-medium text-foreground">
                      {selectedJob.project_name ?? "—"}
                    </span>
                  </div>
                </CardContent>
              </Card>
              <DialogFooter className="flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  onClick={() => setSelectedJob(null)}
                  className="w-full sm:w-auto"
                >
                  Close
                </Button>
                {isPlatformAdmin && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => openEditEditor(selectedJob)}
                      className="w-full sm:w-auto"
                    >
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => void handleArchiveJob(selectedJob.id)}
                      className="w-full sm:w-auto"
                    >
                      Archive
                    </Button>
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={jobEditorOpen} onOpenChange={setJobEditorOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{editingJobId ? "Edit job" : "Add job"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-2">
              <Label htmlFor="job-editor-title">Title</Label>
              <Input
                id="job-editor-title"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="Job title"
              />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label htmlFor="job-editor-desc">Description</Label>
              <textarea
                id="job-editor-desc"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1"
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>
            <div className="space-y-2">
              <Label>Job type</Label>
              <SelectDropdown
                className="input-field w-full"
                value={jobType}
                onChange={setJobType}
                placeholder="Type"
                options={[
                  { value: "", label: "—" },
                  { value: "Topographical", label: "Topographical" },
                  { value: "Cadastral", label: "Cadastral" },
                  { value: "Engineering", label: "Engineering" },
                  { value: "Mining", label: "Mining" },
                  { value: "Monitoring", label: "Monitoring" },
                ]}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-editor-location">Location</Label>
              <Input
                id="job-editor-location"
                value={jobLocation}
                onChange={(e) => setJobLocation(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <SelectDropdown
                className="input-field w-full"
                value={jobStatus}
                onChange={(v) => setJobStatus(v as JobStatus)}
                options={[
                  { value: "planned", label: "Planned" },
                  { value: "scheduled", label: "Scheduled" },
                  { value: "in_progress", label: "In progress" },
                  { value: "completed", label: "Completed" },
                  { value: "cancelled", label: "Cancelled" },
                ]}
              />
            </div>
            <div className="space-y-2">
              <Label>Project (optional)</Label>
              <SelectDropdown
                className="input-field w-full"
                value={jobProjectId}
                onChange={setJobProjectId}
                options={[
                  { value: "", label: "No project" },
                  ...projects.map((p) => ({
                    value: p.id,
                    label: p.name || "Untitled project",
                  })),
                ]}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-editor-start">Scheduled start</Label>
              <Input
                id="job-editor-start"
                type="datetime-local"
                value={jobScheduledStart}
                onChange={(e) => setJobScheduledStart(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-editor-end">Scheduled end</Label>
              <Input
                id="job-editor-end"
                type="datetime-local"
                value={jobScheduledEnd}
                onChange={(e) => setJobScheduledEnd(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setJobEditorOpen(false)}
              disabled={savingJob}
            >
              Cancel
            </Button>
            <Button onClick={() => void saveJobEditor()} disabled={savingJob}>
              {savingJob ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Briefcase className="h-12 w-12 text-muted-foreground/50" />
            <p className="font-medium text-foreground">No jobs found</p>
            <p className="text-sm text-muted-foreground">
              {jobs.length === 0
                ? "No jobs available in the system yet."
                : "Try adjusting your search criteria."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {paginated.map((job) => {
              const statusLabel = mapStatus(job.status);
              return (
                <Card
                  key={job.id}
                  className="cursor-pointer transition-all hover:border-primary hover:shadow-md"
                  onClick={() => setSelectedJob(job)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedJob(job);
                    }
                  }}
                >
                  <CardContent className="flex flex-1 flex-col gap-4 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div
                        className={cn(
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
                          jobTypeColors[job.job_type ?? ""] ?? "bg-muted text-primary",
                        )}
                      >
                        <JobTypeIcon type={job.job_type} />
                      </div>
                      <Badge variant={statusVariant(job.status)}>{statusLabel}</Badge>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">{job.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {job.project_name ?? "No project"}
                        {job.job_type && (
                          <>
                            {" "}
                            · <span>{job.job_type}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="mt-auto space-y-1.5 text-xs text-muted-foreground">
                      {job.location && (
                        <span className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5" /> {job.location}
                        </span>
                      )}
                      {job.scheduled_start && (
                        <span className="flex items-center gap-1.5">
                          <CalendarDays className="h-3.5 w-3.5" />{" "}
                          {formatDate(job.scheduled_start)}
                          {job.scheduled_end ? ` – ${formatDate(job.scheduled_end)}` : ""}
                        </span>
                      )}
                    </div>
                    <Separator />
                    {isPlatformAdmin ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditEditor(job);
                        }}
                      >
                        Edit
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">View details</span>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {filtered.length > pageSize && (
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="mr-1 h-4 w-4" /> Previous
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
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
