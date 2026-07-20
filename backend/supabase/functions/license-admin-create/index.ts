/**
 * Edge Function: license-admin-create  (PLATFORM ADMIN ONLY)
 * -------------------------------------------------------------
 * Generates and persists a new license, returning its opaque key for manual
 * delivery to the customer. Authorization is enforced SERVER-SIDE.
 *
 * Request (POST, admin):
 *   {
 *     customer_email: string,
 *     edition: 'starter'|'business'|'enterprise',
 *     seats?: number,
 *     features?: string[],
 *     expires_at?: string (ISO),
 *     grace_days?: number,
 *     notes?: string
 *   }
 *
 * Response:
 *   200 { license: {...}, key: "SSE-XXXX-XXXX-XXXX-XXXX" }
 *   4xx { error }
 */

import { corsHeaders, json, adminClient } from "../_shared/supabase.ts";
import { requirePlatformAdmin, audit } from "../_shared/platformAdmin.ts";

const EDITIONS = new Set(["starter", "business", "enterprise"]);
const MAX_SEATS = 1000;

/** Crypto-random opaque key: SSE-XXXX-XXXX-XXXX-XXXX (Crockford-ish base32). */
function generateLicenseKey(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ0123456789"; // no I,L,O,U (32 chars)
  const charsNeeded = 16;
  // 5 bits per character because 32 = 2^5, so every 5-bit value maps evenly
  // to the alphabet with no modulo bias.
  const bytes = new Uint8Array(Math.ceil((charsNeeded * 5) / 8));
  crypto.getRandomValues(bytes);

  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);

  const chars: string[] = [];
  for (let i = 0; i < charsNeeded; i++) {
    chars.push(alphabet[Number(value & 0x1fn)]);
    value = value >> 5n;
  }
  chars.reverse();

  const groups: string[] = [];
  for (let i = 0; i < charsNeeded; i += 4) groups.push(chars.slice(i, i + 4).join(""));
  return `SSE-${groups.join("-")}`;
}

function oneYearFromNow(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let actor;
  try {
    actor = await requirePlatformAdmin(req);
  } catch (e) {
    return json({ error: (e as Error).message || "not authorized" }, 403);
  }

  try {
    const body = await req.json().catch(() => ({}));

    const customerEmail = String(body?.customer_email ?? "").trim().toLowerCase();
    const edition = String(body?.edition ?? "").trim();
    const seats = Number.isFinite(body?.seats) ? Math.floor(body.seats) : 1;
    const features = Array.isArray(body?.features)
      ? body.features.filter((f: unknown) => typeof f === "string").slice(0, 50)
      : [];
    const expiresAt = body?.expires_at ? new Date(body.expires_at).toISOString() : oneYearFromNow();
    const graceDays = Number.isFinite(body?.grace_days) ? Math.floor(body.grace_days) : 14;
    const notes = typeof body?.notes === "string" ? body.notes.slice(0, 2000) : null;

    // ── Validation ──
    if (!customerEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customerEmail)) {
      return json({ error: "a valid customer_email is required" }, 400);
    }
    if (!EDITIONS.has(edition)) {
      return json({ error: "edition must be starter, business or enterprise" }, 400);
    }
    if (seats < 1 || seats > MAX_SEATS) {
      return json({ error: `seats must be between 1 and ${MAX_SEATS}` }, 400);
    }
    if (graceDays < 0 || graceDays > 90) {
      return json({ error: "grace_days must be between 0 and 90" }, 400);
    }
    if (isNaN(new Date(expiresAt).getTime()) || new Date(expiresAt) <= new Date()) {
      return json({ error: "expires_at must be a valid future date" }, 400);
    }

    const admin = adminClient();

    // Try to pre-bind to an existing auth user with this email so the license
    // is immediately active for them; otherwise leave account_id NULL (pending).
    let accountId: string | null = null;
    {
      const { data: existing } = await admin
        .from("profiles")
        .select("id")
        .ilike("email", customerEmail)
        .maybeSingle();
      if (existing?.id) accountId = existing.id;
    }

    // Generate a unique key (retry on the rare unique collision).
    let key = generateLicenseKey();
    let inserted = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error } = await admin
        .from("licenses")
        .insert({
          account_id: accountId,
          customer_email: customerEmail,
          license_key: key,
          edition,
          features,
          seats,
          grace_days: graceDays,
          status: "active",
          expires_at: expiresAt,
          notes,
          issued_by: actor.id,
        })
        .select("id, account_id, customer_email, license_key, edition, features, seats, grace_days, status, expires_at, notes, created_at")
        .single();

      if (!error && data) {
        inserted = data;
        break;
      }
      // 23505 = unique_violation on license_key → regenerate and retry.
      if (error && error.code === "23505") {
        key = generateLicenseKey();
        continue;
      }
      console.error("license insert error:", error);
      return json({ error: "failed to create license" }, 500);
    }

    if (!inserted) return json({ error: "failed to create a unique license key" }, 500);

    await audit("create", actor, inserted.id, {
      customer_email: customerEmail,
      edition,
      seats,
      features,
      expires_at: expiresAt,
      grace_days: graceDays,
      pending: accountId === null,
    });

    return json({
      license: inserted,
      key,
    });
  } catch (e) {
    console.error("license-admin-create error:", e);
    return json({ error: "internal error" }, 500);
  }
});
