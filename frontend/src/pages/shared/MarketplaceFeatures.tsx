import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock, Cpu, Layers, type LucideIcon } from "lucide-react";
import PageLoader from "../../components/PageLoader.tsx";
import { DashboardCard } from "../../components/dashboard/DashboardCard.tsx";
import { KpiCard } from "../../components/dashboard/KpiCard.tsx";
import {
  listWorkspaceFeatureStatuses,
  requestFeature,
  CAD_FEATURE_KEY,
  type WorkspaceFeatureStatus,
} from "../../lib/repositories/features.ts";
import {
  getMyWorkspaceMembership,
  type WorkspaceMemberRow,
} from "../../lib/repositories/workspaces.ts";
import { hasMinimumRole } from "../../lib/permissions.ts";
import { Button } from "../../components/ui/button.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { Card, CardContent } from "../../components/ui/card.tsx";
import { Alert, AlertDescription } from "../../components/ui/alert.tsx";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.tsx";
import { cn } from "../../lib/utils.ts";

interface MarketplaceFeaturesProps {
  workspaceId: string;
  onNavigate?: (view: string) => void;
}

const periodLabel: Record<string, string> = {
  one_time: "one-time",
  monthly: "/ month",
  annual: "/ year",
};

type FeatureFilter = "all" | "active" | "available";

function stateMeta(state: WorkspaceFeatureStatus["state"]): {
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
} {
  switch (state) {
    case "active":
    case "approved":
      return { label: "Active", variant: "default" };
    case "pending":
      return { label: "Pending review", variant: "secondary" };
    case "declined":
      return { label: "Declined", variant: "destructive" };
    default:
      return { label: "Available", variant: "outline" };
  }
}

const featureIconMap: Record<string, LucideIcon> = {
  cad_engine: Cpu,
};

function FeatureIcon({ featureKey }: { featureKey: string }) {
  const Icon = featureIconMap[featureKey] ?? Layers;
  return <Icon className="h-5 w-5" aria-hidden="true" />;
}

function formatPrice(item: WorkspaceFeatureStatus): string {
  if (item.feature.key === CAD_FEATURE_KEY) {
    return "$5 USD / month";
  }
  if (item.feature.price <= 0) return "Free";
  return `$${item.feature.price.toLocaleString()} ${item.feature.currency}${
    periodLabel[item.feature.billing_period] ?? ""
  }`;
}

