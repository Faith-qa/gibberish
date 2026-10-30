import { JournalCryptoError } from './errors'
import { browserCrypto } from './random'
import { ARGON2ID_PARAMETERS } from './types'

export async function passphraseKek(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (typeof passphrase !== 'string' || passphrase.length === 0 || passphrase.length > 1024) throw new JournalCryptoError('INVALID_INPUT')
  const bytes = new TextEncoder().encode(passphrase)
  if (bytes.length > 1024 || new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== passphrase) {
    bytes.fill(0)
    throw new JournalCryptoError('INVALID_INPUT')
  }
  let derived: Uint8Array | undefined
  try {
    const sodium = (await import('libsodium-wrappers-sumo')).default
    await sodium.ready
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
    bytes.fill(0)
    derived?.fill(0)
  }
}
