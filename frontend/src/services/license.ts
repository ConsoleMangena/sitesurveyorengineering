/**
 * License service
 * ----------------
 * Bridges the React app to:
 *   1. The Rust verification core (via Tauri `invoke`), which validates the
 *      signed license token offline, enforces seat binding, expiry, the
 *      offline grace window, and clock-rollback detection.
 *   2. The Supabase Edge Functions, which are the ONLY place that can mint /
 *      refresh / revoke a signed token (the Ed25519 private key lives in
 *      Supabase secrets, never in the client).
 *
 * Flow:
 *   - Activation: app sends { account, machine fingerprint } to the
 *     `license-activate` Edge Function → receives a signed token → hands it to
 *     Rust (`license_activate`) for verification + tamper-evident caching.
 *   - Refresh: while online, the app periodically calls `license-refresh` with
 *     the current fingerprint → receives a fresh token (new issued_at,
 *     extended grace clock) → re-installs it in Rust.
 *   - Status: read straight from Rust (`license_status`) so the gate is
 *     evaluated by signed-token verification, not by trusting the server or JS.
 */

import { invoke } from '@tauri-apps/api/core';
import { supabase, isOnline } from '@/lib/supabase/client';

export type LicenseStateName =
  | 'unlicensed'
  | 'active'
  | 'grace'
  | 'expired'
  | 'invalid';

export type Edition = 'starter' | 'business' | 'enterprise';

export interface LicenseStatus {
  state: LicenseStateName;
  edition: Edition | null;
  features: string[];
  expires_at: number | null;
  issued_at: number | null;
  grace_until: number | null;
  fingerprint: string;
  /**
   * The account this license belongs to (from the signed token payload).
   * Used by the activation gate to detect when the cached license belongs to
   * a different account than the one currently signed in. `null` when no valid
   * license is installed.
   */
  account_id: string | null;
  message: string | null;
}

const ACTIVATE_FUNCTION = 'license-activate';
const REFRESH_FUNCTION = 'license-refresh';

/** Stable machine fingerprint (sha256 hex) computed in Rust. */
export async function getFingerprint(): Promise<string> {
  return invoke<string>('license_fingerprint');
}

export interface LicenseSelfCheck {
  key_configured: boolean;
  key_id: string;
  message: string | null;
}

/**
 * Build-config self-check: is the licensing public key embedded and valid?
 */
export async function getSelfCheck(): Promise<LicenseSelfCheck> {
  return invoke<LicenseSelfCheck>('license_selfcheck');
}

/** Current, locally-verified license status. Safe to call frequently. */
export async function getLicenseStatus(accountId?: string): Promise<LicenseStatus> {
  return invoke<LicenseStatus>('license_status', {
    expectedAccountId: accountId ?? null,
  });
}

/** True only when Active or in offline Grace. */
export async function isLicenseValid(accountId?: string): Promise<boolean> {
  return invoke<boolean>('license_is_valid', {
    expectedAccountId: accountId ?? null,
  });
}

/** Install a signed token into the Rust verifier + tamper-evident cache. */
async function installToken(token: string, accountId?: string): Promise<LicenseStatus> {
  return invoke<LicenseStatus>('license_activate', {
    token,
    expectedAccountId: accountId ?? null,
  });
}

/** Remove the local license (explicit deactivation). */
export async function deactivateLicense(): Promise<void> {
  await invoke('license_deactivate');
}

interface EdgeTokenResponse {
  token?: string;
  error?: string;
}

/**
 * First-time online activation.
 *
 * Requires an authenticated Supabase session. Sends the machine fingerprint
 * so the server binds the seat, then verifies the returned token locally.
 *
 * @param licenseKey Optional human-entered key for key-based activation.
 * @param accountId Current signed-in user's id. When provided, the returned
 *   token is rejected if it belongs to a different account.
 */
