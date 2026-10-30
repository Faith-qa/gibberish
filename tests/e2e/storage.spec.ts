import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium, firefox, webkit, expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import type { Harness } from '../browser/m2'

const phrase = 'Synthetic M2 browser passphrase'
const content = { title: 'Synthetic browser private title 🌱', body: 'Synthetic browser private body' }

async function routeHarness(context: BrowserContext) {
  await context.route('**/__m2/**', async (route) => {
    const name = basename(new URL(route.request().url()).pathname)
    if (!name.endsWith('.js')) { await route.abort(); return }
    await route.fulfill({ contentType: 'text/javascript', body: await readFile(resolve('reports/M2/browser', name)) })
  })
}
async function load(page: Page) {
  await page.goto('http://127.0.0.1:4173/')
  await page.addScriptTag({ type: 'module', url: '/__m2/m2-harness.js' })
  await page.waitForFunction(() => '__m2' in globalThis)
}

test('M2 encrypted IndexedDB survives reload and rebuilds caches only after unlock', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await routeHarness(context); await load(page)
  const name = `synthetic-m2-reload-${crypto.randomUUID()}`
  const result = await page.evaluate(async ({ name, phrase, content }) => {
    const h = (globalThis as unknown as { __m2: Harness }).__m2
    const initialized = await h.initialize(name, phrase)
    const root = await h.create(content)
    const plan = await h.prepareEdit(root.entryId, root.revisionId, { ...content, body: 'Synthetic browser edited body' })
    await h.commit(plan)
    await h.corruptProjection(root.entryId)
    const raw = JSON.stringify(await h.raw())
    const containsSecrets = [phrase, content.title, content.body, 'Synthetic browser edited body'].some((value) => raw.includes(value))
    const correctBeforeRebuild = (await h.list())[0]?.status === 'active'
    h.close()
    return { ...initialized, root, plan, containsSecrets, correctBeforeRebuild }
  }, { name, phrase, content })
  expect(result.recoveryNotPersisted).toBe(true)
  expect(result.containsSecrets).toBe(false)
  expect(result.correctBeforeRebuild).toBe(true)
  await page.reload()
  await page.addScriptTag({ type: 'module', url: '/__m2/m2-harness.js' })
  await page.waitForFunction(() => '__m2' in globalThis)
  const recovered = await page.evaluate(async ({ name, journalId, phrase, entryId, plan }) => {
    const h = (globalThis as unknown as { __m2: Harness }).__m2
    let lockedCode = ''
    try { await h.list() } catch (error) { lockedCode = (error as { code: string }).code }
    await h.unlock(name, journalId, phrase)
    await h.rebuild()
    const value = await h.read(entryId)
    const receipt = await h.inspect(plan)
    const raw = await h.raw()
    return { lockedCode, value, receipt, raw, local: localStorage.length, session: sessionStorage.length }
  }, { name, journalId: result.journalId, phrase, entryId: result.root.entryId, plan: result.plan })
  expect(recovered.lockedCode).toBe('LOCKED')
  expect(recovered.value.payload).toEqual({ ...content, body: 'Synthetic browser edited body' })
  expect(recovered.receipt?.outcome).toBe('already-committed')
  expect(recovered.raw.journal_revisions).toHaveLength(2)
  expect(recovered.raw.sync_queue).toEqual([])
  expect(recovered.local).toBe(0); expect(recovered.session).toBe(0)
  expect(errors).toEqual([])
  await expect(page.getByRole('textbox')).toHaveCount(0)
})

test('M2 separate tabs preserve concurrent edits and explicit branches', async ({ page, context }) => {
  await routeHarness(context); await load(page)
  const name = `synthetic-m2-tabs-${crypto.randomUUID()}`
  const first = await page.evaluate(async ({ name, phrase, content }) => {
    const h = (globalThis as unknown as { __m2: Harness }).__m2
    return { ...await h.initialize(name, phrase), root: await h.create(content) }
  }, { name, phrase, content })
  const other = await context.newPage(); await load(other)
  await other.evaluate(async ({ name, phrase, journalId }) => {
    await (globalThis as unknown as { __m2: Harness }).__m2.unlock(name, journalId, phrase)
  }, { name, phrase, journalId: first.journalId })
  const prepare = { entryId: first.root.entryId, revisionId: first.root.revisionId }
  const plans = await Promise.all([page, other].map((tab, index) => tab.evaluate(async ({ entryId, revisionId, index, content }) => {
    return (globalThis as unknown as { __m2: Harness }).__m2.prepareEdit(entryId, revisionId, { ...content, body: `Synthetic branch ${index}` })
  }, { ...prepare, index, content })))
  await Promise.all([page, other].map((tab, index) => tab.evaluate(async (plan) => {
    return (globalThis as unknown as { __m2: Harness }).__m2.commit(plan!)
  }, plans[index])))
  const result = await page.evaluate(async (entryId) => {
    const h = (globalThis as unknown as { __m2: Harness }).__m2
    let code = ''
    try { await h.read(entryId) } catch (error) { code = (error as { code: string }).code }
    return { entries: await h.list(), raw: await h.raw(), code }
  }, first.root.entryId)
  expect(result.code).toBe('CONFLICT')
  expect(result.entries[0]).toMatchObject({ status: 'conflicted', headRevisionIds: plans.map((p) => p.revision.revisionId).sort() })
  expect(result.raw.journal_revisions).toHaveLength(3)
  expect(result.raw.sync_conflicts).toHaveLength(1)
})

