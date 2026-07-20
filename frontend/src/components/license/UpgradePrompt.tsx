/**
 * UpgradePrompt
 * -------------
 * Reusable upsell shown as the `fallback` for FeatureGate / EditionGate when
 * the active license does not include a premium capability. Purely cosmetic:
 * the real enforcement lives in Rust + the Supabase RLS license check.
 */

import type { Edition } from '@/services/license'
import { Sparkles, Lock } from 'lucide-react'

const EDITION_LABEL: Record<Edition, string> = {
  starter: 'Starter',
  business: 'Business',
  enterprise: 'Enterprise',
}

export function UpgradePrompt({
  title = 'Premium feature',
  description,
  requiredEdition,
}: {
  title?: string
  description?: string
  requiredEdition?: Edition
}) {
  const planText = requiredEdition
    ? `Available on the ${EDITION_LABEL[requiredEdition]} plan and above.`
    : 'Available on a higher plan.'

  return (
    <div style={{ padding: '2rem', maxWidth: '640px', margin: '0 auto' }}>
      <div style={{
        position: 'relative',
        borderRadius: '12px',
        border: '1px solid rgba(148, 163, 184, 0.15)',
        overflow: 'hidden',
        background: 'rgba(30, 41, 59, 0.6)',
      }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(59,130,246,0.08), rgba(139,92,246,0.08))',
          pointerEvents: 'none',
        }} />
        <div style={{ position: 'relative', padding: '1.5rem' }}>
          <div style={{
            display: 'inline-flex',
            padding: '12px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(59,130,246,0.15))',
            marginBottom: '12px',
          }}>
            <Lock size={24} color="#6366f1" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#f1f5f9', margin: 0 }}>
              {title}
            </h3>
            {requiredEdition && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 8px',
                borderRadius: '99px',
                background: 'rgba(148, 163, 184, 0.15)',
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: '#94a3b8',
              }}>
                <Sparkles size={10} />
                {EDITION_LABEL[requiredEdition]}
              </span>
            )}
          </div>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8', margin: '0 0 12px 0' }}>
            {description || 'This capability is not included in your current plan.'}
          </p>
          <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: 0 }}>
            {planText} Contact your administrator or upgrade your subscription to unlock it.
          </p>
        </div>
      </div>
    </div>
  )
}

export default UpgradePrompt
