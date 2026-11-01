// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { backupManifest, makeBackup, parseBackup, serializeBackup } from '../../../src/core/export/backup'
import { sealBackupManifest, unwrapWithPassphrase } from '../../../src/core/crypto'
import { cleanup, connect, content, fixture, phrase, rawStores } from '../storage/fixture'

afterEach(async () => { vi.restoreAllMocks(); await cleanup() })
async function source() { const f = await fixture(); const entry = await f.service.createEntry(f.session, content); return { ...f, entry } }
it.each(['empty', 'markers only'] as const)('restores a valid %s journal without fabricating entry history', async (kind) => {
  const f = await fixture()
  if (kind === 'markers only') {
    const root = await f.service.createEntry(f.session, content)
    const trash = await f.service.prepareTrash(f.session, root.entryId, root.revisionId); await f.service.commitWrite(f.session, trash)
    await f.service.commitPermanentDelete(f.session, await f.service.preparePermanentDelete(f.session, root.entryId, trash.revision.revisionId, 'manual', true))
  }
  const target = await connect(); const handle = await target.service.prepareBackupRestore(await f.service.prepareEncryptedBackup(f.session), phrase, 'passphrase')
  const restored = await target.service.commitBackupRestore(handle)
  expect(await target.service.listEntryViews(restored.session)).toEqual([])
  expect(await target.db.journal_tombstones.count()).toBe(kind === 'empty' ? 0 : 1)
  expect(await target.db.journal_revisions.count()).toBe(0)
})
it('rejects a valid manifest with missing ancestry before any target write', async () => {
  const f = await source(); await f.service.editEntry(f.session, f.entry.entryId, f.entry.revisionId, content)
  const original = parseBackup(await f.service.prepareEncryptedBackup(f.session))
  const portable = { journalConfig: original.journalConfig, journalKeys: original.journalKeys,
    revisions: original.revisions.filter((r) => r.revisionId !== f.entry.revisionId), tombstones: original.tombstones }
  const key = await unwrapWithPassphrase(original.journalKeys.passphraseWrappedKey, phrase, f.journalId)
  const proof = await sealBackupManifest(backupManifest(portable, original.exportId, original.exportedAt), key)
  const bytes = serializeBackup(makeBackup(portable, original.exportId, original.exportedAt, proof))
  const target = await connect()
  await expect(target.service.prepareBackupRestore(bytes, phrase, 'passphrase')).rejects.toMatchObject({ code: 'INCOMPLETE_HISTORY' })
  for (const table of target.db.tables) expect(await table.count()).toBe(0)
})
it('authenticates the marker inventory so omission of a whole deletion marker is detected', async () => {
  const f = await source(); const trash = await f.service.prepareTrash(f.session, f.entry.entryId, f.entry.revisionId); await f.service.commitWrite(f.session, trash)
  await f.service.commitPermanentDelete(f.session, await f.service.preparePermanentDelete(f.session, f.entry.entryId, trash.revision.revisionId, 'manual', true))
  const backup = parseBackup(await f.service.prepareEncryptedBackup(f.session))
  const bytes = serializeBackup({ ...backup, tombstones: [] })
  const target = await connect()
  await expect(target.service.prepareBackupRestore(bytes, phrase, 'passphrase')).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
  for (const table of target.db.tables) expect(await table.count()).toBe(0)
})
it('preserves a racing initialized journal instead of replacing it with an authenticated import', async () => {
  const f = await source(); const target = await connect()
  const handle = await target.service.prepareBackupRestore(await f.service.prepareEncryptedBackup(f.session), phrase, 'passphrase')
  const winner = await target.service.initializeJournal('Synthetic racing initialization phrase')
  const before = await rawStores(target.db)
  await expect(target.service.commitBackupRestore(handle)).rejects.toMatchObject({ code: 'JOURNAL_EXISTS' })
  expect(await rawStores(target.db)).toEqual(before)
  expect((await target.service.discoverJournal())).toEqual({ kind: 'existing', journalId: winner.journalId })
})
it('aborts atomic import if its private setup intent is revoked during a write', async () => {
  const f = await source(); const target = await connect(); const abort = new AbortController()
  const handle = await target.service.prepareBackupRestore(await f.service.prepareEncryptedBackup(f.session), phrase, 'passphrase', abort.signal)
  target.db.journal_keys.hook('creating', () => { abort.abort() })
  await expect(target.service.commitBackupRestore(handle, abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
  for (const table of target.db.tables) expect(await table.count()).toBe(0)
})
it.each(['journal_tombstones', 'sync_conflicts'] as const)('rolls back the entire restored inventory if %s cannot be created', async (store) => {
  const f = await source()
  if (store === 'journal_tombstones') {
    const trash = await f.service.prepareTrash(f.session, f.entry.entryId, f.entry.revisionId); await f.service.commitWrite(f.session, trash)
    await f.service.commitPermanentDelete(f.session, await f.service.preparePermanentDelete(f.session, f.entry.entryId, trash.revision.revisionId, 'manual', true))
  } else {
    const a = await f.service.prepareEdit(f.session, f.entry.entryId, f.entry.revisionId, content)
    const b = await f.service.prepareEdit(f.session, f.entry.entryId, f.entry.revisionId, content)
    await f.service.commitWrite(f.session, a); await f.service.commitWrite(f.session, b)
  }
  const target = await connect(); const handle = await target.service.prepareBackupRestore(await f.service.prepareEncryptedBackup(f.session), phrase, 'passphrase')
  target.db.table(store).hook('creating', () => { throw new DOMException('Synthetic import failure', 'QuotaExceededError') })
  await expect(target.service.commitBackupRestore(handle)).rejects.toThrow()
  for (const table of target.db.tables) expect(await table.count()).toBe(0)
})
it.each(['passphrase', 'recovery'] as const)('rejects a wrong backup %s without any target writes', async (mode) => {
  const f = await source(); const target = await connect()
  await expect(target.service.prepareBackupRestore(await f.service.prepareEncryptedBackup(f.session), mode === 'passphrase' ? 'Wrong synthetic phrase' : f.recoveryKey.replace(/^gbr1\./, 'gbr1.A'), mode)).rejects.toThrow()
  for (const table of target.db.tables) expect(await table.count()).toBe(0)
})
