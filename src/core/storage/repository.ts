import { validateRevision } from '../crypto'
import { JournalCryptoError } from '../crypto'
import { JournalError } from '../journal/errors'
import { projectHistory, projectJournal } from '../journal/graph'
import { JournalDatabase, openDatabase } from './database'
import { check, id, MAX_HISTORY_REVISIONS, same, time, validateJournalSnapshot, validateKeys, validateOperation, validateSnapshot, validateState, validateWrite } from './validation'
import type { CommitReceipt, EntryProjection, EntrySnapshot, JournalDiscovery, JournalKeys, JournalSnapshot, JournalState, PreparedWrite } from './types'

export class EncryptedJournalRepository {
  readonly #db: JournalDatabase
  constructor(db: JournalDatabase) { this.#db = db }
  close(): void { this.#db.close() }

  async #guard<T>(work: () => Promise<T>): Promise<T> {
    if (!this.#db.isOpen()) throw new JournalError('STORAGE_UNAVAILABLE')
    try { return await work() } catch (error) {
      if (error instanceof JournalError) throw error
      if (error instanceof JournalCryptoError) throw new JournalError('INTEGRITY_ERROR')
      if (error instanceof Error && error.name === 'ConstraintError') throw new JournalError('NONCE_COLLISION')
      throw new JournalError('STORAGE_FAILURE')
    }
  }

  async #state(journalId: string): Promise<JournalState> {
    const db = this.#db
    const config = await db.journal_config.get(journalId)
    check(config, 'NOT_FOUND')
    check(await db.journal_config.count() === 1 && await db.journal_keys.count() === 1 && await db.device_config.count() === 1, 'INTEGRITY_ERROR')
    const state = validateState({ config, keys: await db.journal_keys.get(journalId), device: await db.device_config.toCollection().first() })
    check(state.config.journalId === journalId, 'INTEGRITY_ERROR')
    check(await db.journal_tombstones.count() === 0, 'DELETION_REVIEW_REQUIRED')
    return state
  }

  #scope() {
    const d = this.#db
    return [d.journal_config, d.journal_keys, d.device_config, d.journal_revisions,
      d.journal_entries, d.sync_queue, d.sync_conflicts, d.journal_tombstones]
  }

  async #entry(journalId: string, entryId: string): Promise<EntrySnapshot> {
    return validateSnapshot({ journal: await this.#state(journalId), entryId,
      revisions: await this.#db.journal_revisions.where('[journalId+entryId]').equals([journalId, entryId]).limit(MAX_HISTORY_REVISIONS + 1).toArray() })
  }

  async #journal(journalId: string): Promise<JournalSnapshot> {
    return validateJournalSnapshot({ journal: await this.#state(journalId),
      revisions: await this.#db.journal_revisions.where('journalId').equals(journalId).limit(MAX_HISTORY_REVISIONS + 1).toArray() })
  }

  async discoverJournal(): Promise<JournalDiscovery> {
    return this.#guard(() => this.#db.transaction('r', this.#db.tables, async () => {
      const configs = await this.#db.journal_config.limit(2).toArray()
      if (configs.length === 0) {
        for (const table of this.#db.tables) check(await table.count() === 0, 'INTEGRITY_ERROR')
        return { kind: 'empty' as const }
      }
      check(configs.length === 1, 'INTEGRITY_ERROR')
      const config = configs[0]; check(config, 'INTEGRITY_ERROR'); id(config.journalId)
      await this.#state(config.journalId)
      return { kind: 'existing' as const, journalId: config.journalId }
    }))
  }