test('M2 storage failures stay unsaved and offline domain operations need no network', async ({ page, context }) => {
  await routeHarness(context); await load(page)
  const name = `synthetic-m2-offline-${crypto.randomUUID()}`
  const setup = await page.evaluate(async ({ name, phrase, content }) => {
    const h = (globalThis as unknown as { __m2: Harness }).__m2
    const initialized = await h.initialize(name, phrase)
    const root = await h.create(content)
    const plan = await h.prepareEdit(root.entryId, root.revisionId, { ...content, body: 'Synthetic offline edit' })
    h.closeStorage()
    let code = ''
    try { await h.commit(plan) } catch (error) { code = (error as { code: string }).code }
    h.close()
    return { ...initialized, root, plan, code }
  }, { name, phrase, content })
  expect(setup.code).toBe('COMMIT_UNCERTAIN')
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await context.setOffline(true)
  const recovered = await page.evaluate(async ({ name, phrase, journalId, plan }) => {
    const h = (globalThis as unknown as { __m2: Harness }).__m2
    await h.unlock(name, journalId, phrase)
    const absent = await h.inspect(plan)
    const committed = await h.commit(plan)
    return { absent, committed, value: await h.read(plan.revision.entryId), raw: await h.raw() }
  }, { name, phrase, journalId: setup.journalId, plan: setup.plan })
  expect(recovered.absent).toBeNull()
  expect(recovered.committed.outcome).toBe('committed')
  expect(recovered.value.payload.body).toBe('Synthetic offline edit')
  expect(recovered.raw.journal_revisions).toHaveLength(2)
  expect(requests).toEqual([])
})

test('M2 v2 metadata authentication and codec bytes work in the browser', async ({ page, context }) => {
  await routeHarness(context); await load(page)
  const result = await page.evaluate(async () => {
    const { crypto: api, codec } = (globalThis as unknown as { __m2: Harness }).__m2
    const ids = Array.from({ length: 3 }, () => crypto.randomUUID())
    const now = '2026-01-01T00:00:00.000Z'
    const metadata = { journalId: ids[0]!, entryId: ids[1]!, revisionId: ids[2]!, parentRevisionIds: [],
      status: 'active' as const, createdAt: now, updatedAt: now, deletedAt: null, schemaVersion: 1 as const }
    const key = await api.generateJournalKey()
    const bytes = new TextEncoder().encode('Synthetic v2 browser vector')
    const row = await api.encryptRevision(bytes, key, metadata)
    const envelope = api.envelopeFromBytes(codec.decode(codec.encode(api.envelopeToBytes(row.encryptedPayload))))
    const restored = await api.decryptRevision({ ...row, encryptedPayload: envelope }, key, { journalId: row.journalId, entryId: row.entryId })
    let failure = ''
    try { await api.decryptRevision({ ...row, revisionId: crypto.randomUUID() }, key, { journalId: row.journalId, entryId: row.entryId }) }
    catch (error) { failure = (error as { code: string }).code }
    return { text: new TextDecoder().decode(restored), version: envelope.version, failure }
  })
  expect(result).toEqual({ text: 'Synthetic v2 browser vector', version: 2, failure: 'AUTHENTICATION_FAILED' })
})

test('M2 ciphertext survives a full persistent-browser restart', async ({ browserName }) => {
  test.setTimeout(60_000)
  const directory = await mkdtemp(join(tmpdir(), 'gibberish-m2-profile-'))
  const engine = { chromium, firefox, webkit }[browserName]
  const name = `synthetic-m2-restart-${crypto.randomUUID()}`
  let persistent: BrowserContext | undefined
  try {
    persistent = await engine.launchPersistentContext(directory)
    await routeHarness(persistent)
    const page = await persistent.newPage(); await load(page)
    const saved = await page.evaluate(async ({ name, phrase, content }) => {
      const h = (globalThis as unknown as { __m2: Harness }).__m2
      return { ...await h.initialize(name, phrase), root: await h.create(content) }
    }, { name, phrase, content })
    // Closing this persistent context terminates its browser process. Reusing
    // the synthetic profile tests normal restart, not power-loss durability.
    await persistent.close(); persistent = undefined
    persistent = await engine.launchPersistentContext(directory)
    await routeHarness(persistent)
    const reopened = await persistent.newPage(); await load(reopened)
    const recovered = await reopened.evaluate(async ({ name, phrase, journalId, entryId }) => {
      const h = (globalThis as unknown as { __m2: Harness }).__m2
      await h.unlock(name, journalId, phrase)
      return { value: await h.read(entryId), entries: await h.list(), raw: await h.raw() }
    }, { name, phrase, journalId: saved.journalId, entryId: saved.root.entryId })
    expect(recovered.value.payload).toEqual(content)
    expect(recovered.entries).toHaveLength(1)
    expect(recovered.raw.journal_revisions).toHaveLength(1)
  } finally {
    await persistent?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
