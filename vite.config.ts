import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { pwaBuild } from './build/pwa.ts'

export default defineConfig({
  worker: { format: 'es' },
  plugins: [
    react(),
    tailwindcss(),
    ...pwaBuild(),
    {
      name: 'production-csp',
      // React Fast Refresh injects an inline development preamble.
      // Keep the restrictive HTML policy on production builds only.
      transformIndexHtml: {
        order: 'pre',
        handler(html, context) {
          return context.server
            ? html.replace(/ {4}<meta http-equiv="Content-Security-Policy"[^>]*>\n/, '')
            : html
        },
      },
    },
  ],
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
})
