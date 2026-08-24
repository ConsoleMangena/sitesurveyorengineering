/*
Design contract — /market public surface (code-led, brief-pinned "mission
control"): THESIS: the market is a live orbital feed on a night-side Earth,
not a boxed SaaS directory. OWN-WORLD: deep space-navy ground (#050910),
hairline white borders, amber=listings and cyan=professionals carried from
the pins into every accent; mono strictly for telemetry values; Chakra Petch
display face. STORY: a visitor sees Earth and its pinned activity within
seconds, reads scale from HUD telemetry, filters and searches the registry,
and opens a detail dialog with a sign-in path. FIRST VIEWPORT: slim top bar,
then an edge-to-edge globe at ~68vh carrying the display heading bottom-left,
telemetry top-left, legend bottom-right, cursor coordinate readout top-right.
SIGNATURE: live lat/lng readout tracking the cursor over the globe, pins
surfacing once like acquired plots. FINISH: unreviewed and undocumented is
unfinished; this build ends with the finish review, the verdict, and
DESIGN.md.
*/
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Briefcase,
  ChevronDown,
  Globe2,
  MapPin,
  RefreshCw,
  Search,
  UserRound,
} from "lucide-react";
import { supabase } from "../../lib/supabase/client.ts";
import { useAsyncAction } from "../../hooks/useAsyncAction.ts";
import type { Database } from "../../lib/supabase/types.ts";
import {
  buildMarketDots,
  MARKET_DOT_COLORS,
  type MarketDot,
} from "../../components/market/marketDots";
import { Button } from "../../components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.tsx";
import { Input } from "../../components/ui/input.tsx";

const PublicMarketGlobe = lazy(
  () => import("../../components/market/PublicMarketGlobe.tsx"),
);

type ListingRow = Database["public"]["Views"]["public_market_listings"]["Row"];
type ProfessionalRow =
  Database["public"]["Views"]["public_market_professionals"]["Row"];

type Scope = "all" | "listing" | "professional";

interface LoadFailure {
  reason: "timeout" | "error";
  message: string;
  missingRelation: boolean;
}

const FETCH_TIMEOUT_MS = 12_000;

function matches(
  term: string,
  haystack: (string | null | undefined)[],
): boolean {
  if (!term.trim()) return true;
  const needle = term.trim().toLowerCase();
  return haystack.some((field) => (field ?? "").toLowerCase().includes(needle));
}

