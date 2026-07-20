import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock, Cpu, Layers, type LucideIcon } from "lucide-react";
import PageLoader from "../../components/PageLoader.tsx";
import {
  listWorkspaceFeatureStatuses,
  requestFeature,
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
import { Separator } from "../../components/ui/separator.tsx";
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
  return <Icon className="h-6 w-6" aria-hidden="true" />;
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

  const renderAction = (item: WorkspaceFeatureStatus) => {
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

      {items.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <span className="text-sm text-muted-foreground">Active</span>
              <span className="text-2xl font-semibold text-foreground">{counts.active}</span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <span className="text-sm text-muted-foreground">Pending</span>
              <span className="text-2xl font-semibold text-foreground">{counts.pending}</span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <span className="text-sm text-muted-foreground">Available</span>
              <span className="text-2xl font-semibold text-foreground">{counts.available}</span>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs value={filter} onValueChange={(value) => setFilter(value as FeatureFilter)}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="all">All ({counts.total})</TabsTrigger>
          <TabsTrigger value="active">Active ({counts.active})</TabsTrigger>
          <TabsTrigger value="available">Available ({counts.available})</TabsTrigger>
        </TabsList>
      </Tabs>

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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleItems.map((item) => {
            const meta = stateMeta(item.state);
            const isActive = item.state === "active" || item.state === "approved";
            const isPending = item.state === "pending";
            return (
              <Card
                key={item.feature.key}
                className={cn(
                  "flex flex-col transition-all",
                  isActive && "border-primary/50",
                )}
              >
                <CardContent className="flex flex-1 flex-col gap-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
                      <FeatureIcon featureKey={item.feature.key} />
                    </div>
                    <Badge variant={meta.variant}>
                      {isActive ? <Check className="mr-1 h-3 w-3" /> : isPending ? <Clock className="mr-1 h-3 w-3" /> : null}
                      {meta.label}
                    </Badge>
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{item.feature.name}</h3>
                    {item.feature.category && (
                      <p className="text-sm text-muted-foreground">{item.feature.category}</p>
                    )}
                    {item.feature.description && (
                      <p className="mt-2 text-sm text-muted-foreground">{item.feature.description}</p>
                    )}
                  </div>
                  <div className="mt-auto pt-2">
                    <p className="text-lg font-semibold text-foreground">
                      {item.feature.price > 0
                        ? `$${item.feature.price.toLocaleString()}`
                        : "Free"}{" "}
                      {item.feature.price > 0 && (
                        <span className="text-xs font-normal text-muted-foreground">
                          {item.feature.currency}{" "}
                          {periodLabel[item.feature.billing_period] ?? ""}
                        </span>
                      )}
                    </p>
                    <Separator className="my-3" />
                    {renderAction(item)}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
