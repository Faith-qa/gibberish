// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { decrypt, envelopeFromBytes, generateJournalKey, validateEnvelope, validateWrappedKey } from '../../../src/core/crypto'
import { fromBase64url, toBase64url } from '../../../src/core/crypto/encoding'
import { validateIdentity } from '../../../src/core/crypto/validation'

const envelope = { version: 1, algorithm: 'AES-256-GCM', nonce: toBase64url(new Uint8Array(12)), ciphertext: toBase64url(new Uint8Array(16)) }
const context = { journalId: '11111111-1111-4111-8111-111111111111', entryId: '22222222-2222-4222-8222-222222222222', revisionId: '33333333-3333-4333-8333-333333333333', schemaVersion: 1 as const }

describe('untrusted cryptographic inputs', () => {
  it.each([null, undefined, [], {}, { ...envelope, version: 2 }, { ...envelope, algorithm: 'AES-CBC' },
    { ...envelope, nonce: 'AA' }, { ...envelope, nonce: '='.repeat(16) }, { ...envelope, nonce: 'A'.repeat(15) + '+' },
    { ...envelope, ciphertext: '' }, { ...envelope, ciphertext: 'A'.repeat(21) },
    { ...envelope, ciphertext: 'A'.repeat(21) + 'B' }, { ...envelope, ciphertext: envelope.ciphertext + '==' },
    { ...envelope, plaintext: 'Synthetic sensitive field' }, Object.create(envelope),
  ])('rejects malformed or unsupported envelope %j', (input) => {
    expect(() => validateEnvelope(input)).toThrow()
  })

  it('rejects invalid envelopes before invoking authenticated decryption', async () => {
    const key = await generateJournalKey()
    const spy = vi.spyOn(crypto.subtle, 'decrypt')
    try {
      await expect(decrypt({ ...envelope, nonce: 'bad' }, key, context)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
      expect(spy).not.toHaveBeenCalled()
    } finally { spy.mockRestore() }
  })

  it.each([null, {}, { ...context, journalId: 'not-an-id' }, { ...context, entryId: '' },
    { ...context, revisionId: '../record' }, { ...context, schemaVersion: 2 }, { ...context, extra: 'untrusted' },
  ])('rejects invalid revision identity %j', (input) => expect(() => validateIdentity(input)).toThrow())

  it.each(['A', 'AA=', 'AA==', 'AB', '+A', '/A', ' A', 'AA\n', 'éé', 0, null])('rejects noncanonical Base64url %j', (value) => {
    expect(() => fromBase64url(value, 1, 2)).toThrow()
  })

  it('round trips arbitrary binary Base64url encodings including offset views', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
    for (const length of [0, 1, 2, 3, 255, 256]) {
      const view = bytes.subarray(0, length)
      expect(fromBase64url(toBase64url(view), length, length)).toEqual(view)
    }
  })

  it('rejects malformed, truncated and unknown binary envelopes', () => {
    expect(() => envelopeFromBytes(new Uint8Array(29))).toThrow()
    expect(() => envelopeFromBytes(new Uint8Array(30).fill(3))).toThrow('Unsupported cryptographic format version.')
    const bytes = new Uint8Array(30); bytes[0] = 1; bytes[1] = 2
    expect(() => envelopeFromBytes(bytes)).toThrow('Invalid cryptographic input.')
  })

  it('only accepts the documented bounded KDF profiles', () => {
    const wrapped = { version: 1, purpose: 'passphrase', algorithm: 'AES-256-GCM', nonce: envelope.nonce,
      wrappedKey: toBase64url(new Uint8Array(48)), kdf: { name: 'argon2id', salt: toBase64url(new Uint8Array(16)),
        parameters: { version: 19, memoryKiB: 65536, iterations: 3, parallelism: 1, hashLength: 32 } } }
    expect(validateWrappedKey(wrapped, 'passphrase')).toEqual(wrapped)
    for (const [field, values] of Object.entries({ memoryKiB: [1, Infinity, 1e12], iterations: [0, -1, 1e12, NaN], version: [16], parallelism: [0, 4], hashLength: [16] })) {
      for (const value of values) expect(() => validateWrappedKey({ ...wrapped, kdf: { ...wrapped.kdf,
        parameters: { ...wrapped.kdf.parameters, [field]: value } } }, 'passphrase')).toThrow()
    }
    expect(() => validateWrappedKey({ ...wrapped, version: 2 }, 'passphrase')).toThrow()
    expect(() => validateWrappedKey({ ...wrapped, wrappedKey: 'AA' }, 'passphrase')).toThrow()
    expect(() => validateWrappedKey({ ...wrapped, kdf: { ...wrapped.kdf, salt: 'AA' } }, 'passphrase')).toThrow()
    expect(() => validateWrappedKey({ ...wrapped, kdf: { ...wrapped.kdf, name: 'pbkdf2' } }, 'passphrase')).toThrow()
    expect(() => validateWrappedKey(wrapped, 'recovery')).toThrow()
  })
})
