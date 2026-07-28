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
import { registerSW } from 'virtual:pwa-register'

// Register the generated service worker in production builds so the app shell
// (HTML, JS, CSS, assets) is cached for offline use.
if (import.meta.env.PROD) {
  registerSW({
    immediate: true,
    onOfflineReady() {
      console.info('[PWA] Ready to work offline')
    },
    onNeedRefresh() {
      // autoUpdate is enabled, so this callback is mainly for logging.
      console.info('[PWA] Update available, reloading next time')
    },
  })
}

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
