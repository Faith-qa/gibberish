import * as crypto from '../../src/core/crypto'
import * as codec from '../../src/core/gibberish-codec'
import { JournalService, JournalError } from '../../src/core/journal'
import type { JournalPayload, JournalSession } from '../../src/core/journal'
import { EncryptedJournalRepository } from '../../src/core/storage'
import type { PreparedWrite } from '../../src/core/storage'
import { openDatabase } from '../../src/core/storage/database'
import type { JournalDatabase } from '../../src/core/storage/database'

// Test-only entry: bundled into ignored reports/, never imported by the app.
let current: { db: JournalDatabase; repository: EncryptedJournalRepository; service: JournalService; session: JournalSession } | undefined
function active() { if (!current) throw new JournalError('LOCKED'); return current }
async function connect(name: string) {
  const db = await openDatabase(name)
  const repository = new EncryptedJournalRepository(db)
  return { db, repository, service: new JournalService(repository) }
}
const harness = {
  crypto, codec,
  async initialize(name: string, passphrase: string) {
    const adapter = await connect(name)
    const initialized = await adapter.service.initializeJournal(passphrase)
    current = { ...adapter, session: initialized.session }
    return { journalId: initialized.journalId, recoveryNotPersisted: !JSON.stringify(await harness.raw()).includes(initialized.recoveryKey) }
  },
  async unlock(name: string, journalId: string, passphrase: string) {
    const adapter = await connect(name)
    current = { ...adapter, session: await adapter.service.unlockJournal(journalId, passphrase) }
  },
  create(value: JournalPayload) { const a = active(); return a.service.createEntry(a.session, value) },
  prepareEdit(entryId: string, revisionId: string, value: JournalPayload) {
    const a = active(); return a.service.prepareEdit(a.session, entryId, revisionId, value)
  },
  commit(plan: PreparedWrite) { const a = active(); return a.service.commitWrite(a.session, plan) },
  inspect(plan: PreparedWrite) { const a = active(); return a.service.inspectCommit(a.session, plan) },
  list() { const a = active(); return a.service.listEntries(a.session) },
  read(entryId: string, revisionId?: string) { const a = active(); return a.service.readEntry(a.session, entryId, revisionId) },
  rebuild() { const a = active(); return a.service.rebuildProjections(a.session) },
  lock() { active().session.close() },
  closeStorage() { active().repository.close() },
  close() { if (current) { current.session.close(); current.repository.close(); current = undefined } },
  async raw() {
    return Object.fromEntries(await Promise.all(active().db.tables.map(async (table) => [table.name, await table.toArray()])))
  },
  async corruptProjection(entryId: string) {
    await active().db.journal_entries.update(entryId, { status: 'trashed', headRevisionIds: [globalThis.crypto.randomUUID()] })
  },
}
export type Harness = typeof harness
Object.assign(globalThis, { __m2: harness })
