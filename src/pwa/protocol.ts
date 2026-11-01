/** Public build information only. Never add journal/session fields here. */
export interface BuildProfile { buildId: string; protocol: 1; cacheVersion: 1; databaseVersion: 2 }
export interface Asset { url: string; sha256: string; size: number; mime: string }
export const CACHE_PREFIX = 'gibberish-static-v1-'
export const MAX_ASSETS = 128
export const MAX_ASSET_BYTES = 2 * 1024 * 1024
export const MAX_RELEASE_BYTES = 8 * 1024 * 1024
export const MAX_CACHES = 3
export const HEALTH_TIMEOUT = 10_000
export const PUBLIC_PATHS = new Set(['/index.html', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png'])
export const DOCUMENT_CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'"
export const WORKER_CSP = "default-src 'none'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'"
export const validBuildId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)
export function profile(buildId: string): BuildProfile { return { buildId, protocol: 1, cacheVersion: 1, databaseVersion: 2 } }
export function validProfile(value: unknown): value is BuildProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'buildId,cacheVersion,databaseVersion,protocol') return false
  const p = value as BuildProfile
  return validBuildId(p.buildId) && p.protocol === 1 && p.cacheVersion === 1 && p.databaseVersion === 2
}
export function sameProfile(a: BuildProfile, b: BuildProfile): boolean { return validProfile(a) && validProfile(b) && a.buildId === b.buildId }
export function assetMime(path: string): string | undefined {
  if (!PUBLIC_PATHS.has(path) && !/^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css|wasm)$/.test(path)) return
  if (path.endsWith('.html')) return 'text/html'
  if (path.endsWith('.webmanifest')) return 'application/manifest+json'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.js')) return 'text/javascript'
  if (path.endsWith('.css')) return 'text/css'
  if (path.endsWith('.wasm')) return 'application/wasm'
}
export function validateInventory(input: readonly Asset[]): readonly Asset[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ASSETS) throw new Error('Invalid public inventory')
  let total = 0; const urls = new Set<string>()
  for (const item of input) {
    if (!item || Array.isArray(item) || Object.keys(item).sort().join() !== 'mime,sha256,size,url' || urls.has(item.url)
      || typeof item.mime !== 'string' || assetMime(item.url) !== item.mime || !/^[0-9a-f]{64}$/.test(item.sha256)
      || !Number.isSafeInteger(item.size) || item.size <= 0 || item.size > MAX_ASSET_BYTES) throw new Error('Invalid public inventory')
    total += item.size; urls.add(item.url)
  }
  if (total > MAX_RELEASE_BYTES) throw new Error('Public inventory exceeds budget')
  return input
}
export type PublicRequest = { type: 'PROFILE' | 'VERIFY' | 'REPAIR'; protocol: 1; requestId: string }
export function validRequest(value: unknown): value is PublicRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'protocol,requestId,type') return false
  const r = value as PublicRequest
  return (r.type === 'PROFILE' || r.type === 'VERIFY' || r.type === 'REPAIR') && r.protocol === 1 && validBuildId(r.requestId)
}
export interface PublicReply extends PublicRequest { profile: BuildProfile; ready: boolean; milliseconds: number; assetCount: number; bytes: number }
export function validReply(value: unknown, request: PublicRequest): value is PublicReply {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'assetCount,bytes,milliseconds,profile,protocol,ready,requestId,type') return false
  const r = value as PublicReply
  return r.type === request.type && r.protocol === 1 && r.requestId === request.requestId && validProfile(r.profile)
    && typeof r.ready === 'boolean' && Number.isFinite(r.milliseconds) && r.milliseconds >= 0
    && Number.isSafeInteger(r.assetCount) && r.assetCount > 0 && r.assetCount <= MAX_ASSETS
    && Number.isSafeInteger(r.bytes) && r.bytes > 0 && r.bytes <= MAX_RELEASE_BYTES
}
