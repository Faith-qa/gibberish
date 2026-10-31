import { decryptRevision, encryptRevision, generateJournalKey, generateRecoveryKey, JournalCryptoError, MAX_PLAINTEXT_BYTES,
  unwrapWithPassphrase, wrapWithPassphrase, wrapWithRecoveryKey } from '../crypto'
import type { EncryptedJournalRevision, RevisionMetadata } from '../crypto'
import { browserCrypto } from '../crypto/random'
import type { EncryptedJournalRepository } from '../storage'
import { check, id, same, validateResetPlan, validateState, validateWrite } from '../storage/validation'
import type { CommitReceipt, EntryProjection, EntryView, JournalKeys, JournalState, PassphraseResetPlan, PreparedWrite } from '../storage'
import { JournalError } from './errors'
import { projectHistory, projectJournal } from './graph'
import { JournalAccess } from './access'
import type { SetupHandle, RecoveryHandle } from './access'
import { authenticateRows, payload, decodePayload, notAborted } from './content'
import type { JournalPayload } from './content'

export type { JournalPayload } from './content'
/** Opaque, revocable in-memory capability. It contains no serializable key. */
export interface JournalSession { close(): void }
interface SessionState { journalId: string; key: CryptoKey; keys: JournalKeys }
const sessions = new WeakMap<JournalSession, SessionState>()
const MAX_COMMIT_ATTEMPTS = 3

function sessionState(session: JournalSession): SessionState {
  const state = sessions.get(session)
  if (!state) throw new JournalError('LOCKED')
  return state
}
function mint(state: SessionState): JournalSession {
  const session = Object.freeze({ close() { sessions.delete(session) } })
  sessions.set(session, state)
  return session
}
function uuid(): string { return browserCrypto().randomUUID() }

