// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { CacheGate } from '../../../src/pwa/cache-gate'
import { StaticAssets } from '../../../src/pwa/assets'
import { CACHE_PREFIX, DOCUMENT_CSP, MAX_ASSET_BYTES, MAX_RELEASE_BYTES, validateInventory, validProfile, validRequest } from '../../../src/pwa/protocol'
import type { Asset } from '../../../src/pwa/protocol'

const id = '11111111-1111-4111-8111-111111111111'
const origin = 'https://gibberish.invalid'
const bytes = 'Synthetic PUBLIC application bytes'
const asset: Asset = { url: '/assets/example.js', mime: 'text/javascript', size: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') }
function response(body = bytes, mime = asset.mime) {
  const r = new Response(body, { headers: { 'Content-Type': mime, 'X-Secret': 'must-not-cache', 'Cache-Control': 'private' } })
  Object.defineProperty(r, 'url', { value: origin + asset.url }); return r
}
function stores() {
  const entries = new Map<string, Map<string, Response>>()
  let tail = Promise.resolve()
  const gate: CacheGate = { async run<T>(work: () => Promise<T>): Promise<T> {
    const before = tail; let release: () => void = () => {}; tail = new Promise<void>((resolve) => { release = resolve })
    await before; try { return await work() } finally { release() }
  } }
  const api = {
    keys: async () => [...entries.keys()],
    delete: async (key: string) => entries.delete(key),
    has: async (key: string) => entries.has(key),
    match: async () => undefined,
    open: async (name: string) => {
      let map = entries.get(name); if (!map) { map = new Map(); entries.set(name, map) }
      const owned = map
      const cache: Cache = {
        add: async () => { throw new Error('Forbidden generic add') }, addAll: async () => { throw new Error('Forbidden generic addAll') },
        matchAll: async () => [], delete: async (r) => owned.delete(new Request(r).url),
        match: async (r) => owned.get(new Request(r).url)?.clone(),
        put: async (r, value) => { owned.set(new Request(r).url, value.clone()) },
        keys: async () => [...owned.keys()].map((u) => new Request(u, { credentials: 'omit' })),
      }; return cache
    },
  } satisfies CacheStorage
  return { api, entries, gate }
}
function fixture() {
  const s = stores(); const network = vi.fn<typeof fetch>(async () => response())
  return { ...s, network, assets: new StaticAssets(id, origin, s.api, network, [asset], s.gate) }
}
afterEach(() => vi.useRealTimers())

describe('M5 exact public inventory and cache boundaries', () => {
  it('installs all verified public bytes, verifies actual content and normalizes keys/headers', async () => {
    const f = fixture(); await f.assets.install(); expect(await f.assets.verify()).toBe(true)
    const key = f.network.mock.calls[0]![0] as Request
    expect(key.credentials).toBe('omit'); expect(key.referrerPolicy).toBe('no-referrer'); expect(key.redirect).toBe('error'); expect(key.cache).toBe('no-store')
    const cached = await (await f.api.open(f.assets.name)).match(f.assets.key(asset))
    expect(cached?.headers.get('x-secret')).toBeNull()
    expect(cached?.headers.get('content-security-policy')).toBe(DOCUMENT_CSP)
    expect(await cached?.text()).toBe(bytes)
  })
  it.each(['https://other.invalid/assets/example.js', origin + '/assets/example.js?token=synthetic', origin + '/arbitrary.json', origin + '/reports/harness.js', origin + '/export.md', origin + '/sw.js'])('does not handle unlisted or secret-bearing URL %s', (url) => {
    expect(fixture().assets.match(new Request(url))).toBeUndefined()
  })
  it('rejects non-GET, credential/range headers and incompatible destinations', () => {
    const f = fixture(); const url = origin + asset.url
    for (const init of [{ method: 'POST', body: 'private sentinel' }, { headers: { Authorization: 'synthetic' } }, { headers: { Range: 'bytes=0-' } }]) expect(f.assets.match(new Request(url, init))).toBeUndefined()
    const r = new Request(url); Object.defineProperty(r, 'destination', { value: 'document' }); expect(f.assets.match(r)).toBeUndefined()
  })
  it.each(['unknown path', 'duplicate', 'query', 'invalid digest', 'zero size', 'oversize', 'wrong MIME', 'undefined MIME', 'extra field', 'too many', 'over budget'])('rejects malformed inventory: %s', (mode) => {
    let list: Asset[] = [{ ...asset }]
    if (mode === 'unknown path') list[0]!.url = '/private.json'
    if (mode === 'duplicate') list.push(asset)
    if (mode === 'query') list[0]!.url += '?anything'
    if (mode === 'invalid digest') list[0]!.sha256 = 'abc'
    if (mode === 'zero size') list[0]!.size = 0
    if (mode === 'oversize') list[0]!.size = MAX_ASSET_BYTES + 1
    if (mode === 'wrong MIME') list[0]!.mime = 'application/json'
    if (mode === 'undefined MIME') list[0] = { ...asset, url: '/private.json', mime: undefined } as unknown as Asset
    if (mode === 'extra field') list[0] = { ...asset, secret: 'synthetic' } as Asset
    if (mode === 'too many') list = Array.from({ length: 129 }, (_, i) => ({ ...asset, url: `/assets/a${i}.js` }))
    if (mode === 'over budget') list = Array.from({ length: MAX_RELEASE_BYTES / MAX_ASSET_BYTES + 1 }, (_, i) => ({ ...asset, size: MAX_ASSET_BYTES, url: `/assets/a${i}.js` }))
    expect(() => validateInventory(list)).toThrow()
  })
  it.each(['tamper', 'truncate', 'oversize', 'MIME', 'redirect', 'status', 'partial'])('rejects %s and deletes only its failed candidate', async (mode) => {
    const f = fixture(); await f.api.open(CACHE_PREFIX + 'old'); await f.api.open('another-application')
    f.network.mockImplementation(async () => {
      if (mode === 'tamper') return response(bytes.replace('PUBLIC', 'SECRET'))
      if (mode === 'truncate') return response(bytes.slice(1))
      if (mode === 'oversize') return response(bytes + 'x')
      if (mode === 'MIME') return response(bytes, 'text/html')
      if (mode === 'status') return new Response('failed', { status: 503 })
      if (mode === 'redirect') { const r = response(); Object.defineProperty(r, 'redirected', { value: true }); return r }
      const r = response(); r.headers.set('content-range', 'bytes 0-2/100'); return r
    })
    await expect(f.assets.install()).rejects.toThrow()
    expect(await f.api.keys()).toEqual([CACHE_PREFIX + 'old', 'another-application'])
  })
  it('rolls back an interrupted multi-asset precache, preserving the active generation', async () => {
    const f = fixture(); await f.api.open(CACHE_PREFIX + 'active')
    const second = { ...asset, url: '/assets/second.js' }
    const engine = new StaticAssets(id, origin, f.api, f.network, [asset, second], f.gate)
    f.network.mockRejectedValueOnce(new Error('Network interrupted'))
    await expect(engine.install()).rejects.toThrow(); expect(await f.api.keys()).toEqual([CACHE_PREFIX + 'active'])
  })
  it('does not claim readiness after missing/corrupt/extra cache content and repairs only identical bytes', async () => {
    const f = fixture(); await f.assets.install(); f.network.mockClear()
    const cache = await f.api.open(f.assets.name)
    await cache.put(f.assets.key(asset), response('synthetic corruption'))
    expect(await f.assets.verify()).toBe(false)
    f.network.mockRejectedValueOnce(new Error('Offline'))
    await expect(f.assets.serve(asset)).rejects.toThrow()
    expect(await f.assets.verify()).toBe(false)
    expect(await (await f.assets.serve(asset)).text()).toBe(bytes)
    expect(await f.assets.verify()).toBe(true)
    await cache.put(origin + '/extra', response())
    expect(await f.assets.verify()).toBe(false)
    await cache.delete(origin + '/extra'); await cache.delete(f.assets.key(asset))
    expect(await f.assets.verify()).toBe(false)
  })
  it('rejects a new stable-path shell rather than mixing release bytes', async () => {
    const f = fixture(); await f.assets.install(); const cache = await f.api.open(f.assets.name); await cache.delete(f.assets.key(asset))
    f.network.mockImplementation(async () => response(bytes.replace('PUBLIC', 'UPDATE')))
    await expect(f.assets.serve(asset)).rejects.toThrow('integrity')
    expect(await f.assets.verify()).toBe(false)
  })
  it('bounds generations and never clears an active cache to create another', async () => {
    const f = fixture(); for (const n of ['one', 'two', 'three']) await f.api.open(CACHE_PREFIX + n)
    await expect(f.assets.install()).rejects.toThrow('budget')
    expect(await f.api.keys()).toHaveLength(3); expect(f.network).not.toHaveBeenCalled()
  })
  it('handles quota failure without clearing other caches', async () => {
    const f = fixture(); await f.api.open(CACHE_PREFIX + 'active')
    const open = f.api.open.bind(f.api)
    vi.spyOn(f.api, 'open').mockImplementation(async (name) => {
      const cache = await open(name)
      if (name === f.assets.name) cache.put = async () => { throw new DOMException('Synthetic quota', 'QuotaExceededError') }
      return cache
    })
    await expect(f.assets.install()).rejects.toThrow(); expect(await f.api.keys()).toEqual([CACHE_PREFIX + 'active'])
  })
  it('verified online assets remain usable when cache storage is unavailable', async () => {
    const f = fixture()
    vi.spyOn(f.api, 'keys').mockRejectedValue(new Error('Synthetic unavailable cache'))
    expect(await (await f.assets.serve(asset)).text()).toBe(bytes)
    expect(await f.assets.verify()).toBe(false)
  })
  it('explicit repair recreates only the inventoried cache after eviction', async () => {
    const f = fixture(); expect(await f.assets.verify()).toBe(false)
    expect(await f.assets.repair()).toBe(true); expect(await f.assets.verify()).toBe(true)
  })
  it('a missing active cache never exceeds the three-generation budget during repair', async () => {
    const f = fixture(); for (const n of ['one', 'two', 'three']) await f.api.open(CACHE_PREFIX + n)
    expect(await (await f.assets.serve(asset)).text()).toBe(bytes)
    expect(await f.api.keys()).toHaveLength(3); expect(await f.assets.repair()).toBe(false)
  })
  it('bounds a stalled public fetch and removes only its incomplete candidate', async () => {
    vi.useFakeTimers(); const f = fixture()
    f.network.mockImplementation(async (input) => await new Promise<Response>((_, reject) => {
      (input as Request).signal.addEventListener('abort', () => reject(new DOMException('Synthetic timeout', 'AbortError')))
    }))
    const installing = expect(f.assets.install()).rejects.toThrow('incomplete')
    await vi.advanceTimersByTimeAsync(10001); await installing
    expect(await f.api.keys()).toEqual([])
  })
  it('accepts the exact file/byte budgets without silently lowering them', () => {
    const full = Array.from({ length: 4 }, (_, i) => ({ ...asset, url: `/assets/full${i}.js`, size: MAX_ASSET_BYTES }))
    expect(validateInventory(full)).toEqual(full)
    const count = Array.from({ length: 128 }, (_, i) => ({ ...asset, url: `/assets/count${i}.js` }))
    expect(validateInventory(count)).toHaveLength(128)
  })
  it('serializes concurrent generation allocations without racing past the cache cap', async () => {
    const f = fixture(); await f.api.open(CACHE_PREFIX + 'old-one'); await f.api.open(CACHE_PREFIX + 'old-two')
    const next = new StaticAssets('22222222-2222-4222-8222-222222222222', origin, f.api, f.network, [asset], f.gate)
    const results = await Promise.allSettled([f.assets.install(), next.install()])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    expect(await f.api.keys()).toHaveLength(3)
  })
  it('accepts only purpose-limited public messages and exact profiles', () => {
    expect(validProfile({ buildId: id, protocol: 1, cacheVersion: 1, databaseVersion: 2 })).toBe(true)
    expect(validProfile({ buildId: id, protocol: 1, cacheVersion: 1, databaseVersion: 3 })).toBe(false)
    expect(validRequest({ type: 'VERIFY', protocol: 1, requestId: id })).toBe(true)
    expect(validRequest(Object.assign([], { type: 'VERIFY', protocol: 1, requestId: id }))).toBe(false)
    expect(validProfile(Object.assign([], { buildId: id, protocol: 1, cacheVersion: 1, databaseVersion: 2 }))).toBe(false)
    for (const data of [{ type: 'VERIFY', protocol: 1, requestId: id, passphrase: 'synthetic' }, { type: 'FETCH', protocol: 1, requestId: id }, { type: 'VERIFY', protocol: 2, requestId: id }]) expect(validRequest(data)).toBe(false)
  })
})
