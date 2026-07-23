/**
 * Seat-binding logic shared by activate/refresh.
 *
 * Tables (see backend/supabase/sql/06_licensing.sql):
 *   licenses(id, account_id, edition, features[], seats, expires_at, status, …)
 *   license_seats(id, license_id, fingerprint, seq, created_at, last_seen_at)
 *
 * Activation rules (per-device subscription):
 *   - The license must exist, belong to the caller's account, be `active`, and
 *     not be past `expires_at`.
 *   - A device (fingerprint) already bound to the license re-activates freely
 *     (idempotent) with an incremented `seq`.
 *   - A new device is allowed only if bound seats < licensed `seats`.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { nowUnix, type Edition, type LicensePayload } from "./license.ts";

export interface LicenseRow {
  id: string;
  account_id: string | null;
  customer_email: string | null;
  edition: Edition;
  features: string[] | null;
  seats: number;
  expires_at: string; // ISO timestamp
  grace_days: number | null;
  status: string; // 'active' | 'cancelled' | 'suspended'
}

export interface SeatResult {
  ok: boolean;
  error?: string;
  payload?: LicensePayload;
}

function isActive(license: LicenseRow): boolean {
  if (license.status !== "active") return false;
  const exp = Math.floor(new Date(license.expires_at).getTime() / 1000);
  return exp > nowUnix();
}

const SELECT_COLS =
  "id, account_id, customer_email, edition, features, seats, expires_at, grace_days, status";

/**
 * Resolve the active license for a caller (the seat-bearing entitlement).
 *
 * Matching order:
 *   1. A license already bound to this account_id.
 *   2. (If a license_key is given) an active license with that key whose
 *      account_id is NULL (pending) or already this account.
 *   3. A "pending" license issued to this caller's email (account_id IS NULL),
 *      which is then bound to the account on first activation.
 */
export async function findActiveLicense(
  admin: SupabaseClient,
  accountId: string,
  callerEmail: string | null,
  licenseKey: string | null,
): Promise<LicenseRow | null> {
  // 1. Already bound to this account.
  {
    let q = admin
      .from("licenses")
      .select(SELECT_COLS)
      .eq("account_id", accountId)
      .eq("status", "active");
    if (licenseKey) q = q.eq("license_key", licenseKey);
    const { data } = await q
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as LicenseRow;
  }

  // 2. By explicit key (pending or this account).
  // Pending licenses require the caller's verified email to match
  // customer_email before binding, exactly like email-based claiming.
  if (licenseKey) {
    const { data } = await admin
      .from("licenses")
      .select(SELECT_COLS)
      .eq("license_key", licenseKey)
      .eq("status", "active")
      .or(`account_id.is.null,account_id.eq.${accountId}`)
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      const row = data as LicenseRow;
      const bound = await bindAccountIfPending(admin, row, accountId, callerEmail);
      if (!bound) return null;
      return row;
    }
  }

  // 3. Pending license issued to this caller's email.
  if (callerEmail) {
    const { data } = await admin
      .from("licenses")
      .select(SELECT_COLS)
      .is("account_id", null)
      .eq("status", "active")
      .ilike("customer_email", callerEmail)
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      const row = data as LicenseRow;
      const bound = await bindAccountIfPending(admin, row, accountId, callerEmail);
      if (!bound) return null;
      return row;
    }
  }

  return null;
}

/**
 * Bind a pending license (account_id IS NULL) to the activating account.
 * Only binds when the caller's verified email matches the license's
 * customer_email, or when the license is already bound to this account.
 * Returns true when the caller may use the license, false otherwise.
 */
async function bindAccountIfPending(
  admin: SupabaseClient,
  license: LicenseRow,
  accountId: string,
  callerEmail: string | null,
): Promise<boolean> {
  if (license.account_id) return license.account_id === accountId;
  if (!callerEmail || !license.customer_email) return false;
  if (callerEmail.toLowerCase() !== license.customer_email.toLowerCase()) return false;

  const { error } = await admin
    .from("licenses")
    .update({ account_id: accountId })
    .eq("id", license.id)
    .is("account_id", null); // guard against a race binding it twice
  if (error) return false;
  license.account_id = accountId;
  return true;
}

/** Build the signed payload for a (license, device) pair, enforcing seats. */
export async function bindSeatAndBuildPayload(
  admin: SupabaseClient,
  license: LicenseRow,
  fingerprint: string,
  requireExistingSeat: boolean,
): Promise<SeatResult> {
  if (!isActive(license)) {
    return { ok: false, error: "subscription is not active or has expired" };
  }

  // Atomic bind / refresh. A Postgres function locks the license row and
  // either bumps an existing seat's seq or binds a new one only while seats
  // remain. This prevents concurrent activations from racing past the seat cap.
  const { data: seat, error } = await admin.rpc("bind_license_seat", {
    p_license_id: license.id,
    p_fingerprint: fingerprint,
    p_allow_new: !requireExistingSeat,
  });

  if (error || !seat) {
    const msg = error?.message?.toLowerCase?.() || "";
    if (msg.includes("license not found")) {
      return { ok: false, error: "license not found" };
    }
    return {
      ok: false,
      error: requireExistingSeat
        ? "device is not activated for this license"
        : "all seats are in use for this license",
    };
  }

  const seq = Number(seat.seq ?? 1);
  const issuedAt = nowUnix();
  const expiresAt = Math.floor(new Date(license.expires_at).getTime() / 1000);

  const payload: LicensePayload = {
    license_id: license.id,
    account_id: license.account_id ?? "",
    edition: license.edition,
    fingerprint,
    expires_at: expiresAt,
    issued_at: issuedAt,
    grace_days: license.grace_days ?? null,
    features: license.features ?? [],
    seq,
  };

  return { ok: true, payload };
}
