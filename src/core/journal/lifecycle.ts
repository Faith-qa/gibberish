import { decryptRevision, encryptRevision, sealTombstone, verifyTombstone } from '../crypto'
import { browserCrypto } from '../crypto/random'
import type { EncryptedJournalRepository, PreparedWrite, PreparedDelete, DeleteReceipt } from '../storage'
import { check, same, validateDelete, validateWrite } from '../storage/validation'
import { authenticateHistory, decodePayload, notAborted } from './content'
import { projectHistory } from './graph'
import { authorize, sessionState } from './session'
import type { JournalSession } from './session'
import { JournalError } from './errors'

export const TRASH_RETENTION_MS = 2_592_000_000
export const trashExpired = (deletedAt: string, now: number): boolean => Number.isFinite(now) && now >= Date.parse(deletedAt) + TRASH_RETENTION_MS

/** Whole-entry lifecycle; cryptographic work always precedes repository transactions. */
export class JournalLifecycle {
  readonly #repository: EncryptedJournalRepository
  constructor(repository: EncryptedJournalRepository) { this.#repository = repository }
  async prepareTransition(session: JournalSession, entryId: string, expectedHead: string, target: 'active' | 'trashed', signal?: AbortSignal): Promise<PreparedWrite> {
    const state = sessionState(session); const live = () => { sessionState(session); notAborted(signal) }; live()
    const expected = await this.#repository.readEntrySnapshot(state.journalId, entryId)
    authorize(session, expected.journal)
    await authenticateHistory(state.key, state.journalId, expected.revisions, expected.tombstones, live)
    check(expected.tombstones.length === 0, 'ENTRY_DELETED')
    const projection = projectHistory(expected.revisions)
    check(projection && projection.status !== 'conflicted' && projection.headRevisionIds.length === 1, 'CONFLICT')
    check(projection.headRevisionIds[0] === expectedHead, 'STALE_SNAPSHOT')
    const parent = expected.revisions.find((r) => r.revisionId === expectedHead); check(parent)
    check(parent.status === (target === 'active' ? 'trashed' : 'active'))
    const now = new Date().toISOString(); check(now >= parent.createdAt, 'CLOCK_REVIEW_REQUIRED')
    const content = decodePayload(await decryptRevision(parent, state.key, { journalId: state.journalId, entryId })); live()
    const bytes = new TextEncoder().encode(JSON.stringify(content))
    try {
      const revision = await encryptRevision(bytes, state.key, { journalId: state.journalId, entryId, revisionId: browserCrypto().randomUUID(), schemaVersion: 1,
        parentRevisionIds: [parent.revisionId], status: target, createdAt: parent.createdAt, updatedAt: now, deletedAt: target === 'trashed' ? now : null })
      live()
      return validateWrite({ expected, revision, operationId: browserCrypto().randomUUID(), conflictId: browserCrypto().randomUUID(), detectedAt: now })
    } finally { bytes.fill(0) }
  }
  async preparePermanentDelete(session: JournalSession, entryId: string, expectedHead: string, reason: 'manual' | 'expiry', confirmed: boolean, signal?: AbortSignal): Promise<PreparedDelete> {
    const state = sessionState(session); const live = () => { sessionState(session); notAborted(signal) }; live()
    check(reason === 'expiry' || (reason === 'manual' && confirmed === true), 'INVALID_CONFIRMATION')
    const expected = await this.#repository.readDeletionSnapshot(state.journalId, entryId)
    authorize(session, expected.entry.journal)
    await authenticateHistory(state.key, state.journalId, expected.entry.revisions, expected.entry.tombstones, live)
    check(expected.entry.tombstones.length === 0, 'ENTRY_DELETED')
    const projection = projectHistory(expected.entry.revisions)
    check(projection && projection.status === 'trashed' && projection.headRevisionIds.length === 1, 'CONFLICT')
    check(projection.headRevisionIds[0] === expectedHead, 'STALE_SNAPSHOT'); check(projection.deletedAt)
    const now = new Date().toISOString(); check(now >= projection.deletedAt, 'CLOCK_REVIEW_REQUIRED')
    if (reason === 'expiry') check(trashExpired(projection.deletedAt, Date.parse(now)), 'INVALID_DATA')
    const tombstone = await sealTombstone({ version: 1, journalId: state.journalId, entryId, deletionRevisionId: expectedHead,
      deletedAt: projection.deletedAt, permanentlyDeletedAt: now }, state.key)
    live()
    return validateDelete({ expected, tombstone, operationId: browserCrypto().randomUUID() })
  }
  async inspectPermanentDelete(session: JournalSession, input: PreparedDelete, signal?: AbortSignal): Promise<DeleteReceipt | null> {
    const plan = validateDelete(input); const state = sessionState(session)
    const live = () => { sessionState(session); notAborted(signal) }; live()
    check(state.journalId === plan.tombstone.journalId, 'LOCKED')
    const current = await this.#repository.readDeletionSnapshot(state.journalId, plan.tombstone.entryId)
    authorize(session, current.entry.journal)
    await authenticateHistory(state.key, state.journalId, current.entry.revisions, current.entry.tombstones, live)
    const marker = current.entry.tombstones[0]
    if (marker && !same(marker, plan.tombstone)) throw new JournalError('ENTRY_DELETED')
    const receipt = await this.#repository.reconcilePermanentDelete(plan); live(); return receipt
  }
  async commitPermanentDelete(session: JournalSession, input: PreparedDelete, signal?: AbortSignal): Promise<DeleteReceipt> {
    const plan = validateDelete(input); const state = authorize(session, plan.expected.entry.journal)
    const live = () => { sessionState(session); notAborted(signal) }; live()
    await authenticateHistory(state.key, state.journalId, plan.expected.entry.revisions, plan.expected.entry.tombstones, live)
    await verifyTombstone(plan.tombstone, state.key, state.journalId); live()
    try { const receipt = await this.#repository.commitPermanentDelete(plan, live); live(); return receipt }
    catch (error) {
      if (error instanceof JournalError && ['STALE_SNAPSHOT', 'COMMIT_UNCERTAIN', 'STORAGE_FAILURE', 'STORAGE_UNAVAILABLE'].includes(error.code)) {
        try { const receipt = await this.inspectPermanentDelete(session, plan, signal); if (receipt) return receipt }
        catch (inspection) {
          if (inspection instanceof JournalError && ['STORAGE_FAILURE', 'STORAGE_UNAVAILABLE'].includes(inspection.code)) throw new JournalError('COMMIT_UNCERTAIN')
          throw inspection
        }
      }
      throw error
    }
  }
}
