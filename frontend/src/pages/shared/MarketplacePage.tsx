import { useState, useEffect, useCallback } from "react";
import {
  Package,
  Layers,
  Search,
  Plus,
  X,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import {
  createMarketplaceListing,
  deleteMarketplaceListing,
  listMarketplaceListings,
  updateMarketplaceListing,
  type MarketplaceListingRow,
  type MarketplaceListingWithAsset,
} from "../../lib/repositories/marketplace.ts";
import {
  createMarketplaceRequest,
  hasPendingRequest,
} from "../../lib/repositories/marketplaceRequests.ts";
import { notifyMarketplaceRequest } from "../../lib/repositories/notificationEvents.ts";
import { getWorkspaceById } from "../../lib/repositories/workspaces.ts";
import SelectDropdown from "../../components/SelectDropdown.tsx";
import PageLoader from "../../components/PageLoader.tsx";
import MarketplaceFeatures from "./MarketplaceFeatures.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Label } from "../../components/ui/label.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.tsx";
import { Alert, AlertDescription } from "../../components/ui/alert.tsx";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs.tsx";
import { Switch } from "../../components/ui/switch.tsx";
import { cn } from "../../lib/utils.ts";
import "../../styles/pages.css";

/* ── SVG Icon Components ── */
function IconTotalStation() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21v-3" />
      <path d="M8 21l2-3" />
      <path d="M16 21l-2-3" />
      <path d="M9 18h6" />
      <rect x="10" y="15" width="4" height="3" rx="0.5" />
      <path d="M10 15v-6a2 2 0 0 1 4 0v6" />
      <rect x="7" y="6" width="10" height="4" rx="1" />
      <path d="M17 7v2" />
      <path d="M7 7v2" />
      <path d="M5 7.5h2v1H5z" />
      <path d="M10 6V4h4v2" />
    </svg>
  );
}

function IconGnss() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21V9" />
      <path d="M10 21h4" />
      <path d="M8 9h8a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2z" />
      <path d="M9 4c1-2 5-2 6 0" />
      <path d="M8 6L7 2" />
      <rect x="13" y="12" width="3" height="5" rx="0.5" />
    </svg>
  );
}

function IconLevel() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21v-3" />
      <path d="M8 21l2-3" />
      <path d="M16 21l-2-3" />
      <path d="M9 18h6" />
      <rect x="6" y="10" width="12" height="8" rx="1" />
      <path d="M18 11v6" />
      <path d="M6 12v4" />
      <path d="M4 12.5h2v3H4z" />
      <rect x="9" y="12" width="4" height="4" rx="0.5" />
      <path d="M11 10V9h2v1" />
    </svg>
  );
}

function IconDrone() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="6" height="6" rx="2" />
      <path d="M11 15v2h2v-2" />
      <circle cx="12" cy="18" r="1" />
      <line x1="9" y1="9" x2="5" y2="5" />
      <line x1="15" y1="9" x2="19" y2="5" />
      <line x1="9" y1="15" x2="5" y2="19" />
      <line x1="15" y1="15" x2="19" y2="19" />
      <ellipse cx="5" cy="5" rx="3" ry="1" />
      <ellipse cx="19" cy="5" rx="3" ry="1" />
      <ellipse cx="5" cy="19" rx="3" ry="1" />
      <ellipse cx="19" cy="19" rx="3" ry="1" />
    </svg>
  );
}

function IconController() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <rect x="6" y="5" width="12" height="10" rx="1" />
      <circle cx="9" cy="18" r="1" />
      <circle cx="15" cy="18" r="1" />
      <circle cx="12" cy="17" r="0.5" />
      <circle cx="12" cy="19" r="0.5" />
      <circle cx="11" cy="18" r="0.5" />
      <circle cx="13" cy="18" r="0.5" />
    </svg>
  );
}

function IconCalibration() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
      <circle cx="12" cy="12" r="2" />
      <path d="M15 15l5 5a2 2 0 0 1-3 3l-5-5" />
      <path d="M16 14l2 2" />
    </svg>
  );
}

const iconMap: Record<string, React.FC> = {
  "Total Station": IconTotalStation,
  "GNSS Receiver": IconGnss,
  "Digital Level": IconLevel,
  "UAV / Drone": IconDrone,
  Controller: IconController,
  "Calibration Service": IconCalibration,
};

function ListingIcon({ type }: { type: string }) {
  const Ico = iconMap[type] || IconTotalStation;
  return <Ico />;
}

