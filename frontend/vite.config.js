// defineConfig comes from vitest/config, not vite — it is the same function
// plus the `test` key below. Vite's own build is unaffected.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  // Pinned to this file's directory rather than left to cwd, so `vite` behaves
  // the same whether it is started by `npm -w frontend run dev` or by a
  // `--config frontend/vite.config.js` invocation from the repo root.
  root: here('.'),
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': here('./src')
    }
  },
  // .env lives at the repo ROOT, not in frontend/. Vite looks beside `root` by
  // default, would find nothing, and VITE_API_URL would come back undefined —
  // every API call then goes to "undefined/...". Keeping the file at the root is
  // deliberate: one env file for the repo, sitting next to .env.example.
  envDir: here('..'),
  server: {
    // strictPort: fail loudly if 5173 is taken instead of drifting to 5174.
    // The auth flow is pinned to 5173 (FRONTEND_URL in backend/.dev.vars and the
    // GitHub OAuth callback), so a silent port change breaks login, not just CORS.
    port: 5173,
    strictPort: true,
    fs: {
      // Three tests under features/chinese/ import backend/src directly to pin
      // the duplicated logic (see test comment below). The dev server's fs guard
      // is rooted at frontend/ and would deny anything above it, so the repo root
      // is allowed explicitly.
      allow: [here('..')],
    },
  },
  test: {
    // Scoped to src/ on purpose. backend/ has its own suite that runs inside
    // workerd with real D1 and KV (backend/vitest.config.mjs) — those tests
    // import `cloudflare:test` and cannot run in this plain Node environment.
    // Run both with `npm test` from the repo root.
    include: ['src/**/*.test.{js,jsx}'],
  },
})
