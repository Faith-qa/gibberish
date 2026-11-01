import Dexie from 'dexie'
import type { Table } from 'dexie'
import type { EncryptedJournalRevision } from '../crypto'
import { JournalError } from '../journal/errors'
import type { DeviceConfig, EntryProjection, JournalConfig, JournalKeys, SyncConflict, SyncMetadata, SyncOperation, Tombstone } from './types'

export const DATABASE_NAME = 'gibberish-db'
export const SCHEMA_V1 = Object.freeze({
  journal_revisions: 'revisionId, journalId, [journalId+entryId], [journalId+updatedAt], &[journalId+encryptedPayload.nonce]',
  journal_entries: 'entryId, journalId, [journalId+status+createdAt], [journalId+updatedAt], [journalId+deletedAt]',
  journal_keys: 'journalId', journal_config: 'journalId', device_config: 'deviceId',
  sync_queue: 'operationId, [journalId+state+createdAt], [journalId+revisionId]',
  sync_metadata: 'entryId, journalId', sync_conflicts: 'conflictId, [journalId+entryId]', journal_tombstones: 'entryId, journalId',
})

export const SCHEMA = Object.freeze({ ...SCHEMA_V1,
  journal_tombstones: 'entryId, journalId, &[journalId+authentication.nonce]',
})

/** Internal adapter; normal callers use the encrypted repository, not tables. */
export class JournalDatabase extends Dexie {
  journal_revisions!: Table<EncryptedJournalRevision, string>
  journal_entries!: Table<EntryProjection, string>
  journal_keys!: Table<JournalKeys, string>
  journal_config!: Table<JournalConfig, string>
  device_config!: Table<DeviceConfig, string>
  sync_queue!: Table<SyncOperation, string>
  sync_metadata!: Table<SyncMetadata, string>
  sync_conflicts!: Table<SyncConflict, string>
  journal_tombstones!: Table<Tombstone, string>

  constructor(name = DATABASE_NAME) {
    super(name)
    this.version(1).stores(SCHEMA_V1)
    this.version(2).stores(SCHEMA).upgrade(async (transaction) => {
      // M3 never wrote markers. Never bless or discard unknown legacy evidence.
      if (await transaction.table('journal_tombstones').count() !== 0) throw new JournalError('DELETION_REVIEW_REQUIRED')
    })
    this.on('versionchange', () => this.close())
  }
}

function assertSchema(db: Dexie): void {
  if (![1, 2].includes(db.verno) || db.tables.length !== 9) throw new JournalError('UNSUPPORTED_DATABASE')
  for (const [name, definition] of Object.entries(db.verno === 1 ? SCHEMA_V1 : SCHEMA)) {
    const table = db.tables.find((t) => t.name === name)
    if (!table) throw new JournalError('UNSUPPORTED_DATABASE')
    const expected = definition.split(',').map((part) => part.trim())
    if (table.schema.primKey.name !== expected[0] || table.schema.primKey.keyPath !== expected[0]
      || table.schema.primKey.auto || table.schema.primKey.multi || table.schema.indexes.length !== expected.length - 1) throw new JournalError('UNSUPPORTED_DATABASE')
    for (const index of expected.slice(1)) {
      const name = index.replace(/^&/, '')
      const keyPath = name.startsWith('[') ? name.slice(1, -1).split('+') : name
      if (!table.schema.indexes.some((actual) => actual.name === name && actual.unique === index.startsWith('&')
        && !actual.multi && JSON.stringify(actual.keyPath) === JSON.stringify(keyPath))) throw new JournalError('UNSUPPORTED_DATABASE')
    }
  }
}

async function boundedOpen(db: Dexie): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stop = () => {}
  const interrupted = new Promise<never>((_, reject) => {
    stop = () => { db.close(); reject(new JournalError('STORAGE_UNAVAILABLE')) }
    timer = setTimeout(stop, 5000)
    // WebKit can report blocked while an already-closing probe/other tab is
    // still draining. Let the same bounded deadline allow that close to finish.
  })
  try { await Promise.race([db.open(), interrupted]) }
  finally {
    clearTimeout(timer)
  }
}

export async function openDatabase(name = DATABASE_NAME): Promise<JournalDatabase> {
  try {
    // Dynamic read-only schema inspection prevents accidental upgrades of an
    // unrelated/unsupported existing database. Never delete on open failure.
    const probe = new Dexie(name)
    try { await boundedOpen(probe); assertSchema(probe) }
    catch (error) { if (!(error instanceof Error) || error.name !== 'NoSuchDatabaseError') throw error }
    finally { probe.close() }
    const db = new JournalDatabase(name)
    try { await boundedOpen(db); assertSchema(db); return db } catch (error) { db.close(); throw error }
  } catch (error) {
    if (error instanceof JournalError) throw error
    throw new JournalError('STORAGE_UNAVAILABLE')
  }
}
