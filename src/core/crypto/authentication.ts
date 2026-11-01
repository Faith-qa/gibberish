import { fromBase64url, toBase64url } from './encoding'
import { JournalCryptoError } from './errors'
import { browserCrypto, freshNonce } from './random'
import { validateTimestamp } from './revision'
import { record, validateJournalId, validateJournalKey } from './validation'
import type { AuthenticatedTombstone, AuthenticationProof, BackupManifest, TombstoneMetadata } from './types'

const keys = ['version', 'journalId', 'entryId', 'deletionRevisionId', 'deletedAt', 'permanentlyDeletedAt'] as const
export const MAX_MANIFEST_BYTES = 32 * 1024 * 1024
export function validateProof(value: unknown): AuthenticationProof {
  const r = record(value, ['version', 'algorithm', 'nonce', 'tag'])
  if (r.version !== 1 || r.algorithm !== 'AES-256-GCM') throw new JournalCryptoError('UNSUPPORTED_VERSION')
  fromBase64url(r.nonce, 12, 12); fromBase64url(r.tag, 16, 16)
  return Object.freeze({ version: 1, algorithm: 'AES-256-GCM', nonce: r.nonce as string, tag: r.tag as string })
}
function metadata(value: unknown): TombstoneMetadata {
  const r = record(value, keys)
  if (r.version !== 1) throw new JournalCryptoError('UNSUPPORTED_VERSION')
  validateJournalId(r.journalId); validateJournalId(r.entryId); validateJournalId(r.deletionRevisionId)
  validateTimestamp(r.deletedAt); validateTimestamp(r.permanentlyDeletedAt)
  if (r.permanentlyDeletedAt < r.deletedAt) throw new JournalCryptoError('INVALID_INPUT')
  return Object.freeze({ version: 1, journalId: r.journalId, entryId: r.entryId, deletionRevisionId: r.deletionRevisionId, deletedAt: r.deletedAt, permanentlyDeletedAt: r.permanentlyDeletedAt })
}
export function validateTombstone(value: unknown): AuthenticatedTombstone {
  const r = record(value, [...keys, 'authentication'])
  return Object.freeze({ ...metadata(Object.fromEntries(keys.map((key) => [key, r[key]]))), authentication: validateProof(r.authentication) })
}
function tombstoneAad(m: TombstoneMetadata): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(['gibberish-tombstone-aad', 1, 1, 'AES-256-GCM', m.journalId, m.entryId, m.deletionRevisionId, m.deletedAt, m.permanentlyDeletedAt]))
}
function backupAad(manifest: BackupManifest): Uint8Array<ArrayBuffer> {
  if (!Array.isArray(manifest) || manifest.length !== 6) throw new JournalCryptoError('INVALID_INPUT')
  validateJournalId(manifest[0]); validateTimestamp(manifest[1])
  if (!manifest.slice(2).every(Array.isArray)) throw new JournalCryptoError('INVALID_INPUT')
  const bytes = new TextEncoder().encode(JSON.stringify(['gibberish-backup-aad', 1, 'gibberish-backup', 2, 'AES-256-GCM', manifest]))
  if (bytes.length > MAX_MANIFEST_BYTES) throw new JournalCryptoError('INVALID_INPUT')
  return bytes
}
async function seal(aad: Uint8Array<ArrayBuffer>, key: CryptoKey): Promise<AuthenticationProof> {
  validateJournalKey(key, 'encrypt')
  try {
    const nonce = freshNonce()
    const tag = await browserCrypto().subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 }, key, new Uint8Array(0))
    return validateProof({ version: 1, algorithm: 'AES-256-GCM', nonce: toBase64url(nonce), tag: toBase64url(new Uint8Array(tag)) })
  } catch { throw new JournalCryptoError('ENCRYPTION_FAILED') }
}
async function verify(aad: Uint8Array<ArrayBuffer>, value: unknown, key: CryptoKey): Promise<void> {
  const proof = validateProof(value); validateJournalKey(key, 'decrypt')
  try {
    const bytes = await browserCrypto().subtle.decrypt({ name: 'AES-GCM', iv: fromBase64url(proof.nonce, 12, 12), additionalData: aad, tagLength: 128 }, key, fromBase64url(proof.tag, 16, 16))
    if (bytes.byteLength !== 0) throw new JournalCryptoError('AUTHENTICATION_FAILED')
  } catch { throw new JournalCryptoError('AUTHENTICATION_FAILED') }
}
export async function sealTombstone(value: TombstoneMetadata, key: CryptoKey): Promise<AuthenticatedTombstone> {
  const m = metadata(value)
  return Object.freeze({ ...m, authentication: await seal(tombstoneAad(m), key) })
}
export async function verifyTombstone(value: unknown, key: CryptoKey, journalId: string): Promise<void> {
  validateJournalId(journalId)
  const r = validateTombstone(value)
  if (r.journalId !== journalId) throw new JournalCryptoError('AUTHENTICATION_FAILED')
  await verify(tombstoneAad(r), r.authentication, key)
}
export const sealBackupManifest = (manifest: BackupManifest, key: CryptoKey) => seal(backupAad(manifest), key)
export const verifyBackupManifest = (manifest: BackupManifest, proof: unknown, key: CryptoKey) => verify(backupAad(manifest), proof, key)
