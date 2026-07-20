/**
 * Edge Function: license-admin-update  (PLATFORM ADMIN ONLY)
 * -----------------------------------------------------------
 * Action-dispatched mutations on a license. Authorization enforced
 * server-side; every action writes an append-only audit entry.
 *
 * Request (POST, admin):
 *   { license_id: string, action: Action, ...args }
 *
 * Actions:
 *   revoke                       → status='cancelled', revoked_at=now
 *   suspend                      → status='suspended'
 *   reactivate                   → status='active', revoked_at=null
 *   extend       { expires_at }  → set new paid-through date (future)
 *   set_seats    { seats }       → change seat cap (>= currently bound)
 *   set_edition  { edition }     → change edition
 *   set_features { features[] }  → replace feature list
 *   set_notes    { notes }       → replace vendor notes
 *   unbind_seat  { seat_id }     → free a bound device (delete a seat row)
 *
 * Response: 200 { license } | 4xx { error }
 */

import { corsHeaders, json, adminClient } from "../_shared/supabase.ts";
import { requirePlatformAdmin, audit } from "../_shared/platformAdmin.ts";

const EDITIONS = new Set(["starter", "business", "enterprise"]);
const MAX_SEATS = 1000;

const VALID_STATUS_ACTIONS = new Set(["revoke", "suspend", "reactivate"]);

/** Enforce a sensible state machine for status-changing actions. */
function validateTransition(currentStatus: string, action: string): { ok: true } | { ok: false; error: string } {
  switch (action) {
    case "revoke":
      if (currentStatus === "cancelled") {
        return { ok: false, error: "license is already revoked" };
      }
      return { ok: true };
    case "suspend":
      if (currentStatus === "suspended") {
        return { ok: false, error: "license is already suspended" };
      }
      if (currentStatus === "cancelled") {
        return { ok: false, error: "cannot suspend a revoked license" };
      }
      return { ok: true };
    case "reactivate":
      if (currentStatus === "active") {
        return { ok: false, error: "license is already active" };
      }
      return { ok: true };
    default:
      return { ok: true };
  }
}

const RETURN_COLS =
  "id, account_id, customer_email, license_key, edition, features, seats, grace_days, status, expires_at, notes, issued_by, revoked_at, created_at, updated_at";

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
    const licenseId = String(body?.license_id ?? "").trim();
    const action = String(body?.action ?? "").trim();

    if (!licenseId) return json({ error: "license_id is required" }, 400);

    const admin = adminClient();

    // Confirm the license exists first.
    const { data: license, error: findErr } = await admin
      .from("licenses")
      .select(RETURN_COLS)
      .eq("id", licenseId)
      .maybeSingle();
    if (findErr || !license) return json({ error: "license not found" }, 404);

    if (VALID_STATUS_ACTIONS.has(action)) {
      const transition = validateTransition(license.status, action);
      if (!transition.ok) return json({ error: transition.error }, 400);
    }

    const patch: Record<string, unknown> = {};
    const detail: Record<string, unknown> = { action };

    switch (action) {
      case "revoke":
        patch.status = "cancelled";
        patch.revoked_at = new Date().toISOString();
        break;

      case "suspend":
        patch.status = "suspended";
        break;

      case "reactivate":
        patch.status = "active";
        patch.revoked_at = null;
        break;

      case "extend": {
        const expiresAt = body?.expires_at ? new Date(body.expires_at) : null;
        if (!expiresAt || isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
          return json({ error: "expires_at must be a valid future date" }, 400);
        }
        patch.expires_at = expiresAt.toISOString();
        detail.expires_at = patch.expires_at;
        break;
      }

      case "set_seats": {
        const seats = Math.floor(Number(body?.seats));
        if (!Number.isFinite(seats) || seats < 1 || seats > MAX_SEATS) {
          return json({ error: `seats must be between 1 and ${MAX_SEATS}` }, 400);
        }
        // Cannot drop below the number of currently bound devices.
        const { count } = await admin
          .from("license_seats")
          .select("id", { count: "exact", head: true })
          .eq("license_id", licenseId);
        if (seats < (count ?? 0)) {
          return json(
            { error: `cannot set seats below ${count} currently-bound devices; unbind a device first` },
            400,
          );
        }
        patch.seats = seats;
        detail.seats = seats;
        break;
      }

      case "set_edition": {
        const edition = String(body?.edition ?? "").trim();
        if (!EDITIONS.has(edition)) {
          return json({ error: "edition must be starter, business or enterprise" }, 400);
        }
        patch.edition = edition;
        detail.edition = edition;
        break;
      }

      case "set_features": {
        if (!Array.isArray(body?.features)) {
          return json({ error: "features must be an array" }, 400);
        }
        const features = body.features
          .filter((f: unknown) => typeof f === "string")
          .slice(0, 50);
        patch.features = features;
        detail.features = features;
        break;
      }

      case "set_notes": {
        const notes = typeof body?.notes === "string" ? body.notes.slice(0, 2000) : null;
        patch.notes = notes;
        detail.notes = notes;
        break;
      }

      case "unbind_seat": {
        const seatId = String(body?.seat_id ?? "").trim();
        if (!seatId) return json({ error: "seat_id is required" }, 400);
        const { error: delErr } = await admin
          .from("license_seats")
          .delete()
          .eq("id", seatId)
          .eq("license_id", licenseId);
        if (delErr) return json({ error: "failed to unbind device" }, 500);
        await audit("unbind_seat", actor, licenseId, { seat_id: seatId });
        const { data: refreshed } = await admin
          .from("licenses").select(RETURN_COLS).eq("id", licenseId).maybeSingle();
        return json({ license: refreshed });
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }

    patch.updated_at = new Date().toISOString();

    const { data: updated, error: updErr } = await admin
      .from("licenses")
      .update(patch)
      .eq("id", licenseId)
      .select(RETURN_COLS)
      .single();

    if (updErr || !updated) {
      console.error("license update error:", updErr);
      return json({ error: "failed to update license" }, 500);
    }

    await audit(action, actor, licenseId, detail);

    return json({ license: updated });
  } catch (e) {
    console.error("license-admin-update error:", e);
    return json({ error: "internal error" }, 500);
  }
});
