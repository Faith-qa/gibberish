import type { EncryptedJournalRevision } from '../crypto'
import type { EntryProjection } from '../storage/types'
import { JournalError } from './errors'

/** Operates only on authenticated snapshots supplied by the domain. No I/O. */
export function projectHistory(revisions: readonly EncryptedJournalRevision[]): EntryProjection | null {
  if (revisions.length === 0) return null
  const first = revisions[0]
  if (!first) throw new JournalError('INTEGRITY_ERROR')
  const byId = new Map(revisions.map((r) => [r.revisionId, r]))
  if (byId.size !== revisions.length) throw new JournalError('ID_COLLISION')
  const childCount = new Map<string, number>()
  const remaining = new Map<string, number>()
  const children = new Map<string, string[]>()
  let roots = 0
  for (const r of revisions) {
    if (r.journalId !== first.journalId || r.entryId !== first.entryId || r.createdAt !== first.createdAt) throw new JournalError('INTEGRITY_ERROR')
    if (r.parentRevisionIds.length === 0) roots++
    remaining.set(r.revisionId, r.parentRevisionIds.length)
    for (const parent of r.parentRevisionIds) {
      if (!byId.has(parent)) throw new JournalError('INCOMPLETE_HISTORY')
      childCount.set(parent, (childCount.get(parent) ?? 0) + 1)
      const list = children.get(parent) ?? []; list.push(r.revisionId); children.set(parent, list)
    }
  }
  const queue = revisions.filter((r) => r.parentRevisionIds.length === 0).map((r) => r.revisionId)
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]
    if (!current) throw new JournalError('INTEGRITY_ERROR')
    for (const child of children.get(current) ?? []) {
      const count = (remaining.get(child) ?? 0) - 1; remaining.set(child, count)
      if (count === 0) queue.push(child)
    }
  }
  if (queue.length !== revisions.length || roots !== 1) throw new JournalError('INTEGRITY_ERROR')
  const heads = revisions.filter((r) => !childCount.has(r.revisionId)).sort((a, b) => a.revisionId < b.revisionId ? -1 : 1)
  const head = heads[0]
  if (!head) throw new JournalError('INTEGRITY_ERROR')
  return Object.freeze({ journalId: first.journalId, entryId: first.entryId,
    headRevisionIds: Object.freeze(heads.map((r) => r.revisionId)), status: heads.length === 1 ? head.status : 'conflicted',
    createdAt: first.createdAt, updatedAt: heads.reduce((latest, r) => r.updatedAt > latest ? r.updatedAt : latest, head.updatedAt),
    deletedAt: heads.length === 1 ? head.deletedAt : null })
}

export function projectJournal(revisions: readonly EncryptedJournalRevision[]): EntryProjection[] {
  const groups = new Map<string, EncryptedJournalRevision[]>()
  for (const r of revisions) { const group = groups.get(r.entryId) ?? []; group.push(r); groups.set(r.entryId, group) }
  return [...groups.values()].map((rows) => {
    const projection = projectHistory(rows)
    if (!projection) throw new JournalError('INTEGRITY_ERROR')
    return projection
  }).sort((a, b) => a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : a.entryId < b.entryId ? -1 : 1)
}
