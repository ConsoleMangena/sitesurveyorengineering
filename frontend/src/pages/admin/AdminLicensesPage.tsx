import { useCallback, useEffect, useState } from "react";
import { Search, RefreshCw, Plus, Loader2, KeyRound } from "lucide-react";
import type { Edition } from "../../services/license.ts";

import PageLoader from "@/components/PageLoader.tsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  createLicense,
  listLicenses,
  updateLicense,
  type AdminLicense,
  type LicenseStatus,
} from "../../services/licenseAdmin.ts";
import {
  listAllProfiles,
  type AdminProfileRow,
} from "../../lib/repositories/adminPlatform.ts";

interface AdminLicensesPageProps {
  isPlatformAdmin: boolean;
}

const PAGE_SIZE = 20;

const EDITIONS: { value: Edition; label: string }[] = [
  { value: "starter", label: "Starter" },
  { value: "business", label: "Business" },
  { value: "enterprise", label: "Enterprise" },
];

const STATUSES: { value: LicenseStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "cancelled", label: "Cancelled" },
];

function getStatusVariant(status: LicenseStatus) {
  switch (status) {
    case "active":
      return "success";
    case "suspended":
      return "warning";
    case "cancelled":
      return "secondary";
    default:
      return "secondary";
  }
}

function getEditionVariant(edition: Edition) {
  switch (edition) {
    case "enterprise":
      return "purple";
    case "business":
      return "default";
    default:
      return "secondary";
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function defaultExpireDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split("T")[0];
}

function parseFeatures(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export default function AdminLicensesPage({ isPlatformAdmin }: AdminLicensesPageProps) {
  const [licenses, setLicenses] = useState<AdminLicense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<LicenseStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [profiles, setProfiles] = useState<AdminProfileRow[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    customer_email: "",
    edition: "starter" as Edition,
    seats: 1,
    features: "",
    expires_at: defaultExpireDate(),
    grace_days: 14,
    notes: "",
  });

  const [selected, setSelected] = useState<AdminLicense | null>(null);
  const [updating, setUpdating] = useState(false);
  const [extendDate, setExtendDate] = useState("");
  const [seatsDraft, setSeatsDraft] = useState(1);
  const [editionDraft, setEditionDraft] = useState<Edition>("starter");
  const [featuresDraft, setFeaturesDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2600);
  };

  const load = useCallback(async () => {
    if (!isPlatformAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listLicenses({
        search: search.trim(),
        status: statusFilter === "all" ? undefined : statusFilter,
        page,
        page_size: PAGE_SIZE,
      });
      setLicenses(result.licenses);
      setTotal(result.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load licenses.");
    } finally {
      setLoading(false);
    }
  }, [isPlatformAdmin, search, statusFilter, page]);

  const loadProfiles = useCallback(async () => {
    if (!isPlatformAdmin) return;
    setProfilesLoading(true);
    try {
      const data = await listAllProfiles();
      setProfiles(data.filter((p) => Boolean(p.email)));
    } catch {
      setProfiles([]);
    } finally {
      setProfilesLoading(false);
    }
  }, [isPlatformAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  useEffect(() => {
    if (selected) {
      setExtendDate(selected.expires_at.split("T")[0]);
      setSeatsDraft(selected.seats);
      setEditionDraft(selected.edition);
      setFeaturesDraft(selected.features?.join(", ") ?? "");
      setNotesDraft(selected.notes ?? "");
    }
  }, [selected]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const result = await createLicense({
        customer_email: createForm.customer_email.trim().toLowerCase(),
        edition: createForm.edition,
        seats: Number(createForm.seats) || 1,
        features: parseFeatures(createForm.features),
        expires_at: createForm.expires_at,
        grace_days: Number.isFinite(Number(createForm.grace_days))
          ? Number(createForm.grace_days)
          : 14,
        notes: createForm.notes.trim() || undefined,
      });
      setCreatedKey(result.key);
      flash("License created successfully.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create license.");
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async (change: Parameters<typeof updateLicense>[1]) => {
    if (!selected) return;
    setUpdating(true);
    setError(null);
    try {
      await updateLicense(selected.id, change);
      flash("License updated.");
      await load();
      const refreshed = licenses.find((l) => l.id === selected.id);
      if (refreshed) setSelected(refreshed);
      else setSelected(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update license.");
    } finally {
      setUpdating(false);
    }
  };

  const closeCreate = () => {
    setShowCreate(false);
    setCreatedKey(null);
    setCreateForm({
      customer_email: "",
      edition: "starter",
      seats: 1,
      features: "",
      expires_at: defaultExpireDate(),
      grace_days: 14,
      notes: "",
    });
  };

  if (!isPlatformAdmin) {
    return (
      <DashboardShell className="hub-body admin-console-page">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Platform administrator access is required.
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell className="hub-body admin-console-page">
      <DashboardHeader
        badge={<Badge variant="secondary">Platform admin</Badge>}
        title="License management"
        subtitle="Create, view, and manage SiteSurveyor licenses"
        actions={
          <div className="flex gap-2">
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
            <Button
              size="sm"
              onClick={() => {
                closeCreate();
                setShowCreate(true);
              }}
              className="gap-2"
            >
              <Plus size={16} />
              Create license
            </Button>
          </div>
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

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex flex-wrap gap-2">
          <Button
            variant={statusFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter("all")}
          >
            All
          </Button>
          {STATUSES.map((s) => (
            <Button
              key={s.value}
              variant={statusFilter === s.value ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s.value)}
            >
              {s.label}
            </Button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            placeholder="Search by email or license key…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {loading ? (
        <PageLoader compact />
      ) : (
        <>
          <Card className="border-border/60 overflow-hidden">
            <CardContent className="p-0">
              <ResponsiveTable>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>License key</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Edition</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Seats</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {licenses.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="text-center py-8 text-muted-foreground"
                        >
                          No licenses found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      licenses.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell>
                            <code className="text-xs">{l.license_key}</code>
                          </TableCell>
                          <TableCell>{l.customer_email ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant={getEditionVariant(l.edition)}>
                              {l.edition}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={getStatusVariant(l.status)}>{l.status}</Badge>
                          </TableCell>
                          <TableCell>
                            {l.seats_used ?? 0} / {l.seats}
                          </TableCell>
                          <TableCell>{formatDate(l.expires_at)}</TableCell>
                          <TableCell>{formatDate(l.created_at)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelected(l)}
                            >
                              Manage
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ResponsiveTable>
            </CardContent>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Previous
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
                Next
              </Button>
            </div>
          )}
        </>
      )}

      {/* Create License Modal */}
      <Dialog open={showCreate} onOpenChange={(open) => !open && closeCreate()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound size={18} />
              Create license
            </DialogTitle>
            <DialogDescription>Issue a new subscription license.</DialogDescription>
          </DialogHeader>

          {createdKey ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                License created.
              </div>
              <div className="space-y-1.5">
                <Label>License key</Label>
                <Input readOnly value={createdKey} onFocus={(e) => e.target.select()} />
              </div>
              <p className="text-sm text-muted-foreground">
                Copy this key and deliver it to the customer.
              </p>
              <DialogFooter>
                <Button onClick={closeCreate}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="customer_email">Allocate to user *</Label>
                {profilesLoading ? (
                  <p className="text-sm text-muted-foreground">Loading users…</p>
                ) : profiles.length === 0 ? (
                  <Input
                    id="customer_email"
                    type="email"
                    required
                    placeholder="customer@example.com"
                    value={createForm.customer_email}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, customer_email: e.target.value }))
                    }
                  />
                ) : (
                  <Select
                    value={createForm.customer_email}
                    onValueChange={(v) =>
                      setCreateForm((f) => ({ ...f, customer_email: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a user…" />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        { value: "", label: "Select a user…" },
                        ...profiles
                          .filter((p) => p.email)
                          .sort((a, b) =>
                            (a.full_name ?? a.email!).localeCompare(b.full_name ?? b.email!),
                          )
                          .map((p) => ({
                            value: p.email!,
                            label: `${p.full_name ? `${p.full_name} · ` : ""}${p.email}`,
                          })),
                      ].map((opt) => (
                        <SelectItem key={opt.value || "__placeholder"} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {createForm.customer_email && (() => {
                const matches = licenses.filter(
                  (l) =>
                    l.customer_email?.toLowerCase() ===
                    createForm.customer_email.toLowerCase(),
                );
                if (matches.length === 0) return null;
                const latest = [...matches].sort(
                  (a, b) =>
                    new Date(b.created_at).getTime() -
                    new Date(a.created_at).getTime(),
                )[0];
                return (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950">
                    <p className="text-amber-800 dark:text-amber-200">
                      This account already has {matches.length} saved license
                      {matches.length > 1 ? "s" : ""}.
                    </p>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-amber-700 dark:text-amber-300"
                      onClick={() =>
                        setCreateForm((f) => ({
                          ...f,
                          edition: latest.edition,
                          seats: latest.seats,
                          features: latest.features.join(", "),
                          expires_at:
                            latest.expires_at?.slice(0, 10) ?? f.expires_at,
                          grace_days: latest.grace_days,
                          notes: latest.notes ?? "",
                        }))
                      }
                    >
                      Use this license
                    </Button>
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Edition</Label>
                  <Select
                    value={createForm.edition}
                    onValueChange={(v) =>
                      setCreateForm((f) => ({ ...f, edition: v as Edition }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EDITIONS.map((e) => (
                        <SelectItem key={e.value} value={e.value}>
                          {e.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="seats">Seats</Label>
                  <Input
                    id="seats"
                    type="number"
                    min={1}
                    max={1000}
                    value={createForm.seats}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, seats: Number(e.target.value) }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="features">Features (comma separated)</Label>
                <Input
                  id="features"
                  placeholder="e.g. lidar_import, advanced_cad"
                  value={createForm.features}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, features: e.target.value }))
                  }
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="expires_at">Expires at *</Label>
                  <Input
                    id="expires_at"
                    type="date"
                    required
                    value={createForm.expires_at}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, expires_at: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="grace_days">Grace days</Label>
                  <Input
                    id="grace_days"
                    type="number"
                    min={0}
                    max={90}
                    value={createForm.grace_days}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, grace_days: Number(e.target.value) }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <textarea
                  id="notes"
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  value={createForm.notes}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, notes: e.target.value }))
                  }
                />
              </div>

              <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
                <Button type="button" variant="outline" onClick={closeCreate}>
                  Cancel
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating ? "Creating…" : "Create license"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Manage License Modal */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage license</DialogTitle>
            <DialogDescription>
              {selected && (
                <>
                  {selected.license_key} · {selected.customer_email ?? "No customer"}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground">Edition</span>
                  <p className="font-medium mt-0.5">
                    <Badge variant={getEditionVariant(selected.edition)}>
                      {selected.edition}
                    </Badge>
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Status</span>
                  <p className="font-medium mt-0.5">
                    <Badge variant={getStatusVariant(selected.status)}>
                      {selected.status}
                    </Badge>
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Seats</span>
                  <p className="font-medium mt-0.5">
                    {selected.seats_used ?? 0} / {selected.seats} used
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Expires</span>
                  <p className="font-medium mt-0.5">{formatDateTime(selected.expires_at)}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Grace period</span>
                  <p className="font-medium mt-0.5">{selected.grace_days} days</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Created</span>
                  <p className="font-medium mt-0.5">{formatDateTime(selected.created_at)}</p>
                </div>
                {selected.notes && (
                  <div className="col-span-2 sm:col-span-3">
                    <span className="text-xs text-muted-foreground">Notes</span>
                    <p className="font-medium mt-0.5">{selected.notes}</p>
                  </div>
                )}
              </div>

              {selected.bound_devices.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">Bound devices</h4>
                  <Card>
                    <CardContent className="p-0 overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Fingerprint</TableHead>
                            <TableHead className="text-xs">Last seen</TableHead>
                            <TableHead className="text-xs">Bound</TableHead>
                            <TableHead className="text-xs text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selected.bound_devices.map((device) => (
                            <TableRow key={device.id}>
                              <TableCell className="text-xs">
                                <code>{device.fingerprint.slice(0, 24)}…</code>
                              </TableCell>
                              <TableCell className="text-xs">
                                {formatDateTime(device.last_seen_at)}
                              </TableCell>
                              <TableCell className="text-xs">
                                {formatDateTime(device.created_at)}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={updating}
                                  onClick={() => {
                                    if (!window.confirm("Unbind this device?")) return;
                                    void handleUpdate({
                                      action: "unbind_seat",
                                      seat_id: device.id,
                                    });
                                  }}
                                >
                                  Unbind
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </div>
              )}

              <div className="space-y-4">
                <h4 className="text-sm font-semibold">Actions</h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Change edition</Label>
                    <div className="flex gap-2">
                      <Select
                        value={editionDraft}
                        onValueChange={(v) => setEditionDraft(v as Edition)}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EDITIONS.map((e) => (
                            <SelectItem key={e.value} value={e.value}>
                              {e.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={updating || editionDraft === selected.edition}
                        onClick={() =>
                          handleUpdate({ action: "set_edition", edition: editionDraft })
                        }
                      >
                        Save
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Change seats</Label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        min={1}
                        max={1000}
                        value={seatsDraft}
                        onChange={(e) => setSeatsDraft(Number(e.target.value))}
                        className="flex-1"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={updating || seatsDraft === selected.seats}
                        onClick={() =>
                          handleUpdate({ action: "set_seats", seats: seatsDraft })
                        }
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Extend expiry</Label>
                  <div className="flex gap-2 max-w-sm">
                    <Input
                      type="date"
                      value={extendDate}
                      onChange={(e) => setExtendDate(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={updating || !extendDate}
                      onClick={() =>
                        handleUpdate({ action: "extend", expires_at: extendDate })
                      }
                    >
                      Extend
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Features (comma separated)</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="e.g. lidar_import, advanced_cad"
                      value={featuresDraft}
                      onChange={(e) => setFeaturesDraft(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={updating}
                      onClick={() =>
                        handleUpdate({
                          action: "set_features",
                          features: parseFeatures(featuresDraft),
                        })
                      }
                    >
                      Save
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Notes</Label>
                  <div className="flex gap-2">
                    <textarea
                      rows={2}
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      className="flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={updating || notesDraft === (selected.notes ?? "")}
                      onClick={() =>
                        handleUpdate({ action: "set_notes", notes: notesDraft })
                      }
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="flex-col-reverse sm:flex-row gap-2 sm:justify-between">
            <div className="flex flex-col-reverse sm:flex-row gap-2 w-full sm:w-auto">
              {selected && selected.status !== "active" && (
                <Button
                  onClick={() => handleUpdate({ action: "reactivate" })}
                  disabled={updating}
                >
                  {updating ? <Loader2 size={14} className="animate-spin" /> : null}
                  Reactivate
                </Button>
              )}
              {selected && selected.status !== "suspended" && (
                <Button
                  variant="outline"
                  onClick={() => handleUpdate({ action: "suspend" })}
                  disabled={updating}
                >
                  Suspend
                </Button>
              )}
              {selected && selected.status !== "cancelled" && (
                <Button
                  variant="outline"
                  disabled={updating}
                  onClick={() => {
                    if (!window.confirm("Revoke this license? This cannot be undone.")) return;
                    handleUpdate({ action: "revoke" });
                  }}
                >
                  Revoke
                </Button>
              )}
            </div>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}