export async function activateLicense(
  licenseKey?: string,
  accountId?: string
): Promise<LicenseStatus> {
  if (!supabase) {
    throw new Error('Activation requires a configured Supabase connection.');
  }
  if (!isOnline()) {
    throw new Error('You must be online to activate your license.');
  }

  const fingerprint = await getFingerprint();

  const { data, error } = await supabase.functions.invoke<EdgeTokenResponse>(
    ACTIVATE_FUNCTION,
    { body: { fingerprint, license_key: licenseKey ?? null } }
  );

  if (error || !data?.token) {
    const serverMsg =
      (data?.error as string | undefined) ||
      ((error as { context?: { error?: string } } | null)?.context?.error) ||
      (error?.message as string | undefined) ||
      '';
    throw new Error(humanizeEdgeError(serverMsg));
  }

  return installToken(data.token, accountId);
}

/**
 * Patterns in the server's refresh error that mean the entitlement is
 * DEFINITIVELY gone (not a transient/network issue): revoked, suspended,
 * expired, or the seat was unbound. When we are online and the server says
 * one of these, we lock immediately instead of coasting on offline grace.
 */
const DEFINITIVE_REVOCATION =
  /revoked|suspend|cancel|expired|no longer active|not activated|seat|subscription/i;

/**
 * Online re-validation. Called periodically (and on reconnect) to extend the
 * offline grace clock and to pick up edition/feature/expiry changes or
 * server-side revocation.
 *
 * Behaviour:
 *   - Success → install the fresh token (extends grace, updates edition/features).
 *   - Online + server DEFINITIVELY rejects (revoked/suspended/expired/seat
 *     removed) → deactivate the local token and return an `invalid` status so
 *     the app locks immediately, even though offline grace had time left.
 *   - Offline or a transient/unknown error → keep the cached token; offline
 *     grace covers temporary loss of connectivity.
 *
 * @param accountId Current signed-in user's id. When provided, cached and
 *   refreshed tokens for a different account are rejected.
 * @returns The resulting status.
 */
export async function refreshLicense(accountId?: string): Promise<LicenseStatus> {
  const current = await getLicenseStatus(accountId);

  // Nothing to refresh if we were never activated.
  if (current.state === 'unlicensed') return current;
  if (!supabase || !isOnline()) return current;

  // Guard: ensure the Supabase session is available before calling the edge
  // function. Without a valid JWT the API gateway returns 403, which the
  // DEFINITIVE_REVOCATION regex would wrongly interpret as a real revocation.
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return current;
    }
  } catch {
    return current;
  }

  try {
    const fingerprint = await getFingerprint();
    const { data, error } = await supabase.functions.invoke<EdgeTokenResponse>(
      REFRESH_FUNCTION,
      { body: { fingerprint } }
    );

    if (data?.token) {
      return await invoke<LicenseStatus>('license_refresh', {
        token: data.token,
        expectedAccountId: accountId ?? null,
      });
    }

    // No token returned. Decide whether this is a definitive server rejection
    // or a transient issue.
    const serverMsg =
      (data?.error as string | undefined) ||
      ((error as { context?: { error?: string } } | null)?.context?.error) ||
      (error?.message as string | undefined) ||
      '';

    if (serverMsg && DEFINITIVE_REVOCATION.test(serverMsg)) {
      try {
        await deactivateLicense();
      } catch {
        /* best-effort */
      }
      return {
        ...current,
        state: 'invalid',
        message:
          'Your license is no longer valid (revoked, suspended, or expired). Please re-activate.',
      };
    }

    // Transient / unknown — keep the cached token; offline grace handles it.
    return current;
  } catch {
    return current;
  }
}

function humanizeEdgeError(message?: string): string {
  if (!message) return 'Activation failed. Please try again.';
  if (/seat/i.test(message)) {
    return 'All license seats for this plan are in use. Free a device or upgrade your plan.';
  }
  if (/expired|inactive|no.*subscription/i.test(message)) {
    return 'No active subscription found for this account.';
  }
  return message;
}

/** Days remaining until expiry (or until grace lapses if already expired). */
export function daysUntil(unixSeconds: number | null): number | null {
  if (!unixSeconds) return null;
  const diff = unixSeconds - Math.floor(Date.now() / 1000);
  return Math.ceil(diff / 86_400);
}
