import { useState, useCallback } from "react";
import {
  Download,
  Plus,
  FileText,
  Check,
  CalendarDays,
  Printer,
  Building2,
  Pencil,
  Trash2,
} from "lucide-react";

import PageLoader from "@/components/PageLoader.tsx";
import { useAsyncAction } from "../../hooks/useAsyncAction.ts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { DialogTemplate } from "@/components/templates/DialogTemplate.tsx";
import { PageForm } from "@/components/templates/PageForm.tsx";
import { SuccessDialog } from "@/components/SuccessDialog.tsx";
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
import { LineItemsEditor } from "@/components/finance/LineItemsEditor.tsx";
import { DocumentThemeSelector } from "@/components/finance/DocumentThemeSelector.tsx";
import { BusinessProfileDialog } from "@/components/finance/BusinessProfileDialog.tsx";
import { printDocument } from "@/lib/printDocument.ts";
import { useBusinessProfile, type BusinessProfile } from "@/lib/businessProfile.ts";
import { useDocumentDefaults } from "@/lib/documentDefaults.ts";
import type { DocumentTheme } from "@/lib/printDocument.ts";

interface InvoiceDetailProps {
  invoice: UiInvoice;
  business: BusinessProfile;
  theme: DocumentTheme;
  terms: string;
  onMarkPaid: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSaveNotes: (notes: string) => Promise<void> | void;
  onTermsChange: (value: string) => void;
}

