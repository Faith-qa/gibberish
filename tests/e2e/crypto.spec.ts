import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { expect, test } from '@playwright/test'

type Harness = {
  crypto: typeof import('../../src/core/crypto')
  codec: typeof import('../../src/core/gibberish-codec')
}

test('M1 encryption, Argon2id and recovery work under the production CSP', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.route('**/__m1/**', async (route) => {
    const name = basename(new URL(route.request().url()).pathname)
    if (!name.endsWith('.js')) { await route.abort(); return }
    await route.fulfill({ contentType: 'text/javascript', body: await readFile(resolve('reports/M1/browser', name)) })
  })
  await page.goto('/')
  await page.addScriptTag({ type: 'module', url: '/__m1/m1-harness.js' })
  await page.waitForFunction(() => '__m1' in globalThis)
  const result = await page.evaluate(async () => {
    const { crypto: api, codec } = (globalThis as unknown as { __m1: Harness }).__m1
    const identity = { journalId: '11111111-1111-4111-8111-111111111111', entryId: '22222222-2222-4222-8222-222222222222', revisionId: '33333333-3333-4333-8333-333333333333', schemaVersion: 1 as const }
    const plaintext = new TextEncoder().encode('Synthetic browser title and body — 🌱')
    const key = await api.generateJournalKey()
    const envelope = await api.encrypt(plaintext, key, identity)
    const gibberish = codec.encode(api.envelopeToBytes(envelope))
    const decoded = api.envelopeFromBytes(codec.decode(gibberish))
    const start = performance.now()
    const wrapped = await api.wrapWithPassphrase(key, 'Synthetic browser passphrase', identity.journalId)
    const argon2Millis = performance.now() - start
    const restored = await api.unwrapWithPassphrase(wrapped, 'Synthetic browser passphrase', identity.journalId)
    const recovery = api.generateRecoveryKey()
    const recoveryRecord = await api.wrapWithRecoveryKey(key, recovery, identity.journalId)
    const recovered = await api.unwrapWithRecoveryKey(recoveryRecord, recovery, identity.journalId)
    const match = (bytes: Uint8Array) => bytes.length === plaintext.length && bytes.every((value, i) => value === plaintext[i])
    const rejected: string[] = []
    for (const operation of [
      () => api.unwrapWithPassphrase(wrapped, 'Wrong synthetic passphrase', identity.journalId),
      () => api.unwrapWithRecoveryKey(recoveryRecord, api.generateRecoveryKey(), identity.journalId),
      () => api.decrypt(decoded, key, { ...identity, revisionId: '44444444-4444-4444-8444-444444444444' }),
    ]) {
      try { await operation(); rejected.push('accepted invalid data') }
      catch (error) { rejected.push(error instanceof api.JournalCryptoError ? error.code : 'unexpected error') }
    }
    return {
      passphraseRoundTrip: match(await api.decrypt(decoded, restored, identity)),
      recoveryRoundTrip: match(await api.decrypt(decoded, recovered, identity)),
      rejected, argon2Millis: Math.round(argon2Millis),
      localStorageItems: localStorage.length, sessionStorageItems: sessionStorage.length,
      containsPlaintext: gibberish.includes('Synthetic'),
    }
  })
  expect(result.passphraseRoundTrip).toBe(true)
  expect(result.recoveryRoundTrip).toBe(true)
  expect(result.rejected).toEqual(['AUTHENTICATION_FAILED', 'AUTHENTICATION_FAILED', 'AUTHENTICATION_FAILED'])
  expect(result.localStorageItems).toBe(0)
  expect(result.sessionStorageItems).toBe(0)
  expect(result.containsPlaintext).toBe(false)
  expect(errors).toEqual([])
  console.log(`${testInfo.project.name}: synthetic Argon2id 64 MiB / 3 passes = ${result.argon2Millis} ms`)
  await expect(page.getByRole('textbox')).toHaveCount(0)
})
