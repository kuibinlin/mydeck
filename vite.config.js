import { defineConfig } from 'vite'
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
  }
})