import React, { useState, useEffect } from "react";
import {
  Briefcase,
  CalendarDays,
  FileText,
  FileCheck,
  Plus,
  TrendingUp,
  Users,
  Gauge,
  AlertTriangle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { MetricStrip } from "@/components/dashboard/MetricStrip.tsx";
import { DashboardCard } from "@/components/dashboard/DashboardCard.tsx";
import {
  DashboardColumn,
  DashboardGrid,
  DashboardHeader,
  DashboardShell,
} from "@/components/dashboard/DashboardShell.tsx";

import { listProjects, type ProjectWithOrg } from "../../lib/repositories/projects.ts";
import { listInvoices, type InvoiceWithDetails } from "../../lib/repositories/invoices.ts";
import { listJobEvents, type JobEventRow } from "../../lib/repositories/jobEvents.ts";
import { listWorkspaceMembers } from "../../lib/repositories/workspaceMembers.ts";
import { listCalibrations } from "../../lib/repositories/assets.ts";
import { listQuotes } from "../../lib/repositories/quotes.ts";
import { listAssets } from "../../lib/repositories/assets.ts";

interface BusinessDashboardPageProps {
  userName?: string;
  workspaceId: string;
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

export default function BusinessDashboardPage({
  userName,
  workspaceId,
}: BusinessDashboardPageProps) {
  const [projects, setProjects] = useState<ProjectWithOrg[]>([]);
  const [invoices, setInvoices] = useState<InvoiceWithDetails[]>([]);
  const [jobEvents, setJobEvents] = useState<JobEventRow[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [assetsAvailableCount, setAssetsAvailableCount] = useState(0);
  const [quotesPendingCount, setQuotesPendingCount] = useState(0);
  const [calibrationsDueCount, setCalibrationsDueCount] = useState(0);

  useEffect(() => {
    if (!workspaceId) return;

    Promise.all([
      listProjects(workspaceId).catch(() => []),
      listInvoices(workspaceId).catch(() => []),
      listJobEvents(workspaceId).catch(() => []),
      listWorkspaceMembers(workspaceId, { statuses: ["active"] }).catch(() => []),
      listAssets(workspaceId).catch(() => []),
      listQuotes(workspaceId).catch(() => []),
      listCalibrations(workspaceId).catch(() => []),
    ]).then(([p, i, events, members, assets, quotes, calibrations]) => {
      setProjects(p);
      setInvoices(i);
      setJobEvents(events);
      setMemberCount(members.length);
      setAssetsAvailableCount(
        assets.filter((asset) => asset.status === "available").length,
      );
      setQuotesPendingCount(
        quotes.filter((quote) => quote.status === "draft" || quote.status === "sent")
          .length,
      );
      const now = new Date();
      const dueWindow = new Date();
      dueWindow.setDate(now.getDate() + 7);
      setCalibrationsDueCount(
        calibrations.filter((item) => {
          if (!item.next_calibration_date) return false;
          const due = new Date(item.next_calibration_date);
          return due >= now && due <= dueWindow;
        }).length,
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
  const allDispatchesToday = jobEvents.filter(
    (event) => event.event_date === new Date().toISOString().slice(0, 10),
  );
  const dispatchBoard = allDispatchesToday.slice(0, 6).map((event) => ({
    time: event.start_time ? event.start_time.slice(0, 5) : "All day",
    team: event.title,
    task: event.event_type || "Field work",
    location: event.location || "No location",
  }));

  const currentDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <DashboardShell className="hub-body">
      <DashboardHeader
        badge={<Badge variant="secondary">Business account</Badge>}
        title={`${getGreeting()}, ${getFirstName(userName)}`}
        subtitle={currentDate}
        description="Manage company operations from one place — dispatch crews, monitor active projects, track billing, and coordinate assets across your workspace."
        actions={
          <>
            <Button variant="outline" className="gap-2">
              <TrendingUp size={16} />
              Weekly Report
            </Button>
            <Button className="gap-2">
              <Plus size={16} />
              New Dispatch
            </Button>
          </>
        }
      />

      <MetricStrip
        metrics={[
          {
            label: "Active Projects",
            value: activeProjectsCount.toString(),
            subtext: `${projects.length} total projects`,
            accentColor: "#8b5cf6",
            icon: <Briefcase size={18} />,
          },
          {
            label: "Dispatches Today",
            value: allDispatchesToday.length.toString(),
            subtext: `${allDispatchesToday.filter((item) => item.start_time).length} time-slotted events`,
            accentColor: "#3b82f6",
            icon: <CalendarDays size={18} />,
          },
          {
            label: "Outstanding Billing",
            value: `$${pendingInvoicesTotal.toLocaleString()}`,
            subtext: `${pendingInvoices.length} invoices awaiting payment`,
            accentColor: "#ef4444",
            icon: <FileText size={18} />,
          },
          {
            label: "Quotes Pipeline",
            value: quotesPendingCount.toString(),
            subtext: "awaiting approval",
            accentColor: "#10b981",
            icon: <FileCheck size={18} />,
          },
        ]}
      />

      <DashboardGrid>
        <DashboardColumn>
          <DashboardCard
            title="Operations Overview"
            icon={<Briefcase size={16} />}
          >
            <div className="flex flex-col">
              {projects.slice(0, 4).map((project) => (
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
                  No recent operations found.
                </div>
              )}
            </div>
          </DashboardCard>

          <DashboardCard
            title="Resource & Equipment"
            icon={<Gauge size={16} />}
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1 p-4 rounded-xl bg-muted/50 border">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Users size={14} />
                  <span className="text-xs font-medium">Team Capacity</span>
                </div>
                <span className="text-2xl font-bold text-foreground">
                  {memberCount}
                </span>
                <span className="text-xs text-muted-foreground">
                  active field staff
                </span>
              </div>
              <div className="flex flex-col gap-1 p-4 rounded-xl bg-muted/50 border">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Gauge size={14} />
                  <span className="text-xs font-medium">Ready Assets</span>
                </div>
                <span className="text-2xl font-bold text-foreground">
                  {assetsAvailableCount}
                </span>
                <span className="text-xs text-muted-foreground">
                  available for deployment
                </span>
              </div>
              <div className="flex flex-col gap-1 p-4 rounded-xl bg-muted/50 border">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <AlertTriangle size={14} />
                  <span className="text-xs font-medium">Calibrations</span>
                </div>
                <span className="text-2xl font-bold text-foreground">
                  {calibrationsDueCount}
                </span>
                <span className="text-xs text-muted-foreground">due this week</span>
              </div>
            </div>
          </DashboardCard>
        </DashboardColumn>

        <DashboardColumn>
          <DashboardCard
            title="Dispatch Board"
            icon={<CalendarDays size={16} />}
            accent
          >
            <div className="flex flex-col gap-3">
              {dispatchBoard.map((assignment, index) => (
                <div
                  key={`${assignment.team}-${index}`}
                  className="flex gap-4 items-start"
                >
                  <div className="text-xs font-semibold text-muted-foreground w-16 shrink-0 pt-0.5">
                    {assignment.time}
                  </div>
                  <div className="flex-1 rounded-lg bg-muted/60 p-3">
                    <p className="text-sm font-medium text-foreground">
                      {assignment.team}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {assignment.task}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {assignment.location}
                    </p>
                  </div>
                </div>
              ))}
              {dispatchBoard.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No dispatch events scheduled for today.
                </div>
              )}
            </div>
          </DashboardCard>
        </DashboardColumn>
      </DashboardGrid>
    </DashboardShell>
  );
}
