/**
 * ActivationScreen
 * ----------------
 * Shown when the app is locked: no license, expired past grace, or invalid
 * (e.g. the token is bound to a different device). This is the whole-app gate.
 *
 * It performs a one-time online activation: it sends the machine fingerprint
 * (read from Rust) to the Supabase `license-activate` Edge Function via the
 * license service, then verifies + caches the returned signed token in Rust.
 */

import { useEffect, useRef, useState } from 'react'
import { useLicense } from '@/contexts/LicenseContext'
import { getFingerprint } from '@/services/license'
import { signOut } from '@/lib/auth/session'
import { KeyRound, ShieldAlert, Copy, Check, Clipboard, ArrowLeft } from 'lucide-react'

const SEGMENT_LENGTHS = [3, 4, 4, 4, 4]

function distributeKey(raw: string): string[] {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const segments = Array(SEGMENT_LENGTHS.length).fill('')
  let pos = 0
  for (let i = 0; i < SEGMENT_LENGTHS.length; i++) {
    segments[i] = cleaned.slice(pos, pos + SEGMENT_LENGTHS[i])
    pos += SEGMENT_LENGTHS[i]
  }
  return segments
}

async function readClipboardText(): Promise<string> {
  if (navigator.clipboard?.readText) {
    try {
      const text = await navigator.clipboard.readText()
      if (text != null) return text
    } catch {
      // Permission denied or API unavailable — fall through.
    }
  }

  const input = document.createElement('textarea')
  input.setAttribute('readonly', 'true')
  input.setAttribute('aria-hidden', 'true')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  input.style.pointerEvents = 'none'
  input.style.left = '-9999px'
  input.style.top = '0'
  input.tabIndex = -1
  document.body.appendChild(input)

  let text = ''
  try {
    input.focus()
    input.select()
    if (document.execCommand('paste')) {
      text = input.value
    }
  } finally {
    document.body.removeChild(input)
  }

  if (text != null) return text
  throw new Error('Clipboard unavailable')
}

