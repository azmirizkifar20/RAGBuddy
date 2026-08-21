import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const LANDING_DIR = path.resolve(import.meta.dirname, '../landing')

const LANDING_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

/** Dev-only parity with production (`src/server/app.ts`): the repo-root `landing/` page answers
 *  `/` plus its `images/` + `fonts/` assets, while everything else (`/login`, `/dashboard`, …)
 *  falls through to Vite's normal SPA handling. Registered pre-internal-middleware so it wins
 *  over Vite's own index.html serving for `/`. */
function serveLanding(): Plugin {
  return {
    name: 'serve-landing-at-root',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '/').split('?')[0])
        const rel = url === '/' ? '/index.html' : url
        if (rel !== '/index.html' && !rel.startsWith('/images/') && !rel.startsWith('/fonts/')) return next()
        const file = path.join(LANDING_DIR, rel)
        if (!file.startsWith(LANDING_DIR + path.sep)) return next()
        fs.readFile(file, (err, data) => {
          if (err) return next() // landing/ missing or file gone — let Vite handle it
          res.setHeader('Content-Type', LANDING_TYPES[path.extname(file)] ?? 'application/octet-stream')
          res.end(data)
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [serveLanding(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:4300',
    },
  },
})
