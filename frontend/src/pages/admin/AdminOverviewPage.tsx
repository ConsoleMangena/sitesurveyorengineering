import React, { useCallback, useEffect, useState } from "react";

import {
  DashboardHeader,
  DashboardShell,
} from "@/components/dashboard/DashboardShell.tsx";
import PageLoader from "@/components/PageLoader.tsx";
import { AdminPlatformDashboard } from "@/features/admin/dashboard/admin-platform-dashboard";
import {
  countProfiles,
  listProfilesSummary,
  listWorkspaces,
  type WorkspaceRowAdmin,
} from "@/lib/repositories/adminPlatform.ts";

interface AdminOverviewPageProps {
  isPlatformAdmin: boolean;
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

  if (!isPlatformAdmin) {
    return null;
  }

  return (
    <DashboardShell className="hub-body admin-console-page">
      <DashboardHeader title="Admin console" subtitle="Platform-wide metrics and workspaces" />

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <PageLoader compact />
      ) : (
        <AdminPlatformDashboard
          workspaces={rows}
          userCount={userCount}
          ownerLabels={ownerLabels}
          loading={loading}
          lastRefreshed={lastRefreshed}
          onRefresh={load}
        />
      )}
    </DashboardShell>
  );
}
