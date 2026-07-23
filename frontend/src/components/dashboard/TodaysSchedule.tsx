import * as React from "react";
import { CalendarDays, CalendarX, MapPin, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { JobEventRow } from "@/lib/repositories/jobEvents.ts";
import { DashboardCard } from "./DashboardCard.tsx";

interface TodaysScheduleProps {
  events: JobEventRow[];
  onNewDispatch?: () => void;
  maxItems?: number;
}

function formatEventTypeLabel(type: string | null): string {
  if (!type) return "Event";
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getEventTypeStyles(type: string | null): string {
  switch (type?.toLowerCase()) {
    case "field_work":
      return "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800";
    case "delivery":
      return "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800";
    case "meeting":
      return "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800";
    case "calibration":
      return "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800";
    case "maintenance":
      return "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";
    case "survey":
      return "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function parseMinutes(time: string | null): number | null {
  if (!time) return null;
  const [hours, minutes] = time.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function formatTime(event: JobEventRow): string {
  if (!event.start_time) return "All day";
  const start = event.start_time.slice(0, 5);
  if (event.end_time) {
    return `${start} – ${event.end_time.slice(0, 5)}`;
  }
  return start;
}

function isAllDay(event: JobEventRow): boolean {
  return !event.start_time;
}

function getEventStatus(
  event: JobEventRow,
  nowMinutes: number,
): "past" | "current" | "upcoming" {
  if (isAllDay(event)) return "upcoming";
  const start = parseMinutes(event.start_time);
  const end = event.end_time ? parseMinutes(event.end_time) : null;
  if (start === null) return "upcoming";
  if (end !== null && nowMinutes > end) return "past";
  if (nowMinutes >= start && (end === null || nowMinutes < end)) return "current";
  return "upcoming";
}

export function TodaysSchedule({
  events,
  onNewDispatch,
  maxItems = 6,
}: TodaysScheduleProps) {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const todaysEvents = React.useMemo(() => {
    return events
      .filter((event) => event.event_date === today)
      .sort((a, b) => {
        // All-day events first, then by start time, then by end time.
        if (isAllDay(a) && !isAllDay(b)) return -1;
        if (!isAllDay(a) && isAllDay(b)) return 1;
        const aStart = parseMinutes(a.start_time) ?? Infinity;
        const bStart = parseMinutes(b.start_time) ?? Infinity;
        if (aStart !== bStart) return aStart - bStart;
        return (parseMinutes(a.end_time) ?? Infinity) - (parseMinutes(b.end_time) ?? Infinity);
      })
      .slice(0, maxItems);
  }, [events, today, maxItems]);

  const allDayCount = todaysEvents.filter(isAllDay).length;
  const timedCount = todaysEvents.length - allDayCount;
  const upcomingCount = todaysEvents.filter(
    (event) => getEventStatus(event, nowMinutes) === "upcoming",
  ).length;

  const titleAction = onNewDispatch ? (
    <Button size="sm" className="gap-1.5" onClick={onNewDispatch}>
      <Plus className="size-3.5" />
      New Dispatch
    </Button>
  ) : null;

  return (
    <DashboardCard
      title="Today's Schedule"
      icon={<CalendarDays className="size-4" />}
      titleAction={titleAction}
      accent
    >
      {todaysEvents.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <CalendarX className="size-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">No dispatches today</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Your crews do not have any events scheduled for today.
            </p>
          </div>
          {onNewDispatch && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onNewDispatch}>
              <Plus className="size-3.5" />
              Schedule dispatch
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col">
          <p className="mb-3 text-xs text-muted-foreground">
            {todaysEvents.length} dispatch{todaysEvents.length === 1 ? "" : "es"}
            {timedCount > 0 && allDayCount > 0
              ? ` · ${timedCount} timed, ${allDayCount} all-day`
              : ""}
            {upcomingCount > 0 && ` · ${upcomingCount} upcoming`}
          </p>

          <div className="relative space-y-1">
            {todaysEvents.map((event) => {
              const status = getEventStatus(event, nowMinutes);
              const time = formatTime(event);

              return (
                <div
                  key={event.id}
                  className={cn(
                    "group flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-muted/60",
                    status === "current" && "bg-primary/5 hover:bg-primary/10",
                    status === "past" && "opacity-60",
                  )}
                >
                  <div className="flex w-14 shrink-0 flex-col items-end pt-1.5">
                    <span
                      className={cn(
                        "text-xs font-semibold tabular-nums",
                        status === "current" ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {isAllDay(event) ? "All day" : time.split(" – ")[0]}
                    </span>
                    {!isAllDay(event) && event.end_time && (
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {time.split(" – ")[1]}
                      </span>
                    )}
                  </div>

                  <div className="relative flex-1">
                    <span
                      className={cn(
                        "absolute -left-[17px] top-2 hidden h-2.5 w-2.5 rounded-full border-2 border-background sm:block",
                        status === "current"
                          ? "border-primary bg-primary"
                          : status === "past"
                            ? "bg-muted-foreground"
                            : "bg-background ring-1 ring-muted-foreground",
                      )}
                    />
                    <div
                      className={cn(
                        "rounded-lg border bg-card p-2.5 shadow-sm",
                        status === "current"
                          ? "border-primary/30"
                          : "border-border/60",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-1 text-sm font-medium text-foreground">
                          {event.title}
                        </p>
                        <Badge variant="outline" className={cn("shrink-0 text-[10px] uppercase", getEventTypeStyles(event.event_type))}>
                          {formatEventTypeLabel(event.event_type)}
                        </Badge>
                      </div>
                      {event.location && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="size-3 shrink-0" />
                          <span className="line-clamp-1">{event.location}</span>
                        </div>
                      )}
                      {status === "current" && (
                        <p className="mt-1.5 text-xs font-medium text-primary">
                          Happening now
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </DashboardCard>
  );
}
