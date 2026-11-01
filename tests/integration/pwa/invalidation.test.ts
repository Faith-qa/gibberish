// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { AppController } from '../../../src/app/controller'
import { SCHEMA } from '../../../src/core/storage/database'
import { cleanup, connect, content, fixture, phrase, rawStores } from '../storage/fixture'

afterEach(async () => { vi.restoreAllMocks(); await cleanup() })

it('M5 synchronously revokes a revealed controller on storage versionchange and refuses late reopening', async () => {
  const f = await fixture(); const entry = await f.service.createEntry(f.session, content)
  const app = new AppController(f.service, { warm: async () => {}, close: () => f.repository.close() })
  f.repository.onInvalidated(() => app.invalidateCompatibility())
  await app.boot(); await app.unlock(phrase); await app.openEntry(entry.entryId); await app.reveal()
  expect(JSON.stringify(app.snapshot())).toContain(content.body)
  const before = await rawStores(f.db)
  const next = new Dexie(f.db.name); next.version(2).stores(SCHEMA); next.version(3).stores({ future: 'id' })
  try {
    await next.open()
    expect(app.snapshot().screen).toBe('compatibility')
    expect(JSON.stringify(app.snapshot())).not.toContain(content.body)
    await app.unlock(phrase); await app.resume(); app.newEntry(); await app.boot()
    expect(app.snapshot().screen).toBe('compatibility')
    await expect(f.repository.discoverJournal()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    expect(await next.table('journal_revisions').toArray()).toEqual(before.journal_revisions)
  } finally { next.close() }
})

it('M5 prepare-close refuses dirty, busy and uncertain plans; clean preparation revokes only this controller', async () => {
  const f = await fixture(); const close = vi.fn()
  const app = new AppController(f.service, { warm: async () => {}, close })
  await app.boot(); await app.unlock(phrase); app.newEntry(); app.updateDraft(content)
  expect(app.prepareToClose()).toBe(false); expect(close).not.toHaveBeenCalled()
  vi.spyOn(f.repository, 'commitPreparedRevision').mockRejectedValueOnce(new Error('Synthetic failed receipt'))
  await app.save(); await app.timeline()
  expect(app.prepareToClose()).toBe(false)
  await app.checkSave(true)
  expect(app.prepareToClose()).toBe(true); expect(close).toHaveBeenCalledOnce()
  await app.unlock(phrase); await app.resume(); app.newEntry()
  expect(app.snapshot().screen).toBe('prepared-close')
  expect(await f.service.listEntries(f.session)).toHaveLength(1)
})

it('M5 resume compatibility waits do not accept activity past the original deadline', async () => {
  const f = await fixture(); let now = 0; let answer: (value: boolean) => void = () => {}
  const check = new Promise<boolean>((resolve) => { answer = resolve })
  const app = new AppController(f.service, { warm: async () => {}, compatibility: () => check, clock: { wall: () => now, monotonic: () => now } })
  await app.boot(); await app.unlock(phrase); app.newEntry(); app.updateDraft(content)
  now = 240000; app.conceal(); const resuming = app.resume()
  now = 299999; app.activity(); now = 300000; answer(true); await resuming
  expect(app.snapshot().screen).toBe('locked'); expect(JSON.stringify(app.snapshot())).not.toContain(content.body)
})

it('M5 invalidation discards a late revealed result and remains terminal through timer/visibility events', async () => {
  const f = await fixture(); const entry = await f.service.createEntry(f.session, content)
  const app = new AppController(f.service, { warm: async () => {} }); await app.boot(); await app.unlock(phrase); await app.openEntry(entry.entryId)
  const read = await f.service.readEntry(f.session, entry.entryId, entry.revisionId)
  let answer: (value: typeof read) => void = () => {}
  vi.spyOn(f.service, 'readEntry').mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
  const revealing = app.reveal(); app.invalidateCompatibility(); answer(read); await revealing
  app.checkDeadline(); app.conceal(); app.pagehide(); await app.resume()
  expect(app.snapshot().screen).toBe('compatibility'); expect(JSON.stringify(app.snapshot())).not.toContain(content.body)
})

it('M5 unexpected connection close invalidates synchronously and cannot automatically reopen', async () => {
  const f = await fixture(); const events: string[] = []
  f.repository.onInvalidated(() => events.push('invalidated'))
  f.db.close(); events.push('closed')
  expect(events).toEqual(['invalidated', 'closed'])
  await expect(f.repository.readJournal(f.journalId)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
})

it('M5 prepare-close refuses setup, recovery, restore, export and unfinished artifact flows', async () => {
  const f = await fixture(); const close = vi.fn()
  const app = new AppController(f.service, { warm: async () => {}, close })
  const empty = await connect(); const onboarding = new AppController(empty.service, { warm: async () => {} })
  await onboarding.boot(); onboarding.beginSetup(); expect(onboarding.prepareToClose()).toBe(false)
  onboarding.lock(); onboarding.beginRestore(); expect(onboarding.prepareToClose()).toBe(false)
  await app.boot()
  app.lock(); await app.unlock(f.recoveryKey, true); expect(app.prepareToClose()).toBe(false)
  app.lock(); await app.unlock(phrase); app.tools(); app.exportScreen(); expect(app.prepareToClose()).toBe(false)
  await app.generateExport('backup', false); expect(app.snapshot().screen).toBe('export-ready'); expect(app.prepareToClose()).toBe(false)
  await app.backToList(); expect(app.prepareToClose()).toBe(true); expect(close).toHaveBeenCalledOnce()
})
