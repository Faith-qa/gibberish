// @vitest-environment node
import { readFileSync } from 'node:fs'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SCHEMA_V1, openDatabase, JournalDatabase } from '../../../src/core/storage/database'
import { cleanup, connect, rawStores } from '../storage/fixture'
const fixture = JSON.parse(readFileSync(new URL('../../fixtures/m3-journal.json', import.meta.url), 'utf8')) as { sourceCommit: string; passphrase: string; recoveryKey: string; stores: Record<string, unknown[]> }
const names: string[] = []
async function legacy() {
  const name = `synthetic-m3-upgrade-${crypto.randomUUID()}`; names.push(name)
  const db = new Dexie(name); db.version(1).stores(SCHEMA_V1); await db.open()
  for (const [name, rows] of Object.entries(fixture.stores)) await db.table(name).bulkAdd(rows)
  return { name, db }
}
afterEach(async () => { vi.restoreAllMocks(); await cleanup(); for (const name of names) await Dexie.delete(name); names.length = 0 })
describe('explicit M3 version 1 to M4 version 2 migration', () => {
  it('preserves actual committed-M3 fixture bytes, identity, wrappers and history', async () => {
    expect(fixture.sourceCommit).toBe('ccac07dbde38f9fec1f230e9382e1aa0ad8ada09')
    const old = await legacy(); old.db.close()
    const f = await connect(old.name)
    expect(f.db.verno).toBe(2); expect(await rawStores(f.db)).toEqual(fixture.stores)
    const found = await f.service.discoverJournal(); expect(found.kind).toBe('existing')
    if (found.kind !== 'existing') throw new Error('Synthetic migration detection failed')
    const session = await f.service.unlockJournal(found.journalId, fixture.passphrase)
    const entries = await f.service.listEntries(session)
    expect((await f.service.readEntry(session, entries[0]!.entryId)).payload.body).toBe('Synthetic M3 migration edited body')
    await f.service.authenticateRecovery(found.journalId, fixture.recoveryKey)
  })
  it('aborts legacy marker migration and leaves every old byte/version intact', async () => {
    const old = await legacy()
    await old.db.table('journal_tombstones').add({ entryId: crypto.randomUUID(), journalId: crypto.randomUUID() })
    const before = await rawStores(old.db); old.db.close()
    await expect(openDatabase(old.name)).rejects.toThrow()
    const check = new Dexie(old.name); await check.open()
    expect(check.verno).toBe(1); expect(await rawStores(check)).toEqual(before); check.close()
  })
  it('preserves the v1 database when an explicit upgrade is interrupted', async () => {
    const old = await legacy(); const before = await rawStores(old.db); old.db.close()
    vi.spyOn(JournalDatabase.prototype, 'open').mockImplementationOnce(function (this: JournalDatabase) {
      this.on('populate', () => { throw new Error('Synthetic interrupted upgrade') })
      this.version(2).upgrade(() => { throw new Error('Synthetic interrupted upgrade') })
      return Dexie.prototype.open.call(this)
    })
    await expect(openDatabase(old.name)).rejects.toThrow()
    vi.restoreAllMocks()
    const check = new Dexie(old.name); await check.open()
    expect(check.verno).toBe(1); expect(await rawStores(check)).toEqual(before); check.close()
  })
  it('fails within the open deadline on a blocked real v1 upgrade without discarding old records', async () => {
    const old = await legacy(); const before = await rawStores(old.db)
    old.db.on('versionchange', () => false)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(openDatabase(old.name)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    expect(old.db.verno).toBe(1); expect(await rawStores(old.db)).toEqual(before); old.db.close()
  }, 10_000)
})
