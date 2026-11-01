import { validateProof, validateRevision } from '../crypto'
import type { AuthenticationProof, BackupManifest, WrappedKeyRecord } from '../crypto'
import type { JournalConfig, JournalKeys, Tombstone } from '../storage'
import type { EncryptedJournalRevision } from '../crypto'
import { check, id, markers, MAX_HISTORY_REVISIONS, time, validateConfig, validateKeys } from '../storage/validation'
import { record } from '../crypto/validation'
import { JournalError } from '../journal/errors'

export const MAX_BACKUP_BYTES = 32 * 1024 * 1024
export interface PortableJournal {
  readonly journalConfig: JournalConfig
  readonly journalKeys: JournalKeys
  readonly revisions: readonly EncryptedJournalRevision[]
  readonly tombstones: readonly Tombstone[]
}
export interface EncryptedBackup extends PortableJournal {
  readonly format: 'gibberish-backup'; readonly version: 2
  readonly exportId: string; readonly exportedAt: string; readonly authentication: AuthenticationProof
}
export function validatePortable(value: unknown): PortableJournal {
  const r = record(value, ['journalConfig', 'journalKeys', 'revisions', 'tombstones'])
  const journalConfig = validateConfig(r.journalConfig); const journalKeys = validateKeys(r.journalKeys)
  check(journalConfig.journalId === journalKeys.journalId, 'INVALID_BACKUP')
  check(Array.isArray(r.revisions)); check(r.revisions.length <= MAX_HISTORY_REVISIONS, 'EXPORT_TOO_LARGE')
  const revisions = r.revisions.map(validateRevision).sort((a, b) => a.revisionId < b.revisionId ? -1 : 1)
  const tombstones = markers(r.tombstones, journalConfig.journalId)
  const deleted = new Set(tombstones.map((m) => m.entryId)); const ids = new Set<string>(); const nonces = new Set(tombstones.map((m) => m.authentication.nonce))
  check(nonces.size === tombstones.length, 'INVALID_BACKUP')
  for (const row of revisions) {
    check(row.journalId === journalConfig.journalId && !ids.has(row.revisionId) && !deleted.has(row.entryId) && !nonces.has(row.encryptedPayload.nonce), 'INVALID_BACKUP')
    ids.add(row.revisionId); nonces.add(row.encryptedPayload.nonce)
  }
  return Object.freeze({ journalConfig, journalKeys, revisions: Object.freeze(revisions), tombstones })
}
function wrapper(r: WrappedKeyRecord) {
  const p = r.kdf.parameters
  return [r.version, r.purpose, r.algorithm, r.kdf.name, r.kdf.salt, r.purpose === 'passphrase' ? [p.version, p.memoryKiB, p.iterations, p.parallelism, p.hashLength] : [p.hashLength], r.nonce, r.wrappedKey]
}
export function backupManifest(portable: PortableJournal, exportId: string, exportedAt: string): BackupManifest {
  id(exportId); time(exportedAt)
  const c = portable.journalConfig; const k = portable.journalKeys
  return [exportId, exportedAt, [c.journalId, c.schemaVersion, c.createdAt, c.autoLockMinutes, c.codecVersion, c.encryptionVersion],
    [k.journalId, k.version, wrapper(k.passphraseWrappedKey), wrapper(k.recoveryWrappedKey)],
    portable.revisions.map((r) => [r.journalId, r.entryId, r.revisionId, r.parentRevisionIds, r.status, r.createdAt, r.updatedAt, r.deletedAt, r.schemaVersion,
      [r.encryptedPayload.version, r.encryptedPayload.algorithm, r.encryptedPayload.nonce, r.encryptedPayload.ciphertext]]),
    portable.tombstones.map((m) => [m.version, m.journalId, m.entryId, m.deletionRevisionId, m.deletedAt, m.permanentlyDeletedAt,
      [m.authentication.version, m.authentication.algorithm, m.authentication.nonce, m.authentication.tag]])]
}
export function makeBackup(portable: PortableJournal, exportId: string, exportedAt: string, authentication: AuthenticationProof): EncryptedBackup {
  id(exportId); time(exportedAt)
  return Object.freeze({ format: 'gibberish-backup', version: 2, exportId, exportedAt, ...validatePortable(portable), authentication: validateProof(authentication) })
}
export function serializeBackup(backup: EncryptedBackup): Uint8Array<ArrayBuffer> {
  const text = JSON.stringify(backup)
  check(text.length <= MAX_BACKUP_BYTES, 'EXPORT_TOO_LARGE')
  const bytes = new TextEncoder().encode(text); check(bytes.length <= MAX_BACKUP_BYTES, 'EXPORT_TOO_LARGE'); return bytes
}
export function parseBackup(bytes: Uint8Array): EncryptedBackup {
  check(bytes instanceof Uint8Array && bytes.byteLength <= MAX_BACKUP_BYTES, 'EXPORT_TOO_LARGE')
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    const r = record(JSON.parse(text), ['format', 'version', 'exportId', 'exportedAt', 'journalConfig', 'journalKeys', 'revisions', 'tombstones', 'authentication'])
    check(r.format === 'gibberish-backup' && r.version === 2, 'INVALID_BACKUP'); id(r.exportId); time(r.exportedAt)
    const p = validatePortable({ journalConfig: r.journalConfig, journalKeys: r.journalKeys, revisions: r.revisions, tombstones: r.tombstones })
    const value = makeBackup(p, r.exportId, r.exportedAt, validateProof(r.authentication))
    check(JSON.stringify(value) === text, 'INVALID_BACKUP')
    const nonce = value.authentication.nonce
    check(!p.revisions.some((r) => r.encryptedPayload.nonce === nonce) && !p.tombstones.some((m) => m.authentication.nonce === nonce), 'INVALID_BACKUP')
    return value
  } catch (error) {
    if (error instanceof JournalError && error.code === 'EXPORT_TOO_LARGE') throw error
    throw new JournalError('INVALID_BACKUP')
  }
}
