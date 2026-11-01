import { decryptRevision, sealBackupManifest, unwrapWithPassphrase, unwrapWithRecoveryKey, verifyBackupManifest, wrapWithPassphrase } from '../crypto'
import { browserCrypto } from '../crypto/random'
import { backupManifest, makeBackup, MAX_BACKUP_BYTES, parseBackup, serializeBackup, validatePortable } from '../export/backup'
import type { EncryptedBackup } from '../export/backup'
import { formatMarkdown, yieldTask } from '../export/markdown'
import type { ReadableRecord } from '../export/markdown'
import type { EncryptedJournalRepository, JournalSnapshot, RestorePlan } from '../storage'
import { check, same, validateRestore, validateState } from '../storage/validation'
import { authenticateHistory, decodePayload, notAborted, preserveHistory } from './content'
import { projectJournal } from './graph'
import { authorize, mint, sessionState } from './session'
import type { JournalSession } from './session'
import { validateNewPassphrase } from './access'
import { JournalError } from './errors'

export interface RestoreHandle { close(): void }
interface Restoring { key: CryptoKey; backup: EncryptedBackup; mode: 'passphrase' | 'recovery'; plan?: RestorePlan }
export class JournalPortability {
  readonly #repository: EncryptedJournalRepository
  readonly #restores = new WeakMap<RestoreHandle, Restoring>()
  constructor(repository: EncryptedJournalRepository) { this.#repository = repository }
  async #snapshot(session: JournalSession, live: () => void): Promise<JournalSnapshot> {
    const state = sessionState(session); live()
    const snapshot = await this.#repository.readJournalSnapshot(state.journalId); authorize(session, snapshot.journal)
    await authenticateHistory(state.key, state.journalId, snapshot.revisions, snapshot.tombstones, live)
    projectJournal(snapshot.revisions); live(); return snapshot
  }
  async #unchanged(session: JournalSession, snapshot: JournalSnapshot, live: () => void): Promise<void> {
    const current = await this.#repository.readJournalSnapshot(snapshot.journal.config.journalId)
    authorize(session, current.journal); live(); check(same(current, snapshot), 'STALE_SNAPSHOT')
  }
  async encryptedBackup(session: JournalSession, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
    const live = () => { sessionState(session); notAborted(signal) }
    const snapshot = await this.#snapshot(session, live); const state = sessionState(session)
    const portable = validatePortable({ journalConfig: snapshot.journal.config, journalKeys: snapshot.journal.keys, revisions: snapshot.revisions, tombstones: snapshot.tombstones })
    const exportId = browserCrypto().randomUUID(); const exportedAt = new Date().toISOString()
    const placeholder = { version: 1 as const, algorithm: 'AES-256-GCM' as const, nonce: 'A'.repeat(16), tag: 'A'.repeat(22) }
    check(JSON.stringify(makeBackup(portable, exportId, exportedAt, placeholder)).length <= MAX_BACKUP_BYTES, 'EXPORT_TOO_LARGE')
    await yieldTask(); live()
    const authentication = await sealBackupManifest(backupManifest(portable, exportId, exportedAt), state.key); live()
    const bytes = serializeBackup(makeBackup(portable, exportId, exportedAt, authentication))
    try { await this.#unchanged(session, snapshot, live); return bytes }
    catch (error) { bytes.fill(0); throw error }
  }
  async readableExport(session: JournalSession, acknowledged: boolean, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
    check(acknowledged === true, 'INVALID_CONFIRMATION')
    const live = () => { sessionState(session); notAborted(signal) }; live()
    const snapshot = await this.#snapshot(session, live); const state = sessionState(session)
    const byId = new Map(snapshot.revisions.map((r) => [r.revisionId, r]))
    const projections = projectJournal(snapshot.revisions)
    async function* records(): AsyncGenerator<ReadableRecord> {
      for (const projection of projections) {
        for (let index = 0; index < projection.headRevisionIds.length; index++) {
          const row = byId.get(projection.headRevisionIds[index]!); check(row)
          if (row.status !== 'active') continue
          const payload = decodePayload(await decryptRevision(row, state.key, { journalId: state.journalId, entryId: row.entryId })); live()
          yield { ...payload, createdAt: row.createdAt, updatedAt: row.updatedAt, version: index + 1, versions: projection.headRevisionIds.length }
        }
      }
    }
    const bytes = await formatMarkdown(records(), live)
    try { await this.#unchanged(session, snapshot, live); return bytes }
    catch (error) { bytes.fill(0); throw error }
  }
  #restore(handle: RestoreHandle, signal?: AbortSignal): Restoring {
    notAborted(signal); const state = this.#restores.get(handle); check(state, 'LOCKED'); return state
  }
  #plan(state: Restoring, passphraseWrappedKey = state.backup.journalKeys.passphraseWrappedKey): RestorePlan {
    const b = state.backup
    const journal = validateState({ config: b.journalConfig, keys: { ...b.journalKeys, passphraseWrappedKey }, device: {
      deviceId: browserCrypto().randomUUID(), cloudEnabled: false, googleSpreadsheetId: null, googleDriveFolderId: null, lastSuccessfulSyncAt: null } })
    return validateRestore({ snapshot: { journal, revisions: b.revisions, tombstones: b.tombstones }, restoredAt: new Date().toISOString(),
      conflictIds: projectJournal(b.revisions).map((p) => ({ entryId: p.entryId, conflictId: browserCrypto().randomUUID() })) })
  }
  async prepareRestore(bytes: Uint8Array, credential: string, mode: 'passphrase' | 'recovery', signal?: AbortSignal): Promise<RestoreHandle> {
    notAborted(signal); check(mode === 'passphrase' || mode === 'recovery')
    const backup = parseBackup(bytes)
    check((await this.#repository.discoverJournal()).kind === 'empty', 'JOURNAL_EXISTS'); notAborted(signal)
    const key = mode === 'passphrase'
      ? await unwrapWithPassphrase(backup.journalKeys.passphraseWrappedKey, credential, backup.journalConfig.journalId, signal)
      : await unwrapWithRecoveryKey(backup.journalKeys.recoveryWrappedKey, credential, backup.journalConfig.journalId)
    notAborted(signal)
    await verifyBackupManifest(backupManifest(backup, backup.exportId, backup.exportedAt), backup.authentication, key); notAborted(signal)
    await authenticateHistory(key, backup.journalConfig.journalId, backup.revisions, backup.tombstones, () => notAborted(signal))
    projectJournal(backup.revisions); notAborted(signal)
    const handle = Object.freeze({ close: () => { this.#restores.delete(handle) } })
    const state: Restoring = { key, backup, mode }
    if (mode === 'passphrase') state.plan = this.#plan(state)
    this.#restores.set(handle, state); return handle
  }
  restoreSummary(handle: RestoreHandle) {
    const state = this.#restore(handle); const projections = projectJournal(state.backup.revisions)
    return Object.freeze({ exportedAt: state.backup.exportedAt, entries: projections.length,
      trash: projections.filter((p) => p.status === 'trashed').length, conflicts: projections.filter((p) => p.status === 'conflicted').length,
      tombstones: state.backup.tombstones.length, needsPassphrase: !state.plan })
  }
  async setRestorePassphrase(handle: RestoreHandle, phrase: string, confirmation: string, signal?: AbortSignal): Promise<void> {
    const state = this.#restore(handle, signal); check(state.mode === 'recovery' && !state.plan)
    validateNewPassphrase(phrase, confirmation)
    const wrapped = await wrapWithPassphrase(state.key, phrase, state.backup.journalConfig.journalId, signal)
    this.#restore(handle, signal); state.plan = this.#plan(state, wrapped)
  }
  restorePlan(handle: RestoreHandle): RestorePlan | undefined { return this.#restore(handle).plan }
  async #inspect(key: CryptoKey, plan: RestorePlan, live: () => void): Promise<boolean> {
    const current = await this.#repository.readJournalSnapshot(plan.snapshot.journal.config.journalId)
    check(same(current.journal, plan.snapshot.journal), 'JOURNAL_EXISTS')
    await authenticateHistory(key, current.journal.config.journalId, current.revisions, current.tombstones, live)
    projectJournal(current.revisions)
    preserveHistory(plan.snapshot.revisions, current.revisions, current.tombstones)
    for (const old of plan.snapshot.tombstones) check(current.tombstones.some((m) => same(m, old)), 'INCOMPLETE_HISTORY')
    live(); return true
  }
  async inspectRestoration(session: JournalSession, plan: RestorePlan): Promise<boolean> {
    const state = sessionState(session); check(state.journalId === plan.snapshot.journal.config.journalId, 'LOCKED')
    return this.#inspect(state.key, validateRestore(plan), () => { sessionState(session) })
  }
  async commitRestore(handle: RestoreHandle, signal?: AbortSignal): Promise<{ journalId: string; session: JournalSession }> {
    const state = this.#restore(handle, signal); const plan = state.plan; check(plan, 'INVALID_CONFIRMATION')
    const live = () => { this.#restore(handle, signal) }; live()
    try { await this.#repository.restoreJournal(plan, live) }
    catch (error) {
      if (!(error instanceof JournalError) || !['COMMIT_UNCERTAIN', 'STORAGE_FAILURE', 'STORAGE_UNAVAILABLE', 'JOURNAL_EXISTS'].includes(error.code)) throw error
      live()
      try { await this.#inspect(state.key, plan, live) }
      catch (inspection) {
        if (inspection instanceof JournalError && inspection.code === 'NOT_FOUND') throw error
        if (inspection instanceof JournalError && inspection.code === 'JOURNAL_EXISTS') throw inspection
        if (inspection instanceof JournalError && ['STORAGE_FAILURE', 'STORAGE_UNAVAILABLE'].includes(inspection.code)) throw new JournalError('COMMIT_UNCERTAIN')
        throw inspection
      }
    }
    live()
    const result = { journalId: plan.snapshot.journal.config.journalId,
      session: mint({ key: state.key, journalId: plan.snapshot.journal.config.journalId, keys: plan.snapshot.journal.keys }) }
    handle.close(); return result
  }
}
