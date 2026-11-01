/// <reference lib="webworker" />
import { cacheGate } from './cache-gate'
import { StaticAssets } from './assets'
import { CACHE_PREFIX, DOCUMENT_CSP, profile, validRequest } from './protocol'
import type { Asset, PublicReply } from './protocol'
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (Omit<Asset, 'size'> & { byteLength: number; revision: null })[] }
declare const __GIBBERISH_BUILD_ID__: string
const ownProfile = profile(__GIBBERISH_BUILD_ID__)
const gate = cacheGate(self.navigator.locks)
const assets = new StaticAssets(ownProfile.buildId, self.location.origin, self.caches, self.fetch.bind(self), self.__WB_MANIFEST.map(({ url, byteLength, mime, sha256 }) => ({ url, size: byteLength, mime, sha256 })), gate)

self.addEventListener('install', (event) => { event.waitUntil(assets.install()) })
async function cleanup(): Promise<void> {
  await gate.run(async () => {
    // Activation/health are public asset maintenance, never journal maintenance.
    if (self.registration.installing || self.registration.waiting) return
    for (const name of await self.caches.keys()) if (name.startsWith(CACHE_PREFIX) && name !== assets.name) await self.caches.delete(name)
  })
}
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (!await assets.verify()) throw new Error('Offline assets unavailable')
    await cleanup()
  })())
})
self.addEventListener('fetch', (event) => {
  const asset = assets.match(event.request)
  if (!asset) return
  event.respondWith(assets.serve(asset).catch(() => new Response(event.request.mode === 'navigate'
    ? '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Gibberish unavailable</title><h1>Offline files unavailable</h1><p>Reconnect, close all Gibberish windows and reopen. Do not clear browser data. This page did not reset journal storage.</p></html>'
    : 'Required public asset unavailable', { status: 503, headers: { 'Content-Type': event.request.mode === 'navigate' ? 'text/html' : 'text/plain', 'Content-Security-Policy': DOCUMENT_CSP, 'X-Content-Type-Options': 'nosniff' } })))
})
self.addEventListener('message', (event) => {
  if (!validRequest(event.data) || event.ports.length !== 1 || !event.source || !('url' in event.source)) return
  const source = new URL(event.source.url)
  if (source.origin !== self.location.origin || !['/', '/index.html'].includes(source.pathname) || source.search) return
  const request = event.data; const port = event.ports[0]!
  event.waitUntil((async () => {
    const start = performance.now()
    const ready = request.type === 'REPAIR' ? await assets.repair() : request.type === 'VERIFY' ? await assets.verify() : false
    if (ready) await cleanup().catch(() => {})
    const reply: PublicReply = { ...request, profile: ownProfile, ready, milliseconds: performance.now() - start,
      assetCount: assets.inventory.length, bytes: assets.inventory.reduce((n, a) => n + a.size, 0) }
    port.postMessage(reply); port.close()
  })())
})
