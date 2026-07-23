/**
 * LicenseGate
 * -----------
 * Whole-app activation gate. Wraps the routed application so that nothing
 * renders until the device holds a valid (active or in-grace) license.
 *
 * States:
 *   - loading    → show the standard loading screen while Rust is queried.
 *   - locked     → (unlicensed / expired / invalid) show ActivationScreen.
 *   - licensed   → render the app. A non-blocking banner appears during grace.
 *
 * The trust decision is made in Rust; this component only reacts to it.
 */

import type { ReactNode } from 'react'
import { useLicense } from '@/contexts/LicenseContext'
import { useAuthStore } from '@/lib/auth/auth-store'
import { ActivationScreen } from '@/components/license/ActivationScreen'
import { GraceBanner } from '@/components/license/GraceBanner'

export function LicenseGate({ children }: { children: ReactNode }) {
  const { loading, isLocked, state, status } = useLicense()
  const user = useAuthStore((s) => s.user)

  if (loading) {
    return null // Parent already shows SplashScreen during loading
  }

  // Account-binding check: a locally-cached license is only usable by the
  // account it was issued to. If the signed-in account differs from the
  // token's account_id, force re-activation.
  const accountMismatch =
    !!user && !!status?.account_id && status.account_id !== user.id

  if (isLocked || accountMismatch) {
    return <ActivationScreen mismatch={accountMismatch} />
  }

  return (
    <>
      {state === 'grace' && <GraceBanner />}
      {children}
    </>
  )
}

export default LicenseGate
