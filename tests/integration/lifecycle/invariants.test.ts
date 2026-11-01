// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { sealTombstone, unwrapWithPassphrase } from '../../../src/core/crypto'
import { MAX_TOMBSTONES, validateOperation } from '../../../src/core/storage/validation'
import { cleanup, content, fixture, phrase, rawStores } from '../storage/fixture'

afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await cleanup() })
async function source(eligible = false) {
  const f = await fixture()
  if (eligible) { const state = await f.repository.readJournal(f.journalId); await f.db.device_config.update(state.device.deviceId, { cloudEnabled: true }) }
  const root = await f.service.createEntry(f.session, content)
  const trash = await f.service.prepareTrash(f.session, root.entryId, root.revisionId); await f.service.commitWrite(f.session, trash)
  return { ...f, root, trash }
}

it('cancels only superseded uploads and requires the exact eligible deletion intent on reconciliation', async () => {
  const f = await source(true)
  const other = await f.service.createEntry(f.session, { title: 'Synthetic unrelated queue', body: 'Synthetic unrelated body' })
  const unrelated = (await f.db.sync_queue.toArray()).filter((o) => o.entryId === other.entryId)
  const plan = await f.service.preparePermanentDelete(f.session, f.root.entryId, f.trash.revision.revisionId, 'manual', true)
  await f.service.commitPermanentDelete(f.session, plan)
  const queue = await f.db.sync_queue.toArray()
  expect(queue.filter((o) => o.entryId === other.entryId)).toEqual(unrelated)
  const markerOperation = queue.find((o) => o.entryId === f.root.entryId)!
  expect(markerOperation).toMatchObject({ type: 'publish-tombstone', revisionId: null, operationId: plan.operationId })
  expect(await f.service.inspectPermanentDelete(f.session, plan)).toMatchObject({ outcome: 'already-committed', syncStatus: 'pending' })
  await f.db.sync_queue.update(plan.operationId, { attempts: 1, state: 'failed' })
  await expect(f.service.inspectPermanentDelete(f.session, plan)).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' })
  expect(await f.db.journal_tombstones.count()).toBe(1)
})

it('does not miss a stale mis-scoped upload after the original revision rows were removed', async () => {
  const f = await source()
  const plan = await f.service.preparePermanentDelete(f.session, f.root.entryId, f.trash.revision.revisionId, 'manual', true)
  await f.service.commitPermanentDelete(f.session, plan)
  await f.db.sync_queue.add({ operationId: crypto.randomUUID(), journalId: f.journalId, entryId: crypto.randomUUID(), revisionId: f.root.revisionId,
    type: 'publish-revision', state: 'pending', attempts: 0, lastAttemptAt: null, createdAt: new Date().toISOString() })
  await expect(f.service.inspectPermanentDelete(f.session, plan)).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' })
  expect(await f.db.sync_queue.count()).toBe(1)
})

