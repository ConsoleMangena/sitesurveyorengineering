/**
 * GraceBanner
 * -----------
 * Non-blocking warning shown while the license is past its paid term but still
 * inside the offline grace window. Nudges the user to reconnect so the app
 * can re-validate and refresh the grace clock before it lapses.
 */

import { useLicense } from '@/contexts/LicenseContext'
import { daysUntil, refreshLicense } from '@/services/license'
import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'

export function GraceBanner() {
  const { status, refresh } = useLicense()
  const [checking, setChecking] = useState(false)

  const left = daysUntil(status?.grace_until ?? null)
  const daysText =
    left === null
      ? ''
      : left <= 0
        ? 'today'
        : left === 1
          ? 'in 1 day'
          : `in ${left} days`

  const handleReconnect = async () => {
    setChecking(true)
    try {
      await refreshLicense()
      await refresh()
    } finally {
      setChecking(false)
    }
  }

  return (
    <div style={{
      width: '100%',
      background: 'rgba(245, 158, 11, 0.12)',
      borderBottom: '1px solid rgba(245, 158, 11, 0.25)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '8px 16px',
        fontSize: '0.8125rem',
        color: '#f59e0b',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Your subscription has ended. SiteSurveyor keeps working offline, but access ends{' '}
            <strong>{daysText}</strong>. Connect to renew.
          </span>
        </div>
        <button
          onClick={handleReconnect}
          disabled={checking}
          style={{
            flexShrink: 0,
            height: '28px',
            padding: '0 12px',
            borderRadius: '6px',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            background: 'transparent',
            color: '#f59e0b',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: checking ? 'not-allowed' : 'pointer',
          }}
        >
          {checking ? 'Checking…' : 'Reconnect'}
        </button>
      </div>
    </div>
  )
}

export default GraceBanner
