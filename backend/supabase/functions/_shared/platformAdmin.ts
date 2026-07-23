/**
 * Platform-admin authorization for license-admin Edge Functions.
 * ---------------------------------------------------------------
 * License management is restricted to accounts with `profiles.is_platform_admin
 * = true`. This check runs SERVER-SIDE on every admin function, so the React UI
 * gate is a convenience only: the authoritative decision is made here.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adminClient } from "./supabase.ts";

export interface PlatformAdmin {
  id: string;
  email: string;
}

/**
 * Verify the request comes from a platform-admin account. Returns the caller on
 * success; throws an Error (caught by the function → 403) otherwise.
 */
export async function requirePlatformAdmin(req: Request): Promise<PlatformAdmin> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw new Error("authentication required");

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) throw new Error("server auth not configured");

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) throw new Error("authentication required");

  const id = data.user.id;
  const email = (data.user.email ?? "").toLowerCase();

  // Authorization: caller must be a platform admin. Read with the service
  // role (bypasses RLS, authoritative).
  const admin = adminClient();
  const { data: row, error: rowErr } = await admin
    .from("profiles")
    .select("is_platform_admin")
    .eq("id", id)
    .maybeSingle();

  if (rowErr) throw new Error("authorization check failed");
  if (!row || row.is_platform_admin !== true) {
    throw new Error("not authorized");
  }

  return { id, email };
}

/** Write an append-only audit entry. Best-effort: never blocks the operation. */
export async function audit(
  action: string,
  actor: PlatformAdmin,
  licenseId: string | null,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    const admin = adminClient();
    await admin.from("license_audit").insert({
      license_id: licenseId,
      action,
      actor_id: actor.id,
      actor_email: actor.email,
      detail,
    });
  } catch (e) {
    console.error("audit log failed:", e);
  }
}
