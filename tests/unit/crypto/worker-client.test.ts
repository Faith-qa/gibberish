// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class SyntheticWorker {
  static instances: SyntheticWorker[] = []
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  sent: { id: string; bytes: Uint8Array; salt: Uint8Array } | undefined
  cancellations: string[] = []
  terminate = vi.fn()
  constructor() { SyntheticWorker.instances.push(this) }
  postMessage(value: { id: string; bytes: Uint8Array; salt: Uint8Array } | { kind: 'cancel'; id: string }) {
    if ('kind' in value) this.cancellations.push(value.id)
    else this.sent = value
  }
  emit(value: unknown) { this.onmessage?.({ data: value } as MessageEvent<unknown>) }
}
beforeEach(() => { vi.resetModules(); SyntheticWorker.instances = []; vi.stubGlobal('Worker', SyntheticWorker) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('KDF worker lifecycle and non-extractable key boundary', () => {
  it('can cancel readiness immediately, without waiting for a worker startup timeout', async () => {
    const { passphraseKek } = await import('../../../src/core/crypto/argon2')
    vi.stubGlobal('window', {}) // Select the browser executor, never a crypto fallback.
    const signal = new AbortController()
    const pending = passphraseKek('Synthetic worker passphrase', new Uint8Array(16), signal.signal)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    signal.abort(); await rejected
    const worker = SyntheticWorker.instances[0]!
    expect(worker.sent).toBeUndefined()
    worker.emit({ kind: 'ready' }) // Late readiness contains no key/job to adopt.
  })

  it('accepts only the expected non-extractable KEK profile and snapshots input bytes', async () => {
    const api = await import('../../../src/core/crypto/argon2-worker-client')
    const warming = api.warmKdfWorker(); const worker = SyntheticWorker.instances[0]!
    worker.emit({ kind: 'ready' }); await warming
    const bytes = new TextEncoder().encode('Synthetic worker phrase')
    const pending = api.workerPassphraseKek(bytes, new Uint8Array(16))
    await vi.waitFor(() => expect(worker.sent).toBeDefined())
    expect(worker.sent?.bytes).not.toBe(bytes)
    bytes.fill(0); expect(worker.sent?.bytes.some((byte) => byte !== 0)).toBe(true)
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey'])
    worker.emit({ kind: 'result', id: worker.sent?.id, key })
    expect(await pending).toBe(key)
  })

  it.each(['extractable', 'wrong usage', 'wrong id', 'error', 'malformed'] as const)('fails closed on %s transport without retaining a worker', async (kind) => {
    const api = await import('../../../src/core/crypto/argon2-worker-client')
    const warming = api.warmKdfWorker(); const worker = SyntheticWorker.instances[0]!
    worker.emit({ kind: 'ready' }); await warming
    const pending = api.workerPassphraseKek(new Uint8Array(32), new Uint8Array(16))
    const rejected = expect(pending).rejects.toMatchObject({ code: 'KEY_DERIVATION_FAILED' })
    await vi.waitFor(() => expect(worker.sent).toBeDefined())
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, kind === 'extractable', kind === 'wrong usage' ? ['encrypt'] : ['wrapKey', 'unwrapKey'])
    if (kind === 'error') worker.emit({ kind: 'error', id: worker.sent?.id })
    else if (kind === 'malformed') worker.emit(null)
    else worker.emit({ kind: 'result', id: kind === 'wrong id' ? 'wrong' : worker.sent?.id, key })
    await rejected; expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('revokes a cancelled job immediately, discards its late key, and reuses the drained worker offline', async () => {
    const api = await import('../../../src/core/crypto/argon2-worker-client')
    const warming = api.warmKdfWorker(); const worker = SyntheticWorker.instances[0]!
    worker.emit({ kind: 'ready' }); await warming
    const signal = new AbortController()
    const pending = api.workerPassphraseKek(new Uint8Array(32), new Uint8Array(16), signal.signal)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(worker.sent).toBeDefined())
    const oldId = worker.sent!.id
    signal.abort(); await rejected
    expect(worker.terminate).not.toHaveBeenCalled()
    expect(worker.cancellations).toEqual([oldId])
    const next = api.workerPassphraseKek(new Uint8Array(32), new Uint8Array(16))
    await Promise.resolve(); expect(worker.sent!.id).toBe(oldId)
    const lateKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey'])
    worker.emit({ kind: 'result', id: oldId, key: lateKey })
    await vi.waitFor(() => expect(worker.sent!.id).not.toBe(oldId))
    const newKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey'])
    worker.emit({ kind: 'result', id: worker.sent!.id, key: newKey })
    expect(await next).toBe(newKey)
    expect(SyntheticWorker.instances).toHaveLength(1)
    expect(worker.terminate).not.toHaveBeenCalled()
  })

  it('can cancel a queued retry without reviving the original job', async () => {
    const api = await import('../../../src/core/crypto/argon2-worker-client')
    const warming = api.warmKdfWorker(); const worker = SyntheticWorker.instances[0]!
    worker.emit({ kind: 'ready' }); await warming
    const firstSignal = new AbortController()
    const first = api.workerPassphraseKek(new Uint8Array(32), new Uint8Array(16), firstSignal.signal)
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(worker.sent).toBeDefined())
    const oldId = worker.sent!.id
    firstSignal.abort(); await rejected
    const secondSignal = new AbortController()
    const second = api.workerPassphraseKek(new Uint8Array(32), new Uint8Array(16), secondSignal.signal)
    const queuedRejection = expect(second).rejects.toMatchObject({ name: 'AbortError' })
    // Let readiness settle so this retry actually waits for the draining job.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await expect(api.workerPassphraseKek(new Uint8Array(32), new Uint8Array(16))).rejects.toMatchObject({ code: 'KEY_DERIVATION_FAILED' })
    secondSignal.abort(); await queuedRejection
    worker.emit({ kind: 'cancelled', id: oldId })
    expect(worker.sent!.id).toBe(oldId)
    expect(worker.terminate).not.toHaveBeenCalled()
  })

  it('bounds worker startup and active-job timeouts', async () => {
    vi.useFakeTimers()
    const api = await import('../../../src/core/crypto/argon2-worker-client')
    const warming = api.warmKdfWorker()
    const rejected = expect(warming).rejects.toMatchObject({ code: 'KEY_DERIVATION_FAILED' })
    await vi.advanceTimersByTimeAsync(30001); await rejected
    expect(SyntheticWorker.instances[0]?.terminate).toHaveBeenCalled()
    const ready = api.warmKdfWorker(); const worker = SyntheticWorker.instances[1]!
    worker.emit({ kind: 'ready' }); await ready
    const pending = api.workerPassphraseKek(new Uint8Array(32), new Uint8Array(16))
    const failed = expect(pending).rejects.toMatchObject({ code: 'KEY_DERIVATION_FAILED' })
    await vi.advanceTimersByTimeAsync(30001); await failed
    expect(worker.terminate).toHaveBeenCalled()
  })
})
