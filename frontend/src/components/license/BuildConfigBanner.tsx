/**
 * BuildConfigBanner (DEV ONLY)
 * ----------------------------
 * Surfaces licensing misconfiguration to developers immediately on launch,
 * rather than letting it manifest as a confusing activation failure later.
 *
 * Renders only in development builds (import.meta.env.DEV) and only when the
 * licensing public key is missing/invalid.
 */

import { useEffect, useState } from 'react'
import { getSelfCheck } from '@/services/license'
import { AlertTriangle } from 'lucide-react'

export function BuildConfigBanner() {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    getSelfCheck()
      .then((sc) => {
        if (!sc.key_configured) {
          setMessage(sc.message || 'Licensing public key is not configured for this build.')
        }
      })
      .catch(() => {
        /* Tauri bridge unavailable (e.g. web preview); ignore. */
      })
  }, [])

  if (!message) return null

  return (
    <div style={{
      width: '100%',
      background: '#dc2626',
      color: '#ffffff',
      fontSize: '0.8125rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px' }}>
        <AlertTriangle size={16} style={{ flexShrink: 0 }} />
        <span>
          <strong>Dev warning:</strong> {message} Run{' '}
          <code style={{
            fontFamily: 'monospace',
            background: 'rgba(255,255,255,0.2)',
            padding: '1px 4px',
            borderRadius: '3px',
          }}>node scripts/setup-licensing.mjs</code>{' '}
          and rebuild.
        </span>
      </div>
    </div>
  )
}

export default BuildConfigBanner
