import { useCallback, useEffect, useState } from "react";

// CoinGecko public endpoint (no key). USDC id is "usd-coin".
const RATES_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=usd-coin,solana&vs_currencies=usd&include_24hr_change=true";
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60_000;

export interface CryptoRate {
  usd: number;
  change24h: number;
}

export interface CryptoRates {
  usdc: CryptoRate;
  sol: CryptoRate;
  fetchedAt: number;
}

interface CoinGeckoResponse {
  "usd-coin"?: { usd?: number; usd_24h_change?: number };
  solana?: { usd?: number; usd_24h_change?: number };
}

let cache: CryptoRates | null = null;

/** Live USDC/SOL exchange rates for the market pulse strip. Returns null
 *  while loading or when the API is unreachable — callers hide the ticker
 *  rather than show an error for a decorative extra. */
export function useCryptoRates(): CryptoRates | null {
  const [rates, setRates] = useState<CryptoRates | null>(cache);

  const load = useCallback(async () => {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      setRates(cache);
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      FETCH_TIMEOUT_MS,
    );
    try {
      const response = await fetch(RATES_URL, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as CoinGeckoResponse;
      const usdcUsd = data["usd-coin"]?.usd;
      const solUsd = data.solana?.usd;
      if (typeof usdcUsd !== "number" || typeof solUsd !== "number") {
        throw new Error("Unexpected payload");
      }
      cache = {
        usdc: { usd: usdcUsd, change24h: data["usd-coin"]?.usd_24h_change ?? 0 },
        sol: { usd: solUsd, change24h: data.solana?.usd_24h_change ?? 0 },
        fetchedAt: Date.now(),
      };
      setRates(cache);
    } catch {
      // Decorative: leave rates unset; the ticker simply doesn't render.
    } finally {
      window.clearTimeout(timeoutId);
    }
  }, []);

  useEffect(() => {
    // Defer to a macrotask so no state update happens synchronously in the
    // effect body (repo react-hooks/set-state-in-effect policy).
    const kickoffId = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(kickoffId);
    };
  }, [load]);

  return rates;
}