const conditionVariant: Record<string, string> = {
  New: "default",
  "Like New": "secondary",
  Good: "warning",
  Fair: "outline",
  Service: "purple",
};

const TYPE_OPTIONS = [
  "Total Station",
  "GNSS Receiver",
  "Digital Level",
  "UAV / Drone",
  "Controller",
  "Calibration Service",
].map((v) => ({ value: v, label: v }));

const CONDITION_OPTIONS = ["New", "Like New", "Good", "Fair", "Service"].map((v) => ({
  value: v,
  label: v,
}));

type FilterType =
  | "all"
  | "Total Station"
  | "GNSS Receiver"
  | "Digital Level"
  | "UAV / Drone"
  | "Controller"
  | "Calibration Service";

type MarketplaceSegment = "instruments" | "features";

interface MarketplacePageProps {
  workspaceId: string;
  isPlatformAdmin?: boolean;
  onNavigate?: (view: string) => void;
}

export default function MarketplacePage({
  workspaceId,
  isPlatformAdmin = false,
  onNavigate,
}: MarketplacePageProps) {
  const [segment, setSegment] = useState<MarketplaceSegment>("instruments");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<FilterType>("all");
  const [selectedListing, setSelectedListing] = useState<MarketplaceListingWithAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [listingState, setListingState] = useState<MarketplaceListingWithAsset[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingListing, setSavingListing] = useState(false);
  const [mName, setMName] = useState("");
  const [mType, setMType] = useState("Total Station");
  const [mCondition, setMCondition] = useState("Good");
  const [mPrice, setMPrice] = useState("");
  const [mCurrency, setMCurrency] = useState("USD");
  const [mSeller, setMSeller] = useState("");
  const [mLocation, setMLocation] = useState("");
  const [mDescription, setMDescription] = useState("");
  const [mSpecs, setMSpecs] = useState("");
  const [mIsGlobal, setMIsGlobal] = useState(false);

  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestMessage, setRequestMessage] = useState("");
  const [requestStartDate, setRequestStartDate] = useState("");
  const [requestEndDate, setRequestEndDate] = useState("");
  const [requestSending, setRequestSending] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [alreadyRequested, setAlreadyRequested] = useState(false);

  const fetchListings = useCallback(async () => {
    try {
      setFetchError(null);
      const data = await listMarketplaceListings(workspaceId);
      setListingState(data);
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : "Failed to load listings");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  const filtered = listingState.filter((l) => {
    if (typeFilter !== "all" && l.type !== typeFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return [l.name, l.type, l.seller, l.location, l.description]
        .join(" ")
        .toLowerCase()
        .includes(q);
    }
    return true;
  });
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const clearMarketplaceFilters = () => {
    setSearch("");
    setTypeFilter("all");
    setPage(1);
  };

  const openListingDetail = useCallback(async (listing: MarketplaceListingWithAsset) => {
    setSelectedListing(listing);
    setShowRequestForm(false);
    setRequestSent(false);
    setRequestMessage("");
    setRequestStartDate("");
    setRequestEndDate("");
    const pending = await hasPendingRequest(listing.id);
    setAlreadyRequested(pending);
  }, []);

  const handleSubmitRequest = useCallback(async () => {
    if (!selectedListing) return;
    setRequestSending(true);
    try {
      await createMarketplaceRequest({
        listingId: selectedListing.id,
        requesterWorkspaceId: workspaceId,
        message: requestMessage.trim() || null,
        desiredStartDate: requestStartDate || null,
        desiredEndDate: requestEndDate || null,
      });
      setRequestSent(true);
      setShowRequestForm(false);
      setAlreadyRequested(true);
      const ws = await getWorkspaceById(workspaceId).catch(() => null);
      void notifyMarketplaceRequest({
        sellerWorkspaceId: selectedListing.workspace_id,
        listingName: selectedListing.name,
        requesterName: ws?.name ?? null,
        listingType: selectedListing.listing_type,
      });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to send request");
    } finally {
      setRequestSending(false);
    }
  }, [selectedListing, workspaceId, requestMessage, requestStartDate, requestEndDate]);

  const openCreateListing = () => {
    setEditingId(null);
    setMName("");
    setMType("Total Station");
    setMCondition("Good");
    setMPrice("");
    setMCurrency("USD");
    setMSeller("");
    setMLocation("");
    setMDescription("");
    setMSpecs("");
    setMIsGlobal(false);
    setEditorOpen(true);
  };

  const openEditListing = (row: MarketplaceListingRow) => {
    setEditingId(row.id);
    setMName(row.name);
    setMType(row.type);
    setMCondition(row.condition);
    setMPrice(String(row.price));
    setMCurrency(row.currency);
    setMSeller(row.seller);
    setMLocation(row.location);
    setMDescription(row.description ?? "");
    setMSpecs((row.specs ?? []).join(", "));
    setMIsGlobal(row.is_global ?? false);
    setEditorOpen(true);
    setSelectedListing(null);
  };

  const saveListing = async () => {
    if (!isPlatformAdmin) {
      setFetchError("Only platform administrators can manage global marketplace listings.");
      return;
    }
    if (!mName.trim() || !mSeller.trim() || !mLocation.trim()) {
      setFetchError("Name, seller, and location are required.");
      return;
    }
    const priceNum = Number(mPrice);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      setFetchError("Enter a valid price.");
      return;
    }
    const specsArr = mSpecs
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setSavingListing(true);
    setFetchError(null);
    try {
      const payload = {
        name: mName.trim(),
        type: mType,
        condition: mCondition,
        price: priceNum,
        currency: mCurrency.trim() || "USD",
        seller: mSeller.trim(),
        location: mLocation.trim(),
        description: mDescription.trim() || null,
        specs: specsArr.length ? specsArr : null,
        is_global: isPlatformAdmin ? mIsGlobal : false,
      };
      if (editingId) {
        await updateMarketplaceListing(editingId, payload);
      } else {
        await createMarketplaceListing(workspaceId, payload);
      }
      setEditorOpen(false);
      await fetchListings();
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to save listing.");
    } finally {
      setSavingListing(false);
    }
  };

  const removeListing = async (id: string) => {
    if (!window.confirm("Delete this listing permanently?")) return;
    setFetchError(null);
    try {
      await deleteMarketplaceListing(id);
      setSelectedListing(null);
      await fetchListings();
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to delete.");
    }
  };

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const filterTabs: { label: string; value: FilterType }[] = [
    { label: "All", value: "all" },
    { label: "Total Stations", value: "Total Station" },
    { label: "GNSS", value: "GNSS Receiver" },
    { label: "Levels", value: "Digital Level" },
    { label: "Drones", value: "UAV / Drone" },
    { label: "Controllers", value: "Controller" },
    { label: "Calibration", value: "Calibration Service" },
  ];

  return (
    <div className="hub-body mx-auto max-w-6xl space-y-6">
      {fetchError && (
        <Alert variant="destructive">
          <AlertDescription>{fetchError}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert variant="success">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1>Marketplace</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {segment === "instruments"
              ? "Browse available survey instruments and calibration services"
              : "Subscribe to system features and software add-ons"}
          </p>
          {!isPlatformAdmin && (
            <p className="mt-2 text-xs text-muted-foreground">
              {segment === "instruments"
                ? "To list your instruments here, open Asset Management and enable \"List on the Marketplace\" for the asset."
                : "Features are unlocked after a platform administrator approves your request."}
            </p>
          )}
        </div>
        {segment === "instruments" && isPlatformAdmin && (
          <Button onClick={openCreateListing}>
            <Plus className="mr-2 h-4 w-4" /> List a global instrument
          </Button>
        )}
      </div>

      <Tabs value={segment} onValueChange={(value) => setSegment(value as MarketplaceSegment)}>
        <TabsList className="grid w-full grid-cols-2 sm:w-[400px]">
          <TabsTrigger value="instruments">
            <Package className="mr-2 h-4 w-4" /> Instruments & Hiring
          </TabsTrigger>
          <TabsTrigger value="features">
            <Layers className="mr-2 h-4 w-4" /> System Features
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {segment === "features" ? (
        <MarketplaceFeatures workspaceId={workspaceId} onNavigate={onNavigate} />
      ) : loading ? (
        <PageLoader />
      ) : (
        <>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Tabs value={typeFilter} onValueChange={(value) => setTypeFilter(value as FilterType)}>
              <TabsList className="h-auto flex-wrap">
                {filterTabs.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value} className="text-xs sm:text-sm">
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="relative flex-1 lg:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search instruments & services..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <Dialog open={!!selectedListing} onOpenChange={() => setSelectedListing(null)}>
            <DialogContent className="sm:max-w-[480px]">
              {selectedListing && (
                <>
                  <DialogHeader>
                    <div className="flex items-start gap-4">
                      <div className="text-primary">
                        <ListingIcon type={selectedListing.type} />
                      </div>
                      <div>
                        <DialogTitle>{selectedListing.name}</DialogTitle>
                        <DialogDescription>
                          {selectedListing.type} ·{" "}
                          <Badge variant={conditionVariant[selectedListing.condition] as never}>
                            {selectedListing.condition}
                          </Badge>
                        </DialogDescription>
                      </div>
                    </div>
                  </DialogHeader>

                  <div className="space-y-4">
                    <p className="text-2xl font-semibold text-foreground">
                      ${selectedListing.price.toLocaleString()}{" "}
                      <span className="text-sm font-normal text-muted-foreground">
                        {selectedListing.currency}{" "}
                        {selectedListing.listing_type === "hire" ? "/ day" : "one-time"}
                      </span>
                    </p>

                    {selectedListing.description && (
                      <p className="text-sm text-muted-foreground">
                        {selectedListing.description}
                      </p>
                    )}
                    {selectedListing.specs && selectedListing.specs.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {selectedListing.specs.map((s) => (
                          <Badge key={s} variant="secondary">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <Card>
                      <CardContent className="space-y-2 py-4 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            {selectedListing.condition === "Service" ? "Provider" : "Seller"}
                          </span>
                          <span className="font-medium text-foreground">{selectedListing.seller}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Location</span>
                          <span className="font-medium text-foreground">{selectedListing.location}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Posted</span>
                          <span className="font-medium text-foreground">
                            {new Date(selectedListing.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </CardContent>
                    </Card>

                    {showRequestForm && (
                      <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
                        <h4 className="text-sm font-semibold">
                          {selectedListing.listing_type === "hire"
                            ? "Request to Hire"
                            : "Request to Purchase"}
                        </h4>
                        {selectedListing.listing_type === "hire" && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs">Start Date</Label>
                              <Input
                                type="date"
                                value={requestStartDate}
                                onChange={(e) => setRequestStartDate(e.target.value)}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">End Date</Label>
                              <Input
                                type="date"
                                value={requestEndDate}
                                onChange={(e) => setRequestEndDate(e.target.value)}
                              />
                            </div>
                          </div>
                        )}
                        <Textarea
                          placeholder="Add a message to the seller (optional)..."
                          value={requestMessage}
                          onChange={(e) => setRequestMessage(e.target.value)}
                          rows={3}
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowRequestForm(false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            disabled={requestSending}
                            onClick={handleSubmitRequest}
                          >
                            {requestSending ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...
                              </>
                            ) : (
                              "Send Request"
                            )}
                          </Button>
                        </div>
                      </div>
                    )}

                    {requestSent && (
                      <Alert variant="success">
                        <CheckCircle2 className="h-4 w-4" />
                        <AlertDescription>
                          Request sent successfully! The seller will be notified.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>

                  <DialogFooter className="flex-col gap-2 sm:flex-row">
                    <Button
                      variant="outline"
                      onClick={() => setSelectedListing(null)}
                      className="w-full sm:w-auto"
                    >
                      Close
                    </Button>
                    {!showRequestForm && !requestSent && (
                      selectedListing.workspace_id === workspaceId ? (
                        isPlatformAdmin ? (
                          <>
                            <Button
                              variant="outline"
                              onClick={() => openEditListing(selectedListing)}
                              className="w-full sm:w-auto"
                            >
                              Edit
                            </Button>
                            <Button
                              variant="destructive"
                              onClick={() => removeListing(selectedListing.id)}
                              className="w-full sm:w-auto"
                            >
                              Delete
                            </Button>
                          </>
                        ) : (
                          <Button variant="outline" disabled className="w-full sm:w-auto">
                            Your Listing
                          </Button>
                        )
                      ) : selectedListing.assets?.status === "deployed" ? (
                        <Button variant="outline" disabled className="w-full sm:w-auto">
                          Currently In Use
                        </Button>
                      ) : alreadyRequested ? (
                        <Button disabled className="w-full sm:w-auto">
                          <CheckCircle2 className="mr-2 h-4 w-4" /> Request Pending
                        </Button>
                      ) : (
                        <Button
                          onClick={() => setShowRequestForm(true)}
                          className="w-full sm:w-auto"
                        >
                          {selectedListing.listing_type === "hire"
                            ? "Request Hire"
                            : "Request Item"}
                        </Button>
                      )
                    )}
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>

          <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
            <DialogContent className="sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle>
                  {editingId ? "Edit listing" : "List an instrument"}
                </DialogTitle>
                <DialogDescription>
                  Listing assets for hire is free for your workspace.
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2 space-y-2">
                  <Label>Name *</Label>
                  <Input
                    value={mName}
                    onChange={(e) => setMName(e.target.value)}
                    placeholder="e.g. Leica TS16"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <SelectDropdown options={TYPE_OPTIONS} value={mType} onChange={setMType} />
                </div>
                <div className="space-y-2">
                  <Label>Condition</Label>
                  <SelectDropdown
                    options={CONDITION_OPTIONS}
                    value={mCondition}
                    onChange={setMCondition}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Price *</Label>
                  <Input
                    type="number"
                    min="0"
                    value={mPrice}
                    onChange={(e) => setMPrice(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Input
                    value={mCurrency}
                    onChange={(e) => setMCurrency(e.target.value)}
                    placeholder="USD"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Seller / Provider *</Label>
                  <Input
                    value={mSeller}
                    onChange={(e) => setMSeller(e.target.value)}
                    placeholder="Your firm or name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Location *</Label>
                  <Input
                    value={mLocation}
                    onChange={(e) => setMLocation(e.target.value)}
                    placeholder="City, country"
                  />
                </div>
                <div className="sm:col-span-2 space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={mDescription}
                    onChange={(e) => setMDescription(e.target.value)}
                    placeholder="Optional details"
                    rows={3}
                  />
                </div>
                <div className="sm:col-span-2 space-y-2">
                  <Label>Specs (comma separated)</Label>
                  <Input
                    value={mSpecs}
                    onChange={(e) => setMSpecs(e.target.value)}
                    placeholder="2'' accuracy, 1000m range"
                  />
                </div>
                {isPlatformAdmin && (
                  <div className="sm:col-span-2 flex items-center gap-3 rounded-md border p-3">
                    <Switch
                      id="listing-global"
                      checked={mIsGlobal}
                      onCheckedChange={setMIsGlobal}
                    />
                    <Label htmlFor="listing-global" className="cursor-pointer">
                      Publish globally (visible to all workspaces)
                    </Label>
                  </div>
                )}
              </div>
              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setEditorOpen(false)}
                  disabled={savingListing}
                >
                  Cancel
                </Button>
                <Button onClick={saveListing} disabled={savingListing}>
                  {savingListing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                    </>
                  ) : editingId ? (
                    "Save changes"
                  ) : (
                    "Publish listing"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {filtered.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <Package className="h-12 w-12 text-muted-foreground/50" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">No listings found</p>
                  <p className="text-sm text-muted-foreground">
                    No listings are currently available in the system for this view.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={clearMarketplaceFilters}>
                  Clear filters
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {paginated.map((l) => (
                  <Card
                    key={l.id}
                    className={cn(
                      "cursor-pointer transition-all hover:border-primary hover:shadow-md",
                      l.assets?.status === "deployed" && "opacity-70",
                    )}
                    onClick={() => openListingDetail(l)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openListingDetail(l);
                      }
                    }}
                  >
                    <CardContent className="flex flex-col gap-3 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
                          <ListingIcon type={l.type} />
                        </div>
                        <div className="flex flex-wrap justify-end gap-1">
                          <Badge variant={conditionVariant[l.condition] as never}>{l.condition}</Badge>
                          {l.assets?.status === "deployed" && (
                            <Badge variant="secondary">In Use</Badge>
                          )}
                          <Badge variant={l.listing_type === "hire" ? "purple" : "outline"}>
                            {l.listing_type === "hire" ? "Hire" : "Sale"}
                          </Badge>
                        </div>
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">{l.name}</h3>
                        <p className="text-sm text-muted-foreground">{l.type}</p>
                      </div>
                      <p className="text-lg font-semibold text-foreground">
                        ${l.price.toLocaleString()}{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          {l.currency} {l.listing_type === "hire" ? "/ day" : "one-time"}
                        </span>
                      </p>
                      <div className="text-xs text-muted-foreground">
                        <span>{l.seller}</span>
                        <span className="mx-1">·</span>
                        <span>{l.location}</span>
                      </div>
                      <p className="mt-auto text-xs text-muted-foreground">
                        Posted {new Date(l.created_at).toLocaleDateString()}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {filtered.length > pageSize && (
                <div className="flex items-center justify-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" /> Previous
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
                    Next <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
