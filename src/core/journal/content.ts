import { decryptRevision, verifyTombstone } from '../crypto'
import type { AuthenticatedTombstone, EncryptedJournalRevision } from '../crypto'
import { record } from '../crypto/validation'
import { check } from '../storage/validation'
import { JournalError } from './errors'

export interface JournalPayload { title: string; body: string }
export function payload(value: unknown): JournalPayload {
  const input = record(value, ['title', 'body'])
  check(typeof input.title === 'string' && input.title.trim().length > 0 && typeof input.body === 'string' && input.body.trim().length > 0)
  return { title: input.title, body: input.body }
}
export function decodePayload(bytes: Uint8Array): JournalPayload {
  try { return payload(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))) }
  catch { throw new JournalError('INTEGRITY_ERROR') }
  finally { bytes.fill(0) }
}
export async function authenticateRows(key: CryptoKey, journalId: string, rows: readonly EncryptedJournalRevision[], live: () => void): Promise<void> {
  live()
  for (const row of rows) {
    check(row.journalId === journalId, 'INTEGRITY_ERROR')
    decodePayload(await decryptRevision(row, key, { journalId, entryId: row.entryId }))
    live()
  }
}
export function notAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Operation cancelled.', 'AbortError')
}

export async function authenticateHistory(key: CryptoKey, journalId: string, rows: readonly EncryptedJournalRevision[], markers: readonly AuthenticatedTombstone[], live: () => void): Promise<void> {
  live()
  const deleted = new Set<string>(); const nonces = new Set<string>()
  for (const marker of markers) {
    await verifyTombstone(marker, key, journalId); live()
    check(!deleted.has(marker.entryId) && !nonces.has(marker.authentication.nonce), 'INTEGRITY_ERROR')
    deleted.add(marker.entryId); nonces.add(marker.authentication.nonce)
  }
  for (const row of rows) {
    check(!deleted.has(row.entryId) && !nonces.has(row.encryptedPayload.nonce), 'INTEGRITY_ERROR')
    nonces.add(row.encryptedPayload.nonce)
  }
  await authenticateRows(key, journalId, rows, live)
}
/** Call only after authenticating the entire current snapshot, including markers. */
export function preserveHistory(previous: readonly EncryptedJournalRevision[], current: readonly EncryptedJournalRevision[], markers: readonly AuthenticatedTombstone[]): void {
  const rows = new Map(current.map((r) => [r.revisionId, r]))
  for (const old of previous) {
    const row = rows.get(old.revisionId)
    if (!row) check(markers.some((m) => m.entryId === old.entryId && m.journalId === old.journalId), 'INCOMPLETE_HISTORY')
    else check(JSON.stringify(old) === JSON.stringify(row), 'ID_COLLISION')
  }
}
