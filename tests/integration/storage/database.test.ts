// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { openDatabase, SCHEMA } from '../../../src/core/storage/database'
import { cleanup, connect, content, fixture, rawStores } from './fixture'

afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await cleanup() })

describe('M2 database schema and migration boundary', () => {
  it('bounds a stalled database open without deleting existing data', async () => {
    const f = await fixture()
    const before = await rawStores(f.db)
    vi.useFakeTimers()
    vi.spyOn(Dexie.prototype, 'open').mockImplementation(() => new Dexie.Promise(() => {}))
    const opening = openDatabase(f.db.name)
    const rejected = expect(opening).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    await vi.advanceTimersByTimeAsync(5001)
    await rejected
    vi.useRealTimers(); vi.restoreAllMocks()
    expect(await rawStores(f.db)).toEqual(before)
  })

  it('fails a blocked open promptly without a destructive reset', async () => {
    const f = await fixture()
    const before = await rawStores(f.db)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Dexie.prototype, 'open').mockImplementation(function (this: Dexie) {
      queueMicrotask(() => this.on('blocked').fire({} as IDBVersionChangeEvent))
      return new Dexie.Promise(() => {})
    })
    await expect(openDatabase(f.db.name)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    vi.restoreAllMocks()
    expect(await rawStores(f.db)).toEqual(before)
  })
  it('rejects an unknown existing schema and preserves its records', async () => {
    const name = `synthetic-unknown-${crypto.randomUUID()}`
    const unknown = new Dexie(name)
    unknown.version(1).stores({ unexpected: 'id' })
    try {
      await unknown.open()
      await unknown.table('unexpected').add({ id: 'synthetic-record', encrypted: 'synthetic-evidence' })
      await expect(openDatabase(name)).rejects.toMatchObject({ code: 'UNSUPPORTED_DATABASE' })
      expect(await unknown.table('unexpected').toArray()).toEqual([{ id: 'synthetic-record', encrypted: 'synthetic-evidence' }])
    } finally { unknown.close(); await Dexie.delete(name) }
  })

  it('closes old connections on versionchange and refuses a future schema without deleting it', async () => {
    const f = await fixture()
    await f.service.createEntry(f.session, content)
    const before = await rawStores(f.db)
    const future = new Dexie(f.db.name)
    future.version(1).stores(SCHEMA)
    future.version(2).stores({ future_store: 'id' })
    try {
      await future.open()
      expect(f.db.isOpen()).toBe(false)
      await expect(openDatabase(f.db.name)).rejects.toMatchObject({ code: 'UNSUPPORTED_DATABASE' })
      expect(await future.table('journal_revisions').toArray()).toEqual(before.journal_revisions)
      expect(await future.table('journal_keys').toArray()).toEqual(before.journal_keys)
    } finally { future.close() }
  })

  it('preserves the old schema and ciphertext if a future upgrade aborts', async () => {
    const f = await fixture()
    await f.service.createEntry(f.session, content)
    const before = await rawStores(f.db)
    f.repository.close()
    const upgrade = new Dexie(f.db.name)
    upgrade.version(1).stores(SCHEMA)
    upgrade.version(2).stores({ future_store: 'id' }).upgrade(() => { throw new Error('Synthetic upgrade abort') })
    try { await expect(upgrade.open()).rejects.toThrow() } finally { upgrade.close() }
    const recovered = await connect(f.db.name)
    expect(recovered.db.verno).toBe(1)
    expect(await rawStores(recovered.db)).toEqual(before)
  })

  it('rejects a duplicate journal nonce atomically rather than overwriting an immutable revision', async () => {
    const f = await fixture()
    const first = await f.service.prepareCreate(f.session, content)
    const second = await f.service.prepareCreate(f.session, content)
    await f.service.commitWrite(f.session, first)
    const before = await rawStores(f.db)
    // Exercise the defense-in-depth index at the structural adapter boundary;
    // the domain would also reject this altered candidate's authentication tag.
    await expect(f.repository.commitPreparedRevision({ ...second, revision: { ...second.revision,
      encryptedPayload: { ...second.revision.encryptedPayload, nonce: first.revision.encryptedPayload.nonce } } }, () => {}))
      .rejects.toMatchObject({ code: 'NONCE_COLLISION' })
    expect(await rawStores(f.db)).toEqual(before)
  })

  it('includes malformed indexed metadata in journal validation instead of silently dropping it', async () => {
    const f = await fixture()
    const first = await f.service.createEntry(f.session, content)
    const row = (await f.db.journal_revisions.get(first.revisionId))!
    const broken = { ...row, encryptedPayload: null, updatedAt: null }
    await f.db.table('journal_revisions').put(broken)
    await expect(f.service.listEntries(f.session)).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' })
    expect(await f.db.table('journal_revisions').get(first.revisionId)).toEqual(broken)
  })
})
