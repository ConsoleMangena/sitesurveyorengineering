/**
 * Edge Function: license-activate
 * -------------------------------
 * First-time online activation (also safe to call to re-activate an existing
 * device). Binds the caller's machine fingerprint to a seat on their active
 * license and returns a freshly signed Ed25519 token for offline verification
 * by the Rust client.
 *
 * Request (POST, authenticated):
 *   { fingerprint: string, license_key?: string | null }
 *
 * Response:
 *   200 { token: string }
 *   4xx { error: string }
 */

import { corsHeaders, json, adminClient, getCaller } from "../_shared/supabase.ts";
import { signLicense } from "../_shared/license.ts";
import { findActiveLicense, bindSeatAndBuildPayload } from "../_shared/seats.ts";
import { checkRateLimit, clientIp } from "../_shared/rate_limit.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  try {
    const caller = await getCaller(req);
    if (!caller) {
      return json({ error: "authentication required" }, 401);
    }

    const ipLimit = checkRateLimit({
      key: `license-activate:ip:${clientIp(req)}`,
      limit: 30,
      windowMs: 15 * 60 * 1000,
    });
    const accountLimit = checkRateLimit({
      key: `license-activate:account:${caller.id}`,
      limit: 10,
      windowMs: 15 * 60 * 1000,
    });
    if (!ipLimit.allowed || !accountLimit.allowed) {
      return json(
        {
          error: "too many activation attempts; please try again later",
          retry_after_seconds: Math.max(ipLimit.retryAfterSeconds, accountLimit.retryAfterSeconds),
        },
        429,
      );
    }

    const body = await req.json().catch(() => ({}));
    const fingerprint: string | undefined = body?.fingerprint;
    const licenseKey: string | null = body?.license_key ?? null;

    if (!fingerprint || typeof fingerprint !== "string" || fingerprint.length < 16) {
      return json({ error: "valid device fingerprint is required" }, 400);
    }

    const admin = adminClient();

    // SECURITY: pending licenses are bound to whoever's auth email matches
    // `customer_email`. Only trust the caller's email for that match when it
    // has been verified.
    const matchEmail = caller.emailConfirmed ? caller.email : null;

    const license = await findActiveLicense(admin, caller.id, matchEmail, licenseKey);
    if (!license) {
      return json({ error: "no active subscription found for this account" }, 403);
    }

    // Allow binding a new device (requireExistingSeat = false).
    const result = await bindSeatAndBuildPayload(admin, license, fingerprint, false);
    if (!result.ok || !result.payload) {
      return json({ error: result.error ?? "activation failed" }, 403);
    }

    const token = await signLicense(result.payload);
    return json({ token });
  } catch (e) {
    console.error("license-activate error:", e);
    return json({ error: "internal error during activation" }, 500);
  }
});
