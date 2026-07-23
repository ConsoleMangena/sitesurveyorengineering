/**
 * Edge Function: license-refresh
 * ------------------------------
 * Periodic online re-validation for an already-activated device. Confirms the
 * subscription is still active and the seat is still bound, bumps the seat
 * sequence, and returns a freshly signed token with a new issued_at (which
 * extends the client's offline grace clock).
 *
 * Unlike activate, this REQUIRES an existing seat: a device that was never
 * activated cannot silently bind a seat via refresh.
 *
 * Request (POST, authenticated):
 *   { fingerprint: string }
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
      key: `license-refresh:ip:${clientIp(req)}`,
      limit: 240,
      windowMs: 15 * 60 * 1000,
    });
    const accountLimit = checkRateLimit({
      key: `license-refresh:account:${caller.id}`,
      limit: 120,
      windowMs: 15 * 60 * 1000,
    });
    if (!ipLimit.allowed || !accountLimit.allowed) {
      return json(
        {
          error: "too many refresh attempts; please try again later",
          retry_after_seconds: Math.max(ipLimit.retryAfterSeconds, accountLimit.retryAfterSeconds),
        },
        429,
      );
    }

    const body = await req.json().catch(() => ({}));
    const fingerprint: string | undefined = body?.fingerprint;
    if (!fingerprint || typeof fingerprint !== "string" || fingerprint.length < 16) {
      return json({ error: "valid device fingerprint is required" }, 400);
    }

    const admin = adminClient();

    const matchEmail = caller.emailConfirmed ? caller.email : null;

    const license = await findActiveLicense(admin, caller.id, matchEmail, null);
    if (!license) {
      return json({ error: "subscription is no longer active" }, 403);
    }

    // requireExistingSeat = true: refresh must not create new seats.
    const result = await bindSeatAndBuildPayload(admin, license, fingerprint, true);
    if (!result.ok || !result.payload) {
      return json({ error: result.error ?? "refresh failed" }, 403);
    }

    const token = await signLicense(result.payload);
    return json({ token });
  } catch (e) {
    console.error("license-refresh error:", e);
    return json({ error: "internal error during refresh" }, 500);
  }
});
