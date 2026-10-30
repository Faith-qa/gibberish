// @vitest-environment node
import { createDecipheriv } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decrypt, encrypt, envelopeFromBytes, envelopeToBytes, generateJournalKey, JournalCryptoError, MAX_PLAINTEXT_BYTES, revisionAad } from '../../../src/core/crypto'
import type { RevisionIdentity } from '../../../src/core/crypto'
import { fromBase64url, toBase64url } from '../../../src/core/crypto/encoding'
import { decode, encode } from '../../../src/core/gibberish-codec'

export const identity: RevisionIdentity = {
  journalId: '11111111-1111-4111-8111-111111111111',
  entryId: '22222222-2222-4222-8222-222222222222',
  revisionId: '33333333-3333-4333-8333-333333333333', schemaVersion: 1,
}
const plaintext = new TextEncoder().encode(JSON.stringify({ title: 'Synthetic title', body: 'Synthetic body: 雨 🌱\n\u0000' }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('revision-bound AES-256-GCM', () => {
  it('generates distinct AES-256 keys with the usages needed for in-memory wrapping', async () => {
    const a = await generateJournalKey()
    const b = await generateJournalKey()
    expect(a).toMatchObject({ type: 'secret', extractable: true, algorithm: { name: 'AES-GCM', length: 256 }, usages: ['encrypt', 'decrypt'] })
    const rawA = new Uint8Array(await crypto.subtle.exportKey('raw', a))
    const rawB = new Uint8Array(await crypto.subtle.exportKey('raw', b))
    expect(rawA.some((byte, i) => byte !== rawB[i])).toBe(true)
    rawA.fill(0); rawB.fill(0)
  })

  it.each([new Uint8Array(), plaintext, Uint8Array.from({ length: 65536 }, (_, i) => i & 255)])('round trips synthetic bytes without mutation', async (bytes) => {
    const copy = bytes.slice()
    const key = await generateJournalKey()
    const envelope = await encrypt(bytes, key, identity)
    expect(envelope).toMatchObject({ version: 1, algorithm: 'AES-256-GCM' })
    expect(fromBase64url(envelope.nonce, 12, 12)).toHaveLength(12)
    expect(fromBase64url(envelope.ciphertext, 16, MAX_PLAINTEXT_BYTES + 16)).toHaveLength(bytes.length + 16)
    expect(await decrypt(envelope, key, identity)).toEqual(bytes)
    expect(bytes).toEqual(copy)
    expect(JSON.stringify(envelope)).not.toContain('Synthetic title')
  })

  it('has a fixed canonical AAD encoding independent of property order', () => {
    const expected = '["gibberish-entry-aad",1,1,"11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333",1]'
    expect(new TextDecoder().decode(revisionAad(identity))).toBe(expected)
    expect(revisionAad({ schemaVersion: 1, revisionId: identity.revisionId, journalId: identity.journalId, entryId: identity.entryId })).toEqual(revisionAad(identity))
  })

  it('decrypts a fixed synthetic vector generated through native OpenSSL', async () => {
    const keyBytes = Uint8Array.from({ length: 32 }, (_, i) => i)
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', true, ['encrypt', 'decrypt'])
    const ciphertext = Buffer.from('147bb86fad80b672ee61fde4c49b160ceff6f151930f300e1687b65a27918369f6d82597b09266dd43', 'hex')
    const nonce = Uint8Array.from({ length: 12 }, (_, i) => i)
    expect(await decrypt({ version: 1, algorithm: 'AES-256-GCM', nonce: toBase64url(nonce), ciphertext: toBase64url(ciphertext) }, key, identity))
      .toEqual(new TextEncoder().encode('Synthetic journal vector.'))
    const envelope = await encrypt(plaintext, key, identity)
    const output = Buffer.from(envelope.ciphertext, 'base64url')
    const native = createDecipheriv('aes-256-gcm', keyBytes, Buffer.from(envelope.nonce, 'base64url'))
    native.setAAD(revisionAad(identity))
    native.setAuthTag(output.subarray(-16))
    expect(Buffer.concat([native.update(output.subarray(0, -16)), native.final()])).toEqual(Buffer.from(plaintext))
  })

  it('rejects the wrong key and ciphertext, authentication-tag, or nonce tampering', async () => {
    const key = await generateJournalKey()
    const envelope = await encrypt(plaintext, key, identity)
    await expect(decrypt(envelope, await generateJournalKey(), identity)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    for (const index of [0, Buffer.from(envelope.ciphertext, 'base64url').length - 1]) {
      const damaged = Buffer.from(envelope.ciphertext, 'base64url')
      damaged[index] = (damaged[index] ?? 0) ^ 1
      await expect(decrypt({ ...envelope, ciphertext: toBase64url(damaged) }, key, identity)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    }
    const iv = Buffer.from(envelope.nonce, 'base64url'); iv[0] = (iv[0] ?? 0) ^ 1
    await expect(decrypt({ ...envelope, nonce: toBase64url(iv) }, key, identity)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
  })

  it.each(['journalId', 'entryId', 'revisionId'] as const)('rejects an AAD mismatch for %s', async (field) => {
    const key = await generateJournalKey()
    const envelope = await encrypt(plaintext, key, identity)
    await expect(decrypt(envelope, key, { ...identity, [field]: '44444444-4444-4444-8444-444444444444' }))
      .rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
  })

  it('requires fresh encryption when the same content is assigned a new revision', async () => {
    const key = await generateJournalKey()
    const a = await encrypt(plaintext, key, identity)
    const next = { ...identity, revisionId: '44444444-4444-4444-8444-444444444444' }
    await expect(decrypt(a, key, next)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    const b = await encrypt(await decrypt(a, key, identity), key, next)
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(await decrypt(b, key, next)).toEqual(plaintext)
    expect(await decrypt(a, key, identity)).toEqual(plaintext)
  })

  it('requests a fresh nonce for every encryption, including concurrent calls', async () => {
    const key = await generateJournalKey()
    const random = vi.spyOn(crypto, 'getRandomValues')
    const records = await Promise.all(Array.from({ length: 128 }, () => encrypt(plaintext, key, identity)))
    expect(new Set(records.map((value) => value.nonce)).size).toBe(128)
    expect(random).toHaveBeenCalledTimes(128)
    expect(records.every((value) => value.ciphertext !== records[0]?.ciphertext || value === records[0])).toBe(true)
  })

  it('fails closed on repeated RNG output before a second encryption occurs', async () => {
    const key = await generateJournalKey()
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      if (array instanceof Uint8Array) array.fill(203)
      return array
    })
    const encryptSpy = vi.spyOn(crypto.subtle, 'encrypt')
    await encrypt(plaintext, key, identity)
    await expect(encrypt(plaintext, key, identity)).rejects.toMatchObject({ code: 'NONCE_REUSE' })
    expect(encryptSpy).toHaveBeenCalledTimes(1)
  })

  it('clears its owned plaintext copy and returns safe errors on engine failure', async () => {
    const key = await generateJournalKey()
    let temporary: Uint8Array | undefined
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementation((_algorithm, _key, bytes) => {
      temporary = bytes as Uint8Array
      return Promise.reject(new Error('Synthetic secret must not escape'))
    })
    await expect(encrypt(plaintext, key, identity)).rejects.toMatchObject({ code: 'ENCRYPTION_FAILED', message: 'Encryption could not be completed.' })
    expect(temporary?.every((byte) => byte === 0)).toBe(true)
    expect(new TextDecoder().decode(plaintext)).toContain('Synthetic title')
  })

  it('preserves caller data if mutated immediately after the call', async () => {
    const key = await generateJournalKey()
    const caller = plaintext.slice()
    const pending = encrypt(caller, key, identity)
    caller.fill(0)
    expect(await decrypt(await pending, key, identity)).toEqual(plaintext)
  })

  it('round trips complete encrypted envelopes through the independent codec', async () => {
    const key = await generateJournalKey()
    const envelope = await encrypt(plaintext, key, identity)
    const bytes = envelopeToBytes(envelope)
    expect(Array.from(bytes.subarray(0, 2))).toEqual([1, 1])
    const decoded = envelopeFromBytes(decode(encode(bytes)))
    expect(decoded).toEqual(envelope)
    expect(await decrypt(decoded, key, identity)).toEqual(plaintext)
  })

  it('fails safely when secure browser cryptography is unavailable', async () => {
    vi.stubGlobal('crypto', undefined)
    await expect(generateJournalKey()).rejects.toMatchObject({ code: 'CRYPTO_UNAVAILABLE' })
  })

  it('returns safe errors if secure randomness or key generation fails', async () => {
    const key = await generateJournalKey()
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(() => { throw new Error('Synthetic private error') })
    await expect(encrypt(plaintext, key, identity)).rejects.toMatchObject({ code: 'ENCRYPTION_FAILED', message: 'Encryption could not be completed.' })
    vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValue(new Error('Synthetic private error'))
    await expect(generateJournalKey()).rejects.toMatchObject({ code: 'ENCRYPTION_FAILED', message: 'Encryption could not be completed.' })
  })

  it('rejects non-AES-256 keys and excessive plaintext sizes', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, true, ['encrypt', 'decrypt'])
    await expect(encrypt(plaintext, key, identity)).rejects.toMatchObject({ code: 'INVALID_KEY' })
    await expect(encrypt(new Uint8Array(MAX_PLAINTEXT_BYTES + 1), await generateJournalKey(), identity)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(new JournalCryptoError('INVALID_INPUT').message).toBe('Invalid cryptographic input.')
  })
})
