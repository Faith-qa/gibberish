import { JournalService } from '../../src/core/journal'
import { EncryptedJournalRepository } from '../../src/core/storage'
import { openDatabase } from '../../src/core/storage/database'
import { MAX_BACKUP_BYTES } from '../../src/core/export/backup'
import { MAX_READABLE_BYTES } from '../../src/core/export/markdown'
import { handoffDownload } from '../../src/app/download'
import type { ExportKind } from '../../src/app/download'

// Test-only entry, bundled into ignored reports/. No harness ships in dist/.
async function connect(name: string) {
  const db = await openDatabase(name); const repository = new EncryptedJournalRepository(db)
  return { db, repository, service: new JournalService(repository) }
}
let largeArtifacts: Partial<Record<ExportKind, Uint8Array<ArrayBuffer>>> = {}
const harness = {
  downloadLarge(kind: ExportKind) {
    const bytes = largeArtifacts[kind]; if (!bytes) throw new Error('Synthetic artifact absent')
    handoffDownload(bytes, kind); bytes.fill(0); delete largeArtifacts[kind]
  },
  async migrationProbe() {
    try { const db = await openDatabase(); const result = { version: db.verno, code: '' }; db.close(); return result }
    catch (error) { return { version: 0, code: (error as { code: string }).code } }
  },
  async qualifyBounds() {
    const a = await connect(`synthetic-m4-bounds-${crypto.randomUUID()}`)
    const { session, recoveryKey } = await a.service.initializeJournal('Synthetic large backup qualification phrase')
    const started = performance.now()
    try {
      // Three ciphertext payloads fill >99% of the approved file bound. Two
      // current heads fill >99% of the Markdown bound; one revision is historical.
      const body = 'x'.repeat(8 * 1024 * 1024 - 8192)
      const first = await a.service.createEntry(session, { title: 'Synthetic bounded record one', body })
      await a.service.editEntry(session, first.entryId, first.revisionId, { title: 'Synthetic bounded record one', body })
      const second = await a.service.createEntry(session, { title: 'Synthetic bounded record two', body })
      const backup = await a.service.prepareEncryptedBackup(session)
      const size = backup.byteLength
      const target = await connect(`synthetic-m4-large-restore-${crypto.randomUUID()}`)
      try {
        const handle = await target.service.prepareBackupRestore(backup, recoveryKey, 'recovery')
        await target.service.setRestorePassphrase(handle, 'Synthetic restored qualification phrase', 'Synthetic restored qualification phrase')
        const restored = await target.service.commitBackupRestore(handle)
        const restoredLength = (await target.service.readEntry(restored.session, first.entryId)).payload.body.length
        restored.session.close()
        const markdown = await a.service.prepareReadableExport(session, true)
        const readableSize = markdown.byteLength
        await a.service.editEntry(session, second.entryId, second.revisionId, { title: 'Synthetic oversize record', body: body + 'z'.repeat(32768) })
        let backupFailure = '', readableFailure = ''
        try { await a.service.prepareEncryptedBackup(session) } catch (e) { backupFailure = (e as { code: string }).code }
        try { await a.service.prepareReadableExport(session, true) } catch (e) { readableFailure = (e as { code: string }).code }
        for (const bytes of Object.values(largeArtifacts)) bytes.fill(0)
        largeArtifacts = { backup, readable: markdown }
        return { size, readableSize, restoredLength, bodyLength: body.length, revisions: await a.db.journal_revisions.count(), backupFailure, readableFailure,
          maximum: MAX_BACKUP_BYTES, readableMaximum: MAX_READABLE_BYTES, elapsedMs: Math.round(performance.now() - started) }
      } finally { target.repository.close(); await target.db.delete() }
    } finally { session.close(); a.repository.close(); await a.db.delete() }
  },
}
export type Harness = typeof harness
Object.assign(globalThis, { __m4: harness })
