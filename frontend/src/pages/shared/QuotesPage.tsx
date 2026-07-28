import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus,
  Send,
  Save,
  Printer,
  Search,
  FileText,
  Building2,
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
import { SendPreviewDialog } from "@/components/finance/SendPreviewDialog.tsx";
import { printDocument } from "@/lib/printDocument.ts";
import { useBusinessProfile } from "@/lib/businessProfile.ts";
import { useDocumentDefaults } from "@/lib/documentDefaults.ts";
import { cn } from "@/lib/utils";

import {
  listQuotes,
  getQuoteWithItems,
  createQuote,
  updateQuote,
  saveQuoteItems,
} from "../../lib/repositories/quotes.ts";
import { listOrganizations } from "../../lib/repositories/organizations.ts";
import { listProjects } from "../../lib/repositories/projects.ts";
import type { OrganizationRow } from "../../lib/repositories/organizations.ts";
import { mapQuoteRowToUi, type UiQuote } from "../../lib/mappers.ts";

interface LineItem {
  id: string;
  description: string;
  qty: number;
  unit: string;
  rate: number;
}

function statusVariant(status: string) {
  switch (status.toLowerCase()) {
    case "accepted":
      return "success";
    case "sent":
      return "default";
    case "declined":
      return "destructive";
    case "draft":
    default:
      return "secondary";
  }
}

function calculateTotal(items: LineItem[]) {
  return items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.rate) || 0), 0);
}

