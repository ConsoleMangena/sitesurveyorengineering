import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Plus,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Calendar as CalendarIcon,
  Search,
  X,
} from "lucide-react";

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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/DashboardShell.tsx";
import { MetricStrip } from "@/components/dashboard/MetricStrip.tsx";
import { cn } from "@/lib/utils";

import {
  listJobEvents,
  createJobEvent,
  updateJobEvent,
  deleteJobEvent,
} from "../../lib/repositories/jobEvents.ts";
import type { JobEventRow } from "../../lib/repositories/jobEvents.ts";

const TYPE_LABELS: Record<string, string> = {
  boundary: "Boundary Survey",
  topo: "Topographic",
  construction: "Construction",
  pegging: "Stand Pegging",
  other: "Other",
};

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type TypeFilter = "all" | "boundary" | "topo" | "construction" | "pegging" | "other";
type ViewMode = "week" | "month";

const startOfWeekMonday = (d: Date) => {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = (day + 6) % 7;
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - diff);
  return copy;
};

const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

const addDays = (d: Date, days: number) => {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
};

const formatDate = (isoDate: string) =>
  new Date(isoDate).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const typeVariant: Record<string, "default" | "secondary" | "destructive" | "outline" | "warning" | "success" | "purple"> = {
  boundary: "purple",
  topo: "default",
  construction: "warning",
  pegging: "success",
  other: "secondary",
};

const typeBgClass: Record<string, string> = {
  boundary: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200 border-violet-200",
  topo: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-blue-200",
  construction: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 border-amber-200",
  pegging: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 border-emerald-200",
  other: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 border-slate-200",
};

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "";
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const diffMin = (eh * 60 + em) - (sh * 60 + sm);
  if (diffMin <= 0) return "";
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

interface SchedulePageProps {
  workspaceId: string;
  workspaceType?: "personal" | "business";
}

