/**
 * Entitlements — canonical mapping of premium capabilities.
 * ---------------------------------------------------------
 * Single source of truth for which EDITION and/or FEATURE flag a premium
 * capability requires. Used by:
 *   - Page-level gates (EditionGate / FeatureGate fallbacks).
 *   - Navigation filtering (hide links the license doesn't permit).
 *
 * These are convenience/UX checks. The hard enforcement for sensitive
 * capabilities is in Rust + the Supabase RLS license check, which re-validate
 * server-side regardless of what the UI shows.
 */

import type { Edition } from '@/services/license'

export const EDITION_RANK: Record<Edition, number> = {
  starter: 1,
  business: 2,
  enterprise: 3,
}

/** Known feature flags that can be attached to a license. */
export type FeatureFlag =
  | 'lidar_import'
  | 'gdal_raster'
  | 'shapefile_import'
  | 'proj_transforms'
  | 'advanced_cad'
  | 'team_collab'

/**
 * A premium capability requires the active license to meet BOTH (when present):
 *   - a minimum edition, and/or
 *   - a specific feature flag.
 * If neither is set, the capability is available to any active license.
 */
export interface Entitlement {
  minEdition?: Edition
  feature?: FeatureFlag
}

/**
 * Capability registry, keyed by a stable capability id. Page gates and nav
 * items reference these ids so the rules live in exactly one place.
 */
export const CAPABILITIES = {
  lidarImport: { minEdition: 'business', feature: 'lidar_import' } as Entitlement,
  gdalRaster: { minEdition: 'business', feature: 'gdal_raster' } as Entitlement,
  shapefileImport: { minEdition: 'business', feature: 'shapefile_import' } as Entitlement,
  projTransforms: { minEdition: 'business', feature: 'proj_transforms' } as Entitlement,
  advancedCad: { minEdition: 'enterprise', feature: 'advanced_cad' } as Entitlement,
  teamCollab: { minEdition: 'enterprise', feature: 'team_collab' } as Entitlement,
} satisfies Record<string, Entitlement>

export type CapabilityId = keyof typeof CAPABILITIES

/**
 * Evaluate an entitlement against the current license edition + features.
 * Returns true when the license satisfies the requirement.
 *
 * `edition` null / not-licensed → only capabilities with no requirement pass.
 */
export function meetsEntitlement(
  ent: Entitlement | undefined,
  edition: Edition | null,
  features: string[],
): boolean {
  if (!ent) return true

  if (ent.minEdition) {
    if (!edition) return false
    if (EDITION_RANK[edition] < EDITION_RANK[ent.minEdition]) return false
  }

  if (ent.feature) {
    if (!features.includes(ent.feature)) return false
  }

  return true
}
