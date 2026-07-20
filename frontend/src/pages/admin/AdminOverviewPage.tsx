import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Briefcase, Users, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { MetricStrip } from "@/components/dashboard/MetricStrip.tsx";
import {
  DashboardHeader,
  DashboardShell,
} from "@/components/dashboard/DashboardShell.tsx";
import PageLoader from "@/components/PageLoader.tsx";

import {
  countProfiles,
  listProfilesSummary,
  listWorkspaces,
  type WorkspaceRowAdmin,
} from "../../lib/repositories/adminPlatform.ts";

interface AdminOverviewPageProps {
  isPlatformAdmin: boolean;
}

function formatStat(n: number): string {
  return n.toLocaleString();
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

export default function AdminOverviewPage({
  isPlatformAdmin,
}: AdminOverviewPageProps) {
  const [rows, setRows] = useState<WorkspaceRowAdmin[]>([]);
  const [userCount, setUserCount] = useState<number | null>(null);
  const [ownerLabels, setOwnerLabels] = useState<Map<string, string>>(new Map());
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isPlatformAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const [ws, profiles] = await Promise.all([
        listWorkspaces(),
        countProfiles(),
      ]);
      setRows(ws);
      setUserCount(profiles);
      setLastRefreshed(new Date());
      if (ws.length > 0) {
        const labels = await listProfilesSummary(ws.map((r) => r.owner_user_id));
        setOwnerLabels(labels);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load platform data.");
    } finally {
      setLoading(false);
    }
  }, [isPlatformAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const activeWs = rows.filter((r) => !r.archived_at);
    const personal = activeWs.filter((r) => r.type === "personal").length;
    const business = activeWs.filter((r) => r.type === "business").length;
    return {
      workspaces: activeWs.length,
      archived: rows.length - activeWs.length,
      personal,
      business,
    };
  }, [rows]);

  const recentWorkspaces = useMemo(
    () =>
      [...rows]
        .filter((r) => !r.archived_at)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10),
    [rows],
  );

  if (!isPlatformAdmin) {
    return null;
  }

  return (
    <DashboardShell className="hub-body admin-console-page">
      <DashboardHeader
        badge={<Badge variant="secondary">Platform admin</Badge>}
        title="Platform overview"
        subtitle="Cross-tenant metrics for workspaces and users"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            className="gap-2"
          >
            {loading ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {lastRefreshed && !loading && (
        <p className="text-xs text-muted-foreground -mt-2">
          Last refreshed: {lastRefreshed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </p>
      )}

      {loading ? (
        <PageLoader compact />
      ) : (
        <>
          <MetricStrip
            metrics={[
              {
                label: "Workspaces",
                value: formatStat(stats.workspaces),
                subtext: stats.archived > 0 ? `${formatStat(stats.archived)} archived` : "No archived workspaces",
                accentColor: "#8b5cf6",
                icon: <Briefcase size={18} />,
              },
              {
                label: "User profiles",
                value: userCount === null ? "—" : formatStat(userCount),
                subtext: "Registered accounts",
                accentColor: "#3b82f6",
                icon: <Users size={18} />,
              },
              {
                label: "Personal workspaces",
                value: formatStat(stats.personal),
                subtext: "Individual accounts",
                accentColor: "#10b981",
                icon: <Users size={18} />,
              },
              {
                label: "Business workspaces",
                value: formatStat(stats.business),
                subtext: "Organizations",
                accentColor: "#f59e0b",
                icon: <Building2 size={18} />,
              },
            ]}
          />

          <Card className="border-border/60">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="text-base font-semibold">Recent workspaces</CardTitle>
              <span className="text-xs text-muted-foreground">
                {recentWorkspaces.length} newest active
              </span>
            </CardHeader>
            <CardContent className="p-0">
              <ResponsiveTable>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentWorkspaces.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        No active workspaces yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    recentWorkspaces.map((ws) => (
                      <TableRow key={ws.id}>
                        <TableCell>
                          <span className="font-medium text-foreground">{ws.name}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{ws.type}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {ownerLabels.get(ws.owner_user_id) ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(ws.created_at)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                  </TableBody>
                </Table>
              </ResponsiveTable>
            </CardContent>
          </Card>
        </>
      )}
    </DashboardShell>
  );
}
