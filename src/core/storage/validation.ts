import { validateRevision, validateWrappedKey, validateTombstone } from '../crypto'
import { record, validateJournalId } from '../crypto/validation'
import { validateTimestamp } from '../crypto/revision'
import { JournalError } from '../journal/errors'
import type { DeviceConfig, EntrySnapshot, JournalConfig, JournalKeys, JournalSnapshot, JournalState, PassphraseResetPlan, PreparedWrite, SyncOperation, Tombstone, DeletionSnapshot, PreparedDelete, RestorePlan, SyncMetadata } from './types'

export function id(value: unknown): asserts value is string { validateJournalId(value) }
export function time(value: unknown): asserts value is string { validateTimestamp(value) }
export function check(condition: unknown, code: ConstructorParameters<typeof JournalError>[0] = 'INVALID_DATA'): asserts condition {
  if (!condition) throw new JournalError(code)
}
export function validateConfig(value: unknown): JournalConfig {
  const r = record(value, ['journalId', 'schemaVersion', 'createdAt', 'autoLockMinutes', 'codecVersion', 'encryptionVersion'])
  id(r.journalId); time(r.createdAt)
  check(r.schemaVersion === 1 && r.autoLockMinutes === 5 && r.codecVersion === 1 && r.encryptionVersion === 2)
  return Object.freeze({ journalId: r.journalId, schemaVersion: 1, createdAt: r.createdAt, autoLockMinutes: 5, codecVersion: 1, encryptionVersion: 2 })
}
export function validateKeys(value: unknown): JournalKeys {
  const r = record(value, ['journalId', 'version', 'passphraseWrappedKey', 'recoveryWrappedKey'])
  id(r.journalId); check(r.version === 1)
  return Object.freeze({ journalId: r.journalId, version: 1,
    passphraseWrappedKey: validateWrappedKey(r.passphraseWrappedKey, 'passphrase'), recoveryWrappedKey: validateWrappedKey(r.recoveryWrappedKey, 'recovery') })
}
export function validateDevice(value: unknown): DeviceConfig {
  const r = record(value, ['deviceId', 'cloudEnabled', 'googleSpreadsheetId', 'googleDriveFolderId', 'lastSuccessfulSyncAt'])
  id(r.deviceId); check(typeof r.cloudEnabled === 'boolean')
  for (const field of ['googleSpreadsheetId', 'googleDriveFolderId'] as const) {
    check(r[field] === null || (typeof r[field] === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(r[field])))
  }
  if (r.lastSuccessfulSyncAt !== null) time(r.lastSuccessfulSyncAt)
  return Object.freeze({ deviceId: r.deviceId, cloudEnabled: r.cloudEnabled,
    googleSpreadsheetId: r.googleSpreadsheetId as string | null, googleDriveFolderId: r.googleDriveFolderId as string | null,
    lastSuccessfulSyncAt: r.lastSuccessfulSyncAt as string | null })
}
export function validateState(value: unknown): JournalState {
  const r = record(value, ['config', 'keys', 'device'])
  const config = validateConfig(r.config); const keys = validateKeys(r.keys); const device = validateDevice(r.device)
  check(config.journalId === keys.journalId, 'INTEGRITY_ERROR')
  return Object.freeze({ config, keys, device })
}
export const MAX_HISTORY_REVISIONS = 10000
export const MAX_TOMBSTONES = 10000
export function markers(value: unknown, journalId: string, entryId?: string): readonly Tombstone[] {
  check(Array.isArray(value)); check(value.length <= MAX_TOMBSTONES, 'LIMIT_EXCEEDED')
  let rows: Tombstone[]
  try { rows = value.map(validateTombstone) } catch { throw new JournalError('DELETION_REVIEW_REQUIRED') }
  rows.sort((a, b) => a.entryId < b.entryId ? -1 : 1)
  const ids = new Set<string>()
  for (const row of rows) {
    check(row.journalId === journalId && (!entryId || row.entryId === entryId), 'INTEGRITY_ERROR')
    check(!ids.has(row.entryId), 'ID_COLLISION'); ids.add(row.entryId)
  }
  return Object.freeze(rows)
}
export function validateSnapshot(value: unknown): EntrySnapshot {
  const r = record(value, ['journal', 'entryId', 'revisions', 'tombstones'])
  const journal = validateState(r.journal); id(r.entryId)
  check(Array.isArray(r.revisions))
  check(r.revisions.length <= MAX_HISTORY_REVISIONS, 'LIMIT_EXCEEDED')
  const revisions = r.revisions.map(validateRevision).sort((a, b) => a.revisionId < b.revisionId ? -1 : a.revisionId > b.revisionId ? 1 : 0)
  const seen = new Set<string>()
  for (const revision of revisions) {
    check(revision.journalId === journal.config.journalId && revision.entryId === r.entryId, 'INTEGRITY_ERROR')
    check(!seen.has(revision.revisionId), 'ID_COLLISION'); seen.add(revision.revisionId)
  }
  return Object.freeze({ journal, entryId: r.entryId, revisions: Object.freeze(revisions), tombstones: markers(r.tombstones, journal.config.journalId, r.entryId as string) })
}
export function validateJournalSnapshot(value: unknown): JournalSnapshot {
  const r = record(value, ['journal', 'revisions', 'tombstones']); const journal = validateState(r.journal)
  check(Array.isArray(r.revisions))
  check(r.revisions.length <= MAX_HISTORY_REVISIONS, 'LIMIT_EXCEEDED')
  const revisions = r.revisions.map(validateRevision).sort((a, b) => a.revisionId < b.revisionId ? -1 : a.revisionId > b.revisionId ? 1 : 0)
  check(revisions.every((revision) => revision.journalId === journal.config.journalId), 'INTEGRITY_ERROR')
  return Object.freeze({ journal, revisions: Object.freeze(revisions), tombstones: markers(r.tombstones, journal.config.journalId) })
}
export function validateWrite(value: unknown): PreparedWrite {
  const r = record(value, ['expected', 'revision', 'operationId', 'conflictId', 'detectedAt'])
  const expected = validateSnapshot(r.expected); const revision = validateRevision(r.revision)
  id(r.operationId); id(r.conflictId); time(r.detectedAt)
  check(expected.entryId === revision.entryId && expected.journal.config.journalId === revision.journalId, 'INTEGRITY_ERROR')
  return Object.freeze({ expected, revision, operationId: r.operationId, conflictId: r.conflictId, detectedAt: r.detectedAt })
}
export function validateResetPlan(value: unknown): PassphraseResetPlan {
  const r = record(value, ['expected', 'nextKeys'])
  const expected = validateJournalSnapshot(r.expected); const nextKeys = validateKeys(r.nextKeys)
  check(nextKeys.journalId === expected.journal.config.journalId
    && same(nextKeys.recoveryWrappedKey, expected.journal.keys.recoveryWrappedKey))
  return Object.freeze({ expected, nextKeys })
}
export function validateOperation(value: unknown): SyncOperation {
  const r = record(value, ['operationId', 'journalId', 'entryId', 'revisionId', 'type', 'state', 'createdAt', 'attempts', 'lastAttemptAt'])
  id(r.operationId); id(r.journalId); time(r.createdAt)
  if (r.entryId !== null) id(r.entryId)
  if (r.revisionId !== null) id(r.revisionId)
  if (r.lastAttemptAt !== null) time(r.lastAttemptAt)
  check(['publish-revision', 'sync-keys', 'sync-config', 'publish-tombstone'].includes(r.type as string))
  check(['pending', 'in-progress', 'failed'].includes(r.state as string))
  check(typeof r.attempts === 'number' && Number.isSafeInteger(r.attempts) && r.attempts >= 0)
  check(r.type !== 'publish-revision' || (r.entryId !== null && r.revisionId !== null))
  check(r.type !== 'publish-tombstone' || (r.entryId !== null && r.revisionId === null))
  return Object.freeze({ operationId: r.operationId, journalId: r.journalId, entryId: r.entryId as string | null, revisionId: r.revisionId as string | null,
    type: r.type as SyncOperation['type'], state: r.state as SyncOperation['state'], createdAt: r.createdAt,
    attempts: r.attempts, lastAttemptAt: r.lastAttemptAt as string | null })
}
/** Only validated, explicitly ordered DTOs are compared; this is not authentication. */
export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

