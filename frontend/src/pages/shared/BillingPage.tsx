import { useState, useEffect, useCallback } from "react";
import { Receipt, Banknote, AlertCircle, ExternalLink, Loader2, Plus, Download } from "lucide-react";

import { cn } from "@/lib/utils";
import PageLoader from "@/components/PageLoader.tsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { DashboardHeader, DashboardShell } from "@/components/dashboard/DashboardShell.tsx";
import { DashboardCard } from "@/components/dashboard/DashboardCard.tsx";
import { KpiCard } from "@/components/dashboard/KpiCard.tsx";

import { listInvoices } from "../../lib/repositories/invoices.ts";
import type { InvoiceWithDetails } from "../../lib/repositories/invoices.ts";
import { createPayment, listPayments } from "../../lib/repositories/payments.ts";
import type { PaymentWithInvoice } from "../../lib/repositories/payments.ts";
import {
  deletePaymentMethod,
  listPaymentMethods,
  setDefaultPaymentMethod,
  type PaymentMethodRow,
} from "../../lib/repositories/paymentMethods.ts";
import { hasMinimumRole } from "../../lib/permissions.ts";
import { getMyWorkspaceMembership, type WorkspaceMemberRow } from "../../lib/repositories/workspaces.ts";
import SolanaLogo from "../../components/SolanaLogo.tsx";
import EmbeddedWalletCard from "../../components/EmbeddedWalletCard.tsx";
import { useEmbeddedWallet } from "../../hooks/useEmbeddedWallet.ts";
import {
  estimateUsdcTransferFee,
  payInvoiceWithUsdc,
} from "../../lib/payments/solanaPay.ts";
import { verifySolanaPayment } from "../../lib/payments/verify.ts";
import { isOnChainPaymentConfigured, SOLANA_CLUSTER } from "../../lib/solana/config.ts";
import { saveWalletActivity } from "../../lib/solana/walletHistory.ts";

interface BillingPageProps {
  workspaceId: string;
  /** Workspace managers and platform admins may record/manage payments. */
  isPlatformAdmin?: boolean;
}

