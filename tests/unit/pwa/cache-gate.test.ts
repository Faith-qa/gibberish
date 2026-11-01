// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { cacheGate, CACHE_BUDGET_LOCK } from '../../../src/pwa/cache-gate'
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
it('does not allocate cache storage when the native exclusion primitive is unavailable', async () => {
  const work = vi.fn(async () => true)
  await expect(cacheGate(undefined).run(work)).rejects.toThrow('unavailable')
  expect(work).not.toHaveBeenCalled()
})
it('uses a public exclusive name, releases the native lock on failure and does not request takeover', async () => {
  const manager = { request: vi.fn(async (_name: string, options: { signal: AbortSignal }, run: () => Promise<unknown>) => {
    expect(Object.keys(options)).toEqual(['signal']); expect(options.signal.aborted).toBe(false)
    return await run()
  }) }
  const gate = cacheGate(manager as unknown as Pick<LockManager, 'request'>)
  await expect(gate.run(async () => { throw new Error('Synthetic cache failure') })).rejects.toThrow('Synthetic cache failure')
  expect(manager.request.mock.calls[0]![0]).toBe(CACHE_BUDGET_LOCK)
})
it('bounds a queued allocation request rather than stealing a lock', async () => {
  vi.useFakeTimers()
  const work = vi.fn(async () => true)
  const manager = { request: vi.fn(async (_name: string, options: { signal: AbortSignal }) => await new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Synthetic wait deadline', 'AbortError')))
  })) }
  const pending = expect(cacheGate(manager as unknown as Pick<LockManager, 'request'>).run(work)).rejects.toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(10001); await pending
  expect(work).not.toHaveBeenCalled()
})
