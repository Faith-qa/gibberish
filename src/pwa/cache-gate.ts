import { HEALTH_TIMEOUT } from './protocol'
export interface CacheGate { run<T>(work: () => Promise<T>): Promise<T> }
export const CACHE_BUDGET_LOCK = 'gibberish-public-cache-budget-v1'

/** Short public Cache Storage allocation sections only. No session/tab leases. */
export function cacheGate(manager: Pick<LockManager, 'request'> | undefined): CacheGate {
  return { async run<T>(work: () => Promise<T>): Promise<T> {
    if (!manager) throw new Error('Static cache allocation unavailable')
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), HEALTH_TIMEOUT)
    try {
      return await manager.request(CACHE_BUDGET_LOCK, { signal: abort.signal }, async () => {
        clearTimeout(timer)
        return await work()
      })
    } finally { clearTimeout(timer) }
  } }
}
