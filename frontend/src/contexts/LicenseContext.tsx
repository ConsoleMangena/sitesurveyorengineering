/* eslint-disable react-refresh/only-export-components */
/**
 * LicenseContext
 * --------------
 * Single source of truth for the app's licensing state on the frontend.
 *
 * Responsibilities:
 *   - Load the locally-verified status from Rust on startup.
 *   - Periodically (and on reconnect) refresh against the Edge Function so the
 *     offline grace clock stays topped up and revocations/expiry are picked up.
 *   - Expose helpers used by the whole-app activation gate and by feature/
 *     edition gating (`hasFeature`, `edition`, `can*`).
 *
 * The actual trust decision lives in Rust (signed-token verification). This
 * context only reflects and refreshes that decision.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import {
  activateLicense as activateLicenseSvc,
  deactivateLicense as deactivateLicenseSvc,
  getLicenseStatus,
  refreshLicense,
  type LicenseStatus,
  type LicenseStateName,
  type Edition,
} from '@/services/license';
import { useAuthStore } from '@/lib/auth/auth-store';
import {
  meetsEntitlement,
  CAPABILITIES,
  type CapabilityId,
  type Entitlement,
} from '@/lib/entitlements';

interface LicenseContextType {
  status: LicenseStatus | null;
  loading: boolean;
  /** True while the app should be usable (active or within offline grace). */
  isLicensed: boolean;
  /** The locked state that should force the activation screen. */
  isLocked: boolean;
  edition: Edition | null;
  state: LicenseStateName | 'loading';
  hasFeature: (feature: string) => boolean;
  /** Edition ordering check, e.g. requireEdition('business'). */
  requireEdition: (min: Edition) => boolean;
  /** True when the active license satisfies a registered capability id. */
  hasCapability: (id: CapabilityId) => boolean;
  /** True when the active license satisfies an ad-hoc entitlement. */
  meetsEntitlement: (ent: Entitlement | undefined) => boolean;
  activate: (licenseKey?: string) => Promise<void>;
  deactivate: () => Promise<void>;
  refresh: () => Promise<void>;
}

const LicenseContext = createContext<LicenseContextType | null>(null);

const EDITION_RANK: Record<Edition, number> = {
  starter: 1,
  business: 2,
  enterprise: 3,
};

// Re-validate roughly every 6 hours while running; reconnect triggers an
// immediate refresh on top of this.
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function LicenseProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const userId = useAuthStore((s) => s.user?.id);

  const statusRef = useRef<LicenseStatus | null>(null);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const load = useCallback(async () => {
    try {
      const s = await getLicenseStatus(userId);
      setStatus(s);
    } catch (e) {
      // If the Rust bridge is unreachable, fail closed (locked) rather than
      // open. An undefined status renders as locked below.
      console.error('Failed to read license status:', e);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const refresh = useCallback(async () => {
    try {
      const s = await refreshLicense(userId);
      setStatus(s);
    } catch (e) {
      console.error('License refresh failed:', e);
    }
  }, [userId]);

  const activate = useCallback(async (licenseKey?: string) => {
    const s = await activateLicenseSvc(licenseKey, userId);
    setStatus(s);
  }, [userId]);

  const deactivate = useCallback(async () => {
    await deactivateLicenseSvc();
    await load();
  }, [load]);

  // Initial load + first online refresh.
  useEffect(() => {
    (async () => {
      await load();
      // Best-effort top-up if we already have a license and are online.
      await refresh();
    })();
  }, [load, refresh]);

  // Periodic + reconnect-driven refresh.
  useEffect(() => {
    const interval = setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);

    const onOnline = () => {
      void refresh();
    };
    window.addEventListener('online', onOnline);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', onOnline);
    };
  }, [refresh]);

  const state: LicenseStateName | 'loading' = loading
    ? 'loading'
    : status?.state ?? 'invalid';

  const isLicensed = state === 'active' || state === 'grace';
  const isLocked =
    !loading && (state === 'unlicensed' || state === 'expired' || state === 'invalid');

  const hasFeature = useCallback(
    (feature: string) => !!status?.features?.includes(feature),
    [status]
  );

  const requireEdition = useCallback(
    (min: Edition) => {
      if (!status?.edition) return false;
      return EDITION_RANK[status.edition] >= EDITION_RANK[min];
    },
    [status]
  );

  // Entitlement checks only count while the license is usable (active/grace),
  // so a locked/expired license grants no premium capabilities.
  const checkEntitlement = useCallback(
    (ent: Entitlement | undefined) => {
      if (!isLicensed) return false;
      return meetsEntitlement(ent, status?.edition ?? null, status?.features ?? []);
    },
    [isLicensed, status]
  );

  const hasCapability = useCallback(
    (id: CapabilityId) => checkEntitlement(CAPABILITIES[id]),
    [checkEntitlement]
  );

  const value: LicenseContextType = {
    status,
    loading,
    isLicensed,
    isLocked,
    edition: status?.edition ?? null,
    state,
    hasFeature,
    requireEdition,
    hasCapability,
    meetsEntitlement: checkEntitlement,
    activate,
    deactivate,
    refresh,
  };

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>;
}

export function useLicense(): LicenseContextType {
  const ctx = useContext(LicenseContext);
  if (!ctx) {
    throw new Error('useLicense must be used within a LicenseProvider');
  }
  return ctx;
}
