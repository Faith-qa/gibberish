import { fromBase64url, toBase64url } from './encoding'
import { JournalCryptoError } from './errors'
import { browserCrypto, freshNonce } from './random'
import { MAX_PLAINTEXT_BYTES } from './types'
import type { EncryptedEnvelope, RevisionIdentity } from './types'
import { validateEnvelope, validateIdentity, validateJournalKey } from './validation'

export function revisionAad(identity: RevisionIdentity): Uint8Array<ArrayBuffer> {
  const context = validateIdentity(identity)
  return new TextEncoder().encode(JSON.stringify([
    'gibberish-entry-aad', 1, 1,
    context.journalId, context.entryId, context.revisionId, context.schemaVersion,
  ]))
}

export async function generateJournalKey(): Promise<CryptoKey> {
  // Extractability is required for Web Crypto wrapKey and later rewrapping.
  // No raw-key export or persistence is performed by this module.
  const api = browserCrypto()
  try {
    return await api.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  } catch {
    throw new JournalCryptoError('ENCRYPTION_FAILED')
  }
}

export async function encrypt(plaintext: Uint8Array, key: CryptoKey, identity: RevisionIdentity): Promise<EncryptedEnvelope> {
  const api = browserCrypto()
  validateJournalKey(key, 'encrypt')
  const aad = revisionAad(identity)
  if (!(plaintext instanceof Uint8Array) || plaintext.length > MAX_PLAINTEXT_BYTES) throw new JournalCryptoError('INVALID_INPUT')
  const nonce = freshNonce()
  const copy = new Uint8Array(plaintext)
  try {
    const ciphertext = await api.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 }, key, copy)
    return Object.freeze({ version: 1, algorithm: 'AES-256-GCM', nonce: toBase64url(nonce), ciphertext: toBase64url(new Uint8Array(ciphertext)) })
  } catch {
    throw new JournalCryptoError('ENCRYPTION_FAILED')
  } finally {
    copy.fill(0)
  }
}

export async function decrypt(input: unknown, key: CryptoKey, identity: RevisionIdentity): Promise<Uint8Array<ArrayBuffer>> {
  const api = browserCrypto()
  validateJournalKey(key, 'decrypt')
  const envelope = validateEnvelope(input)
  const aad = revisionAad(identity)
  const nonce = fromBase64url(envelope.nonce, 12, 12)
  const ciphertext = fromBase64url(envelope.ciphertext, 16, MAX_PLAINTEXT_BYTES + 16)
  try {
    return new Uint8Array(await api.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 }, key, ciphertext))
  } catch {
    throw new JournalCryptoError('AUTHENTICATION_FAILED')
  }
}
