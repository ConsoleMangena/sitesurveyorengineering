import { useState, useEffect, useCallback } from "react";
import {
  Download,
  Plus,
  FileText,
  Check,
  CalendarDays,
} from "lucide-react";

import PageLoader from "@/components/PageLoader.tsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
import { DashboardHeader, DashboardShell } from "@/components/dashboard/DashboardShell.tsx";
import { MetricStrip } from "@/components/dashboard/MetricStrip.tsx";

function InvoiceDetail({
  invoice,
  onMarkPaid,
}: {
  invoice: UiInvoice;
  onMarkPaid: () => void;
}) {
  const calcTotal = (items: InvoiceLineItem[]) =>
    items.reduce((s, item) => s + Number(item.qty) * Number(item.rate), 0);
  const formatCurrency = (value: number) =>
    `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatDate = (isoDate: string) =>
    new Date(isoDate).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">{invoice.id}</h2>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-muted-foreground">
            <Badge variant={statusVariant(invoice.status)}>{invoice.status}</Badge>
            <span>Issued: {formatDate(invoice.date)}</span>
            {invoice.dueDate && <span>• Due: {formatDate(invoice.dueDate)}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-2">
            <FileText size={14} />
            PDF
          </Button>
          {invoice.status !== "Paid" && (
            <Button size="sm" onClick={onMarkPaid} className="gap-2">
              <Check size={14} />
              Mark Paid
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-muted/40 p-4">
          <span className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
            Bill To
          </span>
          <p className="font-semibold mt-1">{invoice.client}</p>
          <p className="text-sm text-muted-foreground">Project: {invoice.project}</p>
        </div>
        <div className="rounded-lg border bg-muted/40 p-4">
          <span className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
            From
          </span>
          <p className="font-semibold mt-1">SiteSurveyor User</p>
          <p className="text-sm text-muted-foreground">Harare, Zimbabwe</p>
        </div>
      </div>

      <div className="rounded-lg border overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[480px]">
          <thead className="bg-muted">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Description</th>
              <th className="text-right px-4 py-2 font-medium">Qty</th>
              <th className="text-right px-4 py-2 font-medium">Unit</th>
              <th className="text-right px-4 py-2 font-medium">Rate ($)</th>
              <th className="text-right px-4 py-2 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item) => (
              <tr key={item.id} className="border-t">
                <td className="px-4 py-2">{item.description}</td>
                <td className="px-4 py-2 text-right">{item.qty}</td>
                <td className="px-4 py-2 text-right">{item.unit}</td>
                <td className="px-4 py-2 text-right">{formatCurrency(item.rate)}</td>
                <td className="px-4 py-2 text-right font-medium">
                  {formatCurrency(item.qty * item.rate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <div className="w-full max-w-xs space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(calcTotal(invoice.items))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">VAT (15%)</span>
            <span>{formatCurrency(calcTotal(invoice.items) * 0.15)}</span>
          </div>
          <Separator />
          <div className="flex justify-between font-bold">
            <span>Amount Due</span>
            <span>{formatCurrency(calcTotal(invoice.items) * 1.15)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

import {
  listInvoices,
  getInvoiceWithItems,
  createInvoice,
  updateInvoice,
} from "../../lib/repositories/invoices.ts";
import { listOrganizations } from "../../lib/repositories/organizations.ts";
import { listProjects } from "../../lib/repositories/projects.ts";
import { mapInvoiceRowToUi, type UiInvoice } from "../../lib/mappers.ts";
import type { OrganizationRow } from "../../lib/repositories/organizations.ts";
import { cn } from "@/lib/utils";

interface InvoiceLineItem {
  id: string;
  description: string;
  qty: number;
  unit: string;
  rate: number;
}

interface InvoiceDraft {
  invoice_number: string;
  organization_id: string;
  project_id: string;
  issue_date: string;
  due_date: string;
  status: "draft" | "sent";
  items: InvoiceLineItem[];
}

interface InvoicesPageProps {
  workspaceId: string;
}

function defaultInvoiceDates(): { issueDate: string; dueDate: string } {
  const now = Date.now();
  return {
    issueDate: new Date(now).toISOString().slice(0, 10),
    dueDate: new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  };
}

function statusVariant(status: string) {
  switch (status.toLowerCase()) {
    case "paid":
      return "success";
    case "sent":
      return "default";
    case "overdue":
      return "destructive";
    case "draft":
    default:
      return "secondary";
  }
}

export default function InvoicesPage({ workspaceId }: InvoicesPageProps) {
  const [invoices, setInvoices] = useState<UiInvoice[]>([]);
  const [filter, setFilter] = useState<"all" | "Draft" | "Sent" | "Paid" | "Overdue">("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<
    "issued-desc" | "issued-asc" | "due-asc" | "amount-desc"
  >("issued-desc");
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [organizations, setOrganizations] = useState<OrganizationRow[]>([]);
  const [projectOptions, setProjectOptions] = useState<{ id: string; name: string }[]>([]);

  const [draftInvoice, setDraftInvoice] = useState<InvoiceDraft>(() => {
    const { issueDate, dueDate } = defaultInvoiceDates();
    return {
      invoice_number: "",
      organization_id: "",
      project_id: "",
      issue_date: issueDate,
      due_date: dueDate,
      status: "draft",
      items: [{ id: "new-1", description: "", qty: 1, unit: "Lump Sum", rate: 0 }],
    };
  });

  const fetchInvoices = useCallback(async () => {
    try {
      setError(null);
      const rows = await listInvoices(workspaceId);
      const mapped: UiInvoice[] = [];
      for (const row of rows) {
        const detail = await getInvoiceWithItems(row.id);
        mapped.push(mapInvoiceRowToUi(row, detail?.items ?? []));
      }
      setInvoices(mapped);
      if (mapped.length > 0 && !activeInvoiceId) {
        setActiveInvoiceId(mapped[0].dbId);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, activeInvoiceId]);

  useEffect(() => {
    void fetchInvoices();
  }, [fetchInvoices]);

  useEffect(() => {
    Promise.all([listOrganizations(workspaceId), listProjects(workspaceId)]).then(
      ([orgs, projs]) => {
        setOrganizations(orgs);
        setProjectOptions(projs.map((p) => ({ id: p.id, name: p.name })));
      },
    );
  }, [workspaceId]);

  const calcTotal = (items: InvoiceLineItem[]) =>
    items.reduce((s, item) => s + Number(item.qty) * Number(item.rate), 0);

  const formatCurrency = (value: number) =>
    `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const formatDate = (isoDate: string) =>
    new Date(isoDate).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  const escapeCsv = (value: string | number | null | undefined) => {
    const str = String(value ?? "");
    if (/[",\n]/.test(str)) return `"${str.replaceAll('"', '""')}"`;
    return str;
  };

  const downloadInvoicesCsv = () => {
    const rows = sortedInvoices;
    if (rows.length === 0) return;
    const header = [
      "invoice_number",
      "client",
      "project",
      "status",
      "issued",
      "due",
      "subtotal",
      "vat",
      "total",
    ];
    const csvRows = rows.map((inv) => {
      const subtotal = calcTotal(inv.items);
      const vat = subtotal * 0.15;
      const total = subtotal + vat;
      return [
        inv.id,
        inv.client,
        inv.project,
        inv.status,
        inv.date,
        inv.dueDate ?? "",
        subtotal.toFixed(2),
        vat.toFixed(2),
        total.toFixed(2),
      ]
        .map(escapeCsv)
        .join(",");
    });
    const csv = [header.join(","), ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredByStatus =
    filter === "all" ? invoices : invoices.filter((i) => i.status === filter);
  const searchQuery = search.trim().toLowerCase();
  const filtered = filteredByStatus.filter(
    (inv) =>
      !searchQuery ||
      inv.id.toLowerCase().includes(searchQuery) ||
      inv.client.toLowerCase().includes(searchQuery) ||
      inv.project.toLowerCase().includes(searchQuery),
  );

  const sortedInvoices = [...filtered].sort((a, b) => {
    if (sortBy === "due-asc")
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    if (sortBy === "amount-desc") return calcTotal(b.items) - calcTotal(a.items);
    if (sortBy === "issued-asc")
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  const activeInvoice =
    sortedInvoices.find((inv) => inv.dbId === activeInvoiceId) ?? sortedInvoices[0] ?? null;

  const totals = {
    outstanding: invoices
      .filter((i) => i.status === "Sent" || i.status === "Overdue")
      .reduce((s, i) => s + calcTotal(i.items), 0),
    overdue: invoices
      .filter((i) => i.status === "Overdue")
      .reduce((s, i) => s + calcTotal(i.items), 0),
    collected: invoices
      .filter((i) => i.status === "Paid")
      .reduce((s, i) => s + calcTotal(i.items), 0),
  };

  const markInvoicePaid = async () => {
    if (!activeInvoice) return;
    try {
      await updateInvoice(activeInvoice.dbId, {
        status: "paid",
        paid_at: new Date().toISOString(),
      });
      await fetchInvoices();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to mark as paid");
    }
  };

  const openCreateForm = () => {
    setCreateError(null);
    const { issueDate, dueDate } = defaultInvoiceDates();
    setDraftInvoice({
      invoice_number: "",
      organization_id: "",
      project_id: "",
      issue_date: issueDate,
      due_date: dueDate,
      status: "draft",
      items: [
        { id: `new-${Date.now()}`, description: "", qty: 1, unit: "Lump Sum", rate: 0 },
      ],
    });
    setIsCreateOpen(true);
  };

  const updateDraftItem = (
    id: string,
    field: keyof InvoiceLineItem,
    value: string | number,
  ) => {
    setDraftInvoice((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.id === id ? { ...item, [field]: value } : item,
      ),
    }));
  };

  const addDraftItem = () => {
    setDraftInvoice((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        { id: `new-${Date.now()}`, description: "", qty: 1, unit: "Hours", rate: 0 },
      ],
    }));
  };

  const removeDraftItem = (id: string) => {
    setDraftInvoice((prev) => ({
      ...prev,
      items: prev.items.length === 1 ? prev.items : prev.items.filter((item) => item.id !== id),
    }));
  };

  const submitCreateInvoice = async () => {
    if (!draftInvoice.invoice_number.trim()) {
      setCreateError("Invoice number is required.");
      return;
    }

    const cleanedItems = draftInvoice.items
      .map((item) => ({ ...item, description: item.description.trim() }))
      .filter((item) => item.description.length > 0);

    if (cleanedItems.length === 0) {
      setCreateError("Add at least one line item description.");
      return;
    }

    try {
      await createInvoice(
        workspaceId,
        {
          invoice_number: draftInvoice.invoice_number.trim(),
          organization_id: draftInvoice.organization_id || null,
          project_id: draftInvoice.project_id || null,
          issue_date: draftInvoice.issue_date,
          due_date: draftInvoice.due_date || null,
          status: draftInvoice.status,
        },
        cleanedItems.map((item) => ({
          description: item.description,
          qty: Number(item.qty) || 0,
          rate: Number(item.rate) || 0,
          unit: item.unit || null,
        })),
      );
      setIsCreateOpen(false);
      setActiveInvoiceId(null);
      await fetchInvoices();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Failed to create invoice");
    }
  };

  if (loading) {
    return (
      <div className="hub-body invoices-page p-6">
        <PageLoader />
      </div>
    );
  }

  return (
    <DashboardShell className="hub-body invoices-page">
      <DashboardHeader
        title="Invoices"
        subtitle="Track payments, issue bills, and manage revenue"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={downloadInvoicesCsv}
              disabled={sortedInvoices.length === 0}
              className="gap-2"
            >
              <Download size={16} />
              Export CSV
            </Button>
            <Button onClick={openCreateForm} className="gap-2">
              <Plus size={16} />
              Create Invoice
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <MetricStrip
        metrics={[
          {
            label: "Outstanding",
            value: formatCurrency(totals.outstanding),
            subtext: "unpaid invoices",
            accentColor: "#f59e0b",
            icon: <FileText size={18} />,
          },
          {
            label: "Overdue",
            value: formatCurrency(totals.overdue),
            subtext: "past due",
            accentColor: "#ef4444",
            icon: <CalendarDays size={18} />,
          },
          {
            label: "Collected",
            value: formatCurrency(totals.collected),
            subtext: "paid invoices",
            accentColor: "#22c55e",
            icon: <Check size={18} />,
          },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "Draft", "Sent", "Paid", "Overdue"] as const).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All Invoices" : f}
          </Button>
        ))}
        <div className="relative w-full sm:flex-1 sm:min-w-0 max-w-md">
          <Input
            type="search"
            placeholder="Search invoice, client, project..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="issued-desc">Newest issued</SelectItem>
            <SelectItem value="issued-asc">Oldest issued</SelectItem>
            <SelectItem value="due-asc">Due soonest</SelectItem>
            <SelectItem value="amount-desc">Highest amount</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 h-[600px]">
        <Card className="border-border/60 overflow-hidden flex flex-col">
          <CardContent className="p-0 overflow-y-auto flex-1">
            {sortedInvoices.map((inv) => {
              const sum = calcTotal(inv.items);
              return (
                <button
                  key={inv.dbId}
                  type="button"
                  onClick={() => {
                    setActiveInvoiceId(inv.dbId);
                    setMobileDetailOpen(true);
                  }}
                  className={cn(
                    "w-full text-left px-4 py-3 border-b last:border-b-0 transition-colors hover:bg-muted/50",
                    activeInvoice?.dbId === inv.dbId && "bg-muted",
                  )}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-semibold truncate" title={inv.id}>{inv.id}</span>
                    <Badge variant={statusVariant(inv.status)}>{inv.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground truncate" title={inv.client}>{inv.client}</div>
                  <div className="text-xs text-muted-foreground truncate" title={inv.project}>{inv.project}</div>
                  <div className="flex items-center justify-between mt-2 text-xs">
                    <span className="text-muted-foreground">{formatDate(inv.date)}</span>
                    <span
                      className={cn(
                        "font-semibold",
                        inv.status === "Paid" && "text-emerald-600",
                        inv.status === "Overdue" && "text-red-600",
                      )}
                    >
                      {formatCurrency(sum)}
                    </span>
                  </div>
                </button>
              );
            })}
            {sortedInvoices.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <p className="font-medium text-foreground">
                  {invoices.length === 0 ? "No invoices yet" : "No invoices match"}
                </p>
                <p>
                  {invoices.length === 0
                    ? "Create your first invoice to start tracking revenue."
                    : "Try adjusting your filters or search."}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60 overflow-hidden hidden lg:flex lg:flex-col">
          <CardContent className="p-0 flex-1 overflow-y-auto">
            {activeInvoice ? (
              <InvoiceDetail invoice={activeInvoice} onMarkPaid={markInvoicePaid} />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3 p-8">
                <FileText size={48} />
                <h3 className="text-base font-semibold text-foreground">
                  {sortedInvoices.length === 0 ? "No invoices to display" : "No Invoice Selected"}
                </h3>
                <p className="text-sm text-center">
                  {sortedInvoices.length === 0
                    ? "Create a new invoice or change your filters."
                    : "Select an invoice from the left to view details."}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Sheet open={mobileDetailOpen} onOpenChange={setMobileDetailOpen}>
          <SheetContent side="bottom" className="h-[92vh] p-0 flex flex-col">
            <SheetHeader className="border-b p-4 text-left">
              <SheetTitle>Invoice Details</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto">
              {activeInvoice ? (
                <InvoiceDetail invoice={activeInvoice} onMarkPaid={markInvoicePaid} />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3 p-8">
                  <FileText size={48} />
                  <h3 className="text-base font-semibold text-foreground">No invoice selected</h3>
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={(open) => !open && setIsCreateOpen(false)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Invoice</DialogTitle>
            <DialogDescription>Issue a new invoice to a client.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="inv-number">Invoice number</Label>
              <Input
                id="inv-number"
                placeholder="e.g. INV-2026-020"
                value={draftInvoice.invoice_number}
                onChange={(e) =>
                  setDraftInvoice((prev) => ({ ...prev, invoice_number: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Client</Label>
              <Select
                value={draftInvoice.organization_id}
                onValueChange={(v) =>
                  setDraftInvoice((prev) => ({ ...prev, organization_id: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Client" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Select Client</SelectItem>
                  {organizations.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Project</Label>
              <Select
                value={draftInvoice.project_id}
                onValueChange={(v) =>
                  setDraftInvoice((prev) => ({ ...prev, project_id: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Select Project (optional)</SelectItem>
                  {projectOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-issue">Issue date</Label>
              <Input
                id="inv-issue"
                type="date"
                value={draftInvoice.issue_date}
                onChange={(e) =>
                  setDraftInvoice((prev) => ({ ...prev, issue_date: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-due">Due date</Label>
              <Input
                id="inv-due"
                type="date"
                value={draftInvoice.due_date}
                onChange={(e) =>
                  setDraftInvoice((prev) => ({ ...prev, due_date: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={draftInvoice.status}
                onValueChange={(v) =>
                  setDraftInvoice((prev) => ({ ...prev, status: v as "draft" | "sent" }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <Label>Line items</Label>
            {draftInvoice.items.map((item) => (
              <div key={item.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start">
                <div className="sm:col-span-5">
                  <Input
                    placeholder="Description"
                    value={item.description}
                    onChange={(e) =>
                      updateDraftItem(item.id, "description", e.target.value)
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <Input
                    type="number"
                    placeholder="Qty"
                    value={item.qty}
                    onChange={(e) =>
                      updateDraftItem(item.id, "qty", Number(e.target.value))
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <Input
                    placeholder="Unit"
                    value={item.unit}
                    onChange={(e) =>
                      updateDraftItem(item.id, "unit", e.target.value)
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <Input
                    type="number"
                    placeholder="Rate"
                    value={item.rate}
                    onChange={(e) =>
                      updateDraftItem(item.id, "rate", Number(e.target.value))
                    }
                  />
                </div>
                <div className="sm:col-span-1 flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => removeDraftItem(item.id)}
                    disabled={draftInvoice.items.length === 1}
                  >
                    ×
                  </Button>
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addDraftItem} className="gap-2">
              <Plus size={14} />
              Add Line Item
            </Button>
          </div>

          <div className="flex justify-between items-center border-t pt-4">
            <div className="text-sm">
              <span className="text-muted-foreground">Total:</span>{" "}
              <strong>{formatCurrency(calcTotal(draftInvoice.items) * 1.15)}</strong>
            </div>
            {createError && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {createError}
              </div>
            )}
          </div>

          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitCreateInvoice}>Create Invoice</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}