export function ActivationScreen({ mismatch = false }: { mismatch?: boolean }) {
  const { state, status, activate } = useLicense()
  const [segments, setSegments] = useState<string[]>(Array(SEGMENT_LENGTHS.length).fill(''))
  const segmentRefs = useRef<(HTMLInputElement | null)[]>([])
  const [fingerprint, setFingerprint] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    getFingerprint().then(setFingerprint).catch(() => setFingerprint(''))
  }, [])

  const expired = state === 'expired'
  const invalid = state === 'invalid'

  const heading = mismatch
    ? 'Activate for this account'
    : invalid
      ? 'License problem'
      : expired
        ? 'Subscription expired'
        : 'Activate SiteSurveyor'

  const subtitle = mismatch
    ? 'This device is activated for a different account.'
    : invalid
      ? status?.message || 'This license could not be verified.'
      : expired
        ? 'Renew to continue.'
        : 'Enter your license key to activate this device.'

  const licenseKey = segments.join('-')

  const focusSegmentAfter = (distributed: string[]) => {
    let focusIndex = 0
    for (let i = 0; i < distributed.length; i++) {
      if (distributed[i].length < SEGMENT_LENGTHS[i]) {
        focusIndex = i
        break
      }
      focusIndex = Math.min(i + 1, distributed.length - 1)
    }
    segmentRefs.current[focusIndex]?.focus()
  }

  const handleSegmentChange = (index: number, value: string) => {
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const maxLen = SEGMENT_LENGTHS[index]
    const truncated = cleaned.slice(0, maxLen)

    setSegments(prev => {
      const next = [...prev]
      next[index] = truncated
      return next
    })

    if (truncated.length === maxLen && index < SEGMENT_LENGTHS.length - 1) {
      segmentRefs.current[index + 1]?.focus()
    }
  }

  const handleSegmentKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && segments[index] === '' && index > 0) {
      segmentRefs.current[index - 1]?.focus()
    }
  }

  const handleSegmentPaste = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text')
    const distributed = distributeKey(pasted)
    setSegments(distributed)
    focusSegmentAfter(distributed)
  }

  const handlePasteButton = async () => {
    setError('')
    try {
      const text = await readClipboardText()
      if (!text.trim()) {
        setError('Clipboard is empty')
        return
      }
      const distributed = distributeKey(text)
      setSegments(distributed)
      focusSegmentAfter(distributed)
    } catch {
      setError('Could not read clipboard. Long-press a box and choose Paste, or press Ctrl+V / Cmd+V.')
      segmentRefs.current[0]?.focus()
    }
  }

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await activate(licenseKey.trim() || undefined)
    } catch (err) {
      const msg = typeof err === 'string' ? err : (err instanceof Error ? err.message : 'Activation failed. Please try again.')
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const copyFingerprint = async () => {
    try {
      await navigator.clipboard.writeText(fingerprint)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable; ignore */
    }
  }

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
      padding: '1.5rem',
      position: 'relative',
    }}>
      <button
        type="button"
        onClick={() => void signOut()}
        style={{
          position: 'absolute',
          top: '1.5rem',
          left: '1.5rem',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 12px',
          borderRadius: '8px',
          border: '1px solid rgba(148, 163, 184, 0.2)',
          background: 'rgba(15, 23, 42, 0.5)',
          color: '#94a3b8',
          fontSize: '0.8125rem',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        <ArrowLeft size={16} />
        Back to sign in
      </button>

      <div style={{
        width: '100%',
        maxWidth: '420px',
        background: 'rgba(30, 41, 59, 0.8)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(148, 163, 184, 0.15)',
        borderRadius: '16px',
        padding: '2rem',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: invalid || expired || mismatch
              ? 'rgba(239, 68, 68, 0.15)'
              : 'rgba(99, 102, 241, 0.15)',
            marginBottom: '12px',
          }}>
            {invalid || expired || mismatch ? (
              <ShieldAlert size={24} color="#ef4444" />
            ) : (
              <KeyRound size={24} color="#6366f1" />
            )}
          </div>
          <h2 style={{
            fontSize: '1.25rem',
            fontWeight: 700,
            color: '#f1f5f9',
            margin: '0 0 4px 0',
          }}>{heading}</h2>
          <p style={{
            fontSize: '0.875rem',
            color: '#94a3b8',
            margin: 0,
          }}>{subtitle}</p>
        </div>

        <form onSubmit={handleActivate} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            License key
          </label>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            {SEGMENT_LENGTHS.map((len, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input
                  ref={el => { segmentRefs.current[i] = el }}
                  type="text"
                  value={segments[i]}
                  onChange={(e) => handleSegmentChange(i, e.target.value)}
                  onKeyDown={(e) => handleSegmentKeyDown(i, e)}
                  onPaste={(e) => handleSegmentPaste(i, e)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  inputMode="text"
                  maxLength={len}
                  placeholder={'•'.repeat(len)}
                  style={{
                    width: '52px',
                    height: '48px',
                    borderRadius: '8px',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    background: 'rgba(15, 23, 42, 0.6)',
                    color: '#f1f5f9',
                    textAlign: 'center',
                    fontFamily: 'monospace',
                    fontSize: '0.875rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    outline: 'none',
                  }}
                />
                {i < SEGMENT_LENGTHS.length - 1 && (
                  <span style={{ fontFamily: 'monospace', fontSize: '1.125rem', color: '#64748b' }}>-</span>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={handlePasteButton}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              width: '100%',
              height: '36px',
              borderRadius: '8px',
              border: '1px solid rgba(148, 163, 184, 0.2)',
              background: 'transparent',
              color: '#94a3b8',
              fontSize: '0.8125rem',
              cursor: 'pointer',
            }}
          >
            <Clipboard size={14} />
            Paste License Key
          </button>

          {error && (
            <div style={{
              padding: '10px 12px',
              borderRadius: '8px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              color: '#fca5a5',
              fontSize: '0.8125rem',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              height: '44px',
              borderRadius: '8px',
              border: 'none',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: '#ffffff',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Activating…' : expired ? 'Renew & activate' : 'Activate device'}
          </button>
        </form>

        <button
          type="button"
          onClick={copyFingerprint}
          disabled={!fingerprint}
          title="Copy device ID"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            margin: '16px auto 0',
            padding: '4px 8px',
            border: 'none',
            background: 'transparent',
            color: '#64748b',
            fontSize: '0.6875rem',
            cursor: fingerprint ? 'pointer' : 'default',
            maxWidth: '100%',
          }}
        >
          <span style={{ flexShrink: 0 }}>Device ID</span>
          <code style={{
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{fingerprint || 'resolving…'}</code>
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  )
}

export default ActivationScreen
