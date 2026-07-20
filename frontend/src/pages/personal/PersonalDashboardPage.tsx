import React, { useState, useEffect } from "react";
import {
  Briefcase,
  FileText,
  Clock,
  Plus,
  Gauge,
  CalendarDays,
  ListTodo,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { MetricStrip } from "@/components/dashboard/MetricStrip.tsx";
import {
  DashboardColumn,
  DashboardGrid,
  DashboardHeader,
  DashboardShell,
} from "@/components/dashboard/DashboardShell.tsx";
import { DashboardCard } from "@/components/dashboard/DashboardCard.tsx";

import { listProjects, type ProjectWithOrg } from "../../lib/repositories/projects.ts";
import { listInvoices, type InvoiceWithDetails } from "../../lib/repositories/invoices.ts";
import { listCalibrations, listAssets } from "../../lib/repositories/assets.ts";
import { listJobEvents, type JobEventRow } from "../../lib/repositories/jobEvents.ts";
import { listQuotes } from "../../lib/repositories/quotes.ts";

interface PersonalDashboardPageProps {
  userName?: string;
  workspaceId: string;
  onNavigate?: (view: string) => void;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

function getFirstName(name?: string): string {
  if (!name) return "there";
  const firstName = name.trim().split(/\s+/)[0];
  return firstName || "there";
}

export default function PersonalDashboardPage({
  userName,
  workspaceId,
  onNavigate,
}: PersonalDashboardPageProps) {
  const [projects, setProjects] = useState<ProjectWithOrg[]>([]);
  const [invoices, setInvoices] = useState<InvoiceWithDetails[]>([]);
  const [nextCalibrationDays, setNextCalibrationDays] = useState<number | null>(null);
  const [taskItems, setTaskItems] = useState<string[]>([]);
  const [todayEvents, setTodayEvents] = useState<JobEventRow[]>([]);
  const [assetSnapshot, setAssetSnapshot] = useState<
    { name: string; status: string; color: string }[]
  >([]);

  useEffect(() => {
    if (!workspaceId) return;

    Promise.all([
      listProjects(workspaceId).catch(() => []),
      listInvoices(workspaceId).catch(() => []),
      listCalibrations(workspaceId).catch(() => []),
      listJobEvents(workspaceId).catch(() => []),
      listAssets(workspaceId).catch(() => []),
      listQuotes(workspaceId).catch(() => []),
    ]).then(([p, i, calibrations, events, assets, quotes]) => {
      setProjects(p);
      setInvoices(i);
      const upcomingCalibrations = calibrations
        .filter((item) => item.next_calibration_date)
        .sort((a, b) =>
          (a.next_calibration_date ?? "").localeCompare(b.next_calibration_date ?? ""),
        );
      if (upcomingCalibrations.length > 0) {
        const nextDate = new Date(upcomingCalibrations[0].next_calibration_date!);
        const dayDiff = Math.max(
          0,
          Math.ceil((nextDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        );
        setNextCalibrationDays(dayDiff);
      } else {
        setNextCalibrationDays(null);
      }

      const today = new Date().toISOString().slice(0, 10);
      setTodayEvents(events.filter((event) => event.event_date === today).slice(0, 2));

      const pendingInvoiceCount = i.filter(
        (invoice) =>
          invoice.status === "draft" ||
          invoice.status === "sent" ||
          invoice.status === "overdue",
      ).length;
      const activeProjectCount = p.filter((project) => project.status === "active").length;
      const sentQuotes = quotes.filter(
        (quote) => quote.status === "draft" || quote.status === "sent",
      ).length;
      const dueSoonCalibrations = upcomingCalibrations.filter((item) => {
        if (!item.next_calibration_date) return false;
        const due = new Date(item.next_calibration_date);
        const windowEnd = new Date();
        windowEnd.setDate(windowEnd.getDate() + 14);
        return due <= windowEnd;
      }).length;
      setTaskItems([
        `${activeProjectCount} active project${activeProjectCount === 1 ? "" : "s"} need tracking`,
        `${pendingInvoiceCount} pending invoice${pendingInvoiceCount === 1 ? "" : "s"} need follow-up`,
        `${sentQuotes} quote${sentQuotes === 1 ? "" : "s"} are waiting for client decision`,
        `${dueSoonCalibrations} calibration${dueSoonCalibrations === 1 ? "" : "s"} due within 14 days`,
      ]);

      setAssetSnapshot(
        assets.slice(0, 3).map((asset) => ({
          name: asset.name,
          status:
            asset.status === "available"
              ? "Ready"
              : asset.status === "maintenance"
                ? "Service Soon"
                : asset.status === "deployed"
                  ? "In Use"
                  : "Unavailable",
          color:
            asset.status === "available"
              ? "#16a34a"
              : asset.status === "maintenance"
                ? "#d97706"
                : "#64748b",
        })),
      );
    });
  }, [workspaceId]);

  const activeProjectsCount = projects.filter((p) => p.status === "active").length;
  const pendingInvoices = invoices.filter(
    (i) => i.status === "draft" || i.status === "sent" || i.status === "overdue",
  );
  const pendingInvoicesTotal = pendingInvoices.reduce(
    (sum, inv) => sum + Number(inv.total || 0),
    0,
  );

  const currentDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <DashboardShell className="hub-body">
      <DashboardHeader
        badge={<Badge variant="secondary">Personal account</Badge>}
        title={`${getGreeting()}, ${getFirstName(userName)}`}
        subtitle={currentDate}
        description="Your personal dashboard is focused on your own schedule, projects, invoices, contacts, and field equipment so you can manage solo work efficiently."
        actions={
          <Button className="gap-2">
            <Plus size={16} />
            Create Quote
          </Button>
        }
      />

      <MetricStrip
        metrics={[
          {
            label: "Open Projects",
            value: activeProjectsCount.toString(),
            subtext: `${projects.length} total projects`,
            accentColor: "#8b5cf6",
            icon: <Briefcase size={18} />,
          },
          {
            label: "Pending Invoices",
            value: `$${pendingInvoicesTotal.toLocaleString()}`,
            subtext: `${pendingInvoices.length} invoices awaiting payment`,
            accentColor: "#f59e0b",
            icon: <FileText size={18} />,
          },
          {
            label: "Next Calibration",
            value: nextCalibrationDays == null ? "-- Days" : `${nextCalibrationDays} Days`,
            subtext:
              nextCalibrationDays == null
                ? "No calibration schedule found"
                : "until next calibration",
            accentColor: "#22c55e",
            icon: <Clock size={18} />,
          },
        ]}
      />

      <DashboardGrid>
        <DashboardColumn>
          <DashboardCard title="Recent Projects" icon={<Briefcase size={16} />}>
            <div className="flex flex-col">
              {projects.slice(0, 3).map((project) => (
                <React.Fragment key={project.id}>
                  <button
                    type="button"
                    className="flex items-center justify-between gap-4 w-full text-left py-3 px-1 rounded-lg transition-colors hover:bg-muted/60"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {project.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {project.organization_name || "Private Client"}
                      </p>
                    </div>
                    <Badge
                      variant={
                        project.status === "completed" ? "default" : "secondary"
                      }
                    >
                      {project.status === "completed" ? "Completed" : "Active"}
                    </Badge>
                  </button>
                  <Separator />
                </React.Fragment>
              ))}
              {projects.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No recent projects found.
                </div>
              )}
            </div>
          </DashboardCard>

          <DashboardCard title="Priority Tasks" icon={<ListTodo size={16} />}>
            <div className="flex flex-col gap-3">
              {taskItems.map((task) => (
                <div key={task} className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                  <span className="text-sm text-foreground">{task}</span>
                </div>
              ))}
              {taskItems.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No priority tasks available.
                </p>
              )}
            </div>
          </DashboardCard>
        </DashboardColumn>

        <DashboardColumn>
          <DashboardCard
            title="Today's Schedule"
            icon={<CalendarDays size={16} />}
            accent
            footer={
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => onNavigate?.("schedule")}
              >
                Open Full Schedule
              </Button>
            }
          >
            <div className="flex flex-col gap-3">
              {todayEvents.map((event) => (
                <div key={event.id} className="flex gap-4 items-start">
                  <div className="text-xs font-semibold text-muted-foreground w-16 shrink-0 pt-0.5">
                    {event.start_time ? event.start_time.slice(0, 5) : "All day"}
                  </div>
                  <div className="flex-1 rounded-lg bg-muted/60 p-3">
                    <p className="text-sm font-medium text-foreground">
                      {event.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {event.notes || event.event_type || "Scheduled activity"}
                    </p>
                  </div>
                </div>
              ))}
              {todayEvents.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No schedule events for today.
                </div>
              )}
            </div>
          </DashboardCard>

          <DashboardCard title="Equipment Snapshot" icon={<Gauge size={16} />}>
            <div className="flex flex-col gap-3">
              {assetSnapshot.map((asset) => (
                <div
                  key={asset.name}
                  className="flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Gauge
                      size={16}
                      className="shrink-0 text-muted-foreground"
                    />
                    <span className="text-sm font-medium text-foreground truncate">
                      {asset.name}
                    </span>
                  </div>
                  <span
                    className="text-xs font-semibold shrink-0"
                    style={{ color: asset.color }}
                  >
                    {asset.status}
                  </span>
                </div>
              ))}
              {assetSnapshot.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No assets tracked yet.
                </div>
              )}
            </div>
          </DashboardCard>
        </DashboardColumn>
      </DashboardGrid>
    </DashboardShell>
  );
}
