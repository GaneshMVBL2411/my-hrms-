import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The API server runs as a separate process on 3001. In development both are
// on localhost so the browser can reach each directly, but when the dev server
// is exposed through a tunnel (ngrok) the visitor's "localhost" is their own
// machine, not this one. Proxying /api through Vite means the app and its API
// share one origin, so a single tunnelled URL is enough — and same-origin
// requests skip CORS preflight entirely.
const API_TARGET = 'http://localhost:3001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Tunnel hostnames are generated per session, so they cannot be listed
    // ahead of time; without this Vite answers them with "Blocked request".
    allowedHosts: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
})
