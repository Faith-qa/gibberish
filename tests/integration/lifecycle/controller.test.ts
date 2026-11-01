// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { AppController } from '../../../src/app/controller'
import type { handoffDownload } from '../../../src/app/download'
import { JournalError } from '../../../src/core/journal'
import { TRASH_RETENTION_MS } from '../../../src/core/journal/lifecycle'
import { MAX_BACKUP_BYTES } from '../../../src/core/export/backup'
import { cleanup, connect, content, fixture, phrase } from '../storage/fixture'

afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await cleanup() })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }
function file(bytes: Uint8Array): File { return { size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer } as File }
async function opened(options: ConstructorParameters<typeof AppController>[1] = {}) {
  const f = await fixture(); const saved = await f.service.createEntry(f.session, content)
  const app = new AppController(f.service, { warm: async () => {}, ...options })
  await app.boot(); await app.unlock(phrase)
  return { ...f, saved, app }
}

it('requires acknowledgment, keeps artifacts out of UI state, and downloads only through the explicit action', async () => {
  const dispose = vi.fn(); const download = vi.fn<typeof handoffDownload>(() => dispose)
  const f = await opened({ download }); f.app.exportScreen()
  await f.app.generateExport('readable', false)
  expect(f.app.snapshot().screen).toBe('export'); expect(download).not.toHaveBeenCalled()
  await f.app.generateExport('readable', true)
  expect(f.app.snapshot()).toMatchObject({ screen: 'export-ready', kind: 'readable' })
  expect(JSON.stringify(f.app.snapshot())).not.toContain(content.body)
  f.app.downloadExport(); expect(download).toHaveBeenCalledTimes(1)
  expect(download.mock.calls[0]![0].every((byte: number) => byte === 0)).toBe(true)
  f.app.lock(); expect(dispose).toHaveBeenCalledTimes(1)
})

it.each(['conceal', 'lock', 'pagehide', 'tools'] as const)('discards prepared readable artifacts on %s', async (action) => {
  const download = vi.fn(() => vi.fn()); const f = await opened({ download })
  const bytes = new Uint8Array([1, 2, 3]); vi.spyOn(f.service, 'prepareReadableExport').mockResolvedValueOnce(bytes)
  await f.app.generateExport('readable', true); f.app[action](); f.app.downloadExport()
  expect(bytes).toEqual(new Uint8Array(3)); expect(download).not.toHaveBeenCalled()
})

it('discards a late export result after concealment and does not revive the ready screen', async () => {
  const f = await opened(); const pending = deferred<Uint8Array<ArrayBuffer>>()
  vi.spyOn(f.service, 'prepareEncryptedBackup').mockReturnValueOnce(pending.promise)
  const preparing = f.app.generateExport('backup'); f.app.conceal()
  const bytes = new Uint8Array([1, 2]); pending.resolve(bytes); await preparing
  expect(bytes).toEqual(new Uint8Array(2)); expect(f.app.snapshot().screen).toBe('concealed')
  await f.app.resume(); expect(f.app.snapshot().screen).toBe('timeline')
})

it('checks the original inactivity deadline before a prepared file can be handed off', async () => {
  let time = 0; const download = vi.fn(() => vi.fn())
  const f = await opened({ download, clock: { wall: () => time, monotonic: () => time } })
  await f.app.generateExport('backup'); time = 300_000; f.app.downloadExport()
  expect(f.app.snapshot().screen).toBe('locked'); expect(download).not.toHaveBeenCalled()
})

it('keeps selection intents private across hiding and revokes late file selections on full lock', async () => {
  const target = await connect(); const app = new AppController(target.service, { warm: async () => {} })
  await app.boot(); app.beginRestore()
  const pending = deferred<ArrayBuffer>(); const picking = app.selectBackup({ size: 10, arrayBuffer: () => pending.promise } as File)
  app.conceal(); pending.resolve(new Uint8Array([1, 2]).buffer); await picking
  expect(app.snapshot().screen).toBe('concealed'); await app.resume()
  expect(app.snapshot()).toMatchObject({ screen: 'restore-file', selected: true })
  app.lock(); await app.resume(); expect(app.snapshot().screen).toBe('welcome')
  const second = deferred<ArrayBuffer>(); app.beginRestore()
  const selecting = app.selectBackup({ size: 10, arrayBuffer: () => second.promise } as File)
  app.pagehide(); second.resolve(new Uint8Array([1, 2]).buffer); await selecting
  await app.resume(); expect(app.snapshot().screen).toBe('welcome')
})

it('reconciles a restore committed just before revocation only after a fresh unlock', async () => {
  const source = await fixture(); await source.service.createEntry(source.session, content)
  const bytes = await source.service.prepareEncryptedBackup(source.session)
  const target = await connect(); const app = new AppController(target.service, { warm: async () => {} })
  await app.boot(); app.beginRestore(); await app.selectBackup(file(bytes)); app.continueRestore(); await app.authenticateBackup(phrase, 'passphrase')
  expect(app.snapshot().screen).toBe('restore-summary')
  const commit = target.service.commitBackupRestore.bind(target.service)
  vi.spyOn(target.service, 'commitBackupRestore').mockImplementationOnce(async (...args) => { const result = await commit(...args); app.lock(); return result })
  await app.confirmRestore(true)
  expect(app.snapshot().notice).not.toContain('verified locally')
  await app.boot(); expect(app.snapshot().screen).toBe('locked')
  await app.unlock(phrase); expect(app.snapshot().notice).toContain('restoration was verified locally')
  expect(await target.db.journal_revisions.count()).toBe(1)
})

