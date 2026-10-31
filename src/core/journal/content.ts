import { decryptRevision } from '../crypto'
import type { EncryptedJournalRevision } from '../crypto'
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