export default function BillingPage({
  workspaceId,
  isPlatformAdmin = false,
}: BillingPageProps) {
  const embeddedWallet = useEmbeddedWallet();
  const [activeTab, setActiveTab] = useState<"overview" | "history">("overview");
  const [notice, setNotice] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRow[]>([]);
  const [methodsLoading, setMethodsLoading] = useState(true);
  const [history, setHistory] = useState<PaymentWithInvoice[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceWithDetails[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [membership, setMembership] = useState<WorkspaceMemberRow | null>(null);
  const [isRecordPaymentOpen, setIsRecordPaymentOpen] = useState(false);
  const [recordPaymentError, setRecordPaymentError] = useState<string | null>(null);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [solanaStatus, setSolanaStatus] = useState<
    "idle" | "connecting" | "pending" | "verifying"
  >("idle");
  const [solanaFeeEstimate, setSolanaFeeEstimate] = useState<string | null>(null);
  const [paymentInvoiceId, setPaymentInvoiceId] = useState("");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historySort, setHistorySort] = useState<
    "date-desc" | "date-asc" | "amount-desc"
  >("date-desc");

  const fetchMethods = useCallback(async () => {
    try {
      const data = await listPaymentMethods(workspaceId);
      setPaymentMethods(data);
    } catch {
      setPaymentMethods([]);
    } finally {
      setMethodsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchMethods();
  }, [fetchMethods]);

  const fetchHistory = useCallback(async () => {
    try {
      setHistoryError(null);
      const data = await listPayments(workspaceId);
      setHistory(data);
    } catch (err: unknown) {
      setHistoryError(err instanceof Error ? err.message : "Failed to load billing history");
    } finally {
      setHistoryLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  const fetchInvoices = useCallback(async () => {
    try {
      const data = await listInvoices(workspaceId);
      setInvoices(data);
    } catch {
      setInvoices([]);
    } finally {
      setInvoicesLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchInvoices();
  }, [fetchInvoices]);

  const fetchMembership = useCallback(async () => {
    try {
      const membershipData = await getMyWorkspaceMembership(workspaceId);
      setMembership(membershipData);
    } catch {
      setMembership(null);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchMembership();
  }, [fetchMembership]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2300);
  };

  const formatCurrency = (amount: number) =>
    `$${amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  const setDefaultMethod = async (id: string) => {
    try {
      await setDefaultPaymentMethod(workspaceId, id);
      await fetchMethods();
      showNotice("Default payment method updated.");
    } catch (err: unknown) {
      showNotice(err instanceof Error ? err.message : "Failed to update default.");
    }
  };

  const removeMethod = async (id: string) => {
    try {
      await deletePaymentMethod(id);
      await fetchMethods();
      showNotice("Payment method removed.");
    } catch (err: unknown) {
      showNotice(err instanceof Error ? err.message : "Failed to remove method.");
    }
  };

  const escapeCsv = (value: string | number | null | undefined) => {
    const str = String(value ?? "");
    if (/[",\n]/.test(str)) return `"${str.replaceAll('"', '""')}"`;
    return str;
  };

  const downloadStatementCsv = () => {
    const rows = query ? filteredHistory : history;
    if (rows.length === 0) {
      showNotice("No payment records available to export.");
      return;
    }
    const header = ["paid_on", "invoice_number", "payment_method", "reference", "amount", "notes"];
    const csvRows = rows.map((entry) =>
      [
        entry.paid_on,
        entry.invoice_number,
        entry.payment_method,
        entry.reference,
        entry.amount.toFixed(2),
        entry.notes ?? "",
      ]
        .map(escapeCsv)
        .join(","),
    );
    const csv = [header.join(","), ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `billing-statement-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotice("Statement CSV downloaded.");
  };

  const resetRecordPaymentForm = () => {
    setPaymentInvoiceId("");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPaymentAmount("");
    setPaymentMethod("");
    setPaymentReference("");
    setPaymentNotes("");
    setRecordPaymentError(null);
    setSolanaStatus("idle");
  };

  const submitRecordPayment = async () => {
    if (!paymentInvoiceId) {
      setRecordPaymentError("Please select an invoice.");
      return;
    }
    const parsedAmount = Number(paymentAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setRecordPaymentError("Please enter a valid amount greater than zero.");
      return;
    }
    if (!paymentDate) {
      setRecordPaymentError("Please select a payment date.");
      return;
    }

    try {
      setRecordingPayment(true);
      setRecordPaymentError(null);
      await createPayment(workspaceId, {
        invoice_id: paymentInvoiceId,
        paid_on: paymentDate,
        amount: parsedAmount,
        payment_method: paymentMethod.trim() || null,
        reference: paymentReference.trim() || null,
        notes: paymentNotes.trim() || null,
      });
      await fetchHistory();
      setIsRecordPaymentOpen(false);
      resetRecordPaymentForm();
      showNotice("Payment recorded.");
    } catch (err: unknown) {
      setRecordPaymentError(err instanceof Error ? err.message : "Failed to record payment.");
    } finally {
      setRecordingPayment(false);
    }
  };

  const selectedInvoice = invoices.find((inv) => inv.id === paymentInvoiceId);
  const solanaBusy = solanaStatus !== "idle";
  const solanaConfigured = isOnChainPaymentConfigured();

  const solanaButtonLabel = {
    idle: `Pay with Solana (USDC) on ${SOLANA_CLUSTER}`,
    connecting: "Connecting wallet…",
    pending: "Confirm in wallet…",
    verifying: "Verifying on-chain payment…",
  }[solanaStatus];

  const payWithSolana = async () => {
    if (!selectedInvoice) {
      setRecordPaymentError("Please select an invoice to pay.");
      return;
    }
    setRecordPaymentError(null);
    try {
      setSolanaStatus("connecting");
      const { signature, reference, walletAddress } = await payInvoiceWithUsdc(
        {
          amount: selectedInvoice.total,
          invoiceId: selectedInvoice.id,
        },
        embeddedWallet.unlockedWallet?.keypair,
      );

      setSolanaStatus("verifying");
      const result = await verifySolanaPayment({
        workspaceId,
        invoiceId: selectedInvoice.id,
        signature,
        reference,
        walletAddress,
      });

      saveWalletActivity({
        type: "payment",
        label: `Paid invoice ${selectedInvoice.invoice_number}`,
        signature,
        amount: selectedInvoice.total.toString(),
        token: "USDC",
        detail: selectedInvoice.invoice_number,
        network: SOLANA_CLUSTER,
      });
      await fetchHistory();
      setIsRecordPaymentOpen(false);
      resetRecordPaymentForm();
      showNotice(
        result.alreadyRecorded
          ? "Payment already recorded."
          : "Solana payment confirmed and recorded.",
      );
    } catch (err: unknown) {
      setRecordPaymentError(err instanceof Error ? err.message : "Solana payment failed.");
    } finally {
      setSolanaStatus("idle");
    }
  };

  useEffect(() => {
    if (!selectedInvoice || !solanaConfigured) {
      setSolanaFeeEstimate(null);
      return;
    }
    let cancelled = false;
    setSolanaFeeEstimate("…");
    void estimateUsdcTransferFee(selectedInvoice.total)
      .then((fee) => {
        if (!cancelled) {
          setSolanaFeeEstimate(
            fee > 0
              ? `~${fee.toLocaleString(undefined, { maximumFractionDigits: 6 })} SOL`
              : null,
          );
        }
      })
      .catch(() => {
        if (!cancelled) setSolanaFeeEstimate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedInvoice, solanaConfigured]);

  const canManageBilling = hasMinimumRole(membership?.role, "admin") || isPlatformAdmin;

  const query = historySearch.trim().toLowerCase();
  const filteredHistory = history
    .filter(
      (entry) =>
        !query ||
        (entry.notes ?? "").toLowerCase().includes(query) ||
        (entry.invoice_number ?? "").toLowerCase().includes(query) ||
        (entry.payment_method ?? "").toLowerCase().includes(query),
    )
    .sort((a, b) => {
      if (historySort === "amount-desc") return b.amount - a.amount;
      if (historySort === "date-asc")
        return new Date(a.paid_on).getTime() - new Date(b.paid_on).getTime();
      return new Date(b.paid_on).getTime() - new Date(a.paid_on).getTime();
    });

  const totalCollected = history.reduce((s, p) => s + p.amount, 0);

  return (
    <DashboardShell className="hub-body billing-page finance-page">
      <DashboardHeader
        title="Finance"
        subtitle="Wallet, payments, and transaction history"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={downloadStatementCsv}
              className="gap-2"
            >
              <Download size={16} />
              Export
            </Button>
            {canManageBilling && (
              <Button
                size="sm"
                onClick={() => {
                  resetRecordPaymentForm();
                  setIsRecordPaymentOpen(true);
                }}
                disabled={invoicesLoading || invoices.length === 0}
                className="gap-2"
              >
                <Plus size={16} />
                Record Payment
              </Button>
            )}
          </div>
        }
      />

      {notice && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          title="Payments Recorded"
          value={history.length.toString()}
          subtext="Total transactions"
          icon={<Receipt className="size-3.5" />}
        />
        <KpiCard
          title="Total Collected"
          value={formatCurrency(totalCollected)}
          subtext="Across all payments"
          icon={<Banknote className="size-3.5" />}
        />
        <KpiCard
          title="Outstanding"
          value={formatCurrency(
            invoices
              .filter((inv) => inv.status !== "paid")
              .reduce((s, inv) => s + inv.total, 0),
          )}
          subtext="Unpaid invoices"
          icon={<AlertCircle className="size-3.5" />}
        />
      </div>

      <EmbeddedWalletCard />

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "overview" | "history")}
      >
        <DashboardCard
          title="Billing & Payments"
          icon={<Banknote size={16} />}
          titleAction={
            <TabsList>
              <TabsTrigger value="overview">Saved Methods</TabsTrigger>
              <TabsTrigger value="history">Payment History</TabsTrigger>
            </TabsList>
          }
        >
            <TabsContent value="overview" className="mt-0">
              {methodsLoading ? (
                <PageLoader compact />
              ) : paymentMethods.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No saved payment methods yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {paymentMethods.map((method) => (
                    <Card
                      key={method.id}
                      className={cn(
                        "border-border/60",
                        method.is_default && "border-l-4 border-l-primary",
                      )}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                "h-10 w-10 rounded-lg flex items-center justify-center text-sm font-semibold",
                                method.type === "Card"
                                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200"
                                  : method.type === "Crypto Wallet"
                                    ? "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200"
                                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200",
                              )}
                            >
                              {method.type === "Card"
                                ? method.label.slice(0, 2)
                                : method.type === "Crypto Wallet"
                                  ? <SolanaLogo size={22} />
                                  : "MM"}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold truncate">{method.label}</p>
                              <p className="text-xs text-muted-foreground">{method.type}</p>
                            </div>
                          </div>
                          {method.is_default && <Badge variant="success">Default</Badge>}
                        </div>

                        <p className="mt-3 text-sm font-medium">
                          {method.type === "Crypto Wallet"
                            ? `${method.detail.slice(0, 6)}…${method.detail.slice(-6)}`
                            : method.detail}
                        </p>
                        {method.expiry && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {method.type === "Crypto Wallet"
                              ? `Network: ${method.expiry}`
                              : `Expires ${method.expiry}`}
                          </p>
                        )}
                        {method.holder && (
                          <p className="text-xs text-muted-foreground">{method.holder}</p>
                        )}

                        <div className="flex flex-wrap gap-2 mt-4">
                          {canManageBilling && !method.is_default && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void setDefaultMethod(method.id)}
                            >
                              Set Default
                            </Button>
                          )}
                          {canManageBilling && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void removeMethod(method.id)}
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-0 space-y-4">
              {historyError && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {historyError}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Input
                  placeholder="Search transactions..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  className="max-w-sm"
                />
                <div className="inline-flex flex-wrap gap-2">
                  {[
                    { value: "date-desc", label: "Newest" },
                    { value: "date-asc", label: "Oldest" },
                    { value: "amount-desc", label: "Highest amount" },
                  ].map((opt) => (
                    <Button
                      key={opt.value}
                      variant={historySort === opt.value ? "default" : "outline"}
                      size="sm"
                      onClick={() => setHistorySort(opt.value as typeof historySort)}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>

              {historyLoading ? (
                <PageLoader compact />
              ) : filteredHistory.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  {history.length === 0
                    ? "No payments recorded yet."
                    : "No records match your search."}
                </div>
              ) : (
                <div className="divide-y border rounded-md">
                  {filteredHistory.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">{formatDate(entry.paid_on)}</span>
                          <span className="font-medium">{entry.invoice_number ?? "Payment"}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          {entry.payment_method ?? "Manual"} • {entry.reference ?? "No reference"}
                          {entry.tx_signature && (
                            <>
                              {" • "}
                              <a
                                href={`https://explorer.solana.com/tx/${entry.tx_signature}${
                                  SOLANA_CLUSTER === "mainnet-beta" ? "" : `?cluster=${SOLANA_CLUSTER}`
                                }`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                View on Explorer
                                <ExternalLink size={12} />
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="font-semibold text-sm shrink-0">
                        {formatCurrency(entry.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
        </DashboardCard>
      </Tabs>

      <Dialog
        open={isRecordPaymentOpen}
        onOpenChange={(open) => !open && setIsRecordPaymentOpen(false)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              Record an offline payment or pay on-chain with Solana.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 space-y-1.5">
              <Label>Invoice</Label>
              <Select value={paymentInvoiceId} onValueChange={setPaymentInvoiceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select invoice" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Select invoice</SelectItem>
                  {invoices.map((inv) => (
                    <SelectItem key={inv.id} value={inv.id}>
                      {inv.invoice_number} - {formatCurrency(inv.total)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-date">Date</Label>
              <Input
                id="payment-date"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-amount">Amount</Label>
              <Input
                id="payment-amount"
                type="number"
                min="0"
                step="0.01"
                placeholder="Amount"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-method">Method</Label>
              <Input
                id="payment-method"
                placeholder="Payment method (optional)"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-reference">Reference</Label>
              <Input
                id="payment-reference"
                placeholder="Reference (optional)"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="payment-notes">Notes</Label>
              <Input
                id="payment-notes"
                placeholder="Notes (optional)"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
              />
            </div>
          </div>

          {recordPaymentError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {recordPaymentError}
            </div>
          )}

          {solanaConfigured && (
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={payWithSolana}
                disabled={solanaBusy || recordingPayment || !selectedInvoice || !embeddedWallet.unlocked}
                aria-busy={solanaBusy}
              >
                {solanaBusy && <Loader2 size={16} className="animate-spin" />}
                <SolanaLogo size={18} />
                {solanaButtonLabel}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                {!embeddedWallet.unlocked
                  ? "Unlock your embedded wallet to pay invoices on-chain."
                  : selectedInvoice
                    ? `Pays ${formatCurrency(selectedInvoice.total)} in USDC to the workspace treasury. Verified on-chain before recording.${
                        solanaFeeEstimate ? ` Estimated network fee: ${solanaFeeEstimate}.` : ""
                      }`
                    : "Select an invoice to pay it directly with a Solana wallet."}
              </p>
            </div>
          )}

          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setIsRecordPaymentOpen(false)}
              disabled={recordingPayment || solanaBusy}
            >
              Cancel
            </Button>
            <Button
              onClick={submitRecordPayment}
              disabled={recordingPayment || solanaBusy}
            >
              {recordingPayment && <Loader2 size={14} className="animate-spin mr-2" />}
              {recordingPayment ? "Saving..." : "Save Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}