it('does not adopt a late authenticated restore capability after locking', async () => {
  const source = await fixture(); const bytes = await source.service.prepareEncryptedBackup(source.session)
  const target = await connect(); const app = new AppController(target.service, { warm: async () => {} })
  await app.boot(); app.beginRestore(); await app.selectBackup(file(bytes)); app.continueRestore()
  const handle = { close: vi.fn() }; const pending = deferred<typeof handle>()
  vi.spyOn(target.service, 'prepareBackupRestore').mockReturnValueOnce(pending.promise)
  const authenticating = app.authenticateBackup(phrase, 'passphrase'); app.lock(); pending.resolve(handle); await authenticating
  expect(handle.close).toHaveBeenCalledTimes(1); expect(app.snapshot().screen).toBe('welcome')
  expect(await target.db.journal_config.count()).toBe(0)
})

it('discards an earlier selected backup when a replacement is invalid rather than continuing the old file', async () => {
  const target = await connect(); const app = new AppController(target.service, { warm: async () => {} })
  await app.boot(); app.beginRestore(); await app.selectBackup(file(new Uint8Array([1, 2])))
  expect(app.snapshot()).toMatchObject({ screen: 'restore-file', selected: true })
  await app.selectBackup({ size: MAX_BACKUP_BYTES + 1 } as File); app.continueRestore()
  expect(app.snapshot()).toMatchObject({ screen: 'restore-file', selected: false })
  expect(app.snapshot().message).toContain('supported size')
})

it('reconciles a general passphrase change without adopting its late session', async () => {
  const f = await opened(); const commit = f.service.commitPassphraseReset.bind(f.service)
  vi.spyOn(f.service, 'commitPassphraseReset').mockImplementationOnce(async (...args) => { const result = await commit(...args); f.app.lock(); return result })
  await f.app.changePassphrase(phrase, 'Another synthetic change phrase', 'Another synthetic change phrase')
  expect(f.app.snapshot().screen).toBe('locked'); expect(f.app.snapshot().notice).not.toContain('verified')
  await f.app.unlock('Another synthetic change phrase'); expect(f.app.snapshot().notice).toContain('verified locally')
})

it('never reports a blocked stale save as saved after another tab permanently deletes its entry', async () => {
  const f = await opened(); await f.app.openEntry(f.saved.entryId); await f.app.reveal(); f.app.edit(); f.app.updateDraft(content)
  vi.spyOn(f.repository, 'commitPreparedRevision').mockRejectedValueOnce(new JournalError('STORAGE_FAILURE')); await f.app.save()
  const trash = await f.service.prepareTrash(f.session, f.saved.entryId, f.saved.revisionId); await f.service.commitWrite(f.session, trash)
  await f.service.commitPermanentDelete(f.session, await f.service.preparePermanentDelete(f.session, f.saved.entryId, trash.revision.revisionId, 'manual', true))
  await f.app.checkSave(true)
  expect(f.app.snapshot()).toMatchObject({ screen: 'timeline', pendingSave: false })
  expect(f.app.snapshot().notice).toContain('permanently deleted'); expect(f.app.snapshot().notice).not.toContain('Saved locally')
  expect(await f.db.journal_revisions.count()).toBe(0)
})

it('runs small expiry batches only while authorized, visible and free of drafts without extending inactivity', async () => {
  const f = await fixture(); const start = Date.now() - TRASH_RETENTION_MS
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(start)
  for (let n = 0; n < 4; n++) { const e = await f.service.createEntry(f.session, content); await f.service.commitWrite(f.session, await f.service.prepareTrash(f.session, e.entryId, e.revisionId)) }
  vi.setSystemTime(start + TRASH_RETENTION_MS); let elapsed = 0
  const app = new AppController(f.service, { warm: async () => {}, clock: { wall: () => start + TRASH_RETENTION_MS + elapsed, monotonic: () => elapsed } })
  await app.boot(); await app.unlock(phrase); app.newEntry(); app.updateDraft(content); await app.maintenance()
  expect(await f.db.journal_tombstones.count()).toBe(0)
  await app.timeline(); app.conceal(); await app.maintenance(); expect(await f.db.journal_tombstones.count()).toBe(0)
  await app.resume(); await app.maintenance(); expect(await f.db.journal_tombstones.count()).toBe(3)
  elapsed = 5_000; vi.setSystemTime(start + TRASH_RETENTION_MS + elapsed); await app.maintenance(); expect(await f.db.journal_tombstones.count()).toBe(4)
  elapsed = 300_000; await app.maintenance(); expect(app.snapshot().screen).toBe('locked')
})

it('pauses automatic destruction on a clock anomaly until explicit date review', async () => {
  let wall = 0, mono = 0
  const f = await opened({ clock: { wall: () => wall, monotonic: () => mono } })
  const purge = vi.spyOn(f.service, 'preparePermanentDelete')
  wall = 90_000; mono = 1_000; f.app.checkDeadline(); await f.app.maintenance()
  expect(f.app.snapshot().clockReview).toBe(true); expect(purge).not.toHaveBeenCalled()
  f.app.reviewClock(true); expect(f.app.snapshot().clockReview).toBe(false)
})

it('defers automatic cleanup when an authenticated Trash date lies in the device clock’s future', async () => {
  const f = await fixture(); const wall = Date.now()
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(wall + 86_400_000)
  const root = await f.service.createEntry(f.session, content)
  await f.service.commitWrite(f.session, await f.service.prepareTrash(f.session, root.entryId, root.revisionId))
  vi.setSystemTime(wall)
  const app = new AppController(f.service, { warm: async () => {}, clock: { wall: () => wall, monotonic: () => 0 } })
  await app.boot(); await app.unlock(phrase); await app.maintenance()
  expect(app.snapshot().clockReview).toBe(true)
  expect(await f.db.journal_revisions.count()).toBe(2); expect(await f.db.journal_tombstones.count()).toBe(0)
})
