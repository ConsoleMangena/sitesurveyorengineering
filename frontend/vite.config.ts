/// <reference types="vitest/config" />
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import type { PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// wasm + top-level-await enable the lazy-loaded survey-wasm geometry module.
// The CAD bridge only imports it on demand, so it ships as a separate chunk and
// never affects the initial app bundle.
//
// They are loaded synchronously and only outside Vitest: the test runner does
// not bundle the WASM chunk (the bridge falls back to the pure-TS surface engine
// under test), and these plugins pull in build-only peers that need not be
// present for unit tests. This keeps `npm run test` fast and dependency-light
// while production `build`/`dev` get the optimised WebAssembly path.
function wasmPlugins(): PluginOption[] {
  if (process.env.VITEST) return []
  const require = createRequire(import.meta.url)
  const wasm = require('vite-plugin-wasm').default
  const topLevelAwait = require('vite-plugin-top-level-await').default
  return [wasm(), topLevelAwait()]
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), nodePolyfills(), ...wasmPlugins()],
  // @solana/web3.js (v1) and its deps reference Node's `global`. Alias it to
  // globalThis so the browser bundle resolves it; `Buffer` is polyfilled in
  // src/main.tsx.
  define: {
    global: 'globalThis',
  },
  // WebAssembly and top-level await require a modern output target. The default
  // (es2020/chrome87) cannot transform the wrapper that vite-plugin-top-level-await
  // emits, so pin both the dependency-optimizer and the final build to es2022.
  build: {
    target: 'es2022',
    // Split heavy, rarely-changing vendor libraries into their own chunk so the
    // app code and the vendor code can be cached independently. This also keeps
    // any single chunk under the 500 kB warning threshold.
    rolldownOptions: {
      output: {
        // Rolldown (Vite 8) expects manualChunks as a function rather than the
        // object map Rollup used. Group heavy vendor libraries by id.
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
              return 'vendor-react'
            }
            if (id.includes('@supabase')) {
              return 'vendor-supabase'
            }
          }
        },
      },
    },
  },
  optimizeDeps: { rolldownOptions: { transform: { target: 'es2022' } } },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Under Vite 8 (rolldown-vite) + Vitest 4 the default `forks`/`threads`
    // pool fails to initialise the worker runner state before test
    // collection, so every `describe()` throws "Cannot read properties of
    // undefined (reading 'config')" and zero tests run. The `vmThreads`
    // pool sets up the runner correctly. Revisit once Vitest fully supports
    // the Vite 8 module runner in the default pool.
    pool: 'vmThreads',
  },
})
