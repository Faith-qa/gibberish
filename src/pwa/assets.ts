import { CACHE_PREFIX, DOCUMENT_CSP, HEALTH_TIMEOUT, MAX_CACHES, validateInventory } from './protocol'
import type { Asset } from './protocol'
import type { CacheGate } from './cache-gate'

/** Static bytes only; this module has no application/domain imports or messages. */
export class StaticAssets {
  readonly name: string
  readonly inventory: readonly Asset[]
  constructor(readonly buildId: string, readonly origin: string, readonly store: CacheStorage, readonly network: typeof fetch, inventory: readonly Asset[], readonly gate: CacheGate) {
    this.name = CACHE_PREFIX + buildId
    this.inventory = validateInventory(inventory)
  }
  key(asset: Asset): Request { return new Request(this.origin + asset.url, { credentials: 'omit', referrerPolicy: 'no-referrer' }) }
  match(request: Request): Asset | undefined {
    const u = new URL(request.url)
    if (request.method !== 'GET' || u.origin !== this.origin || u.search || request.headers.has('Authorization') || request.headers.has('Range')) return
    const path = u.pathname === '/' && request.mode === 'navigate' ? '/index.html' : u.pathname
    if (path === '/index.html' && request.mode !== 'navigate' && request.destination) return
    const asset = this.inventory.find((a) => a.url === path)
    if (!asset) return
    const dest = request.destination
    if (dest && !({ 'text/html': ['document'], 'text/javascript': ['script', 'worker', 'sharedworker'], 'text/css': ['style'], 'image/png': ['image'], 'image/svg+xml': ['image'], 'application/manifest+json': ['manifest'], 'application/wasm': [''] }[asset.mime]?.includes(dest))) return
    return asset
  }
  async verified(response: Response | undefined, asset: Asset, network = false): Promise<Response> {
    if (!response || response.status !== 200 || response.redirected || ['opaque', 'opaqueredirect', 'error'].includes(response.type)
      || (network && response.url !== this.origin + asset.url)
      || response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== asset.mime || response.headers.has('content-range') || !response.body) throw new Error('Static asset unavailable')
    const reader = response.body.getReader(); const bytes = new Uint8Array(asset.size); let offset = 0
    try {
      if (!network && (Array.from(response.headers.keys()).sort().join() !== 'content-security-policy,content-type,referrer-policy,x-content-type-options'
        || response.headers.get('content-security-policy') !== DOCUMENT_CSP || response.headers.get('referrer-policy') !== 'no-referrer'
        || response.headers.get('x-content-type-options') !== 'nosniff')) throw new Error('Unexpected cached headers')
      for (;;) {
        const { value, done } = await reader.read(); if (done) break
        if (offset + value.byteLength > asset.size) throw new Error('Static asset exceeds bound')
        bytes.set(value, offset); offset += value.byteLength
      }
      if (offset !== asset.size) throw new Error('Static asset truncated')
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) => v.toString(16).padStart(2, '0')).join('')
      if (digest !== asset.sha256) throw new Error('Static asset integrity mismatch')
      return new Response(bytes, { status: 200, headers: { 'Content-Type': asset.mime, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': DOCUMENT_CSP, 'Referrer-Policy': 'no-referrer' } })
    } finally {
      // A tee's other consumer can delay cancellation completion indefinitely.
      // Request cancellation without delaying a bounded public-asset failure.
      void reader.cancel().catch(() => {}); reader.releaseLock()
    }
  }
  async fetchAsset(asset: Asset): Promise<Response> {
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), HEALTH_TIMEOUT)
    try { return await this.verified(await this.network(new Request(this.key(asset), { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error', signal: abort.signal })), asset, true) }
    finally { clearTimeout(timer) }
  }
  async #cache(create: boolean): Promise<{ cache: Cache; created: boolean } | undefined> {
    return await this.gate.run(async () => {
      const names = await this.store.keys(); const exists = names.includes(this.name)
      if (!exists && !create) return
      if (!exists && names.filter((n) => n.startsWith(CACHE_PREFIX)).length >= MAX_CACHES) throw new Error('Static cache budget exhausted')
      return { cache: await this.store.open(this.name), created: !exists }
    })
  }
  async install(): Promise<void> {
    const allocated = await this.#cache(true)
    if (!allocated) throw new Error('Static cache unavailable')
    if (!allocated.created) { if (!await this.verify()) throw new Error('Existing candidate invalid'); return }
    try {
      for (const asset of this.inventory) await allocated.cache.put(this.key(asset), await this.fetchAsset(asset))
      if (!await this.verify()) throw new Error('Incomplete precache')
    } catch {
      await this.gate.run(async () => { await this.store.delete(this.name) })
      throw new Error('Offline installation incomplete')
    }
  }
  async verify(): Promise<boolean> {
    try {
      const allocated = await this.#cache(false)
      if (!allocated) return false
      const cache = allocated.cache; const keys = await cache.keys()
      if (keys.length !== this.inventory.length || keys.some((key) => key.headers.has('authorization') || key.headers.has('range') || !this.inventory.some((a) => key.url === this.key(a).url))) return false
      const start = performance.now()
      for (const asset of this.inventory) {
        if (performance.now() - start >= HEALTH_TIMEOUT) return false
        await this.verified(await cache.match(this.key(asset)), asset)
      }
      return true
    } catch { return false }
  }
  async repair(): Promise<boolean> {
    const start = performance.now()
    try {
      if (!await this.#cache(true)) return false
      for (const asset of this.inventory) {
        if (performance.now() - start >= HEALTH_TIMEOUT) return false
        await this.serve(asset)
      }
      return await this.verify()
    } catch { return false }
  }
  async serve(asset: Asset): Promise<Response> {
    let cache: Cache | undefined
    try {
      cache = (await this.#cache(false))?.cache
      if (cache) return await this.verified(await cache.match(this.key(asset)), asset)
    } catch { /* Missing/failed cache does not prevent verified online delivery. */ }
    const response = await this.fetchAsset(asset)
    try { await cache?.put(this.key(asset), response.clone()) } catch { /* Offline readiness remains unverified. */ }
    return response
  }
}
