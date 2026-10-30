// @vitest-environment node
import { createCipheriv, hkdfSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decrypt, encrypt, generateJournalKey, generateRecoveryKey, unwrapWithPassphrase, unwrapWithRecoveryKey, wrapWithPassphrase, wrapWithRecoveryKey } from '../../../src/core/crypto'
import { passphraseKek } from '../../../src/core/crypto/argon2'
import { toBase64url } from '../../../src/core/crypto/encoding'

const context = { journalId: '11111111-1111-4111-8111-111111111111', entryId: '22222222-2222-4222-8222-222222222222', revisionId: '33333333-3333-4333-8333-333333333333', schemaVersion: 1 as const }
const phrase = 'Synthetic testing passphrase 🌱'
const content = new TextEncoder().encode('Synthetic plaintext — never real journal data')
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('independent key wrapping', () => {
  it('wraps and unwraps the JEK using Argon2id without returning credentials', async () => {
    const key = await generateJournalKey()
    const saved = await encrypt(content, key, context)
    const wrapped = await wrapWithPassphrase(key, phrase, context.journalId)
    expect(wrapped.kdf).toMatchObject({ name: 'argon2id', parameters: { version: 19, memoryKiB: 65536, iterations: 3, parallelism: 1, hashLength: 32 } })
    expect(JSON.stringify(wrapped)).not.toContain(phrase)
    const restored = await unwrapWithPassphrase(wrapped, phrase, context.journalId)
    expect(await decrypt(saved, restored, context)).toEqual(content)
    await expect(unwrapWithPassphrase(wrapped, 'Wrong synthetic passphrase', context.journalId)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
  })

  it('matches a fixed Argon2id key-derivation vector from native Node/OpenSSL Argon2', async () => {
    // Generated independently with node:crypto.argon2Sync; not a production key.
    const derivedHex = '50eae797f0ec0b861402877f00f09f6c1736bcef4c4fdae6256eb1b3ef5c005c'
    const kek = await passphraseKek('synthetic passphrase for vectors', new TextEncoder().encode('0123456789abcdef'))
    expect(kek.extractable).toBe(false)
    const rawKey = new Uint8Array(32).fill(17)
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', true, ['encrypt', 'decrypt'])
    const nonce = new Uint8Array(12).fill(31)
    const aad = new TextEncoder().encode('Synthetic KDF vector')
    const wrapped = new Uint8Array(await crypto.subtle.wrapKey('raw', key, kek, { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 }))
    const native = createCipheriv('aes-256-gcm', Buffer.from(derivedHex, 'hex'), nonce)
    native.setAAD(aad)
    expect(wrapped).toEqual(new Uint8Array(Buffer.concat([native.update(rawKey), native.final(), native.getAuthTag()])))
  })

  it('creates different salts and nonces when wrapping the same key twice', async () => {
    const key = await generateJournalKey()
    const a = await wrapWithPassphrase(key, phrase, context.journalId)
    const b = await wrapWithPassphrase(key, phrase, context.journalId)
    expect(a.kdf.salt).not.toBe(b.kdf.salt)
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.wrappedKey).not.toBe(b.wrappedKey)
  })

  it('generates independent 256-bit recovery material using browser randomness', () => {
    const random = vi.spyOn(crypto, 'getRandomValues')
    const recovery = Array.from({ length: 32 }, generateRecoveryKey)
    expect(new Set(recovery).size).toBe(32)
    expect(recovery.every((value) => /^gbr1\.[A-Za-z0-9_-]{43}$/.test(value))).toBe(true)
    expect(recovery.every((value) => Buffer.from(value.slice(5), 'base64url').length === 32)).toBe(true)
    expect(random).toHaveBeenCalledTimes(32)
  })

  it('recovers the same JEK without the passphrase and allows independent rewrapping', async () => {
    const key = await generateJournalKey()
    const saved = await encrypt(content, key, context)
    const recovery = generateRecoveryKey()
    const wrapped = await wrapWithRecoveryKey(key, recovery, context.journalId)
    expect(JSON.stringify(wrapped)).not.toContain(recovery)
    const restored = await unwrapWithRecoveryKey(wrapped, recovery, context.journalId)
    expect(await decrypt(saved, restored, context)).toEqual(content)
    const newWrapped = await wrapWithPassphrase(restored, 'New synthetic passphrase', context.journalId)
    expect(await decrypt(saved, await unwrapWithPassphrase(newWrapped, 'New synthetic passphrase', context.journalId), context)).toEqual(content)
    await expect(unwrapWithPassphrase(newWrapped, phrase, context.journalId)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    await expect(unwrapWithRecoveryKey(wrapped, generateRecoveryKey(), context.journalId)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
  })

  it('matches native HKDF-SHA256 and AES-GCM for a synthetic recovery vector', async () => {
    const key = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(23), 'AES-GCM', true, ['encrypt', 'decrypt'])
    const recovery = `gbr1.${toBase64url(new Uint8Array(32).fill(7))}`
    const wrapped = await wrapWithRecoveryKey(key, recovery, context.journalId)
    const rawKek = hkdfSync('sha256', new Uint8Array(32).fill(7), Buffer.from(wrapped.kdf.salt, 'base64url'),
      Buffer.from(JSON.stringify(['gibberish-recovery-kek', 1, context.journalId])), 32)
    const native = createCipheriv('aes-256-gcm', Buffer.from(rawKek), Buffer.from(wrapped.nonce, 'base64url'))
    native.setAAD(Buffer.from(JSON.stringify(['gibberish-key-wrap', 1, context.journalId, 'recovery', 'AES-256-GCM', 'hkdf-sha256', wrapped.kdf.salt, [32]])))
    expect(Buffer.concat([native.update(new Uint8Array(32).fill(23)), native.final(), native.getAuthTag()]).toString('base64url')).toBe(wrapped.wrappedKey)
  })

  it.each(['passphrase', 'recovery'] as const)('rejects tampered %s wrappers and journal substitution', async (purpose) => {
    const key = await generateJournalKey()
    const credential = purpose === 'passphrase' ? phrase : generateRecoveryKey()
    const wrap = purpose === 'passphrase' ? wrapWithPassphrase : wrapWithRecoveryKey
    const unwrap = purpose === 'passphrase' ? unwrapWithPassphrase : unwrapWithRecoveryKey
    const record = await wrap(key, credential, context.journalId)
    for (const field of ['nonce', 'wrappedKey'] as const) {
      const damaged = Buffer.from(record[field], 'base64url'); damaged[0] = (damaged[0] ?? 0) ^ 1
      await expect(unwrap({ ...record, [field]: damaged.toString('base64url') }, credential, context.journalId)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    }
    const salt = Buffer.from(record.kdf.salt, 'base64url'); salt[0] = (salt[0] ?? 0) ^ 1
    await expect(unwrap({ ...record, kdf: { ...record.kdf, salt: salt.toString('base64url') } }, credential, context.journalId)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    await expect(unwrap(record, credential, '44444444-4444-4444-8444-444444444444')).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
  })

  it.each(['', ' ', 'gbr2.' + 'A'.repeat(43), 'gbr1.' + 'A'.repeat(42), 'gbr1.' + 'A'.repeat(42) + 'B'])('rejects invalid recovery format %j', async (value) => {
    await expect(wrapWithRecoveryKey(await generateJournalKey(), value, context.journalId)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it.each(['', 'a'.repeat(1025), '\ud800'])('rejects unsupported passphrase encoding/size', async (value) => {
    await expect(wrapWithPassphrase(await generateJournalKey(), value, context.journalId)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})