function EventDetail({
  event,
  isBusiness,
  onEdit,
  onDelete,
}: {
  event: JobEventRow;
  isBusiness: boolean;
  onEdit: (event: JobEventRow) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-4 p-6">
      <Badge variant={typeVariant[event.event_type] ?? "secondary"}>
        {TYPE_LABELS[event.event_type] ?? event.event_type}
      </Badge>
      <div>
        <h3 className="text-lg font-semibold">{event.title}</h3>
        <p className="text-sm text-muted-foreground">{event.location ?? ""}</p>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Date</span>
          <span>{formatDate(event.event_date)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Time</span>
          <span>
            {event.start_time ?? "—"}
            {event.end_time ? ` – ${event.end_time}` : ""}
            {formatDuration(event.start_time, event.end_time)
              ? ` (${formatDuration(event.start_time, event.end_time)})`
              : ""}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Location</span>
          <span className="text-right max-w-[60%] truncate" title={event.location ?? undefined}>
            {event.location ?? "—"}
          </span>
        </div>
      </div>
      <div>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Notes
        </span>
        <p className="text-sm text-muted-foreground mt-1">{event.notes ?? "No notes."}</p>
      </div>
      <div className="flex gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={() => onEdit(event)} disabled={!isBusiness}>
          Edit
        </Button>
        <Button variant="outline" size="sm" onClick={onDelete} disabled={!isBusiness}>
          Delete
        </Button>
      </div>
    </div>
  );
}

export default function SchedulePage({ workspaceId, workspaceType }: SchedulePageProps) {
  const isBusiness = workspaceType === "business";
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const todayStr = toIsoDate(today);

  const [events, setEvents] = useState<JobEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [formError, setFormError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [monthDate, setMonthDate] = useState(() => new Date(today));
  const [draft, setDraft] = useState({
    id: "",
    title: "",
    location: "",
    event_date: todayStr,
    start_time: "08:00",
    end_time: "",
    event_type: "other",
    notes: "",
  });

  const fetchEvents = useCallback(async () => {
    try {
      setError(null);
      const data = await listJobEvents(workspaceId);
      setEvents(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isModalOpen) setIsModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isModalOpen]);

  const weekStart = useMemo(
    () => addDays(startOfWeekMonday(today), weekOffset * 7),
    [today, weekOffset],
  );
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => toIsoDate(addDays(weekStart, i))),
    [weekStart],
  );

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      if (typeFilter !== "all" && e.event_type !== typeFilter) return false;
      if (!q) return true;
      return [e.title, e.location ?? "", e.notes ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [events, search, typeFilter]);

  const scheduleStats = useMemo(() => {
    const upcoming = events.filter((e) => e.event_date >= todayStr).length;
    const weekEnd = toIsoDate(addDays(startOfWeekMonday(today), 7));
    const thisWeek = events.filter(
      (e) => e.event_date >= toIsoDate(startOfWeekMonday(today)) && e.event_date < weekEnd,
    ).length;
    return { upcoming, thisWeek, total: events.length, filtered: filteredEvents.length };
  }, [events, todayStr, filteredEvents]);

  const selectedEvent = selectedEventId ? (events.find((e) => e.id === selectedEventId) ?? null) : null;

  const openCreate = (defaultDate?: string) => {
    setModalMode("create");
    setFormError(null);
    setDraft({
      id: "",
      title: "",
      location: "",
      event_date: defaultDate ?? todayStr,
      start_time: "08:00",
      end_time: "",
      event_type: "other",
      notes: "",
    });
    setIsModalOpen(true);
  };

  const openEdit = (ev: JobEventRow) => {
    setModalMode("edit");
    setFormError(null);
    setDraft({
      id: ev.id,
      title: ev.title,
      location: ev.location ?? "",
      event_date: ev.event_date,
      start_time: ev.start_time ?? "08:00",
      end_time: ev.end_time ?? "",
      event_type: ev.event_type,
      notes: ev.notes ?? "",
    });
    setIsModalOpen(true);
  };

  const saveDraft = async () => {
    if (!draft.title.trim()) {
      setFormError("Title is required.");
      return;
    }
    if (!draft.event_date || !draft.start_time) {
      setFormError("Date and time are required.");
      return;
    }
    setFormError(null);

    try {
      if (modalMode === "edit" && draft.id) {
        await updateJobEvent(draft.id, {
          title: draft.title.trim(),
          location: draft.location.trim() || null,
          event_date: draft.event_date,
          start_time: draft.start_time,
          end_time: draft.end_time || null,
          event_type: draft.event_type,
          notes: draft.notes.trim() || null,
        });
        setSelectedEventId(draft.id);
      } else {
        const created = await createJobEvent(workspaceId, {
          title: draft.title.trim(),
          location: draft.location.trim() || null,
          event_date: draft.event_date,
          start_time: draft.start_time,
          end_time: draft.end_time || null,
          event_type: draft.event_type,
          notes: draft.notes.trim() || null,
        });
        setSelectedEventId(created.id);
      }
      setIsModalOpen(false);
      await fetchEvents();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to save event");
    }
  };

  const handleDelete = async () => {
    if (!selectedEvent) return;
    if (!window.confirm("Delete this event?")) return;
    try {
      await deleteJobEvent(selectedEvent.id);
      setSelectedEventId(null);
      await fetchEvents();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete event");
    }
  };

  // Month calendar helpers
  const monthYear = monthDate.getFullYear();
  const monthNum = monthDate.getMonth();
  const firstOfMonth = new Date(monthYear, monthNum, 1);
  const lastOfMonth = new Date(monthYear, monthNum + 1, 0);
  const startDay = (firstOfMonth.getDay() + 6) % 7;
  const totalDays = lastOfMonth.getDate();

  const monthCells = (() => {
    const cells: { date: string; dayNum: number; outside: boolean }[] = [];
    const prevMonthLast = new Date(monthYear, monthNum, 0).getDate();
    for (let i = startDay - 1; i >= 0; i--) {
      const d = new Date(monthYear, monthNum - 1, prevMonthLast - i);
      cells.push({ date: toIsoDate(d), dayNum: prevMonthLast - i, outside: true });
    }
    for (let d = 1; d <= totalDays; d++) {
      const date = new Date(monthYear, monthNum, d);
      cells.push({ date: toIsoDate(date), dayNum: d, outside: false });
    }
    const remaining = 42 - cells.length;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(monthYear, monthNum + 1, i);
      cells.push({ date: toIsoDate(d), dayNum: i, outside: true });
    }
    return cells;
  })();

  if (loading) {
    return (
      <div className="hub-body p-6">
        <PageLoader />
      </div>
    );
  }

  return (
    <DashboardShell className="hub-body">
      <DashboardHeader
        title="My Schedule"
        subtitle="Weekly site visits, lodgements, and appointments"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="week">Week</TabsTrigger>
                <TabsTrigger value="month">Month</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button onClick={() => openCreate()} disabled={!isBusiness} className="gap-2">
              <Plus size={16} />
              New Event
            </Button>
          </div>
        }
      />

      {!isBusiness && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Scheduling is only available for business workspaces. Upgrade to a business workspace to create and manage events.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <MetricStrip
        metrics={[
          {
            label: "Total events",
            value: scheduleStats.total.toString(),
            subtext: "all time",
            accentColor: "#8b5cf6",
            icon: <CalendarIcon size={18} />,
          },
          {
            label: "This week",
            value: scheduleStats.thisWeek.toString(),
            subtext: "scheduled",
            accentColor: "#3b82f6",
            icon: <CalendarDays size={18} />,
          },
          {
            label: "Upcoming",
            value: scheduleStats.upcoming.toString(),
            subtext: "from today",
            accentColor: "#22c55e",
            icon: <Clock size={18} />,
          },
          {
            label: "Shown",
            value: scheduleStats.filtered.toString(),
            subtext: "matching filters",
            accentColor: "#f59e0b",
            icon: <Search size={18} />,
          },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-md border">
          <Button variant="ghost" size="icon" onClick={() => setWeekOffset((v) => v - 1)} disabled={viewMode !== "week"}>
            <ChevronLeft size={18} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => (viewMode === "week" ? setWeekOffset(0) : setMonthDate(new Date(today)))}>
            Today
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setWeekOffset((v) => v + 1)} disabled={viewMode !== "week"}>
            <ChevronRight size={18} />
          </Button>
          <span className="px-2 text-sm text-muted-foreground min-w-[140px]">
            {viewMode === "week"
              ? `Week of ${new Date(weekDates[0]).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`
              : monthDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-52">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search schedule..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-7 h-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="inline-flex flex-wrap gap-1">
            {(["all", "boundary", "topo", "construction", "pegging", "other"] as const).map((t) => (
              <Button
                key={t}
                variant={typeFilter === t ? "default" : "outline"}
                size="sm"
                onClick={() => setTypeFilter(t)}
              >
                {t === "all" ? "All" : TYPE_LABELS[t]}
              </Button>
            ))}
          </div>
          <Badge variant="outline">{filteredEvents.length} event{filteredEvents.length === 1 ? "" : "s"}</Badge>
        </div>
      </div>

      {viewMode === "week" ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 lg:h-[600px]">
          <Card className="border-border/60 overflow-hidden flex flex-col">
            <CardContent className="p-0 flex-1 overflow-auto">
              <div className="grid grid-cols-7 min-w-[700px] h-full divide-x">
                {weekDates.map((date, i) => {
                  const dayEvents = filteredEvents
                    .filter((e) => e.event_date === date)
                    .sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));
                  const isTodayDate = date === todayStr;
                  const dayNum = new Date(date).getDate();
                  return (
                    <div
                      key={date}
                      className={cn(
                        "flex flex-col h-full min-h-[320px] p-2 gap-2",
                        isTodayDate && "bg-muted/40",
                      )}
                    >
                      <div className="text-center py-2">
                        <div className="text-xs text-muted-foreground uppercase tracking-wide">{WEEK_DAYS[i]}</div>
                        <div
                          className={cn(
                            "text-lg font-semibold mt-0.5",
                            isTodayDate && "text-primary",
                          )}
                        >
                          {dayNum}
                        </div>
                      </div>
                      <div className="flex-1 space-y-1.5">
                        {dayEvents.map((ev) => (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={() => {
                              setSelectedEventId(ev.id);
                              setMobileDetailOpen(true);
                            }}
                            className={cn(
                              "w-full text-left rounded-md border px-2 py-1.5 text-xs transition-all hover:shadow-sm",
                              typeBgClass[ev.event_type] ?? typeBgClass.other,
                              selectedEventId === ev.id && "ring-2 ring-primary ring-offset-1",
                            )}
                            title={`${TYPE_LABELS[ev.event_type] ?? ev.event_type} · ${ev.start_time ?? ""}${ev.end_time ? `–${ev.end_time}` : ""} · ${ev.location ?? "No location"}`}
                          >
                            <div className="font-semibold truncate">{ev.start_time ?? ""}</div>
                            <div className="truncate">{ev.title}</div>
                          </button>
                        ))}
                        {dayEvents.length === 0 && (
                          <div className="text-xs text-muted-foreground text-center py-4">No events</div>
                        )}
                        {isBusiness && (
                          <Button variant="ghost" size="sm" className="w-full h-7 text-xs" onClick={() => openCreate(date)}>
                            + Add
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 overflow-hidden hidden lg:flex lg:flex-col">
            <CardContent className="p-5 flex-1 overflow-auto">
              {selectedEvent ? (
                <EventDetail
                  event={selectedEvent}
                  isBusiness={isBusiness}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3 text-center">
                  <CalendarIcon size={40} />
                  <h3 className="text-base font-semibold text-foreground">
                    {filteredEvents.length === 0 ? "No events match" : "Select an Event"}
                  </h3>
                  <p className="text-sm">
                    {filteredEvents.length === 0
                      ? "Try changing filters or add a new event."
                      : "Click on any scheduled event to see details."}
                  </p>
                  {filteredEvents.length === 0 && isBusiness && (
                    <Button size="sm" onClick={() => openCreate()}>New Event</Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

        <Sheet open={mobileDetailOpen} onOpenChange={setMobileDetailOpen}>
          <SheetContent side="bottom" className="h-[92vh] p-0 flex flex-col">
            <SheetHeader className="border-b p-4 text-left">
              <SheetTitle>Event Details</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto">
              {selectedEvent ? (
                <EventDetail
                  event={selectedEvent}
                  isBusiness={isBusiness}
                  onEdit={(ev) => {
                    setMobileDetailOpen(false);
                    openEdit(ev);
                  }}
                  onDelete={() => {
                    setMobileDetailOpen(false);
                    handleDelete();
                  }}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3 p-8">
                  <CalendarIcon size={40} />
                  <h3 className="text-base font-semibold text-foreground">No event selected</h3>
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
        </div>
      ) : (
        <Card className="border-border/60 overflow-hidden">
          <CardContent className="p-0 overflow-x-auto">
            <div className="min-w-[600px]">
              <div className="grid grid-cols-7 border-b text-center text-xs font-semibold text-muted-foreground">
                {MONTH_DAYS.map((d) => (
                  <div key={d} className="py-2">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 auto-rows-fr min-h-[480px]">
              {monthCells.map((cell) => {
                const dayEvents = filteredEvents
                  .filter((e) => e.event_date === cell.date)
                  .sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));
                const isTodayDate = cell.date === todayStr;
                const visible = dayEvents.slice(0, 2);
                const remaining = dayEvents.length - 2;
                return (
                  <div
                    key={cell.date}
                    className={cn(
                      "min-h-[80px] p-1.5 border-b border-r flex flex-col gap-1 cursor-pointer hover:bg-muted/30 transition-colors",
                      cell.outside && "bg-muted/20 text-muted-foreground",
                      isTodayDate && "bg-primary/5",
                    )}
                    onClick={() => !cell.outside && openCreate(cell.date)}
                  >
                    <div
                      className={cn(
                        "text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full",
                        isTodayDate && "bg-primary text-primary-foreground",
                      )}
                    >
                      {cell.dayNum}
                    </div>
                    <div className="flex-1 space-y-1">
                      {visible.map((ev) => (
                        <button
                          key={ev.id}
                          className={cn(
                            "w-full text-left text-[10px] truncate rounded px-1.5 py-0.5 border",
                            typeBgClass[ev.event_type] ?? typeBgClass.other,
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEventId(ev.id);
                            setMobileDetailOpen(true);
                          }}
                          title={`${TYPE_LABELS[ev.event_type] ?? ev.event_type} · ${ev.start_time ?? ""}${ev.end_time ? `–${ev.end_time}` : ""} · ${ev.location ?? "No location"}`}
                        >
                          {ev.start_time ? `${ev.start_time} ` : ""}
                          {ev.title}
                        </button>
                      ))}
                      {remaining > 0 && (
                        <span className="text-[10px] text-muted-foreground pl-1">+{remaining} more</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    )}

      <Dialog open={isModalOpen} onOpenChange={(open) => !open && setIsModalOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{modalMode === "edit" ? "Edit Event" : "New Event"}</DialogTitle>
            <DialogDescription>Plan a site visit or appointment.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="event-title">Title</Label>
              <Input
                id="event-title"
                placeholder="Event title"
                value={draft.title}
                onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-location">Location</Label>
              <div className="relative">
                <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="event-location"
                  placeholder="Site or address"
                  value={draft.location}
                  onChange={(e) => setDraft((prev) => ({ ...prev, location: e.target.value }))}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={draft.event_type}
                onValueChange={(val) => setDraft((prev) => ({ ...prev, event_type: val }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="boundary">{TYPE_LABELS.boundary}</SelectItem>
                  <SelectItem value="topo">{TYPE_LABELS.topo}</SelectItem>
                  <SelectItem value="construction">{TYPE_LABELS.construction}</SelectItem>
                  <SelectItem value="pegging">{TYPE_LABELS.pegging}</SelectItem>
                  <SelectItem value="other">{TYPE_LABELS.other}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="event-date">Date</Label>
                <Input
                  id="event-date"
                  type="date"
                  value={draft.event_date}
                  onChange={(e) => setDraft((prev) => ({ ...prev, event_date: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-start">Start</Label>
                <Input
                  id="event-start"
                  type="time"
                  value={draft.start_time}
                  onChange={(e) => setDraft((prev) => ({ ...prev, start_time: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-end">End</Label>
                <Input
                  id="event-end"
                  type="time"
                  placeholder="End time"
                  value={draft.end_time}
                  onChange={(e) => setDraft((prev) => ({ ...prev, end_time: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-notes">Notes</Label>
              <textarea
                id="event-notes"
                placeholder="Add any extra details..."
                value={draft.notes}
                onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
                rows={3}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>

          {formError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {formError}
            </div>
          )}

          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveDraft}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}
