// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { decrypt, encrypt, generateJournalKey, generateRecoveryKey, unwrapWithPassphrase, unwrapWithRecoveryKey, wrapWithPassphrase, wrapWithRecoveryKey } from '../../../src/core/crypto'

it('never calls logging, persistence, network, or raw-key export APIs', async () => {
  const spies = ['log', 'info', 'debug', 'warn', 'error', 'trace', 'table'].map((method) =>
    vi.spyOn(console, method as 'log'))
  const exportSpy = vi.spyOn(crypto.subtle, 'exportKey')
  const forbidden = vi.fn(() => { throw new Error('Unexpected persistence or network access') })
  vi.stubGlobal('localStorage', { setItem: forbidden })
  vi.stubGlobal('sessionStorage', { setItem: forbidden })
  vi.stubGlobal('indexedDB', { open: forbidden, deleteDatabase: forbidden })
  vi.stubGlobal('fetch', forbidden)
  vi.stubGlobal('XMLHttpRequest', forbidden)
  try {
    const identity = { journalId: '11111111-1111-4111-8111-111111111111', entryId: '22222222-2222-4222-8222-222222222222', revisionId: '33333333-3333-4333-8333-333333333333', schemaVersion: 1 as const }
    const passphrase = 'Synthetic privacy test passphrase'
    const plaintext = new TextEncoder().encode('Synthetic title and body for privacy testing')
    const key = await generateJournalKey()
    const envelope = await encrypt(plaintext, key, identity)
    const recovery = generateRecoveryKey()
    const pass = await wrapWithPassphrase(key, passphrase, identity.journalId)
    const rec = await wrapWithRecoveryKey(key, recovery, identity.journalId)
    expect(await decrypt(envelope, await unwrapWithPassphrase(pass, passphrase, identity.journalId), identity)).toEqual(plaintext)
    expect(await decrypt(envelope, await unwrapWithRecoveryKey(rec, recovery, identity.journalId), identity)).toEqual(plaintext)
    await expect(unwrapWithPassphrase(pass, 'wrong synthetic credential', identity.journalId)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    const serialized = JSON.stringify({ envelope, pass, rec })
    expect(serialized.includes(passphrase)).toBe(false)
    expect(serialized.includes(recovery)).toBe(false)
    expect(serialized.includes(new TextDecoder().decode(plaintext))).toBe(false)
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    expect(forbidden).not.toHaveBeenCalled()
    expect(exportSpy).not.toHaveBeenCalled()
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})