export function validateSyncMetadata(value: unknown): SyncMetadata {
  const r = record(value, ['entryId', 'journalId', 'acknowledgedRevisionIds', 'lastSyncedAt', 'remoteHeadRevisionIds'])
  id(r.entryId); id(r.journalId); if (r.lastSyncedAt !== null) time(r.lastSyncedAt)
  function ids(value: unknown): string[] { check(Array.isArray(value)); check(value.length <= MAX_HISTORY_REVISIONS, 'LIMIT_EXCEEDED'); const list = value.map((v: unknown) => { id(v); return v }); check(new Set(list).size === list.length); return list }
  return Object.freeze({ entryId: r.entryId, journalId: r.journalId, acknowledgedRevisionIds: ids(r.acknowledgedRevisionIds), lastSyncedAt: r.lastSyncedAt as string | null, remoteHeadRevisionIds: ids(r.remoteHeadRevisionIds) })
}
export function validateDeletionSnapshot(value: unknown): DeletionSnapshot {
  const r = record(value, ['entry', 'operations', 'metadata']); const entry = validateSnapshot(r.entry)
  check(Array.isArray(r.operations)); check(r.operations.length <= MAX_HISTORY_REVISIONS, 'LIMIT_EXCEEDED')
  const operations = r.operations.map(validateOperation).sort((a, b) => a.operationId < b.operationId ? -1 : 1)
  check(operations.every((o) => o.journalId === entry.journal.config.journalId && o.entryId === entry.entryId), 'INTEGRITY_ERROR')
  const metadata = r.metadata === null ? null : validateSyncMetadata(r.metadata)
  check(!metadata || (metadata.entryId === entry.entryId && metadata.journalId === entry.journal.config.journalId), 'INTEGRITY_ERROR')
  return Object.freeze({ entry, operations: Object.freeze(operations), metadata })
}
export function validateDelete(value: unknown): PreparedDelete {
  const r = record(value, ['expected', 'tombstone', 'operationId'])
  const expected = validateDeletionSnapshot(r.expected); const tombstone = validateTombstone(r.tombstone); id(r.operationId)
  check(expected.entry.entryId === tombstone.entryId && expected.entry.journal.config.journalId === tombstone.journalId)
  return Object.freeze({ expected, tombstone, operationId: r.operationId })
}
export function validateRestore(value: unknown): RestorePlan {
  const r = record(value, ['snapshot', 'conflictIds', 'restoredAt']); const snapshot = validateJournalSnapshot(r.snapshot); time(r.restoredAt)
  check(Array.isArray(r.conflictIds)); check(r.conflictIds.length <= MAX_HISTORY_REVISIONS, 'LIMIT_EXCEEDED')
  const conflictIds = r.conflictIds.map((value: unknown) => { const pair = record(value, ['entryId', 'conflictId']); id(pair.entryId); id(pair.conflictId); return Object.freeze({ entryId: pair.entryId, conflictId: pair.conflictId }) })
  check(new Set(conflictIds.map((p) => p.entryId)).size === conflictIds.length)
  check(new Set(conflictIds.map((p) => p.conflictId)).size === conflictIds.length)
  check(!snapshot.journal.device.cloudEnabled && snapshot.journal.device.lastSuccessfulSyncAt === null)
  return Object.freeze({ snapshot, conflictIds: Object.freeze(conflictIds), restoredAt: r.restoredAt })
}
