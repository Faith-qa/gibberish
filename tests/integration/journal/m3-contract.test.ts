// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, connect, content, fixture, phrase, rawStores } from '../storage/fixture'
import { JournalError } from '../../../src/core/journal'
import { encryptRevision, generateJournalKey } from '../../../src/core/crypto'

afterEach(async () => { vi.restoreAllMocks(); await cleanup() })

describe('M3 approved domain boundaries', () => {
  it('does not replace keys if an empty recovery snapshot gains ciphertext under another key', async () => {
    const f = await fixture()
    const handle = await f.service.authenticateRecovery(f.journalId, f.recoveryKey)
    const plan = await f.service.preparePassphraseReset(handle, phrase, phrase)
    const now = '2026-01-01T00:00:00.000Z'
    const foreign = await encryptRevision(new TextEncoder().encode(JSON.stringify(content)), await generateJournalKey(), {
      journalId: f.journalId, entryId: crypto.randomUUID(), revisionId: crypto.randomUUID(), parentRevisionIds: [], schemaVersion: 1,
      status: 'active', createdAt: now, updatedAt: now, deletedAt: null,
    })
    await f.db.journal_revisions.add(foreign)
    const keys = (await f.repository.readJournal(f.journalId)).keys
    await expect(f.service.commitPassphraseReset(handle, plan)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    expect((await f.repository.readJournal(f.journalId)).keys).toEqual(keys)
    expect(await f.db.journal_revisions.toArray()).toEqual([foreign])
  })

  it('keeps a reset plan encrypted across revocation and reconciles through a new recovery capability', async () => {
    const f = await fixture()
    const handle = await f.service.authenticateRecovery(f.journalId, f.recoveryKey)
    const plan = await f.service.preparePassphraseReset(handle, phrase, phrase)
    await f.service.commitPassphraseReset(handle, plan)
    const fresh = await f.service.authenticateRecovery(f.journalId, f.recoveryKey)
    const result = await f.service.reconcileRecoveryReset(fresh, JSON.parse(JSON.stringify(plan)) as typeof plan)
    expect(result).not.toBeNull()
    expect(await f.service.listEntries(result!.session)).toEqual([])
    await expect(f.service.commitPassphraseReset(handle, plan)).rejects.toMatchObject({ code: 'LOCKED' })
  })
  it('discovers only presence and refuses partial stores without pretending they are empty', async () => {
    const f = await connect()
    expect(await f.service.discoverJournal()).toEqual({ kind: 'empty' })
    const initialized = await f.service.initializeJournal(phrase)
    expect(await f.service.discoverJournal()).toEqual({ kind: 'existing', journalId: initialized.journalId })
    await f.db.journal_config.clear() // Synthetic corruption, not a product API.
    await expect(f.service.discoverJournal()).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' })
    expect(await f.db.journal_keys.count()).toBe(1)
  })

  it('writes nothing before complete recovery confirmation and acknowledgment', async () => {
    const f = await connect()
    const setup = await f.service.prepareJournal(phrase, phrase)
    const recovery = f.service.getRecoveryKey(setup)
    expect(recovery).toMatch(/^gbr1\.[A-Za-z0-9_-]{43}$/)
    for (const table of f.db.tables) expect(await table.count()).toBe(0)
    await expect(f.service.confirmJournal(setup, 'Wrong synthetic key', true)).rejects.toMatchObject({ code: 'INVALID_CONFIRMATION' })
    await expect(f.service.confirmJournal(setup, recovery, false)).rejects.toMatchObject({ code: 'INVALID_CONFIRMATION' })
    for (const table of f.db.tables) expect(await table.count()).toBe(0)
    const journal = await f.service.confirmJournal(setup, recovery, true)
    expect(await f.service.listEntries(journal.session)).toEqual([])
    expect(await f.db.journal_keys.count()).toBe(1)
    expect(() => f.service.getRecoveryKey(setup)).toThrow()
    const serialized = JSON.stringify(await rawStores(f.db))
    expect(serialized).not.toContain(recovery)
    expect(serialized).not.toContain(phrase)
  })

  it('revokes setup without persisting and rejects an aborted preparation', async () => {
    const f = await connect()
    const setup = await f.service.prepareJournal(phrase, phrase)
    const recovery = f.service.getRecoveryKey(setup)
    setup.close()
    await expect(f.service.confirmJournal(setup, recovery, true)).rejects.toMatchObject({ code: 'LOCKED' })
    const abort = new AbortController(); abort.abort()
    await expect(f.service.prepareJournal(phrase, phrase, abort.signal)).rejects.toThrow()
    expect(await f.service.discoverJournal()).toEqual({ kind: 'empty' })
  })

  it.each(['', 'short', ' '.repeat(15), '\ud800'.repeat(15), 'a'.repeat(1025)])('rejects new passphrase policy violation without writes', async (value) => {
    const f = await connect()
    await expect(f.service.prepareJournal(value, value)).rejects.toMatchObject({ code: 'PASSPHRASE_POLICY' })
    expect(await f.service.discoverJournal()).toEqual({ kind: 'empty' })
  })

  it('counts Unicode code points, preserves exact bytes, and still unlocks shorter legacy phrases', async () => {
    const f = await connect()
    await expect(f.service.prepareJournal('🌱'.repeat(14), '🌱'.repeat(14))).rejects.toMatchObject({ code: 'PASSPHRASE_POLICY' })
    const value = ' 🌱'.repeat(15)
    const setup = await f.service.prepareJournal(value, value)
    const journal = await f.service.confirmJournal(setup, f.service.getRecoveryKey(setup), true)
    journal.session.close()
    await expect(f.service.unlockJournal(journal.journalId, value.trim())).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    const session = await f.service.unlockJournal(journal.journalId, value)
    expect(await f.service.listEntries(session)).toEqual([])
    const legacy = await connect()
    const old = await legacy.service.initializeJournal('short')
    expect(await legacy.service.listEntries(await legacy.service.unlockJournal(old.journalId, 'short'))).toEqual([])
  })

  it('returns authenticated encrypted views and never returns a plaintext payload by default', async () => {
    const f = await fixture()
    const saved = await f.service.createEntry(f.session, content)
    const views = await f.service.listEntryViews(f.session)
    expect(views).toHaveLength(1)
    expect(views[0]?.heads[0]).toEqual(await f.db.journal_revisions.get(saved.revisionId))
    expect(JSON.stringify(views)).not.toContain(content.body)
    const detail = await f.service.readEncryptedEntry(f.session, saved.entryId)
    expect(detail.revision.revisionId).toBe(saved.revisionId)
    expect(detail).not.toHaveProperty('payload')
    f.session.close()
    await expect(f.service.listEntryViews(f.session)).rejects.toMatchObject({ code: 'LOCKED' })
  })

  it('authenticates recovery independently and resets only the passphrase wrapper', async () => {
    const f = await fixture()
    const entry = await f.service.createEntry(f.session, content)
    const before = await rawStores(f.db)
    await expect(f.service.authenticateRecovery(f.journalId, 'bad')).rejects.toThrow()
    const handle = await f.service.authenticateRecovery(f.journalId, f.recoveryKey)
    const plan = await f.service.preparePassphraseReset(handle, 'New synthetic recovery phrase', 'New synthetic recovery phrase')
    expect(JSON.stringify(plan)).not.toContain(f.recoveryKey)
    const recovered = await f.service.commitPassphraseReset(handle, plan)
    expect((await f.service.readEntry(recovered.session, entry.entryId)).payload).toEqual(content)
    const after = await rawStores(f.db)
    expect(after.journal_revisions).toEqual(before.journal_revisions)
    expect(after.journal_config).toEqual(before.journal_config)
    expect(after.sync_queue).toEqual(before.sync_queue)
    const oldKeys = (before.journal_keys as { recoveryWrappedKey: unknown }[])[0]!
    expect((await f.repository.readJournal(f.journalId)).keys.recoveryWrappedKey).toEqual(oldKeys.recoveryWrappedKey)
    await expect(f.service.unlockJournal(f.journalId, phrase)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    expect(await f.service.listEntries(await f.service.unlockJournal(f.journalId, 'New synthetic recovery phrase'))).toHaveLength(1)
    expect(await f.service.inspectPassphraseReset(recovered.session, plan)).toBe('committed')
    await expect(f.service.listEntries(f.session)).rejects.toMatchObject({ code: 'AUTHORIZATION_CHANGED' })
  })

  it('rechecks concurrently added history before CAS and preserves every revision', async () => {
    const f = await fixture()
    const handle = await f.service.authenticateRecovery(f.journalId, f.recoveryKey)
    const plan = await f.service.preparePassphraseReset(handle, phrase, phrase)
    await f.service.createEntry(f.session, content)
    await expect(f.repository.replaceJournalKeys(plan.expected, plan.nextKeys, () => {})).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' })
    const result = await f.service.commitPassphraseReset(handle, plan)
    expect(await f.service.listEntries(result.session)).toHaveLength(1)
  })

  it('rolls back failed reset persistence and reconciles a lost committed receipt', async () => {
    const f = await fixture()
    const handle = await f.service.authenticateRecovery(f.journalId, f.recoveryKey)
    const plan = await f.service.preparePassphraseReset(handle, phrase, phrase)
    const before = await rawStores(f.db)
    vi.spyOn(f.db.journal_keys, 'put').mockRejectedValueOnce(new DOMException('Synthetic quota', 'QuotaExceededError'))
    await expect(f.service.commitPassphraseReset(handle, plan)).rejects.toMatchObject({ code: 'STORAGE_FAILURE' })
    expect(await rawStores(f.db)).toEqual(before)
    expect(await f.service.inspectPassphraseReset(f.session, plan)).toBe('not-committed')
    const replace = f.repository.replaceJournalKeys.bind(f.repository)
    vi.spyOn(f.repository, 'replaceJournalKeys').mockImplementationOnce(async (...args) => {
      await replace(...args)
      throw new JournalError('COMMIT_UNCERTAIN')
    })
    const result = await f.service.commitPassphraseReset(handle, plan)
    expect(await f.service.inspectPassphraseReset(result.session, plan)).toBe('committed')
  })

  it('rejects forged plans, corrupt history and revoked recovery handles without rewriting keys', async () => {
    const f = await fixture()
    const entry = await f.service.createEntry(f.session, content)
    const handle = await f.service.authenticateRecovery(f.journalId, f.recoveryKey)
    const plan = await f.service.preparePassphraseReset(handle, phrase, phrase)
    const keys = (await f.repository.readJournal(f.journalId)).keys
    await expect(f.service.commitPassphraseReset(handle, { ...plan, nextKeys: keys })).rejects.toMatchObject({ code: 'INVALID_DATA' })
    const row = (await f.db.journal_revisions.get(entry.revisionId))!
    const bytes = Buffer.from(row.encryptedPayload.ciphertext, 'base64url'); bytes[0] = (bytes[0] ?? 0) ^ 1
    await f.db.journal_revisions.put({ ...row, encryptedPayload: { ...row.encryptedPayload, ciphertext: bytes.toString('base64url') } })
    await expect(f.service.commitPassphraseReset(handle, plan)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    expect((await f.repository.readJournal(f.journalId)).keys).toEqual(keys)
    handle.close()
    await expect(f.service.commitPassphraseReset(handle, plan)).rejects.toMatchObject({ code: 'LOCKED' })
  })
})
