// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encryptRevision, revisionMetadata, unwrapWithPassphrase } from '../../../src/core/crypto'
import { JournalError } from '../../../src/core/journal'
import { MAX_HISTORY_REVISIONS, validateJournalSnapshot } from '../../../src/core/storage/validation'
import { cleanup, connect, content, fixture, phrase, rawStores } from './fixture'

afterEach(async () => { vi.restoreAllMocks(); await cleanup() })

describe('M2 atomic transactions and failure recovery', () => {
  it('fails at the documented history limit before writing and never silently truncates a snapshot', async () => {
    const f = await fixture()
    const plan = await f.service.prepareCreate(f.session, content)
    expect(() => validateJournalSnapshot({ journal: plan.expected.journal,
      revisions: Array.from({ length: MAX_HISTORY_REVISIONS + 1 }, () => plan.revision) })).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }))
    vi.spyOn(f.db.journal_revisions, 'count').mockResolvedValueOnce(MAX_HISTORY_REVISIONS)
    await expect(f.service.commitWrite(f.session, plan)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    expect(await f.db.journal_revisions.count()).toBe(0)
  })
  it('rolls back partial journal initialization', async () => {
    const f = await connect()
    vi.spyOn(f.db.device_config, 'add').mockRejectedValueOnce(new DOMException('Synthetic quota failure', 'QuotaExceededError'))
    await expect(f.service.initializeJournal(phrase)).rejects.toMatchObject({ code: 'STORAGE_FAILURE' })
    for (const table of f.db.tables) expect(await table.count()).toBe(0)
  })

  it('reconciles an initialization receipt lost after its atomic commit', async () => {
    const f = await connect()
    const initialize = f.repository.initializeJournal.bind(f.repository)
    vi.spyOn(f.repository, 'initializeJournal').mockImplementationOnce(async (state) => {
      await initialize(state)
      throw new JournalError('COMMIT_UNCERTAIN')
    })
    const journal = await f.service.initializeJournal(phrase)
    expect(await f.db.journal_config.count()).toBe(1)
    expect(await f.db.journal_keys.count()).toBe(1)
    expect(await f.service.listEntries(journal.session)).toEqual([])
  })

  it.each(['revision', 'projection', 'outbox'] as const)('rolls back every related write on %s failure', async (stage) => {
    const f = await fixture()
    const state = await f.repository.readJournal(f.journalId)
    await f.db.device_config.update(state.device.deviceId, { cloudEnabled: true }) // Adapter fixture, no Google integration.
    const plan = await f.service.prepareCreate(f.session, content)
    const before = await rawStores(f.db)
    const error = new DOMException('Synthetic transaction failure', 'QuotaExceededError')
    if (stage === 'revision') vi.spyOn(f.db.journal_revisions, 'add').mockRejectedValueOnce(error)
    if (stage === 'projection') vi.spyOn(f.db.journal_entries, 'put').mockRejectedValueOnce(error)
    if (stage === 'outbox') vi.spyOn(f.db.sync_queue, 'add').mockRejectedValueOnce(error)
    await expect(f.service.commitWrite(f.session, plan)).rejects.toMatchObject({ code: 'STORAGE_FAILURE' })
    expect(await rawStores(f.db)).toEqual(before)
    const saved = await f.service.commitWrite(f.session, plan)
    expect(saved).toMatchObject({ outcome: 'committed', syncStatus: 'pending' })
    expect(await f.db.journal_revisions.count()).toBe(1)
    expect(await f.db.journal_entries.count()).toBe(1)
    expect(await f.db.sync_queue.toArray()).toEqual([expect.objectContaining({ operationId: plan.operationId,
      revisionId: plan.revision.revisionId, state: 'pending', attempts: 0 })])
  })

  it('rolls back conflict creation and preserves the first branch if its cache write fails', async () => {
    const f = await fixture()
    const root = await f.service.createEntry(f.session, content)
    const a = await f.service.prepareEdit(f.session, root.entryId, root.revisionId, content)
    const b = await f.service.prepareEdit(f.session, root.entryId, root.revisionId, content)
    await f.service.commitWrite(f.session, a)
    const before = await rawStores(f.db)
    vi.spyOn(f.db.sync_conflicts, 'add').mockRejectedValueOnce(new Error('Synthetic conflict cache failure'))
    await expect(f.service.commitWrite(f.session, b)).rejects.toMatchObject({ code: 'STORAGE_FAILURE' })
    expect(await rawStores(f.db)).toEqual(before)
    await f.service.commitWrite(f.session, b)
    expect((await f.service.listEntries(f.session))[0]?.status).toBe('conflicted')
  })

  it('enforces exact source snapshots, reauthenticates races, and never rebases a sealed edit', async () => {
    const f = await fixture()
    const root = await f.service.createEntry(f.session, content)
    const plan = await f.service.prepareEdit(f.session, root.entryId, root.revisionId, content)
    await f.db.device_config.update(plan.expected.journal.device.deviceId, { cloudEnabled: true })
    await expect(f.repository.commitPreparedRevision(plan, () => {})).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' })
    const encrypt = vi.spyOn(crypto.subtle, 'encrypt')
    const receipt = await f.service.commitWrite(f.session, plan)
    expect(receipt.syncStatus).toBe('pending')
    expect(encrypt).not.toHaveBeenCalled()
    expect(await f.db.journal_revisions.get(plan.revision.revisionId)).toEqual(plan.revision)
    expect((await f.db.sync_queue.toArray())[0]?.operationId).toBe(plan.operationId)
    expect(plan.revision.parentRevisionIds).toEqual([root.revisionId])
  })

  it('checks complete record bytes instead of only revision IDs', async () => {
    const f = await fixture()
    const root = await f.service.createEntry(f.session, content)
    const plan = await f.service.prepareEdit(f.session, root.entryId, root.revisionId, content)
    const prior = plan.expected.revisions[0]!
    const cipher = Buffer.from(prior.encryptedPayload.ciphertext, 'base64url'); cipher[0] = (cipher[0] ?? 0) ^ 1
    await f.db.journal_revisions.put({ ...prior, encryptedPayload: { ...prior.encryptedPayload, ciphertext: cipher.toString('base64url') } })
    await expect(f.repository.commitPreparedRevision(plan, () => {})).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' })
    await expect(f.service.commitWrite(f.session, plan)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    expect(await f.db.journal_revisions.count()).toBe(1)
  })

  it('rejects a source rewritten with a valid tag under the same immutable ID', async () => {
    const f = await fixture()
    const root = await f.service.createEntry(f.session, content)
    const plan = await f.service.prepareEdit(f.session, root.entryId, root.revisionId, content)
    const source = plan.expected.revisions[0]!
    const key = await unwrapWithPassphrase(plan.expected.journal.keys.passphraseWrappedKey, phrase, f.journalId)
    const rewritten = await encryptRevision(new TextEncoder().encode(JSON.stringify({ ...content, body: 'Synthetic rewritten source' })), key, revisionMetadata(source))
    await f.db.journal_revisions.put(rewritten)
    await expect(f.service.commitWrite(f.session, plan)).rejects.toMatchObject({ code: 'ID_COLLISION' })
    expect(await f.db.journal_revisions.toArray()).toEqual([rewritten])
  })

  it('reauthenticates newly observed history on an idempotent retry', async () => {
    const f = await fixture()
    const plan = await f.service.prepareCreate(f.session, content)
    await f.service.commitWrite(f.session, plan)
    const edited = await f.service.editEntry(f.session, plan.revision.entryId, plan.revision.revisionId, content)
    const row = (await f.db.journal_revisions.get(edited.revisionId))!
    const cipher = Buffer.from(row.encryptedPayload.ciphertext, 'base64url'); cipher[0] = (cipher[0] ?? 0) ^ 1
    await f.db.journal_revisions.put({ ...row, encryptedPayload: { ...row.encryptedPayload, ciphertext: cipher.toString('base64url') } })
    await expect(f.service.commitWrite(f.session, plan)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    expect(await f.db.journal_revisions.count()).toBe(2)
  })

  it('rolls back a partial projection rebuild without touching history', async () => {
    const f = await fixture()
    const first = await f.service.createEntry(f.session, content)
    await f.service.createEntry(f.session, content)
    await f.db.journal_entries.update(first.entryId, { status: 'trashed' })
    const before = await rawStores(f.db)
    const put = f.db.journal_entries.put.bind(f.db.journal_entries)
    vi.spyOn(f.db.journal_entries, 'put').mockImplementationOnce((...args) => put(...args))
      .mockRejectedValueOnce(new DOMException('Synthetic rebuild abort', 'AbortError'))
    await expect(f.service.rebuildProjections(f.session)).rejects.toMatchObject({ code: 'STORAGE_FAILURE' })
    expect(await rawStores(f.db)).toEqual(before)
  })

  it('bounds continually stale retries and never reports an unsaved write as saved', async () => {
    const f = await fixture()
    const plan = await f.service.prepareCreate(f.session, content)
    const commit = vi.spyOn(f.repository, 'commitPreparedRevision').mockRejectedValue(new JournalError('STALE_SNAPSHOT'))
    await expect(f.service.commitWrite(f.session, plan)).rejects.toMatchObject({ code: 'RETRY_LIMIT' })
    expect(commit).toHaveBeenCalledTimes(3)
    expect(await f.db.journal_revisions.count()).toBe(0)
  })

  it('replays an exact revision idempotently and rejects a different ciphertext under the same ID', async () => {
    const f = await fixture()
    const plan = await f.service.prepareCreate(f.session, content)
    await f.service.commitWrite(f.session, plan)
    const encrypt = vi.spyOn(crypto.subtle, 'encrypt')
    await expect(f.service.commitWrite(f.session, plan)).resolves.toMatchObject({ outcome: 'already-committed' })
    expect(encrypt).not.toHaveBeenCalled()
    const key = await unwrapWithPassphrase(plan.expected.journal.keys.passphraseWrappedKey, phrase, f.journalId)
    const replacement = await encryptRevision(new TextEncoder().encode(JSON.stringify({ ...content, body: 'Synthetic collision' })), key, revisionMetadata(plan.revision))
    await expect(f.service.commitWrite(f.session, { ...plan, revision: replacement })).rejects.toMatchObject({ code: 'ID_COLLISION' })
    expect(await f.db.journal_revisions.get(plan.revision.revisionId)).toEqual(plan.revision)
    expect(await f.db.journal_revisions.count()).toBe(1)
  })

  it('recovers a committed write after a lost receipt without creating another revision', async () => {
    const f = await fixture()
    const plan = await f.service.prepareCreate(f.session, content)
    const commit = f.repository.commitPreparedRevision.bind(f.repository)
    vi.spyOn(f.repository, 'commitPreparedRevision').mockImplementationOnce(async (...args) => {
      await commit(...args)
      throw new JournalError('COMMIT_UNCERTAIN')
    })
    await expect(f.service.commitWrite(f.session, plan)).resolves.toMatchObject({ outcome: 'already-committed' })
    expect(await f.db.journal_revisions.count()).toBe(1)
    expect(await f.service.inspectCommit(f.session, plan)).toMatchObject({ outcome: 'already-committed' })
  })

  it('preserves uncertain ciphertext, then reconciles original IDs after connection recovery', async () => {
    const f = await fixture()
    const plan = await f.service.prepareCreate(f.session, content)
    const commit = f.repository.commitPreparedRevision.bind(f.repository)
    vi.spyOn(f.repository, 'commitPreparedRevision').mockImplementationOnce(async (...args) => {
      await commit(...args)
      f.repository.close()
      throw new JournalError('COMMIT_UNCERTAIN')
    })
    await expect(f.service.commitWrite(f.session, plan)).rejects.toMatchObject({ code: 'COMMIT_UNCERTAIN' })
    f.session.close()
    const reopened = await connect(f.db.name)
    const session = await reopened.service.unlockJournal(f.journalId, phrase)
    // Prepared plans contain only encrypted records and non-secret metadata.
    const restoredPlan = JSON.parse(JSON.stringify(plan)) as typeof plan
    expect(await reopened.service.inspectCommit(session, restoredPlan)).toMatchObject({ outcome: 'already-committed' })
    expect(await reopened.service.commitWrite(session, restoredPlan)).toMatchObject({ outcome: 'already-committed' })
    expect(await reopened.db.journal_revisions.count()).toBe(1)
  })

  it('does not accept an idempotent cloud receipt if its durable operation is missing or changed', async () => {
    const f = await fixture()
    const state = await f.repository.readJournal(f.journalId)
    await f.db.device_config.update(state.device.deviceId, { cloudEnabled: true })
    const plan = await f.service.prepareCreate(f.session, content)
    await f.service.commitWrite(f.session, plan)
    const operation = (await f.db.sync_queue.toArray())[0]!
    await f.db.sync_queue.delete(operation.operationId)
    await expect(f.service.commitWrite(f.session, plan)).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' })
    await f.db.sync_queue.add({ ...operation, operationId: crypto.randomUUID() })
    await expect(f.service.inspectCommit(f.session, plan)).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' })
    expect(await f.db.journal_revisions.count()).toBe(1)
  })

  it('keeps local-only writes outside the cloud queue and preserves pending records across reopen', async () => {
    const f = await fixture()
    const local = await f.service.createEntry(f.session, content)
    expect(local.syncStatus).toBe('local-only')
    const state = await f.repository.readJournal(f.journalId)
    await f.db.device_config.update(state.device.deviceId, { cloudEnabled: true })
    const pending = await f.service.editEntry(f.session, local.entryId, local.revisionId, content)
    const queue = await f.db.sync_queue.toArray()
    expect(queue).toHaveLength(1)
    expect(queue[0]?.revisionId).toBe(pending.revisionId)
    f.repository.close(); f.session.close()
    const reopened = await connect(f.db.name)
    const session = await reopened.service.unlockJournal(f.journalId, phrase)
    await reopened.service.rebuildProjections(session)
    expect(await reopened.db.sync_queue.toArray()).toEqual(queue)
    expect(await reopened.db.journal_revisions.count()).toBe(2)
  })

  it('aborts a write if the session is revoked inside the transaction', async () => {
    const f = await fixture()
    const plan = await f.service.prepareCreate(f.session, content)
    const put = f.db.journal_entries.put.bind(f.db.journal_entries)
    vi.spyOn(f.db.journal_entries, 'put').mockImplementationOnce((...args) => put(...args).then((result) => {
      f.session.close()
      return result
    }))
    await expect(f.service.commitWrite(f.session, plan)).rejects.toMatchObject({ code: 'LOCKED' })
    expect(await f.db.journal_revisions.count()).toBe(0)
    expect(await f.db.journal_entries.count()).toBe(0)
  })

  it('fails closed on database unavailability and never falls back to another store', async () => {
    const f = await fixture()
    const plan = await f.service.prepareCreate(f.session, content)
    f.repository.close()
    await expect(f.service.commitWrite(f.session, plan)).rejects.toMatchObject({ code: 'COMMIT_UNCERTAIN' })
    const reopened = await connect(f.db.name)
    expect(await reopened.db.journal_revisions.count()).toBe(0)
    const session = await reopened.service.unlockJournal(f.journalId, phrase)
    expect(await reopened.service.inspectCommit(session, plan)).toBeNull()
    await reopened.service.commitWrite(session, plan)
    expect(await reopened.db.journal_revisions.count()).toBe(1)
  })
})
