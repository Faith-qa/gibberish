import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { indexedDB, IDBKeyRange } from 'fake-indexeddb'
import { JournalService } from '../../../src/core/journal'
import { openDatabase } from '../../../src/core/storage/database'
import { EncryptedJournalRepository } from '../../../src/core/storage'

// ESM consumers can load Dexie before this fixture's auto-polyfill executes.
// Supply the in-memory test adapter explicitly; production uses browser IDB.
Dexie.dependencies.indexedDB = indexedDB
Dexie.dependencies.IDBKeyRange = IDBKeyRange

export const phrase = 'Synthetic M2 integration passphrase'
export const content = { title: 'Synthetic private title 🌱', body: 'Synthetic private body — no real journal data' }
const connections: Dexie[] = []
const names = new Set<string>()

export async function connect(name = `synthetic-m2-${crypto.randomUUID()}`) {
  names.add(name)
  const db = await openDatabase(name)
  connections.push(db)
  const repository = new EncryptedJournalRepository(db)
  return { db, repository, service: new JournalService(repository) }
}
export async function fixture() {
  const adapter = await connect()
  return { ...adapter, ...await adapter.service.initializeJournal(phrase) }
}
export async function cleanup() {
  for (const db of connections) db.close()
  connections.length = 0
  for (const name of names) await Dexie.delete(name)
  names.clear()
}
export async function rawStores(db: Dexie) {
  return Object.fromEntries(await Promise.all(db.tables.map(async (table) => [table.name, await table.toArray()])))
}
