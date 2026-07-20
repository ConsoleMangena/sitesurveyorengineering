/**
 * Edge Function: license-admin-list  (PLATFORM ADMIN ONLY)
 * ---------------------------------------------------------
 * Lists licenses with their bound-seat counts and devices, for the vendor
 * license dashboard. Authorization enforced server-side.
 *
 * Request (POST, admin):
 *   {
 *     search?: string,
 *     status?: 'active'|'suspended'|'cancelled',
 *     page?: number,
 *     page_size?: number
 *   }
 *
 * Response:
 *   200 { licenses: License[], total: number, page, page_size }
 */

import { corsHeaders, json, adminClient } from "../_shared/supabase.ts";
import { requirePlatformAdmin } from "../_shared/platformAdmin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    await requirePlatformAdmin(req);
  } catch (e) {
    return json({ error: (e as Error).message || "not authorized" }, 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const search = typeof body?.search === "string" ? body.search.trim() : "";
    const status = typeof body?.status === "string" ? body.status.trim() : "";
    const page = Math.max(1, Number(body?.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(body?.page_size) || 20));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const admin = adminClient();

    let query = admin
      .from("licenses")
      .select(
        "id, account_id, customer_email, license_key, edition, features, seats, grace_days, status, expires_at, notes, issued_by, revoked_at, created_at, updated_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(from, to);

    if (status) query = query.eq("status", status);
    if (search) {
      const safe = search.replace(/[,()]/g, " ");
      query = query.or(`customer_email.ilike.%${safe}%,license_key.ilike.%${safe}%`);
    }

    const { data: licenses, count, error } = await query;
    if (error) {
      console.error("list licenses error:", error);
      return json({ error: "failed to list licenses" }, 500);
    }

    const ids = (licenses ?? []).map((l) => l.id);
    const seatsByLicense: Record<string, { id: string; fingerprint: string; last_seen_at: string | null; created_at: string }[]> = {};

    if (ids.length > 0) {
      const { data: seats } = await admin
        .from("license_seats")
        .select("id, license_id, fingerprint, last_seen_at, created_at")
        .in("license_id", ids);
      for (const s of seats ?? []) {
        (seatsByLicense[s.license_id] ??= []).push({
          id: s.id,
          fingerprint: s.fingerprint,
          last_seen_at: s.last_seen_at,
          created_at: s.created_at,
        });
      }
    }

    const enriched = (licenses ?? []).map((l) => ({
      ...l,
      seats_used: seatsByLicense[l.id]?.length ?? 0,
      bound_devices: seatsByLicense[l.id] ?? [],
    }));

    return json({ licenses: enriched, total: count ?? 0, page, page_size: pageSize });
  } catch (e) {
    console.error("license-admin-list error:", e);
    return json({ error: "internal error" }, 500);
  }
});
