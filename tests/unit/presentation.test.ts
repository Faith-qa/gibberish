// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { encryptRevision, envelopeToBytes, generateJournalKey } from '../../src/core/crypto'
import { encode, decode } from '../../src/core/gibberish-codec'
import { encryptedPresentation } from '../../src/features/journal/presentation'

describe('ciphertext-only paged presentation', () => {
  it.each([0, 1, 226, 227, 1024, 65536])('assembles the exact full codec output for %i synthetic bytes', async (size) => {
    const now = '2026-01-01T00:00:00.000Z'
    const row = await encryptRevision(new Uint8Array(size).fill(9), await generateJournalKey(), {
      journalId: crypto.randomUUID(), entryId: crypto.randomUUID(), revisionId: crypto.randomUUID(), parentRevisionIds: [],
      status: 'active', createdAt: now, updatedAt: now, deletedAt: null, schemaVersion: 1,
    })
    const view = encryptedPresentation(row.encryptedPayload)
    const text = Array.from({ length: view.pages }, (_, index) => view.page(index)).join(' ')
    expect(text).toBe(encode(envelopeToBytes(row.encryptedPayload)))
    expect(decode(text)).toEqual(envelopeToBytes(row.encryptedPayload))
    expect(view.preview.split(' ')).toHaveLength(8)
    expect(text.slice(5).startsWith(view.preview)).toBe(true)
    for (const invalid of [-1, view.pages, 0.5, Number.NaN]) expect(() => view.page(invalid)).toThrow('Invalid encrypted page.')
  })
})