export class JournalService {
  readonly #repository: EncryptedJournalRepository
  readonly #access: JournalAccess
  constructor(repository: EncryptedJournalRepository) { this.#repository = repository; this.#access = new JournalAccess(repository, mint) }

  discoverJournal() { return this.#repository.discoverJournal() }
  prepareJournal(passphrase: string, confirmation: string, signal?: AbortSignal) { return this.#access.prepareJournal(passphrase, confirmation, signal) }
  getRecoveryKey(handle: SetupHandle) { return this.#access.getRecoveryKey(handle) }
  confirmJournal(handle: SetupHandle, confirmation: string, acknowledged: boolean, signal?: AbortSignal) { return this.#access.confirmJournal(handle, confirmation, acknowledged, signal) }
  authenticateRecovery(journalId: string, credential: string, signal?: AbortSignal) { return this.#access.authenticateRecovery(journalId, credential, signal) }
  preparePassphraseReset(handle: RecoveryHandle, passphrase: string, confirmation: string, signal?: AbortSignal) { return this.#access.preparePassphraseReset(handle, passphrase, confirmation, signal) }
  preparedPassphraseReset(handle: RecoveryHandle) { return this.#access.preparedPassphraseReset(handle) }
  commitPassphraseReset(handle: RecoveryHandle, plan: PassphraseResetPlan, signal?: AbortSignal) { return this.#access.commitPassphraseReset(handle, plan, signal) }
  reconcileRecoveryReset(handle: RecoveryHandle, plan: PassphraseResetPlan) { return this.#access.reconcileRecoveryReset(handle, plan) }

  async initializeJournal(passphrase: string): Promise<{ journalId: string; recoveryKey: string; session: JournalSession }> {
    const journalId = uuid(); const deviceId = uuid(); const createdAt = new Date().toISOString()
    const key = await generateJournalKey(); const recoveryKey = generateRecoveryKey()
    const state = validateState({
      config: { journalId, schemaVersion: 1, createdAt, autoLockMinutes: 5, codecVersion: 1, encryptionVersion: 2 },
      keys: { journalId, version: 1, passphraseWrappedKey: await wrapWithPassphrase(key, passphrase, journalId),
        recoveryWrappedKey: await wrapWithRecoveryKey(key, recoveryKey, journalId) },
      device: { deviceId, cloudEnabled: false, googleSpreadsheetId: null, googleDriveFolderId: null, lastSuccessfulSyncAt: null },
    })
    try { await this.#repository.initializeJournal(state) } catch (error) {
      if (error instanceof JournalError && (error.code === 'STORAGE_FAILURE' || error.code === 'COMMIT_UNCERTAIN')) {
        try {
          check(same(await this.#repository.readJournal(journalId), state), 'INTEGRITY_ERROR')
        } catch { throw error }
      } else throw error
    }
    return { journalId, recoveryKey, session: mint({ journalId, key, keys: state.keys }) }
  }

  async unlockJournal(journalId: string, passphrase: string, signal?: AbortSignal): Promise<JournalSession> {
    notAborted(signal)
    const state = await this.#repository.readJournal(journalId)
    const key = await unwrapWithPassphrase(state.keys.passphraseWrappedKey, passphrase, journalId, signal)
    notAborted(signal)
    return mint({ journalId, key, keys: state.keys })
  }

  #authorize(session: JournalSession, journal: JournalState): SessionState {
    const state = sessionState(session)
    check(state.journalId === journal.config.journalId, 'LOCKED')
    if (!same(state.keys, journal.keys)) { session.close(); throw new JournalError('AUTHORIZATION_CHANGED') }
    return state
  }

  async #authenticate(session: JournalSession, journal: JournalState, rows: readonly EncryptedJournalRevision[]): Promise<void> {
    const state = this.#authorize(session, journal)
    await authenticateRows(state.key, state.journalId, rows, () => { sessionState(session) })
  }

  async #seal(session: JournalSession, value: unknown, metadata: RevisionMetadata): Promise<EncryptedJournalRevision> {
    const state = sessionState(session)
    const bytes = new TextEncoder().encode(JSON.stringify(payload(value)))
    try {
      check(bytes.length <= MAX_PLAINTEXT_BYTES)
      const revision = await encryptRevision(bytes, state.key, metadata)
      sessionState(session)
      return revision
    } finally { bytes.fill(0) }
  }

  async prepareCreate(session: JournalSession, input: JournalPayload): Promise<PreparedWrite> {
    const state = sessionState(session); const entryId = uuid()
    const expected = await this.#repository.readEntrySnapshot(state.journalId, entryId)
    this.#authorize(session, expected.journal)
    check(expected.revisions.length === 0, 'ID_COLLISION')
    const now = new Date().toISOString()
    const revision = await this.#seal(session, input, { journalId: state.journalId, entryId, revisionId: uuid(), schemaVersion: 1,
      parentRevisionIds: [], status: 'active', createdAt: now, updatedAt: now, deletedAt: null })
    return validateWrite({ expected, revision, operationId: uuid(), conflictId: uuid(), detectedAt: now })
  }

  async prepareEdit(session: JournalSession, entryId: string, baseRevisionId: string, input: JournalPayload): Promise<PreparedWrite> {
    const state = sessionState(session); id(baseRevisionId)
    const expected = await this.#repository.readEntrySnapshot(state.journalId, entryId)
    await this.#authenticate(session, expected.journal, expected.revisions)
    projectHistory(expected.revisions)
    const parent = expected.revisions.find((r) => r.revisionId === baseRevisionId)
    check(parent, 'NOT_FOUND'); check(parent.status === 'active', 'INVALID_DATA')
    const now = new Date().toISOString(); const updatedAt = now < parent.createdAt ? parent.createdAt : now
    const revision = await this.#seal(session, input, { journalId: state.journalId, entryId, revisionId: uuid(), schemaVersion: 1,
      parentRevisionIds: [parent.revisionId], status: 'active', createdAt: parent.createdAt, updatedAt, deletedAt: null })
    return validateWrite({ expected, revision, operationId: uuid(), conflictId: uuid(), detectedAt: now })
  }

  async commitWrite(session: JournalSession, input: PreparedWrite): Promise<CommitReceipt> {
    let plan = validateWrite(input)
    const original = plan.expected
    await this.#authenticate(session, original.journal, [...original.revisions, plan.revision])
    projectHistory([...original.revisions, plan.revision])
    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
      sessionState(session)
      try {
        const receipt = await this.#repository.commitPreparedRevision(plan, () => { sessionState(session) })
        sessionState(session)
        return receipt
      } catch (error) {
        if (!(error instanceof JournalError)) throw error
        if (error.code === 'STALE_SNAPSHOT') {
          const current = await this.#repository.readEntrySnapshot(plan.revision.journalId, plan.revision.entryId)
          await this.#authenticate(session, current.journal, current.revisions)
          for (const previous of original.revisions) {
            const row = current.revisions.find((r) => r.revisionId === previous.revisionId)
            check(row, 'INCOMPLETE_HISTORY'); check(same(row, previous), 'ID_COLLISION')
          }
          const present = current.revisions.find((r) => r.revisionId === plan.revision.revisionId)
          if (present) check(same(present, plan.revision), 'ID_COLLISION')
          projectHistory(present ? current.revisions : [...current.revisions, plan.revision])
          plan = validateWrite({ ...plan, expected: current })
          continue
        }
        if (['COMMIT_UNCERTAIN', 'STORAGE_FAILURE', 'STORAGE_UNAVAILABLE'].includes(error.code)) {
          try {
            const current = await this.#repository.readEntrySnapshot(plan.revision.journalId, plan.revision.entryId)
            await this.#authenticate(session, current.journal, current.revisions)
            projectHistory(current.revisions)
            const receipt = await this.#repository.reconcileCommit(plan)
            sessionState(session)
            if (receipt) return receipt
          } catch (recoveryError) {
            if (recoveryError instanceof JournalCryptoError || (recoveryError instanceof JournalError
              && !['COMMIT_UNCERTAIN', 'STORAGE_FAILURE', 'STORAGE_UNAVAILABLE'].includes(recoveryError.code))) throw recoveryError
            throw new JournalError('COMMIT_UNCERTAIN')
          }
        }
        throw error
      }
    }
    throw new JournalError('RETRY_LIMIT')
  }

  async createEntry(session: JournalSession, input: JournalPayload): Promise<CommitReceipt> {
    return this.commitWrite(session, await this.prepareCreate(session, input))
  }
  async editEntry(session: JournalSession, entryId: string, baseRevisionId: string, input: JournalPayload): Promise<CommitReceipt> {
    return this.commitWrite(session, await this.prepareEdit(session, entryId, baseRevisionId, input))
  }

  async listEntries(session: JournalSession): Promise<EntryProjection[]> {
    const state = sessionState(session)
    const snapshot = await this.#repository.readJournalSnapshot(state.journalId)
    await this.#authenticate(session, snapshot.journal, snapshot.revisions)
    const projections = projectJournal(snapshot.revisions).filter((p) => p.status !== 'trashed')
    sessionState(session)
    return projections
  }

  async listEntryViews(session: JournalSession): Promise<EntryView[]> {
    const state = sessionState(session)
    const snapshot = await this.#repository.readJournalSnapshot(state.journalId)
    await this.#authenticate(session, snapshot.journal, snapshot.revisions)
    const byId = new Map(snapshot.revisions.map((row) => [row.revisionId, row]))
    const views = projectJournal(snapshot.revisions).filter((p) => p.status !== 'trashed').map((projection) => Object.freeze({
      projection, heads: Object.freeze(projection.headRevisionIds.map((id) => { const row = byId.get(id); check(row, 'INCOMPLETE_HISTORY'); return row })),
    }))
    sessionState(session)
    return views
  }

  async readEncryptedEntry(session: JournalSession, entryId: string, revisionId?: string): Promise<{ projection: EntryProjection; revision: EncryptedJournalRevision }> {
    const state = sessionState(session)
    const snapshot = await this.#repository.readEntrySnapshot(state.journalId, entryId)
    await this.#authenticate(session, snapshot.journal, snapshot.revisions)
    const projection = projectHistory(snapshot.revisions); check(projection, 'NOT_FOUND')
    if (!revisionId && projection.status === 'conflicted') throw new JournalError('CONFLICT')
    const revision = snapshot.revisions.find((r) => r.revisionId === (revisionId ?? projection.headRevisionIds[0])); check(revision, 'NOT_FOUND')
    sessionState(session)
    return { projection, revision }
  }

  async inspectPassphraseReset(session: JournalSession, input: PassphraseResetPlan): Promise<'committed' | 'not-committed'> {
    const { expected, nextKeys: next } = validateResetPlan(input)
    const state = sessionState(session)
    check(next.journalId === state.journalId && expected.journal.config.journalId === state.journalId)
    const current = await this.#repository.readJournalSnapshot(state.journalId)
    await this.#authenticate(session, current.journal, current.revisions); projectJournal(current.revisions)
    for (const previous of expected.revisions) {
      const row = current.revisions.find((r) => r.revisionId === previous.revisionId)
      check(row, 'INCOMPLETE_HISTORY'); check(same(row, previous), 'ID_COLLISION')
    }
    const committed = same(current.journal.keys, next)
    check(committed || same(current.journal.keys, expected.journal.keys), 'AUTHORIZATION_CHANGED')
    sessionState(session)
    return committed ? 'committed' : 'not-committed'
  }

  async readEntry(session: JournalSession, entryId: string, revisionId?: string): Promise<{ projection: EntryProjection; revisionId: string; payload: JournalPayload }> {
    const state = sessionState(session)
    const snapshot = await this.#repository.readEntrySnapshot(state.journalId, entryId)
    await this.#authenticate(session, snapshot.journal, snapshot.revisions)
    const projection = projectHistory(snapshot.revisions); check(projection, 'NOT_FOUND')
    if (!revisionId && projection.status === 'conflicted') throw new JournalError('CONFLICT')
    const chosen = snapshot.revisions.find((r) => r.revisionId === (revisionId ?? projection.headRevisionIds[0]))
    check(chosen, 'NOT_FOUND')
    const decoded = decodePayload(await decryptRevision(chosen, state.key, { journalId: state.journalId, entryId }))
    sessionState(session)
    return { projection, revisionId: chosen.revisionId, payload: decoded }
  }

  async rebuildProjections(session: JournalSession): Promise<void> {
    const state = sessionState(session)
    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
      const snapshot = await this.#repository.readJournalSnapshot(state.journalId)
      await this.#authenticate(session, snapshot.journal, snapshot.revisions)
      const ids = new Map(projectJournal(snapshot.revisions).map((p) => [p.entryId, uuid()]))
      try {
        await this.#repository.rebuildProjectionCache(snapshot, ids, new Date().toISOString(), () => { sessionState(session) })
        sessionState(session)
        return
      } catch (error) { if (!(error instanceof JournalError) || error.code !== 'STALE_SNAPSHOT') throw error }
    }
    throw new JournalError('RETRY_LIMIT')
  }

  async inspectCommit(session: JournalSession, input: PreparedWrite): Promise<CommitReceipt | null> {
    const plan = validateWrite(input)
    await this.#authenticate(session, plan.expected.journal, [plan.revision])
    const current = await this.#repository.readEntrySnapshot(plan.revision.journalId, plan.revision.entryId)
    await this.#authenticate(session, current.journal, current.revisions)
    projectHistory(current.revisions)
    const receipt = await this.#repository.reconcileCommit(plan)
    sessionState(session)
    return receipt
  }
}
