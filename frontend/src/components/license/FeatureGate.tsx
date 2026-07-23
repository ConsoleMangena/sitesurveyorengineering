/**
 * FeatureGate / EditionGate
 * -------------------------
 * Edition- and feature-level gating layered ON TOP of the existing RBAC
 * (`permissions.ts`). RBAC answers "is this role allowed to do this?";
 * licensing answers "does this customer's plan include this capability?".
 *
 * Use these to hide/disable premium UI. Remember the React layer is only a
 * convenience: the hard enforcement for sensitive capabilities is done in
 * Rust + the Supabase RLS license check.
 */

import type { ReactNode } from 'react'
import { useLicense } from '@/contexts/LicenseContext'
import type { Edition } from '@/services/license'

/** Render children only when the active license includes `feature`. */
export function FeatureGate({
  feature,
  children,
  fallback = null,
}: {
  feature: string
  children: ReactNode
  fallback?: ReactNode
}) {
  const { hasFeature } = useLicense()
  return <>{hasFeature(feature) ? children : fallback}</>
}

/** Render children only when the active edition is at least `min`. */
export function EditionGate({
  min,
  children,
  fallback = null,
}: {
  min: Edition
  children: ReactNode
  fallback?: ReactNode
}) {
  const { requireEdition } = useLicense()
  return <>{requireEdition(min) ? children : fallback}</>
}

/** Hook form for imperative checks inside components. */
// eslint-disable-next-line react-refresh/only-export-components
export function useFeature(feature: string): boolean {
  const { hasFeature } = useLicense()
  return hasFeature(feature)
}

// eslint-disable-next-line react-refresh/only-export-components
export function useEditionAtLeast(min: Edition): boolean {
  const { requireEdition } = useLicense()
  return requireEdition(min)
}
