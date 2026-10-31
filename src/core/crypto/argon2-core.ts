import { JournalCryptoError } from './errors'
import { browserCrypto } from './random'
import { ARGON2ID_PARAMETERS } from './types'

export async function loadArgon2() {
  const sodium = (await import('libsodium-wrappers-sumo')).default
  await sodium.ready
  return sodium
}

/** Same M1 derivation. Browser callers execute this only in the KDF worker. */
export async function derivePassphraseKek(bytes: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  let derived: Uint8Array | undefined
  try {
    const sodium = await loadArgon2()
    derived = sodium.crypto_pwhash(32, bytes, salt,
      ARGON2ID_PARAMETERS.iterations, ARGON2ID_PARAMETERS.memoryKiB * 1024,
      sodium.crypto_pwhash_ALG_ARGON2ID13)
    // Explicit owned buffer; never retain the raw derived key.
    const keyBytes = new Uint8Array(derived)
    try {
      return await browserCrypto().subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['wrapKey', 'unwrapKey'])
    } finally {
      keyBytes.fill(0)
    }
  } catch {
    throw new JournalCryptoError('KEY_DERIVATION_FAILED')
  } finally {
    derived?.fill(0)
  }
}
