import { fromBase64url, toBase64url } from './encoding'
import { JournalCryptoError } from './errors'
import { browserCrypto, freshNonce } from './random'
import { MAX_PLAINTEXT_BYTES } from './types'
import type { EncryptedJournalRevision, RevisionMetadata } from './types'
import { record, validateJournalId, validateJournalKey, validateOperationalEnvelope } from './validation'

export const MAX_REVISION_PARENTS = 256
const metadataKeys = ['journalId', 'entryId', 'revisionId', 'parentRevisionIds', 'status', 'createdAt', 'updatedAt', 'deletedAt', 'schemaVersion'] as const

export function validateTimestamp(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new JournalCryptoError('INVALID_INPUT')
}

export function validateRevisionMetadata(value: unknown): RevisionMetadata {
  const r = record(value, metadataKeys)
  if (r.schemaVersion !== 1) throw new JournalCryptoError('UNSUPPORTED_VERSION')
  validateJournalId(r.journalId); validateJournalId(r.entryId); validateJournalId(r.revisionId)
  validateTimestamp(r.createdAt); validateTimestamp(r.updatedAt)
  if (r.updatedAt < r.createdAt || !Array.isArray(r.parentRevisionIds) || r.parentRevisionIds.length > MAX_REVISION_PARENTS) throw new JournalCryptoError('INVALID_INPUT')
  const parents: string[] = []
  for (const parent of r.parentRevisionIds) {
    validateJournalId(parent)
    if (parent === r.revisionId || (parents.length > 0 && parent <= (parents[parents.length - 1] ?? ''))) throw new JournalCryptoError('INVALID_INPUT')
    parents.push(parent)
  }
  if (r.status === 'active') {
    if (r.deletedAt !== null) throw new JournalCryptoError('INVALID_INPUT')
  } else if (r.status === 'trashed') {
    validateTimestamp(r.deletedAt)
    if (r.deletedAt !== r.updatedAt) throw new JournalCryptoError('INVALID_INPUT')
  } else throw new JournalCryptoError('INVALID_INPUT')
  if (parents.length === 0 && (r.status !== 'active' || r.createdAt !== r.updatedAt)) throw new JournalCryptoError('INVALID_INPUT')
  return Object.freeze({ journalId: r.journalId, entryId: r.entryId, revisionId: r.revisionId,
    parentRevisionIds: Object.freeze(parents), status: r.status, createdAt: r.createdAt,
    updatedAt: r.updatedAt, deletedAt: r.deletedAt as string | null, schemaVersion: 1 })
}

export function revisionMetadata(revision: EncryptedJournalRevision): RevisionMetadata {
  return validateRevisionMetadata(Object.fromEntries(metadataKeys.map((key) => [key, revision[key]])))
}

export function validateRevision(value: unknown): EncryptedJournalRevision {
  const input = record(value, [...metadataKeys, 'encryptedPayload'])
  const metadata = validateRevisionMetadata(Object.fromEntries(metadataKeys.map((key) => [key, input[key]])))
  return Object.freeze({ ...metadata, encryptedPayload: validateOperationalEnvelope(input.encryptedPayload) })
}

export function revisionAadV2(value: RevisionMetadata): Uint8Array<ArrayBuffer> {
  const m = validateRevisionMetadata(value)
  return new TextEncoder().encode(JSON.stringify(['gibberish-revision-aad', 2, 2, 'AES-256-GCM', m.schemaVersion,
    m.journalId, m.entryId, m.revisionId, m.parentRevisionIds, m.status, m.createdAt, m.updatedAt, m.deletedAt]))
}

export async function encryptRevision(plaintext: Uint8Array, key: CryptoKey, value: RevisionMetadata): Promise<EncryptedJournalRevision> {
  const api = browserCrypto()
  validateJournalKey(key, 'encrypt')
  const metadata = validateRevisionMetadata(value)
  const aad = revisionAadV2(metadata)
  if (!(plaintext instanceof Uint8Array) || plaintext.length > MAX_PLAINTEXT_BYTES) throw new JournalCryptoError('INVALID_INPUT')
  const iv = freshNonce()
  const copy = new Uint8Array(plaintext)
  try {
    const encrypted = await api.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, copy)
    return validateRevision({ ...metadata, encryptedPayload: { version: 2, algorithm: 'AES-256-GCM', nonce: toBase64url(iv), ciphertext: toBase64url(new Uint8Array(encrypted)) } })
  } catch {
    throw new JournalCryptoError('ENCRYPTION_FAILED')
  } finally { copy.fill(0) }
}

export async function decryptRevision(input: unknown, key: CryptoKey, scope: { journalId: string; entryId: string }): Promise<Uint8Array<ArrayBuffer>> {
  const api = browserCrypto()
  validateJournalKey(key, 'decrypt')
  const expected = record(scope, ['journalId', 'entryId'])
  validateJournalId(expected.journalId); validateJournalId(expected.entryId)
  const r = validateRevision(input)
  if (r.journalId !== expected.journalId || r.entryId !== expected.entryId) throw new JournalCryptoError('AUTHENTICATION_FAILED')
  const envelope = r.encryptedPayload
  try {
    return new Uint8Array(await api.subtle.decrypt({ name: 'AES-GCM', tagLength: 128,
      iv: fromBase64url(envelope.nonce, 12, 12), additionalData: revisionAadV2(revisionMetadata(r)),
    }, key, fromBase64url(envelope.ciphertext, 16, MAX_PLAINTEXT_BYTES + 16)))
  } catch { throw new JournalCryptoError('AUTHENTICATION_FAILED') }
}
