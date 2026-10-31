import { JournalCryptoError } from './errors'

const TIMEOUT_MS = 30_000
interface Client {
  worker: Worker
  ready: Promise<void>
  idle: Promise<void>
  releaseIdle(): void
  stop(error: Error): void
  waiting: boolean
  job?: { id: string; cancelled: boolean; resolve: (key: CryptoKey) => void; reject: (error: Error) => void; clear: () => void }
}
let client: Client | undefined
const failure = () => new JournalCryptoError('KEY_DERIVATION_FAILED')
const cancelled = () => new DOMException('Operation cancelled.', 'AbortError')

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw cancelled()
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(cancelled()) }
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function createClient(): Client {
  if (typeof Worker === 'undefined') throw failure()
  const worker = new Worker(new URL('./argon2.worker.ts', import.meta.url), { type: 'module', name: 'Gibberish key derivation' })
  let readyResolve = () => {}; let readyReject: (error: Error) => void = () => {}
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  const state: Client = { worker, ready, idle: Promise.resolve(), releaseIdle: () => {}, stop, waiting: false }
  const timer = setTimeout(() => stop(failure()), TIMEOUT_MS)
  function stop(error: Error) {
    clearTimeout(timer); readyReject(error)
    state.job?.clear(); state.job?.reject(error); delete state.job; state.releaseIdle()
    worker.terminate()
    if (client === state) client = undefined
  }
  function finish() { state.job?.clear(); delete state.job; state.releaseIdle() }
  worker.onmessage = (event: MessageEvent<unknown>) => {
    const value = event.data as { kind?: unknown; id?: unknown; key?: unknown }
    if (value?.kind === 'ready') { clearTimeout(timer); readyResolve(); return }
    const job = state.job
    if (!job || value?.id !== job.id) { stop(failure()); return }
    if (job.cancelled && ['result', 'cancelled', 'error'].includes(value.kind as string)) { finish(); return }
    const key = value.key
    if (value.kind !== 'result' || !(key instanceof CryptoKey) || key.type !== 'secret' || key.extractable
      || key.algorithm.name !== 'AES-GCM' || (key.algorithm as AesKeyAlgorithm).length !== 256
      || key.usages.length !== 2 || !key.usages.includes('wrapKey') || !key.usages.includes('unwrapKey')) { stop(failure()); return }
    finish(); job.resolve(key)
  }
  worker.onerror = (event) => { event.preventDefault(); stop(failure()) }
  worker.onmessageerror = () => stop(failure())
  return state
}

export async function warmKdfWorker(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw cancelled()
  try { client ??= createClient() } catch { throw failure() }
  await abortable(client.ready, signal)
}

export async function workerPassphraseKek(bytes: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<CryptoKey> {
  await warmKdfWorker(signal)
  const state = client
  if (!state) throw failure()
  if (state.job) {
    if (!state.job.cancelled || state.waiting) throw failure()
    state.waiting = true
    try { await abortable(state.idle, signal) } finally { state.waiting = false }
  }
  if (signal?.aborted) throw cancelled()
  if (client !== state || state.job) throw failure()
  return new Promise<CryptoKey>((resolve, reject) => {
    const abort = () => {
      const job = state.job
      if (!job) return
      job.cancelled = true; signal?.removeEventListener('abort', abort); reject(cancelled())
      try { state.worker.postMessage({ kind: 'cancel', id: job.id }) } catch { state.stop(failure()) }
    }
    const timer = setTimeout(() => state.stop(failure()), TIMEOUT_MS)
    const clear = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    const id = crypto.randomUUID()
    state.idle = new Promise<void>((done) => { state.releaseIdle = done })
    state.job = { id, cancelled: false, resolve, reject, clear }
    signal?.addEventListener('abort', abort, { once: true })
    const owned = new Uint8Array(bytes); const publicSalt = new Uint8Array(salt)
    try { state.worker.postMessage({ id, bytes: owned, salt: publicSalt }, [owned.buffer]) }
    catch { owned.fill(0); state.stop(failure()) }
  })
}
