// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppController } from '../../../src/app/controller'
import type { JournalService, JournalSession } from '../../../src/core/journal'
import { JournalError } from '../../../src/core/journal'
import { cleanup, connect, content, fixture, phrase } from '../storage/fixture'

afterEach(async () => { vi.restoreAllMocks(); await cleanup() })
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

describe('M3 controller privacy and receipt boundaries', () => {
  it('keeps an unresolved save authoritative while other entries remain readable', async () => {
    const f = await fixture()
    const existing = await f.service.createEntry(f.session, content)
    const app = new AppController(f.service, { warm: async () => {} })
    await app.boot(); await app.unlock(phrase); app.newEntry(); app.updateDraft(content)
    vi.spyOn(f.repository, 'commitPreparedRevision').mockRejectedValueOnce(new JournalError('STORAGE_FAILURE'))
    await app.save(); await app.timeline(); app.newEntry()
    expect(app.snapshot()).toMatchObject({ screen: 'timeline', pendingSave: true })
    await app.openEntry(existing.entryId); await app.reveal(); app.edit()
    expect(app.snapshot()).toMatchObject({ screen: 'detail', pendingSave: true, revealed: content })
    await app.timeline(); await app.checkSave(true)
    expect(app.snapshot()).toMatchObject({ screen: 'timeline', pendingSave: false })
    expect(await f.db.journal_revisions.count()).toBe(2)
  })
  it('discards a late prepared entry before any commit or retry evidence can replace a newer action', async () => {
    const f = await fixture()
    const app = new AppController(f.service, { warm: async () => {} }); await app.boot(); await app.unlock(phrase)
    const prepared = await f.service.prepareCreate(f.session, content)
    const pending = deferred<typeof prepared>()
    vi.spyOn(f.service, 'prepareCreate').mockReturnValueOnce(pending.promise)
    const commit = vi.spyOn(f.service, 'commitWrite')
    app.newEntry(); app.updateDraft(content)
    const saving = app.save(); app.conceal(); pending.resolve(prepared); await saving
    await app.resume()
    expect(app.snapshot()).toMatchObject({ screen: 'timeline', pendingSave: false })
    expect(commit).not.toHaveBeenCalled()
    expect(await f.db.journal_revisions.count()).toBe(0)
  })
  it('reconciles reset persistence if a full lock interrupts its returned capability', async () => {
    const f = await fixture()
    const app = new AppController(f.service, { warm: async () => {} }); await app.boot()
    await app.unlock(f.recoveryKey, true)
    const commit = f.service.commitPassphraseReset.bind(f.service)
    vi.spyOn(f.service, 'commitPassphraseReset').mockImplementationOnce(async (...args) => {
      const result = await commit(...args); app.lock(); return result
    })
    await app.resetPassphrase('Replacement synthetic phrase', 'Replacement synthetic phrase')
    expect(app.snapshot().screen).toBe('locked')
    expect(app.snapshot().notice).not.toContain('reset was verified')
    await app.unlock('Replacement synthetic phrase')
    expect(app.snapshot().screen).toBe('timeline')
    expect(app.snapshot().notice).toContain('reset was verified')
  })
  it('starts locked, reveals explicitly, clears on Hide/navigation, and requires Reveal to edit', async () => {
    const f = await fixture(); const saved = await f.service.createEntry(f.session, content)
    const app = new AppController(f.service, { warm: async () => {} })
    await app.boot(); expect(app.snapshot().screen).toBe('locked')
    expect(JSON.stringify(app.snapshot())).not.toContain(saved.entryId)
    await app.unlock(phrase); await app.openEntry(saved.entryId)
    expect(JSON.stringify(app.snapshot())).not.toContain(content.title)
    app.edit(); expect(app.snapshot().screen).toBe('detail')
    await app.reveal(); expect(JSON.stringify(app.snapshot())).toContain(content.body)
    app.hide(); expect(JSON.stringify(app.snapshot())).not.toContain(content.body)
    await app.reveal(); app.edit(); expect(app.snapshot().screen).toBe('editor')
    await app.timeline(); expect(JSON.stringify(app.snapshot())).not.toContain(content.title)
    app.lock(); expect(app.snapshot().screen).toBe('locked')
    expect(JSON.stringify(app.snapshot())).not.toContain(saved.entryId)
  })

  it('conceals drafts and resumes without extending the original deadline', async () => {
    const f = await fixture(); let now = 0
    const app = new AppController(f.service, { warm: async () => {}, clock: { wall: () => now, monotonic: () => now } })
    await app.boot(); await app.unlock(phrase); app.newEntry(); app.updateDraft(content)
    now = 240000; app.conceal()
    expect(app.snapshot().screen).toBe('concealed')
    expect(JSON.stringify(app.snapshot())).not.toContain(content.title)
    now = 299999; await app.resume()
    expect(app.snapshot().screen).toBe('timeline')
    expect(JSON.stringify(app.snapshot())).not.toContain(content.body)
    now = 300000; app.activity()
    expect(app.snapshot().screen).toBe('locked')
    await app.resume(); expect(app.snapshot().screen).toBe('locked')
  })

  it('disposes late-created unlock sessions rather than reviving a hidden tab', async () => {
    const f = await fixture()
    const app = new AppController(f.service, { warm: async () => {} }); await app.boot()
    const pending = deferred<JournalSession>(); const session = { close: vi.fn() }
    vi.spyOn(f.service, 'unlockJournal').mockReturnValueOnce(pending.promise)
    const unlocking = app.unlock(phrase)
    app.conceal(); pending.resolve(session); await unlocking
    expect(session.close).toHaveBeenCalledTimes(1)
    expect(app.snapshot().screen).toBe('concealed')
    await app.resume(); expect(app.snapshot().screen).toBe('locked')
  })

  it('rejects a late reveal after Hide and pagehide', async () => {
    const f = await fixture(); const saved = await f.service.createEntry(f.session, content)
    const app = new AppController(f.service, { warm: async () => {} })
    await app.boot(); await app.unlock(phrase); await app.openEntry(saved.entryId)
    const result = await f.service.readEntry(f.session, saved.entryId)
    const pending = deferred<Awaited<ReturnType<JournalService['readEntry']>>>()
    vi.spyOn(f.service, 'readEntry').mockReturnValueOnce(pending.promise)
    const revealing = app.reveal(); app.hide(); app.pagehide(); pending.resolve(result); await revealing
    expect(JSON.stringify(app.snapshot())).not.toContain(content.title)
    expect(app.snapshot().screen).toBe('locked')
    await app.resume(); expect(app.snapshot().screen).toBe('locked')
  })

  it('preserves a failed foreground draft and retries exactly the same sealed revision', async () => {
    const f = await fixture()
    const app = new AppController(f.service, { warm: async () => {} })
    await app.boot(); await app.unlock(phrase); app.newEntry(); app.updateDraft(content)
    vi.spyOn(f.repository, 'commitPreparedRevision').mockRejectedValueOnce(new JournalError('STORAGE_FAILURE'))
    await app.save()
    expect(app.snapshot()).toMatchObject({ screen: 'editor', draft: content, pendingSave: true })
    expect(app.snapshot().notice).not.toContain('Saved locally')
    expect(await f.db.journal_revisions.count()).toBe(0)
    const encrypt = vi.spyOn(crypto.subtle, 'encrypt')
    await app.checkSave(true)
    expect(app.snapshot().notice).toContain('Saved locally')
    expect(encrypt).not.toHaveBeenCalled()
    expect(await f.db.journal_revisions.count()).toBe(1)
    expect(JSON.stringify(app.snapshot())).not.toContain(content.body)
  })

  it('does not claim success if lock hides a committed receipt, then reconciles after fresh unlock', async () => {
    const f = await fixture()
    const app = new AppController(f.service, { warm: async () => {} })
    await app.boot(); await app.unlock(phrase); app.newEntry(); app.updateDraft(content)
    const commit = f.service.commitWrite.bind(f.service)
    vi.spyOn(f.service, 'commitWrite').mockImplementationOnce(async (...args) => {
      const receipt = await commit(...args); app.lock(); return receipt
    })
    await app.save()
    expect(app.snapshot().screen).toBe('locked')
    expect(app.snapshot().notice).not.toContain('Saved locally')
    expect(await f.db.journal_revisions.count()).toBe(1)
    await app.unlock(phrase); await app.checkSave()
    expect(app.snapshot().notice).toContain('interrupted save was verified')
    expect(await f.db.journal_revisions.count()).toBe(1)
  })

  it('revokes a candidate session if its authenticated timeline cannot load', async () => {
    const f = await fixture()
    const app = new AppController(f.service, { warm: async () => {} }); await app.boot()
    vi.spyOn(f.service, 'listEntryViews').mockRejectedValueOnce(new JournalError('INTEGRITY_ERROR'))
    await app.unlock(phrase)
    expect(app.snapshot().screen).toBe('locked')
    expect(app.snapshot().notice).toContain('preserved')
    app.newEntry(); expect(app.snapshot().screen).toBe('locked')
  })

  it('does not show onboarding when discovery fails', async () => {
    const f = await connect()
    vi.spyOn(f.service, 'discoverJournal').mockRejectedValueOnce(new JournalError('STORAGE_UNAVAILABLE'))
    const app = new AppController(f.service, { warm: async () => {} }); await app.boot()
    expect(app.snapshot().screen).toBe('error')
    expect(await f.db.journal_config.count()).toBe(0)
  })
})
