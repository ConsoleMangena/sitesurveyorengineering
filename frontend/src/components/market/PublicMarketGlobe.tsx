import { useEffect, useRef, useState, type ReactNode } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Crosshair, Globe2 } from "lucide-react";
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
  /** Rendered inside the globe viewport (heading overlay etc.). */
  children?: ReactNode;
}

function formatCoord(lngLat: maplibregl.LngLat): string {
  const lat = lngLat.lat;
  const lng = lngLat.lng;
  return `${lat >= 0 ? "+" : ""}${lat.toFixed(2)}° ${lng >= 0 ? "+" : ""}${lng.toFixed(2)}°`;
}

/** Full-bleed night-side globe of the public market: amber listing pins,
 *  cyan professional pins, live cursor coordinates, tap either pin to open
 *  its detail dialog. */
export default function PublicMarketGlobe({
  dots,
  totalListings,
  totalProfessionals,
  failed,
  onSelect,
  onRetry,
  children,
}: PublicMarketGlobeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const coordRef = useRef<HTMLSpanElement | null>(null);
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
      style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      center: [15, 15],
      zoom: 1.4,
      attributionControl: { compact: true },
    });
    // v6 dropped the constructor option and rejects setProjection until the
    // style has loaded ("Style is not done loading"), so it moves into the
    // load handler below — same gating bizintel's BaseMap applies.
    mapRef.current = map;

    let entranceRaf = 0;
    const timeoutId = window.setTimeout(
      () => setTimedOut(true),
      LOAD_FAILURE_TIMEOUT_MS,
    );

    map.on("load", () => {
      window.clearTimeout(timeoutId);
      // Style is guaranteed loaded here, so globe projection is safe to set.
      map.setProjection({ type: "globe" });
      map.addSource("market-points", {
        type: "geojson",
        data: toFeatureCollection(dotsRef.current ?? []),
      });
      const kindColor = [
        "match",
        ["get", "kind"],
        "professional",
        MARKET_DOT_COLORS.professional,
        MARKET_DOT_COLORS.listing,
      ] as maplibregl.ExpressionSpecification;

      // Soft halo under each pin so pins read as light sources, not stickers.
      map.addLayer({
        id: "market-dots-halo",
        type: "circle",
        source: "market-points",
        paint: {
          "circle-radius": 14,
          "circle-color": kindColor,
          "circle-blur": 0.9,
          "circle-opacity": 0,
        },
      });
      map.addLayer({
        id: "market-dots",
        type: "circle",
        source: "market-points",
        paint: {
          "circle-radius": 5.5,
          "circle-color": kindColor,
          "circle-stroke-width": 1.25,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0,
          "circle-stroke-opacity": 0,
        },
      });

      // The one authored moment: pins surface like instrument plots after
      // acquisition — exponential ease-out, then hands control back.
      const startedAt = performance.now();
      const DURATION_MS = 900;
      const easeOut = (t: number) => 1 - Math.pow(2, -10 * t);
      const revealPins = (now: number) => {
        const progress = Math.min((now - startedAt) / DURATION_MS, 1);
        const eased = progress === 0 ? 0 : easeOut(progress);
        if (dotsRef.current === null || dotsRef.current.length > 0) {
          map.setPaintProperty("market-dots-halo", "circle-opacity", 0.3 * eased);
          map.setPaintProperty("market-dots", "circle-opacity", eased);
          map.setPaintProperty("market-dots", "circle-stroke-opacity", eased);
        }
        if (progress < 1) {
          entranceRaf = requestAnimationFrame(revealPins);
        }
      };
      entranceRaf = requestAnimationFrame(revealPins);

      map.on("click", "market-dots", (
        event: maplibregl.MapMouseEvent & {
          features?: (maplibregl.MapGeoJSONFeature & {
            properties: Record<string, unknown>;
          })[];
        },
      ) => {
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
      map.on("mousemove", (event) => {
        if (coordRef.current) {
          coordRef.current.textContent = formatCoord(event.lngLat);
        }
      });
      setLoaded(true);
    });

    return () => {
      cancelAnimationFrame(entranceRaf);
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
  const pinnedListings =
    dots?.filter((d) => d.kind === "listing").length ?? 0;
  const pinnedProfessionals = (dots?.length ?? 0) - pinnedListings;

  return (
    <section className="relative">
      <div className="relative h-[68vh] min-h-[480px] w-full overflow-hidden border-y border-white/5 bg-[#03060c]">
        {/* Canvas-only content; the searchable registry rows below carry the
            same information for keyboard and screen-reader users. */}
        <p className="sr-only">
          Interactive globe of published listings and professionals. The same
          items are listed below the globe.
        </p>
        {!broken ? (
          <>
            <div ref={containerRef} className="absolute inset-0" />
            {/* Telemetry block */}
            <div className="pointer-events-none absolute left-4 top-4 space-y-1 sm:left-6 sm:top-6">
              <p className="mono-data text-xs text-slate-400" role="status" aria-live="polite">
                {dots === null ? (
                  <span className="text-slate-400">ACQUIRING FEED…</span>
                ) : (
                  <>
                    <span className="text-amber-400">{pinnedListings}</span>
                    <span className="text-slate-400"> LISTINGS · </span>
                    <span className="text-cyan-300">{pinnedProfessionals}</span>
                    <span className="text-slate-400"> PROFESSIONALS</span>
                  </>
                )}
              </p>
              {dots !== null &&
              pinnedListings + pinnedProfessionals <
                totalListings + totalProfessionals ? (
                <p className="mono-data text-[11px] text-slate-400">
                  {pinnedListings + pinnedProfessionals} OF{" "}
                  {totalListings + totalProfessionals} HAVE COORDINATES
                </p>
              ) : null}
            </div>
            {/* Cursor readout */}
            <div className="pointer-events-none absolute right-4 top-4 hidden sm:right-6 sm:top-6 md:block">
              <p className="mono-data flex items-center gap-1.5 text-xs text-slate-400">
                <Crosshair className="size-3" aria-hidden="true" />
                <span ref={coordRef}>——.——° ———.——°</span>
              </p>
            </div>
            {/* Legend */}
            <div className="pointer-events-none absolute bottom-4 right-4 flex gap-4 sm:bottom-6 sm:right-6">
              <span className="flex items-center gap-1.5 text-xs text-slate-300">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: MARKET_DOT_COLORS.listing,
                    boxShadow: `0 0 8px ${MARKET_DOT_COLORS.listing}`,
                  }}
                  aria-hidden="true"
                />
                Listings
              </span>
              <span className="flex items-center gap-1.5 text-xs text-slate-300">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: MARKET_DOT_COLORS.professional,
                    boxShadow: `0 0 8px ${MARKET_DOT_COLORS.professional}`,
                  }}
                  aria-hidden="true"
                />
                Professionals
              </span>
            </div>
            {children}
          </>
        ) : (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <Globe2 className="size-9 text-slate-600" aria-hidden="true" />
            <p className="font-display text-lg font-semibold text-slate-200">
              Couldn&rsquo;t acquire the feed
            </p>
            <p className="max-w-sm text-sm text-slate-400">
              The globe tiles didn&rsquo;t arrive in time. Everything is still
              browsable in the registry below.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRetry}
              className="border-white/15 bg-transparent text-slate-200 hover:bg-white/5 hover:text-white"
            >
              Retry acquisition
            </Button>
          </div>
        )}
        {!broken && dots === null ? (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2">
            <div className="flex flex-col items-center gap-3">
              <div className="flex gap-1.5" role="status" aria-label="Loading the market">
                <span className="size-1.5 animate-pulse rounded-full bg-amber-400/80" />
                <span className="size-1.5 animate-pulse rounded-full bg-cyan-300/80 [animation-delay:150ms]" />
                <span className="size-1.5 animate-pulse rounded-full bg-amber-400/80 [animation-delay:300ms]" />
              </div>
              <p className="mono-data text-[11px] tracking-widest text-slate-400">
                ACQUIRING FEED…
              </p>
            </div>
          </div>
        ) : null}
        {!broken && dots !== null && dots.length === 0 ? (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 px-6">
            <p className="mx-auto max-w-md text-center">
              <span className="font-display block text-lg font-semibold text-slate-200">
                Nothing published yet
              </span>
              <span className="mt-1 block text-sm text-slate-400">
                When workspaces list instruments or professionals, they appear
                here.
              </span>
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
