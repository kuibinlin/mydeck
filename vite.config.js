// defineConfig comes from vitest/config, not vite — it is the same function
// plus the `test` key below. Vite's own build is unaffected.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    // strictPort: fail loudly if 5173 is taken instead of drifting to 5174.
    // The auth flow is pinned to 5173 (FRONTEND_URL in worker/.dev.vars and the
    // GitHub OAuth callback), so a silent port change breaks login, not just CORS.
    port: 5173,
    strictPort: true,
  },
  test: {
    // Scoped to src/ on purpose. worker/ has its own suite that runs inside
    // workerd with real D1 and KV (worker/vitest.config.mjs) — those tests
    // import `cloudflare:test` and cannot run in this plain Node environment.
    // Run both with: npm test && npm --prefix worker test
    include: ['src/**/*.test.{js,jsx}'],
  },
})