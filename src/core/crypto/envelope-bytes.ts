import { fromBase64url, toBase64url } from './encoding'
import { JournalCryptoError } from './errors'
import { MAX_PLAINTEXT_BYTES } from './types'
import type { EncryptedEnvelope } from './types'
import { validateEnvelope } from './validation'

/** Binary v1: envelope-version byte, algorithm-ID byte, 12-byte nonce, ciphertext/tag. */
export function envelopeToBytes(input: unknown): Uint8Array<ArrayBuffer> {
  const envelope = validateEnvelope(input)
  const nonce = fromBase64url(envelope.nonce, 12, 12)
  const ciphertext = fromBase64url(envelope.ciphertext, 16, MAX_PLAINTEXT_BYTES + 16)
  const bytes = new Uint8Array(14 + ciphertext.length)
  bytes.set([1, 1])
  bytes.set(nonce, 2)
  bytes.set(ciphertext, 14)
  return bytes
}

export function envelopeFromBytes(bytes: Uint8Array): EncryptedEnvelope {
  if (!(bytes instanceof Uint8Array) || bytes.length < 30 || bytes.length > MAX_PLAINTEXT_BYTES + 30) throw new JournalCryptoError('INVALID_INPUT')
  if (bytes[0] !== 1) throw new JournalCryptoError('UNSUPPORTED_VERSION')
  if (bytes[1] !== 1) throw new JournalCryptoError('INVALID_INPUT')
  return validateEnvelope({ version: 1, algorithm: 'AES-256-GCM', nonce: toBase64url(bytes.subarray(2, 14)), ciphertext: toBase64url(bytes.subarray(14)) })
}
