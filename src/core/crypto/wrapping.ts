import { passphraseKek } from './argon2'
import { fromBase64url, toBase64url } from './encoding'
import { JournalCryptoError } from './errors'
import { browserCrypto, freshNonce, randomBytes } from './random'
import { ARGON2ID_PARAMETERS, RECOVERY_PARAMETERS } from './types'
import type { WrappedKeyRecord } from './types'
import { validateJournalId, validateJournalKey, validateWrappedKey } from './validation'

export function generateRecoveryKey(): string {
  const bytes = randomBytes(32)
  try {
    return `gbr1.${toBase64url(bytes)}`
  } finally {
    bytes.fill(0)
  }
}

async function recoveryKek(credential: string, salt: Uint8Array<ArrayBuffer>, journalId: string): Promise<CryptoKey> {
  if (typeof credential !== 'string' || !credential.startsWith('gbr1.') || credential.length !== 48) {
    throw new JournalCryptoError('INVALID_INPUT')
  }
  const material = fromBase64url(credential.slice(5), 32, 32)
  const api = browserCrypto()
  try {
    const key = await api.subtle.importKey('raw', material, 'HKDF', false, ['deriveKey'])
    return await api.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt,
      info: new TextEncoder().encode(JSON.stringify(['gibberish-recovery-kek', 1, journalId])),
    }, key, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey'])
  } finally {
    material.fill(0)
  }
}

function wrappingAad(record: WrappedKeyRecord, journalId: string): Uint8Array<ArrayBuffer> {
  const p = record.kdf.parameters
  const parameters = record.purpose === 'passphrase'
    ? [p.version, p.memoryKiB, p.iterations, p.parallelism, p.hashLength] : [p.hashLength]
  return new TextEncoder().encode(JSON.stringify([
    'gibberish-key-wrap', record.version, journalId, record.purpose,
    record.algorithm, record.kdf.name, record.kdf.salt, parameters,
  ]))
}

async function kek(credential: string, record: WrappedKeyRecord, journalId: string, signal?: AbortSignal): Promise<CryptoKey> {
  const salt = fromBase64url(record.kdf.salt, 16, 16)
  return record.purpose === 'passphrase'
    ? passphraseKek(credential, salt, signal) : recoveryKek(credential, salt, journalId)
}

async function wrap(key: CryptoKey, credential: string, journalId: string, purpose: WrappedKeyRecord['purpose'], signal?: AbortSignal): Promise<WrappedKeyRecord> {
  const api = browserCrypto()
  validateJournalId(journalId)
  validateJournalKey(key, 'encrypt')
  validateJournalKey(key, 'decrypt')
  if (!key.extractable) throw new JournalCryptoError('INVALID_KEY')
  const metadata: WrappedKeyRecord = {
    version: 1, purpose, algorithm: 'AES-256-GCM', nonce: '', wrappedKey: '',
    kdf: { name: purpose === 'passphrase' ? 'argon2id' : 'hkdf-sha256',
      salt: toBase64url(randomBytes(16)),
      parameters: purpose === 'passphrase' ? ARGON2ID_PARAMETERS : RECOVERY_PARAMETERS },
  }
  const wrappingKey = await kek(credential, metadata, journalId, signal)
  const nonce = freshNonce()
  try {
    const ciphertext = await api.subtle.wrapKey('raw', key, wrappingKey,
      { name: 'AES-GCM', iv: nonce, additionalData: wrappingAad(metadata, journalId), tagLength: 128 })
    return validateWrappedKey({ ...metadata, nonce: toBase64url(nonce), wrappedKey: toBase64url(new Uint8Array(ciphertext)) }, purpose)
  } catch {
    throw new JournalCryptoError('ENCRYPTION_FAILED')
  }
}

async function unwrap(input: unknown, credential: string, journalId: string, purpose: WrappedKeyRecord['purpose'], signal?: AbortSignal): Promise<CryptoKey> {
  const api = browserCrypto()
  validateJournalId(journalId)
  const record = validateWrappedKey(input, purpose)
  const wrappingKey = await kek(credential, record, journalId, signal)
  try {
    return await api.subtle.unwrapKey('raw', fromBase64url(record.wrappedKey, 48, 48), wrappingKey,
      { name: 'AES-GCM', iv: fromBase64url(record.nonce, 12, 12), additionalData: wrappingAad(record, journalId), tagLength: 128 },
      { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  } catch {
    throw new JournalCryptoError('AUTHENTICATION_FAILED')
  }
}

export const wrapWithPassphrase = (key: CryptoKey, passphrase: string, journalId: string, signal?: AbortSignal) => wrap(key, passphrase, journalId, 'passphrase', signal)
export const unwrapWithPassphrase = (record: unknown, passphrase: string, journalId: string, signal?: AbortSignal) => unwrap(record, passphrase, journalId, 'passphrase', signal)
export const wrapWithRecoveryKey = (key: CryptoKey, recoveryKey: string, journalId: string) => wrap(key, recoveryKey, journalId, 'recovery')
export const unwrapWithRecoveryKey = (record: unknown, recoveryKey: string, journalId: string) => unwrap(record, recoveryKey, journalId, 'recovery')
