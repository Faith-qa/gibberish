// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { decryptRevision, encryptRevision, revisionMetadata, unwrapWithPassphrase, unwrapWithRecoveryKey } from '../../../src/core/crypto'
import { JournalError } from '../../../src/core/journal'
import { cleanup, connect, content, fixture, phrase, rawStores } from './fixture'

afterEach(async () => { vi.restoreAllMocks(); await cleanup() })

describe('M2 encrypted journal domain', () => {
  it('initializes nine stores, validates wrapped keys, and independently recovers the same JEK', async () => {
    const f = await fixture()
    expect(f.db.tables).toHaveLength(9)
    expect(f.db.sync_conflicts.schema.indexes.some((index) => index.name === 'resolved')).toBe(false)
    const state = await f.repository.readJournal(f.journalId)
    expect(state.config).toMatchObject({ encryptionVersion: 2, autoLockMinutes: 5 })
    expect(state.device).toMatchObject({ cloudEnabled: false, lastSuccessfulSyncAt: null })
    await f.repository.initializeJournal(state) // Exact initialization replay is harmless.
    const plan = await f.service.prepareCreate(f.session, content)
    const recovered = await unwrapWithRecoveryKey(state.keys.recoveryWrappedKey, f.recoveryKey, f.journalId)
    const bytes = await decryptRevision(plan.revision, recovered, { journalId: f.journalId, entryId: plan.revision.entryId })
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(content)
    bytes.fill(0)
    await expect(f.service.initializeJournal(phrase)).rejects.toMatchObject({ code: 'JOURNAL_EXISTS' })
    expect(await f.repository.readJournal(f.journalId)).toEqual(state)
  })

  it('creates and edits immutable revisions and persists ciphertext only in every store', async () => {
    const f = await fixture()
    const first = await f.service.createEntry(f.session, content)
    expect(first).toMatchObject({ outcome: 'committed', syncStatus: 'local-only' })
    const original = await f.db.journal_revisions.get(first.revisionId)
    const secondContent = { ...content, body: 'Synthetic edited body' }
    const second = await f.service.editEntry(f.session, first.entryId, first.revisionId, secondContent)
    expect(await f.db.journal_revisions.get(first.revisionId)).toEqual(original)
    const changed = await f.db.journal_revisions.get(second.revisionId)
    expect(changed?.parentRevisionIds).toEqual([first.revisionId])
    expect(changed?.encryptedPayload.nonce).not.toEqual(original?.encryptedPayload.nonce)
    expect((await f.service.readEntry(f.session, first.entryId)).payload).toEqual(secondContent)
    expect((await f.service.readEntry(f.session, first.entryId, first.revisionId)).payload).toEqual(content)
    expect(await f.service.listEntries(f.session)).toEqual([await f.db.journal_entries.get(first.entryId)])
    const stored = await rawStores(f.db)
    const serialized = JSON.stringify(stored)
    for (const secret of [phrase, f.recoveryKey, content.title, content.body, secondContent.body]) expect(serialized).not.toContain(secret)
    const inspect = (value: unknown): void => {
      expect(value instanceof CryptoKey).toBe(false)
      if (value && typeof value === 'object') for (const child of Object.values(value)) inspect(child)
    }
    inspect(stored)
    expect(await f.db.sync_queue.count()).toBe(0)
    expect(await f.db.sync_metadata.count()).toBe(0)
    expect(await f.db.journal_tombstones.count()).toBe(0)
  })

  it('gates authoritative reads and writes on a revocable session and the correct journal', async () => {
    const f = await fixture()
    const entry = await f.service.createEntry(f.session, content)
    await expect(f.service.unlockJournal(f.journalId, 'Wrong synthetic passphrase')).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    await expect(f.service.listEntries({ close() {} })).rejects.toMatchObject({ code: 'LOCKED' })
    await expect(f.repository.readJournal(crypto.randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(f.service.readEntry(f.session, crypto.randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const foreign = await fixture()
    await expect(foreign.service.listEntries(f.session)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const plan = await f.service.prepareEdit(f.session, entry.entryId, entry.revisionId, content)
    f.session.close()
    const readSpy = vi.spyOn(f.repository, 'readJournalSnapshot')
    await expect(f.service.listEntries(f.session)).rejects.toMatchObject({ code: 'LOCKED' })
    expect(readSpy).not.toHaveBeenCalled()
    await expect(f.service.commitWrite(f.session, plan)).rejects.toMatchObject({ code: 'LOCKED' })
    expect(await f.db.journal_revisions.count()).toBe(1)
  })

  it('rejects a key-bundle change and a session closed during asynchronous authentication', async () => {
    const f = await fixture()
    await f.service.createEntry(f.session, content)
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle)
    vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(async (...args) => {
      const bytes = await decrypt(...args)
      f.session.close()
      return bytes
    })
    await expect(f.service.listEntries(f.session)).rejects.toMatchObject({ code: 'LOCKED' })
    vi.restoreAllMocks()
    const session = await f.service.unlockJournal(f.journalId, phrase)
    const other = await fixture()
    const bundle = (await other.repository.readJournal(other.journalId)).keys
    await f.db.journal_keys.put({ ...bundle, journalId: f.journalId })
    await expect(f.service.listEntries(session)).rejects.toMatchObject({ code: 'AUTHORIZATION_CHANGED' })
    await expect(f.service.listEntries(session)).rejects.toMatchObject({ code: 'LOCKED' })
  })

  it('preserves concurrent branches across separate connections without a timestamp winner', async () => {
    const f = await fixture()
    const second = await connect(f.db.name)
    const session = await second.service.unlockJournal(f.journalId, phrase)
    const root = await f.service.createEntry(f.session, content)
    const [left, right] = await Promise.all([
      f.service.prepareEdit(f.session, root.entryId, root.revisionId, { ...content, body: 'Synthetic left branch' }),
      second.service.prepareEdit(session, root.entryId, root.revisionId, { ...content, body: 'Synthetic right branch' }),
    ])
    await Promise.all([f.service.commitWrite(f.session, left), second.service.commitWrite(session, right)])
    expect(await f.db.journal_revisions.count()).toBe(3)
    expect((await f.service.listEntries(f.session))[0]).toMatchObject({ status: 'conflicted',
      headRevisionIds: [left.revision.revisionId, right.revision.revisionId].sort() })
    const conflicts = await f.db.sync_conflicts.toArray()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.conflictingRevisionIds).toEqual([left.revision.revisionId, right.revision.revisionId].sort())
    await expect(f.service.readEntry(f.session, root.entryId)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect((await f.service.readEntry(f.session, root.entryId, left.revision.revisionId)).payload.body).toBe('Synthetic left branch')
    const cachedId = conflicts[0]?.conflictId
    await f.service.rebuildProjections(f.session)
    expect((await f.db.sync_conflicts.toArray())[0]?.conflictId).toBe(cachedId)
    expect(await f.db.journal_revisions.get(root.revisionId)).toMatchObject({ parentRevisionIds: [] })
  })

  it('rebuilds tampered and orphaned caches from authenticated history without changing sources or outbox', async () => {
    const f = await fixture()
    const root = await f.service.createEntry(f.session, content)
    const before = await rawStores(f.db)
    await f.db.journal_entries.update(root.entryId, { status: 'trashed', headRevisionIds: [crypto.randomUUID()] })
    const orphanId = crypto.randomUUID()
    await f.db.journal_entries.add({ journalId: f.journalId, entryId: orphanId, status: 'active', headRevisionIds: [],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null })
    expect(await f.service.listEntries(f.session)).toHaveLength(1)
    expect((await f.service.listEntries(f.session))[0]?.status).toBe('active')
    await f.service.rebuildProjections(f.session)
    expect(await f.db.journal_entries.toArray()).toEqual(before.journal_entries)
    expect(await f.db.journal_revisions.toArray()).toEqual(before.journal_revisions)
    expect(await f.db.sync_queue.toArray()).toEqual(before.sync_queue)
  })

  it.each(['metadata', 'ciphertext', 'legacy'] as const)('preserves but refuses %s corruption, including during rebuild', async (kind) => {
    const f = await fixture()
    const root = await f.service.createEntry(f.session, content)
    const revision = (await f.db.journal_revisions.get(root.revisionId))!
    if (kind === 'metadata') await f.db.journal_revisions.put({ ...revision,
      createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' })
    if (kind === 'ciphertext') {
      const cipher = Buffer.from(revision.encryptedPayload.ciphertext, 'base64url'); cipher[0] = (cipher[0] ?? 0) ^ 1
      await f.db.journal_revisions.put({ ...revision, encryptedPayload: { ...revision.encryptedPayload, ciphertext: cipher.toString('base64url') } })
    }
    if (kind === 'legacy') await f.db.table('journal_revisions').put({ ...revision, encryptedPayload: { ...revision.encryptedPayload, version: 1 } })
    const corrupt = await f.db.journal_revisions.toArray()
    const cache = await f.db.journal_entries.toArray()
    await expect(f.service.listEntries(f.session)).rejects.toThrow()
    await expect(f.service.rebuildProjections(f.session)).rejects.toThrow()
    expect(await f.db.journal_revisions.toArray()).toEqual(corrupt)
    expect(await f.db.journal_entries.toArray()).toEqual(cache)
  })

  it('reports missing ancestry without deleting ciphertext or rebuilding a partial timeline', async () => {
    const f = await fixture()
    const root = await f.service.createEntry(f.session, content)
    await f.service.editEntry(f.session, root.entryId, root.revisionId, { ...content, body: 'Synthetic descendant' })
    await f.db.journal_revisions.delete(root.revisionId) // Simulated corruption, never a repository API.
    const before = await rawStores(f.db)
    await expect(f.service.listEntries(f.session)).rejects.toMatchObject({ code: 'INCOMPLETE_HISTORY' })
    await expect(f.service.rebuildProjections(f.session)).rejects.toMatchObject({ code: 'INCOMPLETE_HISTORY' })
    expect(await rawStores(f.db)).toEqual(before)
  })

  it.each(['cycle', 'multiple roots', 'creation time'] as const)('rejects authenticated invalid history: %s', async (kind) => {
    const f = await fixture()
    const plan = await f.service.prepareCreate(f.session, content)
    const state = await f.repository.readJournal(f.journalId)
    const key = await unwrapWithPassphrase(state.keys.passphraseWrappedKey, phrase, f.journalId)
    const bytes = new TextEncoder().encode(JSON.stringify(content))
    const nextId = crypto.randomUUID()
    const first = await encryptRevision(bytes, key, { ...revisionMetadata(plan.revision),
      parentRevisionIds: kind === 'cycle' ? [nextId] : [] })
    const second = await encryptRevision(bytes, key, { ...revisionMetadata(plan.revision), revisionId: nextId,
      parentRevisionIds: kind === 'multiple roots' ? [] : [first.revisionId],
      ...(kind === 'creation time' ? { createdAt: '2025-01-01T00:00:00.000Z' } : {}) })
    await f.db.journal_revisions.bulkAdd([first, second])
    await expect(f.service.listEntries(f.session)).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' })
    expect(await f.db.journal_revisions.count()).toBe(2)
  })

  it('never uses an untrusted tombstone to erase a revision', async () => {
    const f = await fixture()
    const root = await f.service.createEntry(f.session, content)
    await f.db.table<unknown>('journal_tombstones').add({ journalId: f.journalId, entryId: root.entryId, deletionRevisionId: crypto.randomUUID(),
      deletedAt: '2026-01-01T00:00:00.000Z', permanentlyDeletedAt: '2026-01-01T00:00:00.000Z' })
    await expect(f.service.listEntries(f.session)).rejects.toMatchObject({ code: 'DELETION_REVIEW_REQUIRED' })
    expect(await f.db.journal_revisions.count()).toBe(1)
  })

  it('does crypto outside transactions and never logs synthetic content or credentials', async () => {
    const f = await fixture()
    const logs = ['log', 'info', 'warn', 'error', 'debug'].map((name) => vi.spyOn(console, name as 'log').mockImplementation(() => {}))
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle)
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle)
    vi.spyOn(crypto.subtle, 'decrypt').mockImplementation((...args) => { expect(Dexie.currentTransaction).toBeFalsy(); return decrypt(...args) })
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementation((...args) => { expect(Dexie.currentTransaction).toBeFalsy(); return encrypt(...args) })
    const root = await f.service.createEntry(f.session, content)
    await f.service.editEntry(f.session, root.entryId, root.revisionId, content)
    await f.service.listEntries(f.session)
    await f.service.rebuildProjections(f.session)
    for (const log of logs) expect(log).not.toHaveBeenCalled()
  })

  it('rejects malformed payloads, extra fields and unpersistable objects before writing', async () => {
    const f = await fixture()
    for (const value of [{ title: '', body: 'Synthetic' }, { title: 'Synthetic', body: ' ' }, { ...content, passphrase: phrase }]) {
      await expect(f.service.prepareCreate(f.session, value)).rejects.toThrow()
    }
    const plan = await f.service.prepareCreate(f.session, content)
    await expect(f.repository.commitPreparedRevision({ ...plan, secret: phrase } as typeof plan, () => {})).rejects.toThrow()
    const state = await f.repository.readJournal(f.journalId)
    await expect(f.repository.initializeJournal({ ...state, rawKey: await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']) } as typeof state)).rejects.toThrow()
    expect(await f.db.journal_revisions.count()).toBe(0)
    expect(new JournalError('STORAGE_FAILURE').message).not.toContain(content.title)
  })
})
