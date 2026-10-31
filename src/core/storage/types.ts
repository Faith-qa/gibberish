import type { EncryptedJournalRevision, WrappedKeyRecord } from '../crypto'

export interface JournalConfig {
  journalId: string; schemaVersion: 1; createdAt: string; autoLockMinutes: 5; codecVersion: 1; encryptionVersion: 2
}
export interface JournalKeys {
  journalId: string; version: 1; passphraseWrappedKey: WrappedKeyRecord; recoveryWrappedKey: WrappedKeyRecord
}
export interface DeviceConfig {
  deviceId: string; cloudEnabled: boolean; googleSpreadsheetId: string | null
  googleDriveFolderId: string | null; lastSuccessfulSyncAt: string | null
}
export interface JournalState { config: JournalConfig; keys: JournalKeys; device: DeviceConfig }
export interface EntrySnapshot { journal: JournalState; entryId: string; revisions: readonly EncryptedJournalRevision[] }
export interface JournalSnapshot { journal: JournalState; revisions: readonly EncryptedJournalRevision[] }
export type JournalDiscovery = { kind: 'empty' } | { kind: 'existing'; journalId: string }
export interface PassphraseResetPlan { expected: JournalSnapshot; nextKeys: JournalKeys }
export interface EntryView { projection: EntryProjection; heads: readonly EncryptedJournalRevision[] }
export interface EntryProjection {
  journalId: string; entryId: string; headRevisionIds: readonly string[]
  status: 'active' | 'trashed' | 'conflicted'; createdAt: string; updatedAt: string; deletedAt: string | null
}
export interface SyncConflict {
  conflictId: string; journalId: string; entryId: string; conflictingRevisionIds: readonly string[]
  detectedAt: string; resolved: boolean; resolutionRevisionId: string | null
}
export interface SyncOperation {
  operationId: string; journalId: string; entryId: string | null; revisionId: string | null
  type: 'publish-revision' | 'sync-keys' | 'sync-config' | 'publish-tombstone'
  state: 'pending' | 'in-progress' | 'failed'; createdAt: string; attempts: number; lastAttemptAt: string | null
}
export interface SyncMetadata {
  entryId: string; journalId: string; acknowledgedRevisionIds: string[]; lastSyncedAt: string | null; remoteHeadRevisionIds: string[]
}
export interface Tombstone {
  journalId: string; entryId: string; deletionRevisionId: string; deletedAt: string; permanentlyDeletedAt: string
}
export interface PreparedWrite {
  expected: EntrySnapshot; revision: EncryptedJournalRevision; operationId: string; conflictId: string; detectedAt: string
}
export interface CommitReceipt {
  journalId: string; entryId: string; revisionId: string; outcome: 'committed' | 'already-committed'; syncStatus: 'local-only' | 'pending'
}
