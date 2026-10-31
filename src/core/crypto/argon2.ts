import { JournalCryptoError } from './errors'
import { derivePassphraseKek } from './argon2-core'
import { workerPassphraseKek } from './argon2-worker-client'

export async function passphraseKek(passphrase: string, salt: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<CryptoKey> {
  if (signal?.aborted) throw new DOMException('Operation cancelled.', 'AbortError')
  if (typeof passphrase !== 'string' || passphrase.length === 0 || passphrase.length > 1024) throw new JournalCryptoError('INVALID_INPUT')
  const bytes = new TextEncoder().encode(passphrase)
  try {
    if (bytes.length > 1024 || new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== passphrase) throw new JournalCryptoError('INVALID_INPUT')
    // Only Node regression tests use the direct executor. Browsers never fall back.
    const key = typeof window === 'undefined'
      ? await derivePassphraseKek(bytes, salt) : await workerPassphraseKek(bytes, salt, signal)
    if (signal?.aborted) throw new DOMException('Operation cancelled.', 'AbortError')
    return key
  } finally { bytes.fill(0) }
}
