import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus,
  Send,
  Save,
  Printer,
  Search,
  FileText,
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
  onChange: (id: string, field: keyof LineItem, value: string | number) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onSave: () => void;
  onExport: () => void;
  onSend: () => void;
}

function QuoteDetail({
  quote,
  items,
  saving,
  onChange,
  onAdd,
  onRemove,
  onSave,
  onExport,
  onSend,
}: QuoteDetailProps) {
  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">{quote.id}</h2>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-muted-foreground">
            <Badge variant={statusVariant(quote.status)}>{quote.status}</Badge>
            <span>Issued: {formatDate(quote.date)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onSave} disabled={saving} className="gap-1">
            {saving ? "Saving..." : <Save size={14} />}
            Save Items
          </Button>
          <Button variant="outline" size="sm" onClick={onExport} className="gap-1">
            <Printer size={14} />
            Export PDF
          </Button>
          {quote.status === "Draft" && (
            <Button size="sm" onClick={onSend} className="gap-1">
              <Send size={14} />
              Send to Client
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Bill To", value: quote.client },
          { label: "Project", value: quote.project },
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

      <div className="rounded-lg border overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[480px]">
          <thead className="bg-muted">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Description</th>
              <th className="text-right px-4 py-2 font-medium">Qty</th>
              <th className="text-right px-4 py-2 font-medium">Unit</th>
              <th className="text-right px-4 py-2 font-medium">Rate ($)</th>
              <th className="text-right px-4 py-2 font-medium">Total</th>
              <th className="px-4 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t">
                <td className="px-4 py-2">
                  <Input
                    value={item.description}
                    onChange={(e) => onChange(item.id, "description", e.target.value)}
                    className="h-8"
                  />
                </td>
                <td className="px-4 py-2">
                  <Input
                    type="number"
                    value={item.qty}
                    onChange={(e) => onChange(item.id, "qty", e.target.value)}
                    className="h-8 text-right"
                  />
                </td>
                <td className="px-4 py-2">
                  <Input
                    value={item.unit}
                    onChange={(e) => onChange(item.id, "unit", e.target.value)}
                    className="h-8 text-right"
                  />
                </td>
                <td className="px-4 py-2">
                  <Input
                    type="number"
                    value={item.rate}
                    onChange={(e) => onChange(item.id, "rate", e.target.value)}
                    className="h-8 text-right"
                  />
                </td>
                <td className="px-4 py-2 text-right font-medium">
                  {formatCurrency((Number(item.qty) || 0) * (Number(item.rate) || 0))}
                </td>
                <td className="px-4 py-2">
                  <Button variant="outline" size="sm" onClick={() => onRemove(item.id)}>
                    ×
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="p-3 border-t">
          <Button variant="outline" size="sm" onClick={onAdd} className="gap-1">
            <Plus size={14} />
            Add Line Item
          </Button>
        </div>
      </div>

      <div className="flex justify-end">
        <div className="w-full max-w-xs space-y-2 text-sm bg-muted/40 rounded-lg p-4">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(calculateTotal(items))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">VAT (15%)</span>
            <span>{formatCurrency(calculateTotal(items) * 0.15)}</span>
          </div>
          <Separator />
          <div className="flex justify-between font-bold">
            <span>Total Amount</span>
            <span>{formatCurrency(calculateTotal(items) * 1.15)}</span>
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

  useEffect(() => {
    void fetchQuotes();
  }, [fetchQuotes]);

  useEffect(() => {
    Promise.all([
      listOrganizations(workspaceId),
      listProjects(workspaceId),
    ]).then(([orgs, projs]) => {
      setOrganizations(orgs);
      setProjectOptions(projs.map((p) => ({ id: p.id, name: p.name })));
    });
  }, [workspaceId]);

  useEffect(() => {
    if (activeQuote) {
      setLocalItems(JSON.parse(JSON.stringify(activeQuote.items)));
    } else {
      setLocalItems([]);
    }
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save items");
    } finally {
      setSaving(false);
    }
  };

  const handleSendToClient = async () => {
    if (!activeQuote) return;
    try {
      await updateQuote(activeQuote.dbId, { status: "sent" });
      await fetchQuotes();
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
        },
        cleanedItems,
      );
      setIsCreateOpen(false);
      setActiveQuote(null);
      await fetchQuotes();
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

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const handleExportPdf = () => {
    if (!activeQuote) return;

    const subtotal = calculateTotal(localItems);
    const vat = subtotal * 0.15;
    const total = subtotal + vat;

    const rows = localItems
      .filter((item) => item.description.trim())
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(item.description)}</td>
            <td class="num">${Number(item.qty) || 0}</td>
            <td>${escapeHtml(item.unit || "—")}</td>
            <td class="num">${formatCurrency(Number(item.rate) || 0)}</td>
            <td class="num">${formatCurrency((Number(item.qty) || 0) * (Number(item.rate) || 0))}</td>
          </tr>`,
      )
      .join("");

    const iframe = document.createElement("iframe");
    iframe.title = `Quotation ${activeQuote.id}`;
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);

    const printDocument = iframe.contentWindow?.document;
    if (!printDocument) {
      iframe.remove();
      setError("Unable to prepare the quotation PDF.");
      return;
    }

    printDocument.open();
    printDocument.write(`<!doctype html>
<html>
<head>
  <title>Quotation ${escapeHtml(activeQuote.id)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #172033; background: #f4f7fb; }
    .page { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 22mm; background: #fff; }
    .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 3px solid #2563eb; padding-bottom: 22px; }
    .brand { display: flex; align-items: center; gap: 14px; }
    .brand img { width: 180px; height: auto; object-fit: contain; }
    .doc-title { text-align: right; }
    .doc-title h1 { margin: 0; font-size: 30px; letter-spacing: 2px; color: #111827; }
    .doc-title p { margin: 6px 0 0; color: #64748b; font-size: 13px; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin: 28px 0; }
    .box { border: 1px solid #dbe3ef; border-radius: 12px; padding: 16px; }
    .label { color: #64748b; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 8px; }
    .value { font-size: 15px; font-weight: 700; color: #172033; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th { background: #eff6ff; color: #1d4ed8; text-align: left; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; padding: 11px 10px; border-bottom: 1px solid #bfdbfe; }
    td { padding: 12px 10px; border-bottom: 1px solid #e5eaf2; font-size: 13px; vertical-align: top; }
    .num { text-align: right; white-space: nowrap; }
    .totals { width: 320px; margin-left: auto; margin-top: 22px; border: 1px solid #dbe3ef; border-radius: 12px; overflow: hidden; }
    .total-row { display: flex; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e5eaf2; font-size: 13px; }
    .total-row:last-child { border-bottom: none; background: #111827; color: #fff; font-size: 16px; font-weight: 800; }
    .footer { margin-top: 42px; padding-top: 16px; border-top: 1px solid #e5eaf2; color: #64748b; font-size: 12px; display: flex; justify-content: space-between; gap: 16px; }
    @page { size: A4; margin: 0; }
    @media print { body { background: #fff; } .page { width: auto; min-height: auto; margin: 0; box-shadow: none; } }
  </style>
</head>
<body>
  <main class="page">
    <header class="header">
      <div class="brand">
        <img src="${window.location.origin}/logo.png" alt="SiteSurveyor" />
      </div>
      <div class="doc-title">
        <h1>QUOTATION</h1>
        <p>${escapeHtml(activeQuote.id)}</p>
      </div>
    </header>

    <section class="meta">
      <div class="box">
        <div class="label">Bill To</div>
        <div class="value">${escapeHtml(activeQuote.client)}</div>
      </div>
      <div class="box">
        <div class="label">Project</div>
        <div class="value">${escapeHtml(activeQuote.project || "—")}</div>
      </div>
      <div class="box">
        <div class="label">Date Issued</div>
        <div class="value">${formatDate(activeQuote.date)}</div>
      </div>
      <div class="box">
        <div class="label">Status</div>
        <div class="value">${escapeHtml(activeQuote.status)}</div>
      </div>
    </section>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="num">Qty</th>
          <th>Unit</th>
          <th class="num">Rate</th>
          <th class="num">Total</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="5">No line items</td></tr>`}</tbody>
    </table>

    <section class="totals">
      <div class="total-row"><span>Subtotal</span><strong>${formatCurrency(subtotal)}</strong></div>
      <div class="total-row"><span>VAT (15%)</span><strong>${formatCurrency(vat)}</strong></div>
      <div class="total-row"><span>Total Amount</span><strong>${formatCurrency(total)}</strong></div>
    </section>

    <footer class="footer">
      <span>SiteSurveyor for Engineers</span>
      <span>Generated ${new Date().toLocaleDateString("en-GB")}</span>
    </footer>
  </main>
</body>
</html>`);
    printDocument.close();

    const printFrame = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      window.setTimeout(() => iframe.remove(), 1000);
    };

    const logo = printDocument.querySelector("img");
    if (logo && !logo.complete) {
      logo.addEventListener("load", printFrame, { once: true });
      logo.addEventListener("error", printFrame, { once: true });
    } else {
      window.setTimeout(printFrame, 100);
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
          <Button onClick={openCreateForm} className="gap-2">
            <Plus size={16} />
            Create Quote
          </Button>
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
                onChange={updateItem}
                onAdd={handleAddLineItem}
                onRemove={handleRemoveLineItem}
                onSave={handleSaveItems}
                onExport={handleExportPdf}
                onSend={handleSendToClient}
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
                  onChange={updateItem}
                  onAdd={handleAddLineItem}
                  onRemove={handleRemoveLineItem}
                  onSave={handleSaveItems}
                  onExport={handleExportPdf}
                  onSend={handleSendToClient}
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

      <Dialog open={isCreateOpen} onOpenChange={(open) => !open && setIsCreateOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Quote</DialogTitle>
            <DialogDescription>Prepare a new estimate for a client.</DialogDescription>
          </DialogHeader>

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
            {draftItems.map((item) => (
              <div key={item.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start">
                <div className="sm:col-span-5">
                  <Input
                    placeholder="Description"
                    value={item.description}
                    onChange={(e) =>
                      setDraftItems((prev) =>
                        prev.map((i) => (i.id === item.id ? { ...i, description: e.target.value } : i)),
                      )
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <Input
                    type="number"
                    placeholder="Qty"
                    value={item.qty}
                    onChange={(e) =>
                      setDraftItems((prev) =>
                        prev.map((i) => (i.id === item.id ? { ...i, qty: Number(e.target.value) } : i)),
                      )
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <Input
                    placeholder="Unit"
                    value={item.unit}
                    onChange={(e) =>
                      setDraftItems((prev) =>
                        prev.map((i) => (i.id === item.id ? { ...i, unit: e.target.value } : i)),
                      )
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <Input
                    type="number"
                    placeholder="Rate"
                    value={item.rate}
                    onChange={(e) =>
                      setDraftItems((prev) =>
                        prev.map((i) => (i.id === item.id ? { ...i, rate: Number(e.target.value) } : i)),
                      )
                    }
                  />
                </div>
                <div className="sm:col-span-1 flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setDraftItems((prev) =>
                        prev.length === 1 ? prev : prev.filter((i) => i.id !== item.id),
                      )
                    }
                    disabled={draftItems.length === 1}
                  >
                    ×
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setDraftItems((prev) => [
                  ...prev,
                  { id: `new-${Date.now()}`, description: "", qty: 1, unit: "Hours", rate: 0 },
                ])
              }
              className="gap-1"
            >
              <Plus size={14} />
              Add Line Item
            </Button>
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

          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitCreateQuote}>Create Quote</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}
