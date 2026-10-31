import { derivePassphraseKek, loadArgon2 } from './argon2-core'

// Dedicated same-origin worker: no JEK, storage, network content or UI state.
const scope = globalThis as unknown as {
  postMessage(value: unknown): void
  onmessage: ((event: MessageEvent<unknown>) => void) | null
}
let active: { id: string; cancelled: boolean } | undefined
scope.onmessage = (event) => {
  const value = event.data as { kind?: unknown; id?: unknown; bytes?: unknown; salt?: unknown }
  if (value?.kind === 'cancel') {
    if (active && active.id === value.id) active.cancelled = true
    return
  }
  if (!value || typeof value.id !== 'string' || !(value.bytes instanceof Uint8Array)
    || !(value.salt instanceof Uint8Array) || value.bytes.length > 1024 || value.salt.length !== 16 || active) {
    scope.postMessage({ kind: 'error' }); return
  }
  const job = { id: value.id, cancelled: false }; active = job
  const bytes = value.bytes as Uint8Array<ArrayBuffer>; const salt = value.salt as Uint8Array<ArrayBuffer>
  void (async () => {
    let response: { kind: string; id: string; key?: CryptoKey }
    try {
      const key = await derivePassphraseKek(bytes, salt)
      response = job.cancelled ? { kind: 'cancelled', id: job.id } : { kind: 'result', id: job.id, key }
    } catch { response = { kind: 'error', id: job.id } }
    finally { bytes.fill(0); active = undefined }
    try { scope.postMessage(response) }
    catch { scope.postMessage({ kind: 'error', id: job.id }) }
  })()
}
void loadArgon2().then(() => scope.postMessage({ kind: 'ready' }), () => scope.postMessage({ kind: 'error' }))
