// @vitest-environment node
import { createCipheriv } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { generateJournalKey, sealTombstone, verifyTombstone, sealBackupManifest, verifyBackupManifest } from '../../../src/core/crypto'
import type { BackupManifest } from '../../../src/core/crypto'

const metadata = { version: 1 as const, journalId: '11111111-1111-4111-8111-111111111111', entryId: '22222222-2222-4222-8222-222222222222', deletionRevisionId: '33333333-3333-4333-8333-333333333333', deletedAt: '2026-01-01T00:00:00.000Z', permanentlyDeletedAt: '2026-01-31T00:00:00.000Z' }
const manifest: BackupManifest = ['44444444-4444-4444-8444-444444444444', metadata.permanentlyDeletedAt, [metadata.journalId, 1], [], [], []]

describe('M4 purpose-bound content-free authentication', () => {
  it('verifies independent native AES-GCM whole-manifest authentication with the fixed backup v2 purpose', async () => {
    const bytes = new Uint8Array(32).fill(9); const nonce = new Uint8Array(12).fill(5)
    const aad = JSON.stringify(['gibberish-backup-aad', 1, 'gibberish-backup', 2, 'AES-256-GCM', manifest])
    const cipher = createCipheriv('aes-256-gcm', bytes, nonce); cipher.setAAD(Buffer.from(aad)); cipher.final()
    const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt'])
    await expect(verifyBackupManifest(manifest, { version: 1, algorithm: 'AES-256-GCM', nonce: Buffer.from(nonce).toString('base64url'), tag: cipher.getAuthTag().toString('base64url') }, key)).resolves.toBeUndefined()
  })
  it('matches independent native AES-GCM empty-message tombstone authentication', async () => {
    const bytes = new Uint8Array(32).fill(7); const nonce = new Uint8Array(12).fill(3)
    const aad = JSON.stringify(['gibberish-tombstone-aad', 1, 1, 'AES-256-GCM', metadata.journalId, metadata.entryId, metadata.deletionRevisionId, metadata.deletedAt, metadata.permanentlyDeletedAt])
    const cipher = createCipheriv('aes-256-gcm', bytes, nonce); cipher.setAAD(Buffer.from(aad)); cipher.final()
    const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', true, ['encrypt', 'decrypt'])
    await expect(verifyTombstone({ ...metadata, authentication: { version: 1, algorithm: 'AES-256-GCM', nonce: Buffer.from(nonce).toString('base64url'), tag: cipher.getAuthTag().toString('base64url') } }, key, metadata.journalId)).resolves.toBeUndefined()
  })
  it('seals no content, generates fresh nonces and survives removal of original history', async () => {
    const key = await generateJournalKey()
    const a = await sealTombstone(metadata, key); const b = await sealTombstone(metadata, key)
    expect(a.authentication.nonce).not.toBe(b.authentication.nonce)
    expect(Buffer.from(a.authentication.tag, 'base64url')).toHaveLength(16)
    expect(a).not.toHaveProperty('encryptedPayload')
    await expect(verifyTombstone(a, key, metadata.journalId)).resolves.toBeUndefined()
    await expect(verifyTombstone(a, await generateJournalKey(), metadata.journalId)).rejects.toThrow()
  })
  it.each(['journalId', 'entryId', 'deletionRevisionId', 'deletedAt', 'permanentlyDeletedAt', 'version', 'nonce', 'tag', 'algorithm', 'extra'] as const)('rejects tombstone tampering: %s', async (field) => {
    const key = await generateJournalKey(); const row = await sealTombstone(metadata, key)
    const changed: Record<string, unknown> = { ...row }
    if (field === 'nonce' || field === 'tag') changed.authentication = { ...row.authentication, [field]: Buffer.from(new Uint8Array(field === 'tag' ? 16 : 12)).toString('base64url') }
    else if (field === 'algorithm') changed.authentication = { ...row.authentication, algorithm: 'AES-CBC' }
    else if (field === 'extra') changed.extra = true
    else changed[field] = field === 'version' ? 2 : field.endsWith('At') ? '2026-02-01T00:00:00.000Z' : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    await expect(verifyTombstone(changed, key, metadata.journalId)).rejects.toThrow()
  })
  it('authenticates the entire manifest and separates backup and deletion purposes', async () => {
    const key = await generateJournalKey(); const proof = await sealBackupManifest(manifest, key)
    await expect(verifyBackupManifest(manifest, proof, key)).resolves.toBeUndefined()
    for (let index = 0; index < manifest.length; index++) {
      const altered = [...manifest]; altered[index] = index === 0 ? metadata.entryId : index === 1 ? metadata.deletedAt : ['changed']
      await expect(verifyBackupManifest(altered as unknown as BackupManifest, proof, key)).rejects.toThrow()
    }
    await expect(verifyTombstone({ ...metadata, authentication: proof }, key, metadata.journalId)).rejects.toThrow()
    await expect(verifyBackupManifest(manifest, proof, await generateJournalKey())).rejects.toThrow()
  })
})
