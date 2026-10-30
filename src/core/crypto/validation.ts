import { fromBase64url } from './encoding'
import { JournalCryptoError } from './errors'
import { ARGON2ID_PARAMETERS, MAX_PLAINTEXT_BYTES, RECOVERY_PARAMETERS } from './types'
import type { EncryptedEnvelope, RevisionEnvelope, SupportedEnvelope, RevisionIdentity, WrappedKeyRecord } from './types'

export function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || !keys.every((key) => Object.hasOwn(value, key))) {
    throw new JournalCryptoError('INVALID_INPUT')
  }
  return value as Record<string, unknown>
}

export function validateJournalId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new JournalCryptoError('INVALID_INPUT')
  }
}

export function validateIdentity(value: unknown): RevisionIdentity {
  const input = record(value, ['journalId', 'entryId', 'revisionId', 'schemaVersion'])
  if (input.schemaVersion !== 1) throw new JournalCryptoError('UNSUPPORTED_VERSION')
  validateJournalId(input.journalId)
  validateJournalId(input.entryId)
  validateJournalId(input.revisionId)
  return Object.freeze({ journalId: input.journalId, entryId: input.entryId, revisionId: input.revisionId, schemaVersion: 1 })
}

function envelopeFields(value: unknown, version: 1 | 2): SupportedEnvelope {
  const input = record(value, ['version', 'algorithm', 'nonce', 'ciphertext'])
  if (input.version !== version) throw new JournalCryptoError('UNSUPPORTED_VERSION')
  if (input.algorithm !== 'AES-256-GCM') throw new JournalCryptoError('INVALID_INPUT')
  fromBase64url(input.nonce, 12, 12)
  fromBase64url(input.ciphertext, 16, MAX_PLAINTEXT_BYTES + 16)
  return Object.freeze({ version, algorithm: 'AES-256-GCM', nonce: input.nonce as string, ciphertext: input.ciphertext as string })
}

/** Legacy identity-only format; operational writes never use this validator. */
export function validateEnvelope(value: unknown): EncryptedEnvelope {
  return envelopeFields(value, 1) as EncryptedEnvelope
}

export function validateOperationalEnvelope(value: unknown): RevisionEnvelope {
  return envelopeFields(value, 2) as RevisionEnvelope
}

export function validateSupportedEnvelope(value: unknown): SupportedEnvelope {
  const input = record(value, ['version', 'algorithm', 'nonce', 'ciphertext'])
  if (input.version === 1) return validateEnvelope(input)
  if (input.version === 2) return validateOperationalEnvelope(input)
  throw new JournalCryptoError('UNSUPPORTED_VERSION')
}

export function validateWrappedKey(value: unknown, purpose: WrappedKeyRecord['purpose']): WrappedKeyRecord {
  const input = record(value, ['version', 'purpose', 'algorithm', 'kdf', 'nonce', 'wrappedKey'])
  if (input.version !== 1) throw new JournalCryptoError('UNSUPPORTED_VERSION')
  if (input.purpose !== purpose || input.algorithm !== 'AES-256-GCM') throw new JournalCryptoError('INVALID_INPUT')
  const kdf = record(input.kdf, ['name', 'salt', 'parameters'])
  const name = purpose === 'passphrase' ? 'argon2id' : 'hkdf-sha256'
  const expected = purpose === 'passphrase' ? ARGON2ID_PARAMETERS : RECOVERY_PARAMETERS
  const parameters = record(kdf.parameters, Object.keys(expected))
  if (kdf.name !== name || !Object.entries(expected).every(([key, value]) => parameters[key] === value)) {
    throw new JournalCryptoError('INVALID_INPUT')
  }
  fromBase64url(kdf.salt, 16, 16)
  fromBase64url(input.nonce, 12, 12)
  fromBase64url(input.wrappedKey, 48, 48)
  return Object.freeze({
    version: 1, purpose, algorithm: 'AES-256-GCM',
    kdf: Object.freeze({ name, salt: kdf.salt as string, parameters: Object.freeze({ ...expected }) }),
    nonce: input.nonce as string, wrappedKey: input.wrappedKey as string,
  })
}

export function validateJournalKey(key: CryptoKey, usage: KeyUsage): void {
  if (typeof CryptoKey === 'undefined' || !(key instanceof CryptoKey)
    || key.type !== 'secret' || key.algorithm.name !== 'AES-GCM'
    || (key.algorithm as AesKeyAlgorithm).length !== 256 || !key.usages.includes(usage)) {
    throw new JournalCryptoError('INVALID_KEY')
  }
}