export default function PublicMarketPage() {
  const [listings, setListings] = useState<ListingRow[] | null>(null);
  const [professionals, setProfessionals] = useState<ProfessionalRow[] | null>(
    null,
  );
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const registryRef = useRef<HTMLDivElement | null>(null);
  const [selectedId, setSelectedId] = useState<{ kind: MarketDot["kind"]; id: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      FETCH_TIMEOUT_MS,
    );
    try {
      const [listingsRes, professionalsRes] = await Promise.all([
        supabase
          .from("public_market_listings")
          .select("*")
          .order("created_at", { ascending: false })
          .abortSignal(controller.signal),
        supabase
          .from("public_market_professionals")
          .select("*")
          .abortSignal(controller.signal),
      ]);
      if (listingsRes.error) throw listingsRes.error;
      if (professionalsRes.error) throw professionalsRes.error;
      setListings(listingsRes.data ?? []);
      setProfessionals(professionalsRes.data ?? []);
      setFailure(null);
    } catch (error) {
      const aborted =
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError");
      const postgrestError = error as { code?: string; message?: string };
      setFailure({
        reason: aborted ? "timeout" : "error",
        message:
          !aborted ? (postgrestError.message ?? "Unknown error") : "",
        missingRelation:
          !aborted &&
          (postgrestError.code === "42P01" ||
            /does not exist/i.test(postgrestError.message ?? "")),
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }, []);

  useAsyncAction(load, [load, attempt]);

  // Reset to the loading state synchronously here (event handler, not render)
  // so the globe and registry show placeholders while refetching.
  const retry = useCallback(() => {
    setListings(null);
    setProfessionals(null);
    setFailure(null);
    setAttempt((value) => value + 1);
  }, []);

  const failed = failure !== null;

  const dots = useMemo(
    () =>
      listings !== null && professionals !== null
        ? buildMarketDots(listings, professionals)
        : null,
    [listings, professionals],
  );

  const filteredListings = useMemo(
    () =>
      (listings ?? []).filter((row) =>
        matches(search, [
          row.name,
          row.type,
          row.seller,
          row.location,
          row.description,
        ]),
      ),
    [listings, search],
  );
  const filteredProfessionals = useMemo(
    () =>
      (professionals ?? []).filter((row) =>
        matches(search, [
          row.name,
          row.title,
          row.discipline,
          row.location,
          row.bio,
        ]),
      ),
    [professionals, search],
  );

  const showListings = scope !== "professional";
  const showProfessionals = scope !== "listing";
  const loading = listings === null || professionals === null;

  const scrollToRegistry = () => {
    registryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const selectedDot: MarketDot | null = useMemo(() => {
    if (!selectedId) return null;
    return dotOf(listings ?? [], professionals ?? [], selectedId.kind, selectedId.id);
  }, [selectedId, listings, professionals]);
  const selectedListing =
    selectedId?.kind === "listing"
      ? (listings ?? []).find((row) => row.id === selectedId.id) ?? null
      : null;
  const selectedProfessional =
    selectedId?.kind === "professional"
      ? (professionals ?? []).find((row) => row.id === selectedId.id) ?? null
      : null;

  return (
    <div className="market-dark min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#050910]/90">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <span className="flex items-baseline gap-2">
            <span className="flex items-center gap-2 font-display text-base font-semibold tracking-tight text-white">
              <Globe2 className="size-4 translate-y-px text-amber-400" aria-hidden="true" />
              SiteSurveyor
            </span>
            <span className="text-sm text-slate-400">/ Market</span>
          </span>
          <Button
            size="sm"
            asChild
            className="bg-amber-400 text-[#050910] hover:bg-amber-300"
          >
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
      </header>

      <main>
        <Suspense fallback={<div className="h-[68vh] min-h-[480px] w-full bg-[#03060c]" />}>
          <PublicMarketGlobe
            dots={dots}
            totalListings={listings?.length ?? 0}
            totalProfessionals={professionals?.length ?? 0}
            failed={failed}
            onSelect={(dot) => setSelectedId({ kind: dot.kind, id: dot.id })}
            onRetry={retry}
          >
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#03060c] via-[#03060c]/70 to-transparent pb-8 pt-20 sm:pb-10">
              <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
                <h1 className="font-display max-w-xl text-3xl font-bold leading-tight tracking-[-0.02em] text-white sm:text-5xl">
                  The open surveying market.
                </h1>
                <p className="mt-3 max-w-lg text-sm leading-relaxed text-slate-400 sm:text-base">
                  Instruments for sale or hire and survey professionals
                  worldwide — published live by SiteSurveyor workspaces. No
                  account needed to browse.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={scrollToRegistry}
              aria-label="Scroll to the registry"
              className="absolute bottom-8 right-4 hidden flex-col items-center gap-1 text-slate-400 transition-colors hover:text-slate-200 sm:right-6 md:flex"
            >
              <span className="mono-data text-[11px] tracking-widest">REGISTRY</span>
              <ChevronDown className="size-4" aria-hidden="true" />
            </button>
          </PublicMarketGlobe>
        </Suspense>

        <section ref={registryRef} className="mx-auto w-full max-w-6xl scroll-mt-16 space-y-12 px-4 py-12 sm:px-6 sm:py-16">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div role="group" aria-label="Filter by kind" className="inline-flex w-fit rounded-lg border border-white/10 p-1">
              {(
                [
                  ["all", "Everything", listings?.length, professionals?.length],
                  ["listing", "Listings", listings?.length, undefined],
                  ["professional", "Professionals", undefined, professionals?.length],
                ] as const
              ).map(([value, label, listingCount, professionalCount]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={scope === value}
                  onClick={() => setScope(value)}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                    scope === value
                      ? "bg-white/[0.08] font-medium text-white"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {label}
                  {listingCount !== undefined || professionalCount !== undefined ? (
                    <span className="mono-data ml-2 text-xs text-slate-400">
                      {(listingCount ?? 0) + (professionalCount ?? 0)}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <div className="relative w-full lg:w-[320px]">
              <Search
                className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <Input
                placeholder="Search instruments, people, places…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="border-white/10 bg-white/[0.03] pl-9 text-slate-200 placeholder:text-slate-400 focus-visible:border-amber-400/60 focus-visible:ring-amber-400/30"
              />
            </div>
          </div>

          {failed ? (
            <LoadErrorPanel failure={failure} onRetry={retry} />
          ) : loading ? (
            <div className="space-y-10">
              <SkeletonPanel label="Listings" />
              <SkeletonPanel label="Professionals" />
            </div>
          ) : (
            <>
              {showListings ? (
                <RegistryPanel
                  title="Listings"
                  count={filteredListings.length}
                  emptyLabel={
                    (listings ?? []).length === 0
                      ? "No instruments published yet."
                      : "No listings match your search."
                  }
                  isEmpty={filteredListings.length === 0}
                >
                  {filteredListings.map((row) => (
                    <ListingRowItem
                      key={row.id}
                      row={row}
                      onOpen={() =>
                        setSelectedId({ kind: "listing", id: row.id })
                      }
                    />
                  ))}
                </RegistryPanel>
              ) : null}

              {showProfessionals ? (
                <RegistryPanel
                  title="Professionals"
                  count={filteredProfessionals.length}
                  emptyLabel={
                    (professionals ?? []).length === 0
                      ? "No professionals published yet."
                      : "No professionals match your search."
                  }
                  isEmpty={filteredProfessionals.length === 0}
                >
                  {filteredProfessionals.map((row) => (
                    <ProfessionalRowItem
                      key={row.id}
                      row={row}
                      onOpen={() =>
                        setSelectedId({ kind: "professional", id: row.id })
                      }
                    />
                  ))}
                </RegistryPanel>
              ) : null}
            </>
          )}
        </section>
      </main>

      <footer className="border-t border-white/5 py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 sm:px-6">
          <p className="text-xs text-slate-400">
            Published by SiteSurveyor workspaces · refreshes live
          </p>
          <p className="mono-data text-xs text-slate-400">
            AMBER LISTINGS · CYAN PROFESSIONALS
          </p>
        </div>
      </footer>

      <MarketDetailDialog
        dot={selectedDot}
        listing={selectedListing}
        professional={selectedProfessional}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

function dotOf(
  listings: ListingRow[],
  professionals: ProfessionalRow[],
  kind: MarketDot["kind"],
  id: string,
): MarketDot | null {
  const source =
    kind === "listing"
      ? listings.find((row) => row.id === id)
      : professionals.find((row) => row.id === id);
  if (!source || source.latitude == null || source.longitude == null) {
    return null;
  }
  return {
    kind,
    id,
    name: source.name,
    location: source.location ?? "",
    lat: source.latitude,
    lng: source.longitude,
  };
}

function LoadErrorPanel({
  failure,
  onRetry,
}: {
  failure: LoadFailure;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-6 py-14 text-center">
      <Globe2 className="mx-auto size-9 text-slate-600" aria-hidden="true" />
      <h3 className="font-display mt-4 text-lg font-semibold text-slate-100">
        Couldn&rsquo;t reach the market
      </h3>
      <p className="mt-1 text-sm text-slate-400">
        {failure.reason === "timeout"
          ? "The request didn't complete in time — check your connection."
          : "The market data couldn't be loaded."}
      </p>
      {failure.missingRelation ? (
        <p className="mono-data mx-auto mt-3 max-w-md rounded-md border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-left text-xs text-amber-300">
          public_market views not found — run backend/sql/0002_public_market.sql
          (and 0001 before it) in the Supabase SQL editor.
        </p>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        onClick={onRetry}
        className="mt-5 border-white/15 bg-transparent text-slate-200 hover:bg-white/5 hover:text-white"
      >
        <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}

function SkeletonPanel({ label }: { label: string }) {
  return (
    <div aria-hidden="true">
      <div className="mb-3 h-4 w-32 animate-pulse rounded bg-white/5" />
      <div className="overflow-hidden rounded-xl border border-white/10">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between border-b border-white/5 px-4 py-4 last:border-b-0"
          >
            <div className="h-3.5 w-48 animate-pulse rounded bg-white/5" />
            <div className="h-3.5 w-24 animate-pulse rounded bg-white/5" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading {label.toLowerCase()}…</span>
    </div>
  );
}

function RegistryPanel({
  title,
  count,
  isEmpty,
  emptyLabel,
  children,
}: {
  title: string;
  count: number;
  isEmpty: boolean;
  emptyLabel: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display mb-4 mt-0 text-xl font-semibold tracking-[-0.02em] text-white">
        {title}{" "}
        <span className="mono-data ml-1 align-middle text-xs font-normal text-slate-400">
          ({count})
        </span>
      </h2>
      {isEmpty ? (
        <div className="rounded-xl border border-dashed border-white/10 px-6 py-12 text-center">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            className="mx-auto size-7 text-slate-600"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="7" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
          </svg>
          <p className="mt-3 text-sm text-slate-400">{emptyLabel}</p>
        </div>
      ) : (
        <ul className="market-scroll divide-y divide-white/5 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
          {children}
        </ul>
      )}
    </section>
  );
}

function RowShell({
  onClick,
  accent,
  children,
  ariaLabel,
}: {
  onClick: () => void;
  accent: string;
  children: ReactNode;
  ariaLabel: string;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className="group flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-white/[0.04]"
      >
        <span
          className="size-2 shrink-0 rounded-full transition-transform group-hover:scale-125"
          style={{ backgroundColor: accent, boxShadow: `0 0 6px ${accent}` }}
          aria-hidden="true"
        />
        {children}
      </button>
    </li>
  );
}

function ListingRowItem({
  row,
  onOpen,
}: {
  row: ListingRow;
  onOpen: () => void;
}) {
  return (
    <RowShell
      onClick={onOpen}
      accent={MARKET_DOT_COLORS.listing}
      ariaLabel={`${row.name}, ${row.type}, ${row.price.toLocaleString()} ${row.currency}${row.listing_type === "hire" ? " per day" : ""}, ${row.location}`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-100 transition-colors group-hover:text-amber-300">
          {row.name}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-400">
          {row.type}
          {row.condition ? ` · ${row.condition}` : ""}
          {row.listing_type === "hire" ? " · hire" : ""}
        </p>
      </div>
      <div className="hidden min-w-0 shrink basis-40 items-center gap-1 text-xs text-slate-400 sm:flex">
        <MapPin className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{row.location}</span>
      </div>
      <p className="mono-data shrink-0 text-sm text-slate-200">
        {row.price.toLocaleString()}
        <span className="ml-1 text-xs text-slate-400">{row.currency}</span>
        {row.listing_type === "hire" ? (
          <span className="text-xs text-slate-400">/day</span>
        ) : null}
      </p>
      <Briefcase
        className="size-4 shrink-0 text-slate-700 transition-colors group-hover:text-slate-400"
        aria-hidden="true"
      />
    </RowShell>
  );
}

function ProfessionalRowItem({
  row,
  onOpen,
}: {
  row: ProfessionalRow;
  onOpen: () => void;
}) {
  return (
    <RowShell
      onClick={onOpen}
      accent={MARKET_DOT_COLORS.professional}
      ariaLabel={`${row.name}, ${row.title}, ${row.rate.toLocaleString()} ${row.currency} per ${row.rate_per}, ${row.location}`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-100 transition-colors group-hover:text-cyan-200">
          {row.name}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-400">
          {row.title} · {row.discipline} · {row.experience}
        </p>
      </div>
      <div className="hidden min-w-0 shrink basis-40 items-center gap-1 text-xs text-slate-400 sm:flex">
        <MapPin className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{row.location}</span>
      </div>
      <p className="mono-data shrink-0 text-sm text-slate-200">
        {row.rating != null && row.rating > 0 ? `${row.rating.toFixed(1)}★ ` : ""}
        {row.rate.toLocaleString()}
        <span className="ml-1 text-xs text-slate-400">
          {row.currency}/{row.rate_per}
        </span>
      </p>
      <UserRound
        className="size-4 shrink-0 text-slate-700 transition-colors group-hover:text-slate-400"
        aria-hidden="true"
      />
    </RowShell>
  );
}

function MarketDetailDialog({
  dot,
  listing,
  professional,
  onClose,
}: {
  dot: MarketDot | null;
  listing: ListingRow | null;
  professional: ProfessionalRow | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={dot !== null}
      onOpenChange={(open) => (!open ? onClose() : undefined)}
    >
      <DialogContent className="border-white/10 bg-[#0b1220] text-slate-200 sm:max-w-md [&>button]:text-slate-400 [&>button:hover]:text-white">
        {dot ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-display flex items-center gap-2.5 pr-6 text-lg text-white">
                <span
                  className="size-2.5 rounded-full"
                  style={{
                    backgroundColor:
                      dot.kind === "listing"
                        ? MARKET_DOT_COLORS.listing
                        : MARKET_DOT_COLORS.professional,
                    boxShadow: `0 0 8px ${dot.kind === "listing" ? MARKET_DOT_COLORS.listing : MARKET_DOT_COLORS.professional}`,
                  }}
                  aria-hidden="true"
                />
                {dot.name}
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                {dot.kind === "listing"
                  ? `Marketplace listing${dot.location ? ` · ${dot.location}` : ""}`
                  : `Survey professional${dot.location ? ` · ${dot.location}` : ""}`}
              </DialogDescription>
            </DialogHeader>
            <dl className="space-y-2.5 text-sm">
              {listing ? (
                <>
                  <DetailRow label="Price">
                    <span className="mono-data">
                      {listing.price.toLocaleString()} {listing.currency}
                      {listing.listing_type === "hire" ? " / day" : ""}
                    </span>
                  </DetailRow>
                  {listing.condition ? (
                    <DetailRow label="Condition">{listing.condition}</DetailRow>
                  ) : null}
                  <DetailRow label="Seller">{listing.seller}</DetailRow>
                  {listing.description ? (
                    <DetailRow label="Notes">{listing.description}</DetailRow>
                  ) : null}
                </>
              ) : null}
              {professional ? (
                <>
                  <DetailRow label="Role">
                    {professional.title} · {professional.discipline}
                  </DetailRow>
                  <DetailRow label="Rate">
                    <span className="mono-data">
                      {professional.rate.toLocaleString()}{" "}
                      {professional.currency} / {professional.rate_per}
                    </span>
                  </DetailRow>
                  <DetailRow label="Experience">{professional.experience}</DetailRow>
                  <DetailRow label="Availability">{professional.availability}</DetailRow>
                  {professional.bio ? (
                    <DetailRow label="About">{professional.bio}</DetailRow>
                  ) : null}
                </>
              ) : null}
              {dot.lat != null && dot.lng != null ? (
                <DetailRow label="Coordinates">
                  <span className="mono-data text-xs text-slate-400">
                    {dot.lat.toFixed(4)}°, {dot.lng.toFixed(4)}°
                  </span>
                </DetailRow>
              ) : null}
            </dl>
            <Button asChild className="mt-2 w-full bg-amber-400 text-[#050910] hover:bg-amber-300">
              <Link to="/login">Sign in to contact the publisher</Link>
            </Button>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-3">
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="min-w-0 text-slate-300">{children}</dd>
    </div>
  );
}
