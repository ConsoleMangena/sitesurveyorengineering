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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
