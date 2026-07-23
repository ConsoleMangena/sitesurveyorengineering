import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "../auth/session.ts";
import { supabase } from "../supabase/client.ts";

/**
 * Subscribable "System Features" (software add-ons) surfaced in the
 * Marketplace. A workspace requests a feature; a platform admin accepts or
 * declines; on acceptance the workspace holds an active entitlement.
 *
 * The CAD Engine (key: "cad_engine") is the first such feature.
 *
 * These tables are not in the generated Supabase types yet, so we use a
 * loosely-typed client (matching the pattern used in adminPlatform.ts).
 */
const db = supabase as unknown as SupabaseClient;

export const CAD_FEATURE_KEY = "cad_engine";

export type FeatureBillingPeriod = "one_time" | "monthly" | "annual";
export type FeatureRequestStatus = "pending" | "approved" | "declined";
export type FeatureEntitlementStatus = "active" | "revoked";

export interface FeatureCatalogRow {
  key: string;
  name: string;
  description: string | null;
  category: string;
  price: number;
  currency: string;
  billing_period: FeatureBillingPeriod;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FeatureRequestRow {
  id: string;
  workspace_id: string;
  feature_key: string;
  requested_by: string | null;
  status: FeatureRequestStatus;
  note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeatureEntitlementRow {
  workspace_id: string;
  feature_key: string;
  status: FeatureEntitlementStatus;
  granted_by: string | null;
  granted_at: string;
}

/** Per-feature status, combining catalog + this workspace's request/entitlement. */
export interface WorkspaceFeatureStatus {
  feature: FeatureCatalogRow;
  /** "active" when entitled; otherwise the latest request status, or null. */
  state: "active" | FeatureRequestStatus | null;
}

export async function listFeatureCatalog(): Promise<FeatureCatalogRow[]> {
  const { data, error } = await db
    .from("feature_catalog")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw new Error(`Failed to load feature catalog: ${error.message}`);
  return (data as FeatureCatalogRow[] | null) ?? [];
}

export async function listMyFeatureEntitlements(
  workspaceId: string,
): Promise<FeatureEntitlementRow[]> {
  const { data, error } = await db
    .from("workspace_feature_entitlements")
    .select("*")
    .eq("workspace_id", workspaceId);

  if (error) throw new Error(`Failed to load entitlements: ${error.message}`);
  return (data as FeatureEntitlementRow[] | null) ?? [];
}

export async function listMyFeatureRequests(
  workspaceId: string,
): Promise<FeatureRequestRow[]> {
  const { data, error } = await db
    .from("feature_access_requests")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to load feature requests: ${error.message}`);
  return (data as FeatureRequestRow[] | null) ?? [];
}

/** True when the workspace holds an active entitlement for the feature. */
export async function hasFeature(
  workspaceId: string,
  featureKey: string,
): Promise<boolean> {
  if (!workspaceId) return false;
  const { data, error } = await db
    .from("workspace_feature_entitlements")
    .select("feature_key, status")
    .eq("workspace_id", workspaceId)
    .eq("feature_key", featureKey)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    // Migration not applied yet, or no row: treat as not entitled.
    return false;
  }
  return Boolean(data);
}

export async function requestFeature(
  workspaceId: string,
  featureKey: string,
  note?: string,
): Promise<FeatureRequestRow> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in to request a feature.");

  const { data, error } = await db
    .from("feature_access_requests")
    .insert({
      workspace_id: workspaceId,
      feature_key: featureKey,
      requested_by: user.id,
      status: "pending",
      note: note?.trim() || null,
    })
    .select("*")
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new Error("A request for this feature is already pending review.");
    }
    throw new Error(`Failed to submit request: ${error.message}`);
  }
  return data as FeatureRequestRow;
}

/**
 * Combine catalog + entitlements + requests into a single per-feature status
 * list for rendering in the Marketplace "System Features" segment.
 */
export async function listWorkspaceFeatureStatuses(
  workspaceId: string,
): Promise<WorkspaceFeatureStatus[]> {
  const [catalog, entitlements, requests] = await Promise.all([
    listFeatureCatalog(),
    listMyFeatureEntitlements(workspaceId),
    listMyFeatureRequests(workspaceId),
  ]);

  const activeKeys = new Set(
    entitlements.filter((e) => e.status === "active").map((e) => e.feature_key),
  );
  // requests are ordered newest-first, so the first hit per key is the latest.
  const latestRequestByKey = new Map<string, FeatureRequestStatus>();
  for (const r of requests) {
    if (!latestRequestByKey.has(r.feature_key)) {
      latestRequestByKey.set(r.feature_key, r.status);
    }
  }

  return catalog
    .filter((f) => f.is_active)
    .map((feature) => {
      const state: WorkspaceFeatureStatus["state"] = activeKeys.has(feature.key)
        ? "active"
        : latestRequestByKey.get(feature.key) ?? null;
      return { feature, state };
    });
}
