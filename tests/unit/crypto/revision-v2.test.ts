// @vitest-environment node
import { createCipheriv } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { decryptLegacyEnvelope, decryptRevision, encrypt, encryptRevision, envelopeFromBytes, envelopeToBytes,
  generateJournalKey, revisionAadV2, validateRevisionMetadata } from '../../../src/core/crypto'
import type { RevisionMetadata } from '../../../src/core/crypto'
import { encode, decode } from '../../../src/core/gibberish-codec'

const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'] as const
const metadata: RevisionMetadata = { journalId: ids[0], entryId: ids[1], revisionId: ids[2], parentRevisionIds: [ids[3]],
  status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z', deletedAt: null, schemaVersion: 1 }
const bytes = new TextEncoder().encode('Synthetic v2 vector')

describe('full immutable metadata AAD v2', () => {
  it('uses the exact approved canonical tuple and ignores object property order', () => {
    expect(new TextDecoder().decode(revisionAadV2(metadata))).toBe(
      '["gibberish-revision-aad",2,2,"AES-256-GCM",1,"11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333",["44444444-4444-4444-8444-444444444444"],"active","2026-01-01T00:00:00.000Z","2026-02-01T00:00:00.000Z",null]')
    expect(revisionAadV2(Object.fromEntries(Object.entries(metadata).reverse()) as unknown as RevisionMetadata)).toEqual(revisionAadV2(metadata))
  })

  it('interoperates with native AES-GCM using explicit v2 bytes', async () => {
    const raw = Uint8Array.from({ length: 32 }, (_, i) => i)
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt'])
    const nonce = new Uint8Array(12).fill(91)
    const cipher = createCipheriv('aes-256-gcm', raw, nonce)
    const aad = new TextEncoder().encode(JSON.stringify(['gibberish-revision-aad', 2, 2, 'AES-256-GCM', 1,
      ids[0], ids[1], ids[2], [ids[3]], 'active', metadata.createdAt, metadata.updatedAt, null]))
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]).toString('base64url')
    // Fixed known-answer vector independently generated with native Node/OpenSSL.
    expect(ciphertext).toBe('_ZcMbXUHHD3kgOQvYcs2EJIF4OBTXbgBpxoKrZg8m-kEQzc')
    const row = { ...metadata, encryptedPayload: { version: 2, algorithm: 'AES-256-GCM', nonce: Buffer.from(nonce).toString('base64url'), ciphertext } }
    expect(await decryptRevision(row, key, { journalId: ids[0], entryId: ids[1] })).toEqual(bytes)
  })

  it.each([
    { journalId: ids[4] }, { entryId: ids[4] }, { revisionId: ids[4] }, { parentRevisionIds: [ids[4]] },
    { parentRevisionIds: [ids[3], ids[4]] }, { createdAt: '2025-12-01T00:00:00.000Z' },
    { updatedAt: '2026-03-01T00:00:00.000Z' }, { status: 'trashed', deletedAt: metadata.updatedAt },
  ])('rejects authenticated metadata alteration %j', async (change) => {
    const key = await generateJournalKey(); const original = await encryptRevision(bytes, key, metadata)
    const altered = { ...original, ...change }
    await expect(decryptRevision(altered, key, { journalId: altered.journalId, entryId: altered.entryId })).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
  })

  it('authenticates deletedAt on a structurally valid trashed record', async () => {
    const key = await generateJournalKey()
    const row = await encryptRevision(bytes, key, { ...metadata, status: 'trashed', deletedAt: metadata.updatedAt })
    await expect(decryptRevision({ ...row, updatedAt: '2026-03-01T00:00:00.000Z', deletedAt: '2026-03-01T00:00:00.000Z' }, key,
      { journalId: ids[0], entryId: ids[1] })).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    await expect(decryptRevision({ ...row, deletedAt: null }, key, { journalId: ids[0], entryId: ids[1] })).rejects.toThrow()
  })

  it('authenticates parent removal and supports an empty cryptographic payload', async () => {
    const key = await generateJournalKey()
    const scope = { journalId: metadata.journalId, entryId: metadata.entryId }
    const row = await encryptRevision(new Uint8Array(), key, { ...metadata, parentRevisionIds: [ids[3], ids[4]] })
    expect(await decryptRevision(row, key, scope)).toEqual(new Uint8Array())
    expect(Buffer.from(row.encryptedPayload.ciphertext, 'base64url')).toHaveLength(16)
    await expect(decryptRevision({ ...row, parentRevisionIds: [ids[3]] }, key, scope)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
  })

  it.each([
    { journalId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }, { parentRevisionIds: [ids[4], ids[3]] }, { parentRevisionIds: [ids[3], ids[3]] },
    { parentRevisionIds: [ids[2]] }, { status: 'conflicted' }, { schemaVersion: 2 }, { deletedAt: undefined },
    { createdAt: '2026-02-30T00:00:00.000Z' }, { updatedAt: '2026-02-01T00:00:00Z' },
    { updatedAt: '2026-02-01T00:00:00.000+00:00' }, { updatedAt: '2025-01-01T00:00:00.000Z' },
    { parentRevisionIds: [], createdAt: metadata.createdAt, updatedAt: metadata.updatedAt },
  ])('rejects noncanonical or inconsistent metadata %j', (change) => {
    expect(() => validateRevisionMetadata({ ...metadata, ...change })).toThrow()
  })

  it('requires explicit deletedAt and caps parents at 256 without truncation', () => {
    const missing = Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== 'deletedAt'))
    expect(() => validateRevisionMetadata(missing)).toThrow()
    const parents = Array.from({ length: 257 }, () => crypto.randomUUID()).sort()
    expect(validateRevisionMetadata({ ...metadata, parentRevisionIds: parents.slice(0, 256) }).parentRevisionIds).toHaveLength(256)
    expect(() => validateRevisionMetadata({ ...metadata, parentRevisionIds: parents })).toThrow()
    expect(parents).toHaveLength(257)
  })

  it('snapshots parent IDs and metadata before async encryption', async () => {
    const input = { ...metadata, parentRevisionIds: [ids[3]] as string[] }
    const key = await generateJournalKey(); const pending = encryptRevision(bytes, key, input)
    input.parentRevisionIds[0] = ids[4]; input.updatedAt = '2027-01-01T00:00:00.000Z'
    const row = await pending
    expect(row.parentRevisionIds).toEqual([ids[3]])
    expect(row.updatedAt).toBe(metadata.updatedAt)
    expect(Object.isFrozen(row.parentRevisionIds)).toBe(true)
    expect(await decryptRevision(row, key, { journalId: ids[0], entryId: ids[1] })).toEqual(bytes)
  })

  it('preserves legacy v1 and dispatches binary profiles without a downgrade path', async () => {
    const key = await generateJournalKey()
    const identity = { journalId: ids[0], entryId: ids[1], revisionId: ids[2], schemaVersion: 1 as const }
    const v1 = await encrypt(bytes, key, identity)
    const v2 = await encryptRevision(bytes, key, metadata)
    expect(await decryptLegacyEnvelope(v1, key, identity)).toEqual(bytes)
    for (const envelope of [v1, v2.encryptedPayload]) {
      expect(envelopeFromBytes(decode(encode(envelopeToBytes(envelope))))).toEqual(envelope)
    }
    await expect(decryptRevision({ ...v2, encryptedPayload: v1 }, key, { journalId: ids[0], entryId: ids[1] })).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' })
    await expect(decryptLegacyEnvelope(v2.encryptedPayload, key, identity)).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' })
    const cipher = Buffer.from(v2.encryptedPayload.ciphertext, 'base64url'); cipher[0] = (cipher[0] ?? 0) ^ 1
    const spy = vi.spyOn(crypto.subtle, 'decrypt')
    try {
      await expect(decryptRevision({ ...v2, encryptedPayload: { ...v2.encryptedPayload, ciphertext: cipher.toString('base64url') } }, key,
        { journalId: ids[0], entryId: ids[1] })).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
      expect(spy).toHaveBeenCalledTimes(1)
    } finally { spy.mockRestore() }
  })

  it.each([
    { version: 1 }, { version: 3 }, { algorithm: 'AES-CBC' }, { nonce: 'AA' },
    { ciphertext: '' }, { plaintext: 'Synthetic forbidden field' },
  ])('rejects invalid v2 envelope fields before calling decryption: %j', async (change) => {
    const key = await generateJournalKey(); const row = await encryptRevision(bytes, key, metadata)
    const decrypt = vi.spyOn(crypto.subtle, 'decrypt')
    try {
      await expect(decryptRevision({ ...row, encryptedPayload: { ...row.encryptedPayload, ...change } }, key,
        { journalId: row.journalId, entryId: row.entryId })).rejects.toThrow()
      expect(decrypt).not.toHaveBeenCalled()
    } finally { decrypt.mockRestore() }
  })

  it('uses fresh nonces, rejects wrong keys and scopes, and authenticates the tag for v2', async () => {
    const key = await generateJournalKey()
    const rows = await Promise.all(Array.from({ length: 32 }, () => encryptRevision(bytes, key, { ...metadata, revisionId: crypto.randomUUID() })))
    expect(new Set(rows.map((r) => r.encryptedPayload.nonce)).size).toBe(32)
    const row = rows[0]!
    const scope = { journalId: row.journalId, entryId: row.entryId }
    await expect(decryptRevision(row, await generateJournalKey(), scope)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    await expect(decryptRevision(row, key, { ...scope, entryId: ids[4] })).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    const altered = Buffer.from(row.encryptedPayload.ciphertext, 'base64url')
    altered[altered.length - 1] = (altered[altered.length - 1] ?? 0) ^ 1
    await expect(decryptRevision({ ...row, encryptedPayload: { ...row.encryptedPayload, ciphertext: altered.toString('base64url') } }, key, scope))
      .rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
  })
})