export default function MarketplaceFeatures({
  workspaceId,
  onNavigate,
}: MarketplaceFeaturesProps) {
  const [items, setItems] = useState<WorkspaceFeatureStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [membership, setMembership] = useState<WorkspaceMemberRow | null>(null);
  const [requestingKey, setRequestingKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<FeatureFilter>("all");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<WorkspaceFeatureStatus | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statuses, member] = await Promise.all([
        listWorkspaceFeatureStatuses(workspaceId),
        getMyWorkspaceMembership(workspaceId).catch(() => null),
      ]);
      setItems(statuses);
      setMembership(member);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load features.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const canRequest = hasMinimumRole(membership?.role, "admin");

  const counts = useMemo(() => {
    let active = 0;
    let pending = 0;
    let available = 0;
    for (const item of items) {
      if (item.state === "active" || item.state === "approved") active += 1;
      else if (item.state === "pending") pending += 1;
      else available += 1;
    }
    return { active, pending, available, total: items.length };
  }, [items]);

  const orderByState = (a: WorkspaceFeatureStatus, b: WorkspaceFeatureStatus) => {
    const rank = (s: WorkspaceFeatureStatus["state"]) => {
      if (s === "active" || s === "approved") return 0;
      if (s === "pending") return 1;
      if (s === "declined") return 3;
      return 2;
    };
    return rank(a.state) - rank(b.state);
  };

  const visibleItems = useMemo(() => {
    let list = items;
    if (filter === "active") {
      list = items.filter((i) => i.state === "active" || i.state === "approved");
    } else if (filter === "available") {
      list = items.filter(
        (i) =>
          i.state !== "active" &&
          i.state !== "approved" &&
          i.state !== "pending",
      );
    }
    return [...list].sort(orderByState);
  }, [items, filter]);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2600);
  };

  const handleRequest = async (key: string) => {
    setRequestingKey(key);
    setError(null);
    try {
      await requestFeature(workspaceId, key);
      flash("Request submitted. A platform administrator will review it.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit request.");
    } finally {
      setRequestingKey(null);
    }
  };

  const renderAction = (item: WorkspaceFeatureStatus | null) => {
    if (!item) return null;
    const { feature, state } = item;

    if (state === "active" || state === "approved") {
      if (feature.key === "cad_engine" && onNavigate) {
        return (
          <Button size="sm" onClick={() => onNavigate("projects")}>
            Open feature
          </Button>
        );
      }
      return (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600">
          <Check className="h-4 w-4" /> Enabled
        </span>
      );
    }

    if (state === "pending") {
      return (
        <Button size="sm" variant="outline" disabled>
          <Clock className="mr-1.5 h-3.5 w-3.5" /> Awaiting approval
        </Button>
      );
    }

    if (!canRequest) {
      return (
        <span className="text-xs text-muted-foreground">
          Ask a workspace admin to request
        </span>
      );
    }

    return (
      <Button
        size="sm"
        disabled={requestingKey === feature.key}
        onClick={() => void handleRequest(feature.key)}
      >
        {requestingKey === feature.key
          ? "Requesting…"
          : state === "declined"
            ? "Request again"
            : "Request access"}
      </Button>
    );
  };

  const openDetail = (item: WorkspaceFeatureStatus) => {
    setDetailItem(item);
    setDetailOpen(true);
  };

  const closeDetail = () => {
    setDetailOpen(false);
    setDetailItem(null);
  };

  if (loading) {
    return <PageLoader compact />;
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert variant="success">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          title="Active"
          value={String(counts.active)}
          subtext="Enabled features"
          icon={<Check className="size-3.5" />}
        />
        <KpiCard
          title="Pending"
          value={String(counts.pending)}
          subtext="Awaiting approval"
          icon={<Clock className="size-3.5" />}
        />
        <KpiCard
          title="Available"
          value={String(counts.available)}
          subtext="Can be requested"
          icon={<Layers className="size-3.5" />}
        />
      </div>

      <DashboardCard
        title="System Features"
        icon={<Cpu size={16} />}
        titleAction={
          <Tabs value={filter} onValueChange={(value) => setFilter(value as FeatureFilter)}>
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="all">All ({counts.total})</TabsTrigger>
              <TabsTrigger value="active">Active ({counts.active})</TabsTrigger>
              <TabsTrigger value="available">Available ({counts.available})</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      >
        {visibleItems.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <Layers className="h-12 w-12 text-muted-foreground/50" />
              <p className="font-medium text-foreground">
                {items.length === 0 ? "No system features available" : "Nothing to show here"}
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {items.length === 0
                  ? "There are no subscribable features in the catalog yet."
                  : "Try a different filter to see more features."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]"></TableHead>
                  <TableHead>Feature</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleItems.map((item) => {
                  const meta = stateMeta(item.state);
                  const isActive = item.state === "active" || item.state === "approved";
                  return (
                    <TableRow
                      key={item.feature.key}
                      className={cn(
                        "cursor-pointer",
                        isActive && "bg-primary/5 hover:bg-primary/10",
                      )}
                      onClick={() => openDetail(item)}
                    >
                      <TableCell>
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-primary">
                          <FeatureIcon featureKey={item.feature.key} />
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">
                        {item.feature.name}
                        {item.feature.description && (
                          <p className="max-w-xs truncate text-xs font-normal text-muted-foreground">
                            {item.feature.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>{item.feature.category}</TableCell>
                      <TableCell>{formatPrice(item)}</TableCell>
                      <TableCell>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DashboardCard>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detailItem && (
                <>
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-primary">
                    <FeatureIcon featureKey={detailItem.feature.key} />
                  </div>
                  {detailItem.feature.name}
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {detailItem?.feature.category}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {detailItem?.feature.description && (
              <p className="text-sm text-muted-foreground">
                {detailItem.feature.description}
              </p>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">Price</p>
                <p className="font-semibold">{detailItem && formatPrice(detailItem)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">Status</p>
                <p className="font-semibold">
                  {detailItem && stateMeta(detailItem.state).label}
                </p>
              </div>
            </div>

            {detailItem?.feature.key === CAD_FEATURE_KEY && (
              <p className="text-sm text-muted-foreground">
                Unlock the Engineering Surveyor CAD workspace for $5 USD per month.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDetail}>
              Close
            </Button>
            {detailItem && renderAction(detailItem)}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
