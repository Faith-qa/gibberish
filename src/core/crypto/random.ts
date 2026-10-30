import { toBase64url } from './encoding'
import { JournalCryptoError } from './errors'

export function browserCrypto(): Crypto {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== 'function') {
    throw new JournalCryptoError('CRYPTO_UNAVAILABLE')
  }
  return globalThis.crypto
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const api = browserCrypto()
  try {
    return api.getRandomValues(new Uint8Array(length))
  } catch {
    throw new JournalCryptoError('ENCRYPTION_FAILED')
  }
}

// Public nonces only, never keys. Conservatively reject all repeats in this JS
// context, including separate CryptoKey handles. This is not a durable registry.
const seenNonces = new Set<string>()

export function freshNonce(): Uint8Array<ArrayBuffer> {
  const nonce = randomBytes(12)
  const encoded = toBase64url(nonce)
  if (seenNonces.has(encoded)) throw new JournalCryptoError('NONCE_REUSE')
  seenNonces.add(encoded)
  return nonce
}
