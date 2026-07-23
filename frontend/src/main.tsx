import { Buffer } from 'buffer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// @solana/web3.js (v1) expects Node's Buffer and `global` to exist. Polyfill
// them for the browser before any Solana code runs.
const globalAny = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer
  global?: unknown
}
if (typeof globalAny.Buffer === 'undefined') {
  globalAny.Buffer = Buffer
}
if (typeof globalAny.global === 'undefined') {
  globalAny.global = globalThis
}
import App from './App.tsx'
import { initializeThemeMode } from './lib/theme.ts'

initializeThemeMode()

// Tauri mobile builds run edge-to-edge under the system status/navigation bars.
// Add a class so CSS can apply safe-area fallbacks on devices that do not
// expose env(safe-area-inset-*) values (common in older Android WebViews).
if (import.meta.env.VITE_MOBILE_BUILD === 'true') {
  document.documentElement.classList.add('mobile-build')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