function formatCurrency(value: number) {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(isoDate: string) {
  return new Date(isoDate).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

interface QuoteDetailProps {
  quote: UiQuote;
  items: LineItem[];
  saving: boolean;
  savingNotes: boolean;
  notes: string;
  terms: string;
  onChange: (id: string, field: keyof LineItem, value: string | number) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onSave: () => void;
  onExport: () => void;
  onSend: () => void;
  onNotesChange: (value: string) => void;
  onSaveNotes: () => void;
  onTermsChange: (value: string) => void;
}

function QuoteDetail({
  quote,
  items,
  saving,
  savingNotes,
  notes,
  terms,
  onChange,
  onAdd,
  onRemove,
  onSave,
  onExport,
  onSend,
  onNotesChange,
  onSaveNotes,
  onTermsChange,
}: QuoteDetailProps) {
  const subtotal = calculateTotal(items);
  const vat = subtotal * 0.15;
  const total = subtotal + vat;
  const notesChanged = notes !== (quote.notes ?? "");

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{quote.id}</h2>
          <div className="flex flex-wrap items-center gap-2 mt-1.5 text-sm text-muted-foreground">
            <Badge variant={statusVariant(quote.status)} className="capitalize">
              {quote.status}
            </Badge>
            <span className="text-xs">•</span>
            <span>Issued {formatDate(quote.date)}</span>
            {quote.expiresOn && (
              <>
                <span className="text-xs">•</span>
                <span>Expires {formatDate(quote.expiresOn)}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={onSave} disabled={saving} className="gap-1.5">
            {saving ? "Saving..." : <Save size={14} />}
            Save Items
          </Button>
          <Button variant="outline" size="sm" onClick={onExport} className="gap-1.5">
            <Printer size={14} />
            Print/PDF
          </Button>
          {quote.status === "Draft" && (
            <Button size="sm" onClick={onSend} className="gap-1.5">
              <Send size={14} />
              Send to Client
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Bill To", value: quote.client },
          { label: "Project", value: quote.project || "—" },
          { label: "Date Issued", value: formatDate(quote.date) },
          { label: "Status", value: quote.status },
        ].map((meta) => (
          <div key={meta.label} className="rounded-lg border bg-muted/40 p-3">
            <span className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
              {meta.label}
            </span>
            <p className="text-sm font-medium truncate mt-1" title={meta.value}>
              {meta.value}
            </p>
          </div>
        ))}
      </div>

      <LineItemsEditor
        items={items}
        onChange={onChange}
        onAdd={onAdd}
        onRemove={onRemove}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:hidden">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="quote-notes" className="text-sm font-medium">
              Notes
            </Label>
            {notesChanged && (
              <Button size="sm" variant="outline" onClick={onSaveNotes} disabled={savingNotes}>
                {savingNotes ? "Saving..." : "Save notes"}
              </Button>
            )}
          </div>
          <Textarea
            id="quote-notes"
            rows={3}
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="Add any notes visible to the client..."
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="quote-terms" className="text-sm font-medium">
            Terms & Conditions
          </Label>
          <Textarea
            id="quote-terms"
            rows={3}
            value={terms}
            onChange={(e) => onTermsChange(e.target.value)}
            placeholder="Payment terms, validity, etc."
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
            <span>Total Amount</span>
            <span>{formatCurrency(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function QuotesPage({ workspaceId }: { workspaceId: string }) {
  const [quotes, setQuotes] = useState<UiQuote[]>([]);
  const [activeQuote, setActiveQuote] = useState<UiQuote | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [localItems, setLocalItems] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<"all" | "Draft" | "Sent" | "Accepted" | "Declined">("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"issued-desc" | "issued-asc" | "amount-desc">("issued-desc");

  const [organizations, setOrganizations] = useState<OrganizationRow[]>([]);
  const [projectOptions, setProjectOptions] = useState<{ id: string; name: string }[]>([]);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    quote_number: "",
    organization_id: "",
    project_id: "",
    issue_date: new Date().toISOString().slice(0, 10),
    expires_on: "",
  });
  const [draftItems, setDraftItems] = useState<LineItem[]>([
    { id: "new-1", description: "", qty: 1, unit: "Hours", rate: 0 },
  ]);
  const [draftNotes, setDraftNotes] = useState("");

  const { profile, setProfile } = useBusinessProfile();
  const { defaults, setTheme, setTerms } = useDocumentDefaults();
  const [businessDialogOpen, setBusinessDialogOpen] = useState(false);
  const [sendPreviewOpen, setSendPreviewOpen] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  const fetchQuotes = useCallback(async () => {
    try {
      setError(null);
      const rows = await listQuotes(workspaceId);
      const mapped: UiQuote[] = [];
      for (const row of rows) {
        const detail = await getQuoteWithItems(row.id);
        mapped.push(mapQuoteRowToUi(row, detail?.items ?? []));
      }
      setQuotes(mapped);
      if (mapped.length > 0 && !activeQuote) {
        setActiveQuote(mapped[0]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load quotes");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, activeQuote]);

  useAsyncAction(fetchQuotes, [fetchQuotes]);

  const loadFormOptions = useCallback(async () => {
    const [orgs, projs] = await Promise.all([
      listOrganizations(workspaceId),
      listProjects(workspaceId),
    ]);
    setOrganizations(orgs);
    setProjectOptions(projs.map((p) => ({ id: p.id, name: p.name })));
  }, [workspaceId]);

  useAsyncAction(loadFormOptions, [loadFormOptions]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setLocalItems(activeQuote ? JSON.parse(JSON.stringify(activeQuote.items)) : []);
      setDraftNotes(activeQuote?.notes ?? "");
    }, 0);
    return () => window.clearTimeout(id);
  }, [activeQuote]);

  const updateItem = (id: string, field: keyof LineItem, value: string | number) => {
    setLocalItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
  };

  const handleAddLineItem = () => {
    setLocalItems([
      ...localItems,
      { id: Date.now().toString(), description: "", qty: 1, unit: "Hours", rate: 0 },
    ]);
  };

  const handleRemoveLineItem = (id: string) => {
    setLocalItems((prev) => prev.filter((item) => item.id !== id));
  };

  const updateDraftItem = (id: string, field: keyof LineItem, value: string | number) => {
    setDraftItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
  };

  const handleSaveItems = async () => {
    if (!activeQuote) return;
    setSaving(true);
    try {
      const cleaned = localItems
        .filter((item) => item.description.trim().length > 0)
        .map((item) => ({
          description: item.description.trim(),
          qty: Number(item.qty) || 0,
          rate: Number(item.rate) || 0,
          unit: item.unit || null,
        }));
      await saveQuoteItems(workspaceId, activeQuote.dbId, cleaned);
      await fetchQuotes();
      setSuccessMessage("Quote items saved successfully.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save items");
    } finally {
      setSaving(false);
    }
  };

  const openSendPreview = () => {
    if (!activeQuote) return;
    setSendPreviewOpen(true);
  };

  const handleSendToClient = async (_message: string) => {
    if (!activeQuote) return;
    try {
      await updateQuote(activeQuote.dbId, { status: "sent" });
      setSendPreviewOpen(false);
      await fetchQuotes();
      setSuccessMessage("Quote marked as sent.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    }
  };

  const openCreateForm = () => {
    setCreateError(null);
    const today = new Date().toISOString().slice(0, 10);
    const plus30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    setDraft({
      quote_number: "",
      organization_id: "",
      project_id: "",
      issue_date: today,
      expires_on: plus30,
    });
    setDraftItems([
      { id: `new-${Date.now()}`, description: "", qty: 1, unit: "Hours", rate: 0 },
    ]);
    setDraftNotes("");
    setIsCreateOpen(true);
  };

  const submitCreateQuote = async () => {
    if (!draft.quote_number.trim()) {
      setCreateError("Quote number is required.");
      return;
    }
    const cleanedItems = draftItems
      .filter((item) => item.description.trim().length > 0)
      .map((item) => ({
        description: item.description.trim(),
        qty: Number(item.qty) || 0,
        rate: Number(item.rate) || 0,
        unit: item.unit || null,
      }));
    if (cleanedItems.length === 0) {
      setCreateError("Add at least one line item.");
      return;
    }

    try {
      await createQuote(
        workspaceId,
        {
          quote_number: draft.quote_number.trim(),
          organization_id: draft.organization_id || null,
          project_id: draft.project_id || null,
          issue_date: draft.issue_date,
          expires_on: draft.expires_on || null,
          status: "draft",
          notes: draftNotes || null,
        },
        cleanedItems,
      );
      setIsCreateOpen(false);
      setActiveQuote(null);
      await fetchQuotes();
      setSuccessMessage("Quote created successfully.");
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Failed to create quote");
    }
  };

  const filteredQuotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return quotes.filter((quote) => {
      if (filter !== "all" && quote.status !== filter) return false;
      if (!q) return true;
      return (
        quote.id.toLowerCase().includes(q) ||
        quote.client.toLowerCase().includes(q) ||
        quote.project.toLowerCase().includes(q)
      );
    });
  }, [quotes, filter, search]);

  const sortedQuotes = useMemo(() => {
    const list = [...filteredQuotes];
    if (sortBy === "amount-desc") {
      return list.sort((a, b) => calculateTotal(b.items) - calculateTotal(a.items));
    }
    if (sortBy === "issued-asc") {
      return list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }
    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [filteredQuotes, sortBy]);

  const quoteStats = useMemo(() => {
    const draftCount = quotes.filter((q) => q.status === "Draft").length;
    const acceptedTotal = quotes
      .filter((q) => q.status === "Accepted")
      .reduce((sum, q) => sum + calculateTotal(q.items), 0);
    const average = quotes.length
      ? quotes.reduce((sum, q) => sum + calculateTotal(q.items), 0) / quotes.length
      : 0;
    return {
      total: quotes.length,
      draft: draftCount,
      acceptedTotal,
      average,
    };
  }, [quotes]);

  const handleExportPdf = () => {
    if (!activeQuote) return;
    printDocument({
      type: "quote",
      id: activeQuote.id,
      status: activeQuote.status,
      client: activeQuote.client,
      project: activeQuote.project,
      date: activeQuote.date,
      expiryDate: activeQuote.expiresOn,
      items: activeQuote.items.map((item) => ({
        description: item.description,
        qty: item.qty,
        unit: item.unit,
        rate: item.rate,
      })),
      business: profile,
      notes: activeQuote.notes,
      terms: defaults.terms,
      theme: defaults.theme,
    });
  };

  const handleSaveNotes = async () => {
    if (!activeQuote) return;
    setSavingNotes(true);
    try {
      await updateQuote(activeQuote.dbId, { notes: draftNotes });
      await fetchQuotes();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save notes");
    } finally {
      setSavingNotes(false);
    }
  };

  if (loading) {
    return (
      <div className="hub-body quotes-page p-6">
        <PageLoader />
      </div>
    );
  }

  return (
    <DashboardShell className="hub-body quotes-page">
      <DashboardHeader
        title="Quotes"
        subtitle="Manage estimates, compute surveying fees, and issue proposals"
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
            <Button onClick={openCreateForm} className="gap-2">
              <Plus size={16} />
              Create Quote
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
            label: "Total Quotes",
            value: quoteStats.total.toString(),
            subtext: "all estimates",
            accentColor: "#8b5cf6",
            icon: <FileText size={18} />,
          },
          {
            label: "Drafts",
            value: quoteStats.draft.toString(),
            subtext: "not yet sent",
            accentColor: "#f59e0b",
            icon: <FileText size={18} />,
          },
          {
            label: "Accepted Value",
            value: formatCurrency(quoteStats.acceptedTotal),
            subtext: "won business",
            accentColor: "#22c55e",
            icon: <FileText size={18} />,
          },
          {
            label: "Average Quote",
            value: formatCurrency(quoteStats.average),
            subtext: "per estimate",
            accentColor: "#3b82f6",
            icon: <FileText size={18} />,
          },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "Draft", "Sent", "Accepted", "Declined"] as const).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All Quotes" : f}
          </Button>
        ))}
        <div className="relative w-full sm:flex-1 sm:min-w-0 max-w-md">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search quote, client, project..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="issued-desc">Newest first</SelectItem>
            <SelectItem value="issued-asc">Oldest first</SelectItem>
            <SelectItem value="amount-desc">Highest total</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 h-[600px]">
        <Card className="border-border/60 overflow-hidden flex flex-col">
          <CardContent className="p-0 overflow-y-auto flex-1">
            {sortedQuotes.map((quote) => {
              const total = calculateTotal(quote.items);
              return (
                <button
                  key={quote.dbId}
                  type="button"
                  onClick={() => {
                    setActiveQuote(quote);
                    setMobileDetailOpen(true);
                  }}
                  className={cn(
                    "w-full text-left px-4 py-3 border-b last:border-b-0 transition-colors hover:bg-muted/50",
                    activeQuote?.dbId === quote.dbId && "bg-muted",
                  )}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-semibold truncate" title={quote.id}>{quote.id}</span>
                    <Badge variant={statusVariant(quote.status)}>{quote.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground truncate" title={quote.client}>{quote.client}</div>
                  <div className="text-xs text-muted-foreground truncate" title={quote.project}>{quote.project}</div>
                  <div className="flex items-center justify-between mt-2 text-xs">
                    <span className="text-muted-foreground">{formatDate(quote.date)}</span>
                    <span className="font-semibold">{formatCurrency(total)}</span>
                  </div>
                </button>
              );
            })}
            {sortedQuotes.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <p className="font-medium text-foreground">
                  {quotes.length === 0 ? "No quotes yet" : "No quotes match"}
                </p>
                <p>
                  {quotes.length === 0
                    ? "Create your first quote to start tracking estimates."
                    : "Try adjusting your filters or search."}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60 overflow-hidden hidden lg:flex lg:flex-col">
          <CardContent className="p-0 flex-1 overflow-y-auto">
            {activeQuote ? (
              <QuoteDetail
                quote={activeQuote}
                items={localItems}
                saving={saving}
                savingNotes={savingNotes}
                notes={draftNotes}
                terms={defaults.terms}
                onChange={updateItem}
                onAdd={handleAddLineItem}
                onRemove={handleRemoveLineItem}
                onSave={handleSaveItems}
                onExport={handleExportPdf}
                onSend={openSendPreview}
                onNotesChange={setDraftNotes}
                onSaveNotes={handleSaveNotes}
                onTermsChange={setTerms}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3 p-8">
                <FileText size={48} />
                <h3 className="text-base font-semibold text-foreground">
                  {sortedQuotes.length === 0 ? "No quotes to display" : "No Quote Selected"}
                </h3>
                <p className="text-sm text-center">
                  {sortedQuotes.length === 0
                    ? "Create a new quote or change your filters."
                    : "Select an estimate from the left to view or edit."}
                </p>
                {sortedQuotes.length === 0 && (
                  <Button onClick={openCreateForm}>Create Quote</Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Sheet open={mobileDetailOpen} onOpenChange={setMobileDetailOpen}>
          <SheetContent side="bottom" className="h-[92vh] p-0 flex flex-col">
            <SheetHeader className="border-b p-4 text-left">
              <SheetTitle>Quote Details</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto">
              {activeQuote ? (
                <QuoteDetail
                  quote={activeQuote}
                  items={localItems}
                  saving={saving}
                  savingNotes={savingNotes}
                  notes={draftNotes}
                  terms={defaults.terms}
                  onChange={updateItem}
                  onAdd={handleAddLineItem}
                  onRemove={handleRemoveLineItem}
                  onSave={handleSaveItems}
                  onExport={handleExportPdf}
                  onSend={openSendPreview}
                  onNotesChange={setDraftNotes}
                  onSaveNotes={handleSaveNotes}
                  onTermsChange={setTerms}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3 p-8">
                  <FileText size={48} />
                  <h3 className="text-base font-semibold text-foreground">No quote selected</h3>
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <DialogTemplate
        open={isCreateOpen}
        onOpenChange={(open) => !open && setIsCreateOpen(false)}
        title="Create Quote"
        description="Prepare a new estimate for a client."
        size="full"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitCreateQuote}>Create Quote</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="quote-number">Quote number</Label>
            <Input
              id="quote-number"
              placeholder="e.g. EST-2026-053"
              value={draft.quote_number}
              onChange={(e) => setDraft({ ...draft, quote_number: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Client</Label>
            <Select
              value={draft.organization_id}
              onValueChange={(v) => setDraft({ ...draft, organization_id: v })}
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
              value={draft.project_id}
              onValueChange={(v) => setDraft({ ...draft, project_id: v })}
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
            <Label htmlFor="quote-issue">Issue date</Label>
            <Input
              id="quote-issue"
              type="date"
              value={draft.issue_date}
              onChange={(e) => setDraft({ ...draft, issue_date: e.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="quote-expires">Expires on</Label>
            <Input
              id="quote-expires"
              type="date"
              placeholder="Expires on"
              value={draft.expires_on}
              onChange={(e) => setDraft({ ...draft, expires_on: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-3">
          <Label>Line items</Label>
          <LineItemsEditor
            items={draftItems}
            onChange={updateDraftItem}
            onAdd={() =>
              setDraftItems((prev) => [
                ...prev,
                { id: `new-${Date.now()}`, description: "", qty: 1, unit: "Hours", rate: 0 },
              ])
            }
            onRemove={(id) =>
              setDraftItems((prev) => (prev.length === 1 ? prev : prev.filter((i) => i.id !== id)))
            }
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="create-notes">Notes</Label>
            <Textarea
              id="create-notes"
              rows={3}
              value={draftNotes}
              onChange={(e) => setDraftNotes(e.target.value)}
              placeholder="Notes visible to the client"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-terms">Terms & Conditions</Label>
            <Textarea
              id="create-terms"
              rows={3}
              value={defaults.terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="Payment terms, validity, etc."
            />
          </div>
        </div>

        <div className="flex justify-between items-center border-t pt-4">
          <div className="text-sm">
            <span className="text-muted-foreground">Total:</span>{" "}
            <strong>{formatCurrency(calculateTotal(draftItems) * 1.15)}</strong>
          </div>
          {createError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {createError}
            </div>
          )}
        </div>
      </DialogTemplate>

      <BusinessProfileDialog
        open={businessDialogOpen}
        onOpenChange={setBusinessDialogOpen}
        profile={profile}
        onSave={setProfile}
      />

      {activeQuote && (
        <SendPreviewDialog
          open={sendPreviewOpen}
          onOpenChange={setSendPreviewOpen}
          documentId={activeQuote.id}
          clientName={activeQuote.client}
          documentType="quote"
          onSend={handleSendToClient}
        />
      )}

      <SuccessDialog
        open={!!successMessage}
        onOpenChange={() => setSuccessMessage(null)}
        message={successMessage ?? ""}
      />
    </DashboardShell>
  );
}