function InvoiceDetail({
  invoice,
  business,
  theme,
  terms,
  onMarkPaid,
  onEdit,
  onDelete,
  onSaveNotes,
  onTermsChange,
}: InvoiceDetailProps) {
  const [draftNotes, setDraftNotes] = useState(invoice.notes);
  const [savingNotes, setSavingNotes] = useState(false);
  const notesChanged = draftNotes !== invoice.notes;

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      await onSaveNotes(draftNotes);
    } finally {
      setSavingNotes(false);
    }
  };
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

  const handlePrint = () => {
    printDocument({
      type: "invoice",
      id: invoice.id,
      status: invoice.status,
      client: invoice.client,
      project: invoice.project,
      date: invoice.date,
      dueDate: invoice.dueDate,
      items: invoice.items.map((item) => ({
        description: item.description,
        qty: item.qty,
        unit: item.unit,
        rate: item.rate,
      })),
      business,
      notes: invoice.notes,
      terms,
      theme,
    });
  };

  const subtotal = calcTotal(invoice.items);
  const vat = subtotal * 0.15;
  const total = subtotal + vat;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{invoice.id}</h2>
          <div className="flex flex-wrap items-center gap-2 mt-1.5 text-sm text-muted-foreground">
            <Badge variant={statusVariant(invoice.status)} className="capitalize">
              {invoice.status}
            </Badge>
            <span className="text-xs">•</span>
            <span>Issued {formatDate(invoice.date)}</span>
            {invoice.dueDate && (
              <>
                <span className="text-xs">•</span>
                <span>Due {formatDate(invoice.dueDate)}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={onEdit} className="gap-1.5">
            <Pencil size={14} />
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete} className="gap-1.5 text-destructive hover:text-destructive">
            <Trash2 size={14} />
            Delete
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5">
            <Printer size={14} />
            Print/PDF
          </Button>
          {invoice.status !== "Paid" && (
            <Button size="sm" onClick={onMarkPaid} className="gap-1.5">
              <Check size={14} />
              Mark Paid
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Bill To", value: invoice.client },
          { label: "Project", value: invoice.project || "—" },
          { label: "Date Issued", value: formatDate(invoice.date) },
          ...(invoice.dueDate ? [{ label: "Due Date", value: formatDate(invoice.dueDate) }] : []),
          ...(invoice.dueDate ? [] : [{ label: "Status", value: invoice.status }]),
        ].map((meta, index) => (
          <div key={`${meta.label}-${index}`} className="rounded-lg border bg-muted/40 p-3">
            <span className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
              {meta.label}
            </span>
            <p className="text-sm font-medium truncate mt-1" title={meta.value}>
              {meta.value}
            </p>
          </div>
        ))}
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:hidden">
          <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="inv-notes" className="text-sm font-medium">
              Notes
            </Label>
            {notesChanged && (
              <Button size="sm" variant="outline" onClick={handleSaveNotes} disabled={savingNotes}>
                {savingNotes ? "Saving..." : "Save notes"}
              </Button>
            )}
          </div>
          <Textarea
            id="inv-notes"
            rows={3}
            value={draftNotes}
            onChange={(e) => setDraftNotes(e.target.value)}
            placeholder="Add any notes visible to the client..."
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="inv-terms" className="text-sm font-medium">
            Terms & Conditions
          </Label>
          <Textarea
            id="inv-terms"
            rows={3}
            value={terms}
            onChange={(e) => onTermsChange(e.target.value)}
            placeholder="Payment terms, late fees, etc."
          />
        </div>
      </div>

      <div className="flex justify-end">
        <div className="w-full max-w-xs space-y-2 text-sm bg-muted/40 rounded-lg p-4">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">VAT (15%)</span>
            <span>{formatCurrency(vat)}</span>
          </div>
          <Separator />
          <div className="flex justify-between font-bold">
            <span>Amount Due</span>
            <span>{formatCurrency(total)}</span>
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
  saveInvoiceItems,
  deleteInvoice,
} from "../../lib/repositories/invoices.ts";
import { listOrganizations } from "../../lib/repositories/organizations.ts";
import { listProjects } from "../../lib/repositories/projects.ts";
import { mapInvoiceRowToUi, reverseStatus, type UiInvoice } from "../../lib/mappers.ts";
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
  status: "draft" | "sent" | "paid" | "overdue";
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
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState<UiInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
  const [formNotes, setFormNotes] = useState("");

  const { profile, setProfile } = useBusinessProfile();
  const { defaults, setTheme, setTerms } = useDocumentDefaults();
  const [businessDialogOpen, setBusinessDialogOpen] = useState(false);

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

  useAsyncAction(fetchInvoices, [fetchInvoices]);

  const loadFormOptions = useCallback(async () => {
    const [orgs, projs] = await Promise.all([
      listOrganizations(workspaceId),
      listProjects(workspaceId),
    ]);
    setOrganizations(orgs);
    setProjectOptions(projs.map((p) => ({ id: p.id, name: p.name })));
  }, [workspaceId]);

  useAsyncAction(loadFormOptions, [loadFormOptions]);

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
      setSuccessMessage("Invoice marked as paid.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to mark as paid");
    }
  };

  const handleSaveNotes = async (notes: string) => {
    if (!activeInvoice) return;
    try {
      await updateInvoice(activeInvoice.dbId, { notes });
      await fetchInvoices();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save notes");
    }
  };

  const openCreateForm = () => {
    setCreateError(null);
    setEditingInvoiceId(null);
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
    setFormNotes("");
    setIsCreateOpen(true);
  };

  const openEditForm = (invoice: UiInvoice) => {
    setCreateError(null);
    setEditingInvoiceId(invoice.dbId);
    setDraftInvoice({
      invoice_number: invoice.id,
      organization_id:
        organizations.find((o) => o.name === invoice.client)?.id ?? "",
      project_id:
        projectOptions.find((p) => p.name === invoice.project)?.id ?? "",
      issue_date: invoice.date,
      due_date: invoice.dueDate,
      status: reverseStatus(invoice.status) as "draft" | "sent",
      items: invoice.items.map((item) => ({
        id: item.id,
        description: item.description,
        qty: item.qty,
        unit: item.unit,
        rate: item.rate,
      })),
    });
    setFormNotes(invoice.notes);
    setIsCreateOpen(true);
  };

  const isEditing = editingInvoiceId !== null;

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

  const confirmDeleteInvoice = (invoice: UiInvoice) => {
    setInvoiceToDelete(invoice);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteInvoice = async () => {
    if (!invoiceToDelete) return;
    try {
      await deleteInvoice(invoiceToDelete.dbId);
      if (activeInvoiceId === invoiceToDelete.dbId) {
        setActiveInvoiceId(null);
      }
      setInvoiceToDelete(null);
      setDeleteConfirmOpen(false);
      await fetchInvoices();
      setSuccessMessage("Invoice deleted successfully.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete invoice");
      setDeleteConfirmOpen(false);
    }
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
      if (isEditing && editingInvoiceId) {
        await updateInvoice(editingInvoiceId, {
          invoice_number: draftInvoice.invoice_number.trim(),
          organization_id: draftInvoice.organization_id || null,
          project_id: draftInvoice.project_id || null,
          issue_date: draftInvoice.issue_date,
          due_date: draftInvoice.due_date || null,
          status: draftInvoice.status,
          notes: formNotes || null,
        });
        await saveInvoiceItems(
          workspaceId,
          editingInvoiceId,
          cleanedItems.map((item) => ({
            description: item.description,
            qty: Number(item.qty) || 0,
            rate: Number(item.rate) || 0,
            unit: item.unit || null,
          })),
        );
      } else {
        await createInvoice(
          workspaceId,
          {
            invoice_number: draftInvoice.invoice_number.trim(),
            organization_id: draftInvoice.organization_id || null,
            project_id: draftInvoice.project_id || null,
            issue_date: draftInvoice.issue_date,
            due_date: draftInvoice.due_date || null,
            status: draftInvoice.status,
            notes: formNotes || null,
          },
          cleanedItems.map((item) => ({
            description: item.description,
            qty: Number(item.qty) || 0,
            rate: Number(item.rate) || 0,
            unit: item.unit || null,
          })),
        );
      }
      setIsCreateOpen(false);
      setEditingInvoiceId(null);
      setActiveInvoiceId(null);
      await fetchInvoices();
      setSuccessMessage(
        isEditing ? "Invoice updated successfully." : "Invoice created successfully.",
      );
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Failed to save invoice");
    }
  };

  if (loading) {
    return (
      <div className="hub-body invoices-page p-6">
        <PageLoader />
      </div>
    );
  }

  if (isCreateOpen) {
    return (
      <PageForm
        title={isEditing ? "Edit Invoice" : "Create Invoice"}
        description={
          isEditing
            ? "Update the invoice details and line items."
            : "Issue a new invoice to a client."
        }
        onBack={() => {
          setIsCreateOpen(false);
          setEditingInvoiceId(null);
        }}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateOpen(false);
                setEditingInvoiceId(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={submitCreateInvoice}>
              {isEditing ? "Save Changes" : "Create Invoice"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                setDraftInvoice((prev) => ({ ...prev, status: v as InvoiceDraft["status"] }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-3">
          <Label>Line items</Label>
          <LineItemsEditor
            items={draftInvoice.items}
            onChange={updateDraftItem}
            onAdd={addDraftItem}
            onRemove={removeDraftItem}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="create-inv-notes">Notes</Label>
            <Textarea
              id="create-inv-notes"
              rows={3}
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="Notes visible to the client"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-inv-terms">Terms & Conditions</Label>
            <Textarea
              id="create-inv-terms"
              rows={3}
              value={defaults.terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="Payment terms, late fees, etc."
            />
          </div>
        </div>

        <div className="flex items-center justify-between border-t pt-4">
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
      </PageForm>
    );
  }

  if (businessDialogOpen) {
    return (
      <BusinessProfileDialog
        open={businessDialogOpen}
        onOpenChange={setBusinessDialogOpen}
        profile={profile}
        onSave={setProfile}
      />
    );
  }

  return (
    <DashboardShell className="hub-body invoices-page">
      <DashboardHeader
        title="Invoices"
        subtitle="Track payments, issue bills, and manage revenue"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DocumentThemeSelector
              value={defaults.theme}
              onChange={setTheme}
              className="w-[130px]"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBusinessDialogOpen(true)}
              className="gap-1.5"
            >
              <Building2 size={14} />
              Business
            </Button>
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
              <InvoiceDetail
                key={activeInvoice.dbId}
                invoice={activeInvoice}
                business={profile}
                theme={defaults.theme}
                terms={defaults.terms}
                onMarkPaid={markInvoicePaid}
                onEdit={() => openEditForm(activeInvoice)}
                onDelete={() => confirmDeleteInvoice(activeInvoice)}
                onSaveNotes={handleSaveNotes}
                onTermsChange={setTerms}
              />
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
                <InvoiceDetail
                  key={activeInvoice.dbId}
                  invoice={activeInvoice}
                  business={profile}
                  theme={defaults.theme}
                  terms={defaults.terms}
                  onMarkPaid={markInvoicePaid}
                  onEdit={() => openEditForm(activeInvoice)}
                  onDelete={() => confirmDeleteInvoice(activeInvoice)}
                  onSaveNotes={handleSaveNotes}
                  onTermsChange={setTerms}
                />
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

      <DialogTemplate
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete Invoice?"
        description={`This will permanently remove ${invoiceToDelete?.id ?? "this invoice"} and all its line items. This action cannot be undone.`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteInvoice}>
              Delete
            </Button>
          </>
        }
      >
        <></>
      </DialogTemplate>

      <BusinessProfileDialog
        open={businessDialogOpen}
        onOpenChange={setBusinessDialogOpen}
        profile={profile}
        onSave={setProfile}
      />

      <SuccessDialog
        open={!!successMessage}
        onOpenChange={() => setSuccessMessage(null)}
        message={successMessage ?? ""}
      />
    </DashboardShell>
  );
}
