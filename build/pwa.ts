import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { assetMime, DOCUMENT_CSP, MAX_ASSET_BYTES, PUBLIC_PATHS, validateInventory, validBuildId, WORKER_CSP } from '../src/pwa/protocol.ts'
import type { Asset } from '../src/pwa/protocol.ts'

export function responseHeaders(path: string): Record<string, string> {
  const mime = path === '/sw.js' ? 'text/javascript' : assetMime(path === '/' ? '/index.html' : path)
  return { ...(mime ? { 'Content-Type': mime } : {}), 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': path === '/sw.js' ? WORKER_CSP : DOCUMENT_CSP,
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': path === '/sw.js' ? 'no-cache' : path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' }
}
async function files(directory: string, prefix = ''): Promise<string[]> {
  const result: string[] = []
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = prefix + item.name
    if (item.isDirectory()) result.push(...await files(resolve(directory, item.name), path + '/'))
    else result.push(path)
  }
  return result
}
export function pwaBuild() {
  const buildId = process.env.GIBBERISH_BUILD_ID ?? randomUUID()
  if (!validBuildId(buildId)) throw new Error('Invalid public build ID')
  let output = resolve('dist')
  const contract: Plugin = {
    name: 'gibberish-public-build-contract',
    config: () => ({ define: { __GIBBERISH_BUILD_ID__: JSON.stringify(buildId) } }),
    configResolved(config) { output = resolve(config.root, config.build.outDir) },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (!assetMime(url.pathname === '/' ? '/index.html' : url.pathname) && url.pathname !== '/sw.js') { res.statusCode = 404; res.end('Public asset not found'); return }
        void stat(resolve(output, '.' + (url.pathname === '/' ? '/index.html' : url.pathname))).then((file) => {
          if (!file.isFile()) { res.statusCode = 404; res.end('Public asset not found'); return }
          for (const [key, value] of Object.entries(responseHeaders(url.pathname))) res.setHeader(key, value)
          next()
        }, () => { res.statusCode = 404; res.end('Public asset not found') })
      })
    },
  }
  const pwa = VitePWA({
    strategies: 'injectManifest', srcDir: 'src/pwa', filename: 'sw.ts',
    injectRegister: null, registerType: 'prompt', includeAssets: [], includeManifestIcons: false,
    devOptions: { enabled: false },
    // Own the static manifest explicitly: plugin-generated manifests append an
    // unvalidated extra Workbox entry after user transforms. Every byte here
    // must pass the same inventory path, including the public manifest itself.
    manifest: false,
    injectManifest: {
      rollupFormat: 'iife', maximumFileSizeToCacheInBytes: MAX_ASSET_BYTES,
      globPatterns: ['index.html', 'manifest.webmanifest', 'favicon.svg', 'icons/*.png', 'assets/*.{js,css,wasm}'],
      manifestTransforms: [async (entries) => {
        const emitted = await files(output)
        if (emitted.some((p) => p !== 'sw.js' && p !== '.gitkeep' && !p.endsWith('.map') && !assetMime('/' + p))) throw new Error('Unreviewed public build output')
        const paths = emitted.filter((p) => assetMime('/' + p)).sort()
        const received = entries.map((e) => e.url).sort()
        if (JSON.stringify(paths) !== JSON.stringify(received)) throw new Error('Essential assets omitted by precache tooling')
        for (const p of PUBLIC_PATHS) if (!paths.includes(p.slice(1))) throw new Error('Required public asset missing')
        if (!paths.some((p) => /argon2\.worker.*\.js$/.test(p)) || !paths.some((p) => /libsodium.*\.js$/.test(p))) throw new Error('Offline KDF dependencies missing')
        const inventory: Asset[] = []
        for (const path of paths) {
          const bytes = await readFile(resolve(output, path))
          inventory.push({ url: '/' + path, size: bytes.byteLength, mime: assetMime('/' + path)!, sha256: createHash('sha256').update(bytes).digest('hex') })
        }
        validateInventory(inventory)
        await mkdir('reports/M5/logs', { recursive: true })
        await writeFile(`reports/M5/logs/inventory-${buildId}-${randomUUID()}.json`, JSON.stringify({ buildId, output, generatedAt: new Date().toISOString(), inventory }, null, 2) + '\n')
        // Workbox removes its internal `size` property when serializing entries.
        // Carry our independently verified exact length in a distinct field.
        return { manifest: inventory.map((a) => ({ ...a, byteLength: a.size, revision: null })), warnings: [] }
      }],
    },
  })
  return [contract, pwa]
}