it('refuses erasure at the marker cap and preserves all source data', async () => {
  const f = await source(); const plan = await f.service.preparePermanentDelete(f.session, f.root.entryId, f.trash.revision.revisionId, 'manual', true)
  const before = await rawStores(f.db)
  vi.spyOn(f.db.journal_tombstones, 'count').mockResolvedValueOnce(MAX_TOMBSTONES)
  await expect(f.service.commitPermanentDelete(f.session, plan)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  expect(await rawStores(f.db)).toEqual(before)
})

it('rejects history/marker overlap and never uses a forged marker to authorize data removal', async () => {
  const f = await source(); const plan = await f.service.preparePermanentDelete(f.session, f.root.entryId, f.trash.revision.revisionId, 'manual', true)
  await f.db.journal_tombstones.add(plan.tombstone)
  const before = await rawStores(f.db)
  await expect(f.service.rebuildProjections(f.session)).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' })
  expect(await rawStores(f.db)).toEqual(before)
  await f.db.journal_tombstones.update(f.root.entryId, { authentication: { ...plan.tombstone.authentication, tag: 'A'.repeat(22) } })
  const corrupted = await rawStores(f.db)
  await expect(f.service.listEntryViews(f.session)).rejects.toThrow()
  expect(await rawStores(f.db)).toEqual(corrupted)
})

it('distinguishes a competing valid marker from proof that the original delete committed', async () => {
  const f = await source(); const plan = await f.service.preparePermanentDelete(f.session, f.root.entryId, f.trash.revision.revisionId, 'manual', true)
  const competing = await f.service.preparePermanentDelete(f.session, f.root.entryId, f.trash.revision.revisionId, 'manual', true)
  await f.service.commitPermanentDelete(f.session, competing)
  await expect(f.service.inspectPermanentDelete(f.session, plan)).rejects.toMatchObject({ code: 'ENTRY_DELETED' })
  expect(await f.db.journal_tombstones.toArray()).toEqual([competing.tombstone])
})

it('preserves exact retention dates on retries and starts a fresh interval only after restore and re-Trash', async () => {
  const f = await source(); const id = f.root.entryId
  await expect(f.service.prepareTrash(f.session, id, f.trash.revision.revisionId)).rejects.toThrow()
  const date = Date.parse(f.trash.revision.deletedAt!)
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(date + 1000)
  await f.service.commitWrite(f.session, f.trash)
  expect((await f.service.listTrashViews(f.session))[0]!.projection.deletedAt).toBe(f.trash.revision.deletedAt)
  const restored = await f.service.prepareRestore(f.session, id, f.trash.revision.revisionId); await f.service.commitWrite(f.session, restored)
  vi.setSystemTime(date + 2000)
  const again = await f.service.prepareTrash(f.session, id, restored.revision.revisionId); await f.service.commitWrite(f.session, again)
  expect(again.revision.deletedAt).toBe(new Date(date + 2000).toISOString())
})

it('checks live authorization after marker insertion and rolls the whole transaction back', async () => {
  const f = await source(); const plan = await f.service.preparePermanentDelete(f.session, f.root.entryId, f.trash.revision.revisionId, 'manual', true)
  const before = await rawStores(f.db)
  f.db.journal_tombstones.hook('creating', () => { f.session.close() })
  await expect(f.service.commitPermanentDelete(f.session, plan)).rejects.toMatchObject({ code: 'LOCKED' })
  expect(await rawStores(f.db)).toEqual(before)
})

it('rejects marker/revision nonce collisions before deleting content', async () => {
  const f = await source(); const plan = await f.service.preparePermanentDelete(f.session, f.root.entryId, f.trash.revision.revisionId, 'manual', true)
  const key = await unwrapWithPassphrase(plan.expected.entry.journal.keys.passphraseWrappedKey, phrase, f.journalId)
  const marker = await sealTombstone({ version: 1, journalId: f.journalId, entryId: crypto.randomUUID(), deletionRevisionId: crypto.randomUUID(),
    deletedAt: plan.tombstone.deletedAt, permanentlyDeletedAt: plan.tombstone.permanentlyDeletedAt }, key)
  // Collision testing belongs at the repository's post-crypto invariant boundary;
  // do not ask AEAD to deliberately reuse a production nonce to manufacture it.
  await f.db.journal_tombstones.add({ ...marker, authentication: { ...marker.authentication, nonce: plan.tombstone.authentication.nonce } })
  const before = await rawStores(f.db)
  await expect(f.repository.commitPermanentDelete(plan, () => {})).rejects.toMatchObject({ code: 'NONCE_COLLISION' })
  expect(await rawStores(f.db)).toEqual(before)
})

it.each([{ entryId: null, revisionId: null }, { entryId: crypto.randomUUID(), revisionId: crypto.randomUUID() }])('rejects invalid deletion queue references', (refs) => {
  expect(() => validateOperation({ ...refs, operationId: crypto.randomUUID(), journalId: crypto.randomUUID(), type: 'publish-tombstone', state: 'pending',
    attempts: 0, lastAttemptAt: null, createdAt: new Date().toISOString() })).toThrow()
})
