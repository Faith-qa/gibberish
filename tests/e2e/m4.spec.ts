import { mkdir, readFile, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { chromium, firefox, webkit, devices, expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { SCHEMA_V1 } from '../../src/core/storage/database'
import type { Harness } from '../browser/m4'

const phrase = 'Synthetic M4 browser qualification phrase'
const body = 'Synthetic M4 private body — <script>literal text</script> ``` 🌱'
const title = 'Synthetic M4 private title'
type Stores = Record<string, unknown[]>
async function stores(page: Page): Promise<Stores> {
  return page.evaluate(() => new Promise<Stores>((resolve, reject) => {
    const r = indexedDB.open('gibberish-db'); r.onerror = () => reject(new Error('Synthetic read failed'))
    r.onsuccess = () => {
      const db = r.result, names = Array.from(db.objectStoreNames), tx = db.transaction(names)
      Promise.all(names.map((name) => new Promise<[string, unknown[]]>((done) => {
        const q = tx.objectStore(name).getAll(); q.onsuccess = () => done([name, q.result as unknown[]])
      }))).then((rows) => { db.close(); resolve(Object.fromEntries(rows)) }, reject)
    }
  }))
}
async function onboard(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByLabel('Passphrase', { exact: true }).fill(phrase); await page.getByLabel('Confirm passphrase').fill(phrase)
  await page.getByRole('button', { name: 'Prepare recovery key' }).click()
  const recovery = (await page.getByTestId('recovery-key').textContent())!
  await page.getByRole('button', { name: 'I saved the key — continue' }).click()
  await page.getByLabel('Full recovery key').fill(recovery); await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Confirm key and create journal' }).click()
  await expect(page.getByRole('button', { name: 'New entry', exact: true })).toBeVisible()
  return recovery
}
async function write(page: Page) {
  await page.getByRole('button', { name: 'New entry', exact: true }).click()
  await page.getByLabel('Title', { exact: true }).fill(title); await page.getByLabel('Body', { exact: true }).fill(body)
  await page.getByRole('button', { name: 'Save entry locally' }).click()
  await expect(page.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible()
}
async function unlock(page: Page, credential = phrase) {
  await page.getByLabel('Passphrase', { exact: true }).fill(credential)
  await page.getByRole('button', { name: 'Unlock journal', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible()
}
async function confirm(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click()
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await dialog.getByRole('button', { name, exact: true }).click()
}
async function exportFile(page: Page, readable = false) {
  await page.getByRole('button', { name: 'Journal tools', exact: true }).click()
  await page.getByRole('button', { name: 'Export journal', exact: true }).click()
  if (readable) await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: readable ? 'Generate readable Markdown' : 'Generate encrypted backup', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your file is ready', exact: true })).toBeVisible()
  const promise = page.waitForEvent('download')
  await page.getByRole('button', { name: readable ? 'Download readable Markdown' : 'Download encrypted backup', exact: true }).click()
  const download = await promise
  expect(download.suggestedFilename()).toBe(readable ? 'gibberish-readable.md' : 'gibberish-backup.json')
  expect(await download.failure()).toBeNull()
  const path = await download.path(); expect(path).not.toBeNull()
  return readFile(path!)
}
async function restore(page: Page, bytes: Buffer, credential: string, recovery = false) {
  await page.goto('/'); await page.getByRole('button', { name: 'Restore encrypted backup', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'synthetic-secret-filename.json', mimeType: 'application/json', buffer: bytes })
  await page.getByRole('button', { name: 'Continue with selected backup' }).click()
  expect(await page.locator('body').textContent()).not.toContain('synthetic-secret-filename')
  if (recovery) await page.getByRole('button', { name: 'Use backup recovery key instead' }).click()
  await page.getByLabel(recovery ? 'Backup recovery key' : 'Backup passphrase', { exact: true }).fill(credential)
  await page.getByRole('button', { name: 'Verify encrypted backup' }).click()
  await expect(page.getByRole('heading', { name: 'Authenticated backup summary' })).toBeVisible()
  if (recovery) {
    const replacement = 'Synthetic recovered M4 restore phrase'
    await page.getByLabel('New passphrase', { exact: true }).fill(replacement)
    await page.getByLabel('Confirm passphrase').fill(replacement)
    await page.getByRole('button', { name: 'Prepare restoration passphrase' }).click()
    await expect(page.getByRole('button', { name: 'Confirm encrypted restoration' })).toBeVisible()
  }
  await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Confirm encrypted restoration' }).click()
  await expect(page.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible()
}
async function routeM4(context: BrowserContext) {
  await context.route('**/__m4/**', async (route) => {
    const name = basename(new URL(route.request().url()).pathname)
    if (!name.endsWith('.js')) { await route.abort(); return }
    await route.fulfill({ contentType: 'text/javascript', body: await readFile(resolve('reports/M4/browser', name)) })
  })
}

test('M4 encrypted Trash, restore, confirmed permanent deletion offline and locked reload', async ({ page, context }, info) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message))
  await onboard(page); await write(page)
  await context.setOffline(true)
  const before = await stores(page)
  await page.getByRole('button', { name: 'Open encrypted entry' }).click()
  await page.getByRole('button', { name: 'Move to Trash', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Move to Trash', exact: true })).toBeFocused()
  await confirm(page, 'Move to Trash')
  await expect(page.getByRole('button', { name: 'Open encrypted entry' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Open Trash', exact: true }).click()
  await page.getByRole('button', { name: 'Open encrypted entry' }).click()
  expect(await page.locator('body').textContent()).not.toContain(body)
  await page.getByRole('button', { name: 'Reveal My Thoughts' }).click()
  await expect(page.getByRole('region', { name: 'Revealed entry' })).toContainText(body)
  await confirm(page, 'Restore entry')
  await expect(page.getByRole('heading', { name: 'Encrypted Trash', exact: true })).toBeVisible()
  expect(await page.locator('body').textContent()).not.toContain(body)
  await page.getByRole('button', { name: 'Back to journal', exact: true }).click()
  await page.getByRole('button', { name: 'Open encrypted entry' }).click(); await confirm(page, 'Move to Trash')
  await page.getByRole('button', { name: 'Open Trash', exact: true }).click()
  await page.getByRole('button', { name: 'Open encrypted entry' }).click()
  await expect(page.getByRole('heading', { name: 'Encrypted entry in Gibberish', exact: true })).toBeVisible()
  await mkdir('reports/M4/screens', { recursive: true })
  await page.screenshot({ path: resolve('reports/M4/screens', `${info.project.name}-trash.png`), fullPage: true })
  await confirm(page, 'Permanently delete locally')
  await expect(page.getByRole('status')).toContainText('Permanently deleted locally')
  const raw = await stores(page)
  expect(raw.journal_revisions).toHaveLength(0); expect(raw.journal_entries).toHaveLength(0); expect(raw.journal_tombstones).toHaveLength(1)
  expect(raw.sync_queue).toEqual([]); expect(raw.journal_keys).toEqual(before.journal_keys)
  expect(JSON.stringify(raw)).not.toContain(title); expect(JSON.stringify(raw)).not.toContain(body)
  await context.setOffline(false) // Only the already-loaded offline workflow is qualified.
  await page.reload(); await expect(page.getByRole('heading', { name: 'Unlock your journal', exact: true })).toBeVisible()
  expect(await page.locator('time,li').count()).toBe(0)
  await unlock(page); await expect(page.getByRole('button', { name: 'Open encrypted entry' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('M4 native encrypted backup and explicit readable download work offline in the loaded app', async ({ page, context, browser }, info) => {
  const recovery = await onboard(page); await write(page)
  const external: string[] = []; page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1:4173')) external.push(r.url()) })
  await context.setOffline(true)
  const bytes = await exportFile(page)
  const raw = JSON.parse(bytes.toString()) as { version: number; authentication: { tag: string }; revisions: unknown[] }
  expect(raw.version).toBe(2); expect(raw.revisions).toHaveLength(1); expect(raw.authentication.tag).toHaveLength(22)
  for (const value of [phrase, recovery, title, body]) expect(bytes.toString()).not.toContain(value)
  await page.getByRole('button', { name: 'Back to journal', exact: true }).click()
  const readable = await exportFile(page, true)
  expect(readable.toString()).toContain(body); expect(readable.toString()).toContain(title)
  expect(readable.toString()).not.toContain(phrase); expect(readable.toString()).not.toContain(recovery)
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
  expect(external).toEqual([])
  // A completely separate context supplies the empty target, including offline
  // recovery authentication after the application/worker have already loaded.
  const emulation = info.project.name === 'mobile-chromium' ? devices['Pixel 7'] : info.project.name === 'mobile-webkit' ? devices['iPhone 13'] : {}
  const target = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', ...emulation })
  try {
    const restored = await target.newPage(); await restored.goto('/')
    await expect(restored.getByRole('button', { name: 'Get started' })).toBeVisible()
    await target.setOffline(true)
    // No cold launch claim: restore helper normally navigates, so keep this page loaded.
    await restored.getByRole('button', { name: 'Restore encrypted backup', exact: true }).click()
    await restored.locator('input[type=file]').setInputFiles({ name: 'gibberish-backup.json', mimeType: 'application/json', buffer: bytes })
    await restored.getByRole('button', { name: 'Continue with selected backup' }).click()
    await restored.getByRole('button', { name: 'Use backup recovery key instead' }).click()
    await restored.getByLabel('Backup recovery key').fill(recovery)
    await restored.getByRole('button', { name: 'Verify encrypted backup' }).click()
    await expect(restored.getByRole('heading', { name: 'Authenticated backup summary' })).toBeVisible()
    const replacement = 'Synthetic offline recovered restore phrase'
    await restored.getByLabel('New passphrase', { exact: true }).fill(replacement); await restored.getByLabel('Confirm passphrase').fill(replacement)
    await restored.getByRole('button', { name: 'Prepare restoration passphrase' }).click()
    await restored.getByRole('checkbox').check(); await restored.getByRole('button', { name: 'Confirm encrypted restoration' }).click()
    await expect(restored.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible()
    await restored.getByRole('button', { name: 'Open encrypted entry' }).click(); await restored.getByRole('button', { name: 'Reveal My Thoughts' }).click()
    await expect(restored.getByRole('region', { name: 'Revealed entry' })).toContainText(body)
  } finally { await target.close() }
})

test('M4 backup portability across browser engines and wrong/corrupt backup rejection', async ({ page, browserName }) => {
  test.setTimeout(90_000)
  const recovery = await onboard(page); await write(page); const bytes = await exportFile(page)
  const next = { chromium: firefox, firefox: webkit, webkit: chromium }[browserName]
  const engine = await next.launch(); const context = await engine.newContext({ baseURL: 'http://127.0.0.1:4173' })
  try {
    const target = await context.newPage()
    await restore(target, bytes, browserName === 'firefox' ? recovery : phrase, browserName === 'firefox')
    await target.getByRole('button', { name: 'Open encrypted entry' }).click(); await target.getByRole('button', { name: 'Reveal My Thoughts' }).click()
    await expect(target.getByRole('region', { name: 'Revealed entry' })).toContainText(body)
    const empty = await engine.newContext({ baseURL: 'http://127.0.0.1:4173' })
    try {
      const rejected = await empty.newPage(); await rejected.goto('/')
      await rejected.getByRole('button', { name: 'Restore encrypted backup', exact: true }).click()
      const corrupted = JSON.parse(bytes.toString()) as { revisions: unknown[] }; corrupted.revisions = []
      await rejected.locator('input[type=file]').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(corrupted)) })
      await rejected.getByRole('button', { name: 'Continue with selected backup' }).click()
      await rejected.getByLabel('Backup passphrase').fill(phrase); await rejected.getByRole('button', { name: 'Verify encrypted backup' }).click()
      await expect(rejected.getByRole('alert')).toBeVisible()
      const data = await stores(rejected); for (const rows of Object.values(data)) expect(rows).toEqual([])
    } finally { await empty.close() }
  } finally { await context.close(); await engine.close() }
})

test('M4 current-passphrase reauthentication changes only the wrapper offline', async ({ page, context }) => {
  await onboard(page); await write(page); const before = await stores(page)
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Journal tools', exact: true }).click(); await page.getByRole('button', { name: 'Change passphrase', exact: true }).click()
  const replacement = 'Synthetic replacement M4 change phrase'
  await page.getByLabel('Current passphrase', { exact: true }).fill('Wrong synthetic phrase')
  await page.getByLabel('New passphrase', { exact: true }).fill(replacement); await page.getByLabel('Confirm new passphrase').fill(replacement)
  await page.getByRole('button', { name: 'Change passphrase locally' }).click()
  await expect(page.getByRole('heading', { name: 'Unlock your journal', exact: true })).toBeVisible()
  expect((await stores(page)).journal_keys).toEqual(before.journal_keys)
  await unlock(page)
  await page.getByRole('button', { name: 'Journal tools', exact: true }).click(); await page.getByRole('button', { name: 'Change passphrase', exact: true }).click()
  await page.getByLabel('Current passphrase', { exact: true }).fill(phrase)
  await page.getByLabel('New passphrase', { exact: true }).fill(replacement); await page.getByLabel('Confirm new passphrase').fill(replacement)
  await page.getByRole('button', { name: 'Change passphrase locally' }).click()
  await expect(page.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible()
  const after = await stores(page); expect(after.journal_revisions).toEqual(before.journal_revisions)
  const key = (data: Stores) => (data.journal_keys![0] as { recoveryWrappedKey: unknown }).recoveryWrappedKey
  expect(key(after)).toEqual(key(before))
  await context.setOffline(false)
  await page.reload(); await unlock(page, replacement)
})

test('M4 migrates actual M3 bytes in native IndexedDB without reinterpretation', async ({ page, context }, info) => {
  const fixture = JSON.parse(await readFile('tests/fixtures/m3-journal.json', 'utf8')) as { stores: Stores; passphrase: string }
  await context.route('**/__m4-seed', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic migration fixture</title>' }))
  await page.goto('/__m4-seed')
  await page.evaluate(({ schema, rows }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('gibberish-db', 10)
    request.onupgradeneeded = () => {
      for (const [name, spec] of Object.entries(schema)) {
        const [primary, ...indexes] = spec.split(',').map((v) => v.trim())
        const store = request.result.createObjectStore(name, { keyPath: primary! })
        for (const index of indexes) {
          const name = index.replace(/^&/, ''); const path = name.startsWith('[') ? name.slice(1, -1).split('+') : name
          store.createIndex(name, path, { unique: index.startsWith('&') })
        }
      }
    }
    request.onerror = () => reject(new Error('Synthetic v1 fixture setup failed'))
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction(Object.keys(rows), 'readwrite')
      for (const [name, values] of Object.entries(rows)) for (const value of values) tx.objectStore(name).add(value)
      tx.oncomplete = () => { db.close(); resolve() }; tx.onabort = () => { db.close(); reject(new Error('Synthetic v1 fixture transaction failed')) }
    }
  }), { schema: SCHEMA_V1, rows: fixture.stores })
  await routeM4(context)
  await page.addScriptTag({ type: 'module', url: '/__m4/m4-harness.js' }); await page.waitForFunction(() => '__m4' in globalThis)
  const probe = await page.evaluate(() => (globalThis as unknown as { __m4: Harness }).__m4.migrationProbe())
  await info.attach('migration-probe', { body: JSON.stringify(probe), contentType: 'application/json' })
  expect(probe).toEqual({ version: 2, code: '' })
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Unlock your journal', exact: true })).toBeVisible()
  expect(await stores(page)).toEqual(fixture.stores)
  await unlock(page, fixture.passphrase)
  await page.getByRole('button', { name: 'Open encrypted entry' }).click(); await page.getByRole('button', { name: 'Reveal My Thoughts' }).click()
  await expect(page.getByRole('region', { name: 'Revealed entry' })).toContainText('Synthetic M3 migration edited body')
})

test('M4 approved backup and readable bounds qualify on the actual browser engine', async ({ page, context }, info) => {
  test.setTimeout(180_000)
  await routeM4(context); await page.goto('/')
  await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible()
  await page.addScriptTag({ type: 'module', url: '/__m4/m4-harness.js' }); await page.waitForFunction(() => '__m4' in globalThis)
  const result = await page.evaluate(() => (globalThis as unknown as { __m4: Harness }).__m4.qualifyBounds())
  expect(result.size).toBeGreaterThan(result.maximum * 0.99); expect(result.size).toBeLessThanOrEqual(result.maximum)
  expect(result.readableSize).toBeGreaterThan(result.readableMaximum * 0.99); expect(result.readableSize).toBeLessThanOrEqual(result.readableMaximum)
  expect(result.restoredLength).toBe(result.bodyLength); expect(result.revisions).toBe(4)
  expect(result.backupFailure).toBe('EXPORT_TOO_LARGE'); expect(result.readableFailure).toBe('EXPORT_TOO_LARGE')
  for (const kind of ['backup', 'readable'] as const) {
    const promise = page.waitForEvent('download')
    await page.evaluate((kind) => (globalThis as unknown as { __m4: Harness }).__m4.downloadLarge(kind), kind)
    const download = await promise; expect(await download.failure()).toBeNull()
    expect((await stat((await download.path())!)).size).toBe(kind === 'backup' ? result.size : result.readableSize)
  }
  await info.attach('M4-bounds', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
  await mkdir('reports/M4/logs', { recursive: true })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(resolve('reports/M4/logs', `${info.project.name}-bounds-${Date.now()}.json`), JSON.stringify(result, null, 2))
})
