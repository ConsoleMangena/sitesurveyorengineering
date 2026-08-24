import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Briefcase, Globe2, MapPin, Search, UserRound } from "lucide-react";
import { supabase } from "../../lib/supabase/client.ts";
import { useAsyncAction } from "../../hooks/useAsyncAction.ts";
import type { Database } from "../../lib/supabase/types.ts";
import {
  buildMarketDots,
  type MarketDot,
} from "../../components/market/marketDots";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent } from "../../components/ui/card.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Skeleton } from "../../components/ui/skeleton.tsx";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs.tsx";

const PublicMarketGlobe = lazy(
  () => import("../../components/market/PublicMarketGlobe.tsx"),
);

type ListingRow = Database["public"]["Views"]["public_market_listings"]["Row"];
type ProfessionalRow =
  Database["public"]["Views"]["public_market_professionals"]["Row"];

type Scope = "all" | "listing" | "professional";

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
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [selected, setSelected] = useState<MarketDot | null>(null);

  const load = useCallback(async () => {
    try {
      const [listingsRes, professionalsRes] = await Promise.all([
        supabase
          .from("public_market_listings")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase.from("public_market_professionals").select("*"),
      ]);
      if (listingsRes.error) throw listingsRes.error;
      if (professionalsRes.error) throw professionalsRes.error;
      setListings(listingsRes.data ?? []);
      setProfessionals(professionalsRes.data ?? []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useAsyncAction(load, [load, attempt]);

  // Reset to the loading state synchronously here (event handler, not render)
  // so the globe and grids show placeholders while refetching.
  const retry = useCallback(() => {
    setListings(null);
    setProfessionals(null);
    setFailed(false);
    setAttempt((value) => value + 1);
  }, []);

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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <Globe2 className="size-4 text-primary" />
            SiteSurveyor Market
          </span>
          <Button variant="outline" size="sm" asChild>
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
      </header>

      <main className="space-y-6 py-8">
        <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            The public engineering market
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Instruments for sale or hire and survey professionals worldwide —
            published by SiteSurveyor workspaces. No account needed to browse.
          </p>
        </section>

        <Suspense
          fallback={
            <div className="mx-auto h-[420px] w-full max-w-7xl px-4 sm:h-[520px] sm:px-6 lg:px-8">
              <Skeleton className="h-full w-full rounded-xl" />
            </div>
          }
        >
          <PublicMarketGlobe
            dots={dots}
            totalListings={listings?.length ?? 0}
            totalProfessionals={professionals?.length ?? 0}
            failed={failed}
            onSelect={setSelected}
            onRetry={retry}
          />
        </Suspense>

        <section className="mx-auto w-full max-w-7xl space-y-4 px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs value={scope} onValueChange={(value) => setScope(value as Scope)}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="listing">Listings</TabsTrigger>
                <TabsTrigger value="professional">Professionals</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative w-full sm:w-[280px]">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search instruments & professionals…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {failed ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <Globe2 className="size-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">
                  Couldn&rsquo;t load the market.
                </p>
                <Button size="sm" variant="outline" onClick={retry}>
                  Try again
                </Button>
              </CardContent>
            </Card>
          ) : loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-40 rounded-xl" />
              ))}
            </div>
          ) : (
            <>
              {showListings ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    Listings ({filteredListings.length})
                  </h3>
                  {filteredListings.length === 0 ? (
                    <EmptyHint label="No listings match your search." />
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {filteredListings.map((row) => (
                        <ListingCard
                          key={row.id}
                          row={row}
                          onOpen={() =>
                            setSelected(
                              dotOf(listings ?? [], professionals ?? [], "listing", row.id),
                            )
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              {showProfessionals ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    Professionals ({filteredProfessionals.length})
                  </h3>
                  {filteredProfessionals.length === 0 ? (
                    <EmptyHint label="No professionals match your search." />
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {filteredProfessionals.map((row) => (
                        <ProfessionalCard
                          key={row.id}
                          row={row}
                          onOpen={() =>
                            setSelected(
                              dotOf(listings ?? [], professionals ?? [], "professional", row.id),
                            )
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </>
          )}
        </section>
      </main>

      <footer className="border-t py-6">
        <p className="mx-auto max-w-7xl px-4 text-xs text-muted-foreground sm:px-6 lg:px-8">
          Data shown is published by SiteSurveyor workspaces. Sign in to
          request, hire, or purchase.
        </p>
      </footer>

      <MarketDotDialog dot={selected} onClose={() => setSelected(null)} />
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

function EmptyHint({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        {label}
      </CardContent>
    </Card>
  );
}

function ListingCard({ row, onOpen }: { row: ListingRow; onOpen: () => void }) {
  return (
    <Card
      className="cursor-pointer transition-all hover:border-primary hover:shadow-md"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <CardContent className="space-y-2 p-5">
        <div className="flex items-start justify-between gap-2">
          <Briefcase className="size-5 text-primary" />
          <div className="flex gap-1">
            {row.condition ? <Badge variant="secondary">{row.condition}</Badge> : null}
            <Badge variant="outline">
              {row.listing_type === "hire" ? "Hire" : "Sale"}
            </Badge>
          </div>
        </div>
        <div>
          <h4 className="font-semibold">{row.name}</h4>
          <p className="text-sm text-muted-foreground">{row.type}</p>
        </div>
        <p className="font-semibold">
          {row.price.toLocaleString()} {row.currency}
          {row.listing_type === "hire" ? " / day" : ""}
        </p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3" /> {row.seller} · {row.location}
        </p>
      </CardContent>
    </Card>
  );
}

function ProfessionalCard({
  row,
  onOpen,
}: {
  row: ProfessionalRow;
  onOpen: () => void;
}) {
  return (
    <Card
      className="cursor-pointer transition-all hover:border-primary hover:shadow-md"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <CardContent className="space-y-2 p-5">
        <div className="flex items-start justify-between gap-2">
          <UserRound className="size-5 text-primary" />
          <Badge variant="outline">{row.availability}</Badge>
        </div>
        <div>
          <h4 className="font-semibold">{row.name}</h4>
          <p className="text-sm text-muted-foreground">{row.title}</p>
        </div>
        <p className="text-sm">{row.discipline}</p>
        <p className="font-semibold">
          {row.rate.toLocaleString()} {row.currency} / {row.rate_per}
        </p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3" /> {row.location}
        </p>
      </CardContent>
    </Card>
  );
}

function MarketDotDialog({
  dot,
  onClose,
}: {
  dot: MarketDot | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={dot !== null}
      onOpenChange={(open) => (!open ? onClose() : undefined)}
    >
      <DialogContent className="sm:max-w-md">
        {dot ? (
          <>
            <DialogHeader>
              <DialogTitle>{dot.name}</DialogTitle>
              <DialogDescription>
                {dot.kind === "listing" ? "Marketplace listing" : "Survey professional"}
                {dot.location ? ` · ${dot.location}` : ""}
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Sign in to contact the publisher
              {dot.location ? ` in ${dot.location}` : ""}.
            </p>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