  async initializeJournal(input: JournalState, authorize: () => void = () => {}): Promise<void> {
    const state = validateState(input)
    // Initialization is strictly local-only. Synthetic cloud fixtures can be
    // established through the internal adapter, not a product connection flow.
    check(!state.device.cloudEnabled && state.device.lastSuccessfulSyncAt === null)
    return this.#guard(() => this.#db.transaction('rw', this.#db.tables, async () => {
      const db = this.#db
      authorize()
      const existing = await db.journal_config.limit(2).toArray()
      if (existing.length > 0) {
        check(existing.length === 1 && existing[0]?.journalId === state.config.journalId, 'JOURNAL_EXISTS')
        check(same(await this.#state(state.config.journalId), state), 'JOURNAL_EXISTS')
        return
      }
      for (const table of db.tables) check(await table.count() === 0, 'INTEGRITY_ERROR')
      await db.journal_keys.add(state.keys)
      await db.journal_config.add(state.config)
      await db.device_config.add(state.device)
      authorize()
    }))
  }

  async replaceJournalKeys(expected: JournalSnapshot, replacement: JournalKeys, authorize: () => void): Promise<void> {
    const snapshot = validateJournalSnapshot(expected); const next = validateKeys(replacement)
    check(next.journalId === snapshot.journal.config.journalId && !snapshot.journal.device.cloudEnabled)
    check(same(next.recoveryWrappedKey, snapshot.journal.keys.recoveryWrappedKey))
    return this.#guard(() => this.#db.transaction('rw', this.#scope(), async () => {
      const current = await this.#journal(next.journalId)
      authorize()
      check(same(current, snapshot), 'STALE_SNAPSHOT')
      await this.#db.journal_keys.put(next)
      authorize()
    }))
  }

  async readJournal(journalId: string): Promise<JournalState> {
    id(journalId)
    return this.#guard(() => this.#db.transaction('r', this.#scope(), () => this.#state(journalId)))
  }
  async readEntrySnapshot(journalId: string, entryId: string): Promise<EntrySnapshot> {
    id(journalId); id(entryId)
    return this.#guard(() => this.#db.transaction('r', this.#scope(), () => this.#entry(journalId, entryId)))
  }
  async readJournalSnapshot(journalId: string): Promise<JournalSnapshot> {
    id(journalId)
    return this.#guard(() => this.#db.transaction('r', this.#scope(), () => this.#journal(journalId)))
  }

  async #pending(plan: PreparedWrite, required: boolean): Promise<boolean> {
    const rows = await this.#db.sync_queue.where('[journalId+revisionId]').equals([plan.revision.journalId, plan.revision.revisionId]).limit(2).toArray()
    check(rows.length <= 1 && (!required || rows.length === 1), 'INTEGRITY_ERROR')
    for (const row of rows) {
      const operation = validateOperation(row)
      check(operation.type === 'publish-revision' && operation.entryId === plan.revision.entryId
        && operation.operationId === plan.operationId, 'INTEGRITY_ERROR')
    }
    return rows.length === 1
  }

  #receipt(plan: PreparedWrite, pending: boolean, outcome: CommitReceipt['outcome']): CommitReceipt {
    return Object.freeze({ journalId: plan.revision.journalId, entryId: plan.revision.entryId,
      revisionId: plan.revision.revisionId, outcome, syncStatus: pending ? 'pending' : 'local-only' })
  }

  async #writeProjection(projection: EntryProjection, conflictId: string, detectedAt: string): Promise<void> {
    const db = this.#db
    await db.journal_entries.put(projection)
    const selector = db.sync_conflicts.where('[journalId+entryId]').equals([projection.journalId, projection.entryId])
    const old = await selector.first()
    let stableId = conflictId
    if (old) {
      try { id(old.conflictId); stableId = old.conflictId } catch { /* Discard corrupt derived cache identity only. */ }
    }
    const collision = await db.sync_conflicts.get(stableId)
    check(!collision || (collision.journalId === projection.journalId && collision.entryId === projection.entryId), 'ID_COLLISION')
    await selector.delete()
    if (projection.status === 'conflicted') await db.sync_conflicts.add({ conflictId: stableId,
      journalId: projection.journalId, entryId: projection.entryId, conflictingRevisionIds: projection.headRevisionIds,
      detectedAt, resolved: false, resolutionRevisionId: null })
  }

  async commitPreparedRevision(input: PreparedWrite, authorize: () => void): Promise<CommitReceipt> {
    const plan = validateWrite(input)
    return this.#guard(() => this.#db.transaction('rw', this.#scope(), async () => {
      const db = this.#db
      const current = await this.#entry(plan.revision.journalId, plan.revision.entryId)
      authorize()
      const existing = await db.journal_revisions.get(plan.revision.revisionId)
      if (existing) {
        check(same(validateRevision(existing), plan.revision), 'ID_COLLISION')
        check(same(current.journal.config, plan.expected.journal.config) && same(current.journal.keys, plan.expected.journal.keys), 'STALE_SNAPSHOT')
        // An exact replay writes nothing, but newly observed history must still
        // return to the domain for authentication before acknowledging it.
        const source = (rows: EntrySnapshot['revisions']) => rows.filter((r) => r.revisionId !== plan.revision.revisionId)
        check(same(source(current.revisions), source(plan.expected.revisions)), 'STALE_SNAPSHOT')
        return this.#receipt(plan, await this.#pending(plan, plan.expected.journal.device.cloudEnabled), 'already-committed')
      }
      check(same(current, plan.expected), 'STALE_SNAPSHOT')
      check(await db.journal_revisions.count() < MAX_HISTORY_REVISIONS, 'LIMIT_EXCEEDED')
      const projection = projectHistory([...current.revisions, plan.revision])
      check(projection, 'INTEGRITY_ERROR')
      check(!await db.sync_queue.get(plan.operationId), 'ID_COLLISION')
      authorize()
      await db.journal_revisions.add(plan.revision)
      await this.#writeProjection(projection, plan.conflictId, plan.detectedAt)
      if (current.journal.device.cloudEnabled) {
        await db.sync_queue.add(validateOperation({ operationId: plan.operationId, journalId: plan.revision.journalId,
          entryId: plan.revision.entryId, revisionId: plan.revision.revisionId, type: 'publish-revision', state: 'pending',
          createdAt: plan.detectedAt, attempts: 0, lastAttemptAt: null }))
      }
      authorize()
      return this.#receipt(plan, current.journal.device.cloudEnabled, 'committed')
    }))
  }

  async reconcileCommit(input: PreparedWrite): Promise<CommitReceipt | null> {
    const plan = validateWrite(input)
    return this.#guard(() => this.#db.transaction('r', this.#scope(), async () => {
      const state = await this.#state(plan.revision.journalId)
      check(same(state.config, plan.expected.journal.config) && same(state.keys, plan.expected.journal.keys), 'AUTHORIZATION_CHANGED')
      const found = await this.#db.journal_revisions.get(plan.revision.revisionId)
      if (!found) return null
      check(same(validateRevision(found), plan.revision), 'ID_COLLISION')
      return this.#receipt(plan, await this.#pending(plan, plan.expected.journal.device.cloudEnabled), 'already-committed')
    }))
  }

  async rebuildProjectionCache(expected: JournalSnapshot, conflictIds: ReadonlyMap<string, string>, detectedAt: string, authorize: () => void): Promise<void> {
    const snapshot = validateJournalSnapshot(expected)
    time(detectedAt)
    const ids = new Map(conflictIds)
    for (const [entryId, conflictId] of ids) { id(entryId); id(conflictId) }
    return this.#guard(() => this.#db.transaction('rw', this.#scope(), async () => {
      const current = await this.#journal(snapshot.journal.config.journalId)
      check(same(current, snapshot), 'STALE_SNAPSHOT')
      authorize()
      const projections = projectJournal(current.revisions)
      const entryIds = new Set(projections.map((p) => p.entryId))
      for (const cached of await this.#db.journal_entries.where('journalId').equals(current.journal.config.journalId).toArray()) {
        if (!entryIds.has(cached.entryId)) await this.#db.journal_entries.delete(cached.entryId)
      }
      for (const cached of await this.#db.sync_conflicts.where('journalId').equals(current.journal.config.journalId).toArray()) {
        if (!entryIds.has(cached.entryId)) await this.#db.sync_conflicts.delete(cached.conflictId)
      }
      for (const projection of projections) {
        const conflictId = ids.get(projection.entryId); id(conflictId)
        await this.#writeProjection(projection, conflictId, detectedAt)
      }
      authorize()
    }))
  }
}

export async function openRepository(name?: string): Promise<EncryptedJournalRepository> {
  return new EncryptedJournalRepository(await openDatabase(name))
}
