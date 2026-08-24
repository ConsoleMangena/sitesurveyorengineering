import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Globe2 } from "lucide-react";
import { Button } from "../ui/button.tsx";
import {
  MARKET_DOT_COLORS,
  toFeatureCollection,
  type MarketDot,
} from "./marketDots";

// Generous: slow connections beat a false error (bizintel uses the same value).
const LOAD_FAILURE_TIMEOUT_MS = 10_000;

interface PublicMarketGlobeProps {
  /** null while the parent is fetching. */
  dots: MarketDot[] | null;
  totalListings: number;
  totalProfessionals: number;
  failed: boolean;
  onSelect: (dot: MarketDot) => void;
  onRetry: () => void;
}

function countLabel(
  dots: MarketDot[] | null,
  totalListings: number,
  totalProfessionals: number,
): string {
  if (dots === null) return "Loading…";
  const pinnedListings = dots.filter((d) => d.kind === "listing").length;
  const pinnedPros = dots.length - pinnedListings;
  if (totalListings === 0 && totalProfessionals === 0) {
    return "Nothing published yet";
  }
  const listingsFull = pinnedListings === totalListings;
  const prosFull = pinnedPros === totalProfessionals;
  if (listingsFull && prosFull) {
    return `${totalListings} ${totalListings === 1 ? "listing" : "listings"} · ${totalProfessionals} ${totalProfessionals === 1 ? "professional" : "professionals"}`;
  }
  return `${pinnedListings} of ${totalListings} listings · ${pinnedPros} of ${totalProfessionals} professionals have a pinned location`;
}

/** Full-width 3D globe of the public market: amber listing dots, cyan
 *  professional dots, tap either to open its detail dialog. */
export default function PublicMarketGlobe({
  dots,
  totalListings,
  totalProfessionals,
  failed,
  onSelect,
  onRetry,
}: PublicMarketGlobeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Latest values for handlers bound once at map creation.
  const dotsRef = useRef(dots);
  const selectRef = useRef(onSelect);
  useEffect(() => {
    dotsRef.current = dots;
  }, [dots]);
  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || failed) return;

    setLoaded(false);
    setTimedOut(false);

    const map = new maplibregl.Map({
      container,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [15, 20],
      zoom: 1.35,
    });
    // v6 dropped the constructor option; globe is set on the instance.
    map.setProjection({ type: "globe" });
    mapRef.current = map;

    const timeoutId = window.setTimeout(
      () => setTimedOut(true),
      LOAD_FAILURE_TIMEOUT_MS,
    );

    map.on("load", () => {
      window.clearTimeout(timeoutId);
      map.addSource("market-points", {
        type: "geojson",
        data: toFeatureCollection(dotsRef.current ?? []),
      });
      map.addLayer({
        id: "market-dots",
        type: "circle",
        source: "market-points",
        paint: {
          "circle-radius": 6,
          "circle-color": [
            "match",
            ["get", "kind"],
            "professional",
            MARKET_DOT_COLORS.professional,
            MARKET_DOT_COLORS.listing,
          ],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.on("click", "market-dots", (event: maplibregl.MapMouseEvent & {
        features?: (maplibregl.MapGeoJSONFeature & { properties: Record<string, unknown> })[];
      }) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const props = feature.properties as
          | { kind?: string; id?: string }
          | null;
        const dot = dotsRef.current?.find(
          (candidate) =>
            candidate.kind === props?.kind && candidate.id === props?.id,
        );
        if (dot) selectRef.current(dot);
      });
      map.on("mouseenter", "market-dots", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "market-dots", () => {
        map.getCanvas().style.cursor = "";
      });
      setLoaded(true);
    });

    return () => {
      window.clearTimeout(timeoutId);
      map.remove();
      mapRef.current = null;
    };
  }, [attempt, failed]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const source = map.getSource("market-points");
    if (source && "setData" in source) {
      (source as maplibregl.GeoJSONSource).setData(toFeatureCollection(dots ?? []));
    }
  }, [dots, loaded]);

  const handleRetry = () => {
    setAttempt((value) => value + 1);
    onRetry();
  };

  const broken = failed || (timedOut && !loaded);

  return (
    <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight sm:text-lg">
          <Globe2 className="size-4 text-muted-foreground" />
          Everything on the globe
        </h2>
        <span
          className="text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {countLabel(dots, totalListings, totalProfessionals)}
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: MARKET_DOT_COLORS.listing }}
              aria-hidden="true"
            />
            Listings
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: MARKET_DOT_COLORS.professional }}
              aria-hidden="true"
            />
            Professionals
          </span>
        </span>
      </div>

      <div className="relative z-0 h-[420px] w-full overflow-hidden rounded-xl border bg-muted/40 sm:h-[520px]">
        {/* Canvas-only content; the searchable card grids below carry the
            same information for keyboard and screen-reader users. */}
        <p className="sr-only">
          Interactive globe of published listings and professionals. The same
          items are listed below the globe.
        </p>
        {!broken ? (
          <div ref={containerRef} className="absolute inset-0" />
        ) : (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <Globe2 className="size-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">Couldn&rsquo;t load the globe.</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Check your connection — everything is also browsable below.
            </p>
            <Button size="sm" variant="outline" onClick={handleRetry}>
              Try again
            </Button>
          </div>
        )}
        {!broken && dots === null ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div
              className="flex gap-1"
              role="status"
              aria-label="Loading the market"
            >
              <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
              <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
              <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
