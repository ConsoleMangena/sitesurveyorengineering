import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Loader2, Check, X } from "lucide-react";

import PageLoader from "@/components/PageLoader.tsx";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/DashboardShell.tsx";

import {
  approveFeatureRequest,
  declineFeatureRequest,
  listFeatureCatalogAdmin,
  listFeatureRequests,
  listProfilesSummary,
  listWorkspaces,
  type FeatureCatalogRowAdmin,
  type FeatureRequestRowAdmin,
  type WorkspaceRowAdmin,
} from "../../lib/repositories/adminPlatform.ts";

interface AdminFeatureRequestsPageProps {
  isPlatformAdmin: boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

function statusVariant(status: string) {
  switch (status) {
    case "pending":
      return "warning";
    case "approved":
      return "success";
    case "declined":
      return "secondary";
    default:
      return "secondary";
  }
}

type StatusFilter = "pending" | "approved" | "declined" | "all";

export default function AdminFeatureRequestsPage({
  isPlatformAdmin,
}: AdminFeatureRequestsPageProps) {
  const [rows, setRows] = useState<FeatureRequestRowAdmin[]>([]);
  const [catalog, setCatalog] = useState<FeatureCatalogRowAdmin[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRowAdmin[]>([]);
  const [requesterLabels, setRequesterLabels] = useState<Map<string, string>>(new Map());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isPlatformAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const [reqs, cat, ws] = await Promise.all([
        listFeatureRequests(statusFilter === "all" ? undefined : statusFilter),
        listFeatureCatalogAdmin(),
        listWorkspaces(),
      ]);
      setRows(reqs);
      setCatalog(cat);
      setWorkspaces(ws);
      const requesterIds = reqs
        .map((r) => r.requested_by)
        .filter((id): id is string => Boolean(id));
      setRequesterLabels(await listProfilesSummary(requesterIds));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load feature requests.");
    } finally {
      setLoading(false);
    }
  }, [isPlatformAdmin, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const featureName = useMemo(() => {
    const map = new Map(catalog.map((f) => [f.key, f.name]));
    return (key: string) => map.get(key) ?? key;
  }, [catalog]);

  const workspaceName = useMemo(() => {
    const map = new Map(workspaces.map((w) => [w.id, w.name]));
    return (id: string) => map.get(id) ?? `${id.slice(0, 8)}…`;
  }, [workspaces]);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2300);
  };

  const handleApprove = async (id: string) => {
    setActingId(id);
    setError(null);
    try {
      await approveFeatureRequest(id);
      flash("Request approved — feature unlocked for the workspace.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to approve request.");
    } finally {
      setActingId(null);
    }
  };

  const handleDecline = async (id: string) => {
    const reason = window.prompt("Reason for declining (optional):") ?? undefined;
    setActingId(id);
    setError(null);
    try {
      await declineFeatureRequest(id, reason);
      flash("Request declined.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to decline request.");
    } finally {
      setActingId(null);
    }
  };

  if (!isPlatformAdmin) return null;

  return (
    <DashboardShell className="hub-body admin-console-page">
      <DashboardHeader
        badge={<Badge variant="secondary">Platform admin</Badge>}
        title="Feature requests"
        subtitle="Review and approve workspace requests for System Features (add-ons)"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            className="gap-2"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {notice}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(["pending", "approved", "declined", "all"] as StatusFilter[]).map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(s)}
            className="capitalize"
          >
            {s}
          </Button>
        ))}
      </div>

      {loading ? (
        <PageLoader compact />
      ) : (
        <Card className="border-border/60 overflow-hidden">
          <CardContent className="p-0">
            <ResponsiveTable>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Feature</TableHead>
                    <TableHead>Requested by</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No requests found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {workspaceName(r.workspace_id)}
                        </TableCell>
                        <TableCell>{featureName(r.feature_key)}</TableCell>
                        <TableCell>
                          {r.requested_by
                            ? requesterLabels.get(r.requested_by) ?? "—"
                            : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(r.created_at)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(r.status)} className="capitalize">
                            {r.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {r.status === "pending" ? (
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                disabled={actingId === r.id}
                                onClick={() => void handleApprove(r.id)}
                                className="gap-1"
                              >
                                {actingId === r.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Check size={14} />
                                )}
                                Accept
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={actingId === r.id}
                                onClick={() => void handleDecline(r.id)}
                                className="gap-1"
                              >
                                {actingId === r.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <X size={14} />
                                )}
                                Decline
                              </Button>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              {r.reviewed_at ? `Reviewed ${formatDate(r.reviewed_at)}` : "—"}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ResponsiveTable>
          </CardContent>
        </Card>
      )}
    </DashboardShell>
  );
}
