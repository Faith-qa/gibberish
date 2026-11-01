import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, firefox, webkit, devices, expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { pwaServer } from './pwa-server'
import { CACHE_BUDGET_LOCK } from '../../src/pwa/cache-gate'
import type { PublicReply, PublicRequest } from '../../src/pwa/protocol'
const phrase = 'Synthetic M5 offline passphrase 🌱'
const title = 'Synthetic M5 private title'
const body = 'Synthetic M5 private body; not a public application asset.'
const servers: Awaited<ReturnType<typeof pwaServer>>[] = []
async function host() { const s = await pwaServer(); servers.push(s); return s }
test.afterEach(async () => { for (const s of servers.splice(0)) await s.close() })

async function request(page: Page, type: PublicRequest['type'] = 'VERIFY'): Promise<PublicReply> {
  return await page.evaluate(async (type) => {
    const worker = navigator.serviceWorker.controller ?? (await navigator.serviceWorker.ready).active
    if (!worker) throw new Error('Synthetic worker missing')
    return await new Promise<PublicReply>((resolve, reject) => {
      const channel = new MessageChannel(); const timer = setTimeout(() => reject(new Error('Synthetic worker timeout')), 11000)
      channel.port1.onmessage = (e: MessageEvent<PublicReply>) => { clearTimeout(timer); channel.port1.close(); resolve(e.data) }
      worker.postMessage({ type, protocol: 1, requestId: crypto.randomUUID() }, [channel.port2])
    })
  }, type)
}
async function installed(page: Page, url: string) {
  await page.goto(url)
  await expect(page.getByText('Offline files downloaded. Close and reopen to confirm offline use in this browser.', { exact: true })).toBeVisible({ timeout: 20000 })
}
async function controlled(context: BrowserContext, url: string) {
  const initial = await context.newPage(); await installed(initial, url); await initial.close()
  const page = await context.newPage(); await page.goto(url)
  await expect(page.getByText(/^Offline files checked for this browser/)).toBeVisible({ timeout: 20000 })
  return page
}
async function onboard(page: Page) {
  await page.getByRole('button', { name: 'Get started', exact: true }).click()
  await page.getByLabel('Passphrase', { exact: true }).fill(phrase)
  await page.getByLabel('Confirm passphrase').fill(phrase)
  await page.getByRole('button', { name: 'Prepare recovery key' }).click()
  const key = (await page.getByTestId('recovery-key').textContent())!
  await page.getByRole('button', { name: 'I saved the key — continue' }).click()
  await page.getByLabel('Full recovery key').fill(key); await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Confirm key and create journal' }).click()
  await expect(page.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible()
  return key
}
async function unlock(page: Page) {
  await page.getByLabel('Passphrase', { exact: true }).fill(phrase)
  await page.getByRole('button', { name: 'Unlock journal', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible()
}
async function write(page: Page) {
  await page.getByRole('button', { name: 'New entry', exact: true }).click()
  await page.getByLabel('Title', { exact: true }).fill(title); await page.getByRole('textbox', { name: 'Body', exact: true }).fill(body)
  await page.getByRole('button', { name: 'Save entry locally' }).click()
  await expect(page.getByRole('status')).toContainText('Saved locally')
}
async function stored(page: Page) {
  return await page.evaluate(() => new Promise<Record<string, unknown[]>>((resolve, reject) => {
    const r = indexedDB.open('gibberish-db'); r.onerror = () => reject(new Error('Synthetic read failed'))
    r.onsuccess = () => {
      const db = r.result; const names = Array.from(db.objectStoreNames); const t = db.transaction(names, 'readonly')
      const rows: Record<string, unknown[]> = {}
      for (const name of names) { const read = t.objectStore(name).getAll(); read.onsuccess = () => { rows[name] = read.result as unknown[] } }
      t.oncomplete = () => { db.close(); resolve(rows) }; t.onerror = () => { db.close(); reject(new Error('Synthetic read failed')) }
    }
  }))
}
async function measure(name: string, values: unknown, project: string) {
  await mkdir('reports/M5/logs/performance', { recursive: true })
  await writeFile(`reports/M5/logs/performance/${project}-${name}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.json`, JSON.stringify({ recordedAt: new Date().toISOString(), project, workload: name, values }, null, 2) + '\n')
}

test('M5 complete precache supports genuine offline cold onboarding, reload and encrypted writing', async ({ context, browserName }, info) => {
  const s = await host(); const initial = await context.newPage(); await installed(initial, s.url)
  const preflight = await request(initial); expect(preflight.ready).toBe(true); expect(preflight.assetCount).toBe(12)
  await initial.close()
  if (browserName === 'chromium') {
    const cachePage = await context.newPage(); const cdp = await context.newCDPSession(cachePage); await cdp.send('Network.clearBrowserCache'); await cachePage.close()
  }
  await context.setOffline(true); s.fault.networkDown = true
  const cold = await context.newPage(); const start = performance.now(); await cold.goto(s.url)
  await expect(cold.getByRole('button', { name: 'Get started', exact: true })).toBeVisible()
  await expect(cold.getByText(/^Offline files checked for this browser/)).toBeVisible()
  const startupMs = performance.now() - start
  await onboard(cold); await write(cold)
  const before = await stored(cold); expect(JSON.stringify(before)).not.toContain(title); expect(JSON.stringify(before)).not.toContain(body)
  expect(before.sync_queue).toEqual([])
  await cold.reload(); await expect(cold.getByRole('heading', { name: 'Unlock your journal' })).toBeVisible()
  expect(await cold.locator('body').innerText()).not.toContain(title)
  await unlock(cold)
  const health = await request(cold); expect(health.ready).toBe(true)
  const inventory = await cold.evaluate(async () => {
    const rows: { name: string; urls: string[]; texts: string[]; headers: string[][] }[] = []
    for (const name of await caches.keys()) {
      const cache = await caches.open(name); const keys = await cache.keys()
      rows.push({ name, urls: keys.map((k) => k.url), texts: await Promise.all(keys.map(async (k) => (await cache.match(k))!.text())), headers: keys.map((k) => [...k.headers.keys()]) })
    }
    return rows
  })
  expect(inventory).toHaveLength(1)
  expect(inventory[0]!.urls).toHaveLength(12)
  for (const url of inventory[0]!.urls) expect(new URL(url).pathname).toMatch(/^\/(?:assets\/[\w.-]+\.(?:js|css|wasm)|icons\/[\w.-]+\.png|index\.html|manifest\.webmanifest|favicon\.svg)$/)
  const cachedText = inventory[0]!.texts.join(' ')
  expect(cachedText).not.toContain(phrase); expect(cachedText).not.toContain(title); expect(cachedText).not.toContain(body)
  expect(inventory[0]!.headers.every((h) => h.length === 0)).toBe(true)
  expect(await stored(cold)).toEqual(before)
  await measure('cold-launch', { startupMs, health, initialVerificationMs: preflight.milliseconds, clearedHttpCache: browserName === 'chromium' }, info.project.name)
})

test('M5 release B waits for dirty and multiple release A clients, then reopens offline without data loss', async ({ context }, info) => {
  const s = await host(); const a = await controlled(context, s.url); await onboard(a); await write(a)
  const before = await stored(a); const other = await context.newPage(); await other.goto(s.url); await expect(other.getByRole('heading', { name: 'Unlock your journal' })).toBeVisible()
  await a.bringToFront(); await a.getByRole('button', { name: 'New entry', exact: true }).click(); await a.getByLabel('Title', { exact: true }).fill('Synthetic pending update title'); await a.getByRole('textbox', { name: 'Body', exact: true }).fill('Synthetic unsaved update draft')
  const documentIdentity = await a.evaluate(() => performance.timeOrigin)
  const aProfile = (await request(a, 'PROFILE')).profile
  expect(aProfile.buildId).toBe('11111111-1111-4111-8111-111111111111')
  s.publishB()
  const oldShell = await readFile('reports/M5/releases/A/index.html', 'utf8')
  const oldScript = oldShell.match(/src="([^"]+\.js)"/)?.[1]
  expect(oldScript).toBeTruthy()
  const retained = await context.request.get(s.url + oldScript!)
  expect(retained.status()).toBe(200); expect(retained.headers()['cache-control']).toContain('immutable')
  await a.evaluate(async () => { await (await navigator.serviceWorker.getRegistration('/'))!.update() })
  await expect(a.getByText(/^An update is ready/)).toBeVisible({ timeout: 20000 })
  expect((await request(a, 'PROFILE')).profile).toEqual(aProfile)
  expect((await request(other, 'PROFILE')).profile).toEqual(aProfile)
  expect(await a.evaluate(() => performance.timeOrigin)).toBe(documentIdentity)
  await expect(a.getByRole('textbox', { name: 'Body', exact: true })).toHaveValue('Synthetic unsaved update draft')
  await a.getByRole('button', { name: 'Prepare this window to close' }).click()
  await expect(a.getByRole('alert')).toContainText('Finish, cancel or check')
  await expect(a.getByRole('textbox', { name: 'Body', exact: true })).toHaveValue('Synthetic unsaved update draft')
  await a.getByRole('button', { name: 'Save entry locally' }).click(); await expect(a.getByRole('status')).toContainText('Saved locally')
  const committed = await stored(a); expect(committed.journal_revisions).toHaveLength(2)
  await a.getByRole('button', { name: 'Prepare this window to close' }).click(); await expect(a.getByRole('heading', { name: 'Ready to close this window' })).toBeVisible()
  expect((await request(other, 'PROFILE')).profile).toEqual(aProfile)
  await a.close(); expect((await request(other, 'PROFILE')).profile).toEqual(aProfile); await other.close()
  await context.setOffline(true); s.fault.networkDown = true
  let reopened: Page | undefined
  await expect.poll(async () => {
    const candidate = await context.newPage(); await candidate.goto(s.url)
    const id = (await request(candidate, 'PROFILE')).profile.buildId
    if (id === '22222222-2222-4222-8222-222222222222') { reopened = candidate; return id }
    await candidate.close(); return id
  }, { timeout: 15000 }).toBe('22222222-2222-4222-8222-222222222222')
  const b = reopened!; await expect(b.getByRole('heading', { name: 'Unlock your journal' })).toBeVisible()
  await expect(b.getByText(/^Offline files checked for this browser/)).toBeVisible()
  expect(await stored(b)).toEqual(committed); expect(before.journal_keys).toEqual(committed.journal_keys)
  await unlock(b); expect(await b.evaluate(() => caches.keys())).toHaveLength(1)
  await measure('update', { aProfile, bHealth: await request(b), unchangedStores: true, dirtyDraftPreservedUntilExplicitSave: true, forcedReloads: 0 }, info.project.name)
})

test('M5 interrupted precache leaves online onboarding available, never ready, and explicit retry repairs installation', async ({ context }) => {
  const s = await host(); s.fault.path = '/index.html'; s.fault.mode = 'disconnect'
  const page = await context.newPage(); await page.goto(s.url)
  await expect(page.getByRole('button', { name: 'Get started', exact: true })).toBeVisible()
  await expect(page.getByText(/^Offline files are not verified/)).toBeVisible()
  await onboard(page); await write(page)
  expect(await page.evaluate(() => caches.keys())).toEqual([])
  delete s.fault.path; delete s.fault.mode
  await page.getByRole('button', { name: 'Check offline files and updates' }).click()
  await expect(page.getByText(/^Offline files downloaded/)).toBeVisible({ timeout: 20000 })
  expect((await request(page)).ready).toBe(true)
})

test('M5 corrupt shell fails offline without deleting ciphertext and exact online repair restores use', async ({ context }) => {
  const s = await host(); const page = await controlled(context, s.url); await onboard(page); await write(page)
  const before = await stored(page)
  await page.evaluate(async () => {
    const name = (await caches.keys())[0]!; const cache = await caches.open(name)
    await cache.put(new URL('/index.html', location.origin).href, new Response('Synthetic corrupted public shell', { headers: { 'Content-Type': 'text/html' } }))
  })
  expect((await request(page)).ready).toBe(false)
  await page.close(); await context.setOffline(true); s.fault.networkDown = true
  const failed = await context.newPage(); await failed.goto(s.url)
  await expect(failed.getByRole('heading', { name: 'Offline files unavailable' })).toBeVisible()
  expect(await stored(failed)).toEqual(before)
  await context.setOffline(false); s.fault.networkDown = false; await failed.reload()
  await expect(failed.getByRole('heading', { name: 'Unlock your journal' })).toBeVisible()
  await failed.getByRole('button', { name: 'Check offline files and updates' }).click()
  await expect(failed.getByText(/^Offline files checked for this browser/)).toBeVisible()
  expect(await stored(failed)).toEqual(before)
})

test('M5 complete static cache eviction can be repaired online without recreating or clearing the journal', async ({ context }) => {
  const s = await host(); const page = await controlled(context, s.url); await onboard(page); await write(page)
  const before = await stored(page)
  await page.evaluate(async () => { for (const n of await caches.keys()) await caches.delete(n) })
  expect((await request(page)).ready).toBe(false)
  await page.getByRole('button', { name: 'Check offline files and updates' }).click()
  await expect(page.getByText(/^Offline files checked for this browser/)).toBeVisible({ timeout: 20000 })
  expect(await stored(page)).toEqual(before)
  await page.close(); await context.setOffline(true); s.fault.networkDown = true; const cold = await context.newPage(); await cold.goto(s.url)
  await expect(cold.getByRole('heading', { name: 'Unlock your journal' })).toBeVisible()
})

test('M5 native database versionchange revokes English and rejects unsupported schema without mutation', async ({ context }) => {
  const s = await host(); const page = await controlled(context, s.url); await onboard(page); await write(page)
  await page.getByRole('button', { name: 'Open encrypted entry' }).first().click(); await page.getByRole('button', { name: 'Reveal My Thoughts' }).click()
  await expect(page.getByText(body, { exact: true })).toBeVisible()
  const before = await stored(page)
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    // Dexie schema v2 maps to native IndexedDB version 20. This synthetic v3
    // fixture is a compatibility test, not a product schema migration.
    const open = indexedDB.open('gibberish-db', 30)
    open.onupgradeneeded = () => { open.result.createObjectStore('synthetic_future', { keyPath: 'id' }) }
    open.onsuccess = () => { open.result.close(); resolve() }; open.onerror = () => reject(new Error('Synthetic upgrade failed'))
  }))
  await expect(page.getByRole('heading', { name: 'App compatibility needs attention' })).toBeVisible()
  expect(await page.locator('body').innerText()).not.toContain(body)
  const after = await stored(page); delete after.synthetic_future; expect(after).toEqual(before)
  await page.reload(); await expect(page.getByRole('heading', { name: 'App compatibility needs attention' })).toBeVisible()
  const preserved = await stored(page); delete preserved.synthetic_future; expect(preserved).toEqual(before)
})

test('M5 unexpected controllerchange revokes a dirty editor without forced reload or late revival', async ({ context }) => {
  const s = await host(); const page = await controlled(context, s.url); await onboard(page)
  await page.getByRole('button', { name: 'New entry', exact: true }).click(); await page.getByRole('textbox', { name: 'Body', exact: true }).fill(body)
  const time = await page.evaluate(() => performance.timeOrigin)
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')))
  await expect(page.getByRole('heading', { name: 'App compatibility needs attention' })).toBeVisible()
  expect(await page.locator('body').innerText()).not.toContain(body)
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(time)
  expect((await stored(page)).journal_revisions).toEqual([])
})

test('M5 production manifest, MIME, headers, root routing and accessible installation guidance', async ({ context }, info) => {
  const s = await host(); const page = await controlled(context, s.url)
  const manifest = await (await context.request.get(s.url + '/manifest.webmanifest')).json() as { name: string; id: string; start_url: string; scope: string; display: string; icons: {src:string; sizes:string; purpose:string}[] }
  expect(manifest).toMatchObject({ name: 'Gibberish', id: '/', start_url: '/', scope: '/', display: 'standalone' })
  expect(manifest.icons.map((i) => i.purpose)).toEqual(['any', 'any', 'maskable'])
  for (const path of ['/sw.js', '/', '/manifest.webmanifest', '/icons/icon-192.png']) {
    const response = await context.request.get(s.url + path); expect(response.status()).toBe(200)
    expect(response.headers()['x-content-type-options']).toBe('nosniff')
    expect(response.headers()['content-security-policy']).toBeTruthy()
    expect(response.headers()['cache-control']).toBe('no-cache')
  }
  expect((await context.request.get(s.url + '/assets/missing.js')).status()).toBe(404)
  expect((await context.request.get('http://127.0.0.1:4173/assets/missing.js')).status()).toBe(404)
  await page.getByText('Installation help and local data safety', { exact: true }).focus()
  await page.getByText('Installation help and local data safety', { exact: true }).press('Enter')
  await expect(page.getByText(/Verify the restored journal before deleting/)).toBeVisible()
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Check offline files and updates' }).focus()
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Check offline files and updates')
  await mkdir('reports/M5/screens', { recursive: true })
  await page.screenshot({ path: `reports/M5/screens/${info.project.name}-installation-help.png`, fullPage: true })
})

test('M5 offline worker, cache and ciphertext survive a full persistent-browser process restart', async ({ browserName }, info) => {
  test.setTimeout(60000)
  const s = await host(); const directory = await mkdtemp(join(tmpdir(), 'gibberish-m5-profile-'))
  const engine = { chromium, firefox, webkit }[browserName]
  let persistent: BrowserContext | undefined
  try {
    persistent = await engine.launchPersistentContext(directory)
    const page = await controlled(persistent, s.url); await onboard(page); await write(page)
    const before = await stored(page); await persistent.close(); persistent = undefined
    persistent = await engine.launchPersistentContext(directory); await persistent.setOffline(true); s.fault.networkDown = true
    const cold = await persistent.newPage(); const start = performance.now(); await cold.goto(s.url)
    await expect(cold.getByRole('heading', { name: 'Unlock your journal' })).toBeVisible()
    await expect(cold.getByText(/^Offline files checked for this browser/)).toBeVisible()
    await unlock(cold); expect(await stored(cold)).toEqual(before)
    await measure('restart', { coldRestartMs: performance.now() - start, health: await request(cold), browserName, persistentProfile: true }, info.project.name)
  } finally { await persistent?.close(); await rm(directory, { recursive: true, force: true }) }
})

test('M5 exact 8 MiB inventory with 2 MiB assets installs, verifies and cold-launches within bounds', async ({ context }, info) => {
  const s = await pwaServer('LIMIT'); servers.push(s)
  const page = await context.newPage(); const installStart = performance.now(); await installed(page, s.url)
  const installationMs = performance.now() - installStart
  const health = await request(page); expect(health.bytes).toBe(8 * 1024 * 1024); expect(health.ready).toBe(true)
  expect(health.milliseconds).toBeLessThan(10000)
  await page.close(); await context.setOffline(true); s.fault.networkDown = true
  const cold = await context.newPage(); const coldStart = performance.now(); await cold.goto(s.url)
  await expect(cold.getByRole('button', { name: 'Get started', exact: true })).toBeVisible()
  await expect(cold.getByText(/^Offline files checked for this browser/)).toBeVisible()
  const coldStartupMs = performance.now() - coldStart
  await onboard(cold)
  await measure('cache-budget', { installationMs, coldStartupMs, health, largestAssetBytes: 2097152, realDeviceMemoryProfile: false }, info.project.name)
})

test('M5 startup rejects an incompatible worker profile before any database open', async ({ context }) => {
  const s = await host(); const initial = await controlled(context, s.url); await onboard(initial); await write(initial)
  const before = await stored(initial); await initial.close()
  await context.addInitScript(() => {
    const originalOpen = indexedDB.open.bind(indexedDB)
    let count = 0
    Object.defineProperty(globalThis, '__syntheticOpenCount', { get: () => count })
    indexedDB.open = (...args: Parameters<IDBFactory['open']>) => { count++; return originalOpen(...args) }
    Object.defineProperty(navigator.serviceWorker, 'controller', { configurable: true, value: {
      scriptURL: location.origin + '/sw.js', state: 'activated',
      postMessage: (message: { type: string; requestId: string }, ports: MessagePort[]) => ports[0]!.postMessage({
        ...message, protocol: 1, profile: { buildId: '22222222-2222-4222-8222-222222222222', protocol: 1, cacheVersion: 1, databaseVersion: 2 },
        ready: false, milliseconds: 0, assetCount: 12, bytes: 1500000,
      }),
    } })
  })
  const rejected = await context.newPage(); await rejected.goto(s.url)
  await expect(rejected.getByRole('heading', { name: 'App compatibility needs attention' })).toBeVisible()
  expect(await rejected.evaluate(() => (globalThis as unknown as { __syntheticOpenCount: number }).__syntheticOpenCount)).toBe(0)
  expect(await stored(rejected)).toEqual(before)
  expect(await rejected.locator('body').innerText()).not.toContain(title)
})

test('M5 concurrent active-cache repair and candidate installation respect the native three-cache budget', async ({ context }) => {
  const s = await host(); const page = await controlled(context, s.url); await onboard(page); const before = await stored(page)
  await page.evaluate(async (lockName) => {
    for (const name of await caches.keys()) await caches.delete(name)
    await caches.open('gibberish-static-v1-44444444-4444-4444-8444-444444444444')
    await caches.open('gibberish-static-v1-55555555-5555-4555-8555-555555555555')
    await caches.open('synthetic-unrelated-cache')
    await new Promise<void>((acquired) => {
      void navigator.locks.request(lockName, async () => {
        acquired()
        await new Promise<void>((release) => { (globalThis as unknown as { __allocationRelease: () => void }).__allocationRelease = release })
      })
    })
  }, CACHE_BUDGET_LOCK)
  s.publishB()
  const repairing = request(page, 'REPAIR')
  const updating = page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration('/'))!.update() })
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration('/'))?.installing))).toBe(true)
  await page.evaluate(() => (globalThis as unknown as { __allocationRelease: () => void }).__allocationRelease())
  await Promise.all([repairing, updating])
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration('/'))?.installing))).toBe(false)
  const names = await page.evaluate(() => caches.keys())
  expect(names.filter((n) => n.startsWith('gibberish-static-v1-')).length).toBeLessThanOrEqual(3)
  expect(names).toContain('synthetic-unrelated-cache')
  expect(await stored(page)).toEqual(before)
  await write(page)
})

test('M5 unavailable storage never becomes false onboarding; complete external eviction cannot be recovered by cached assets', async ({ context }) => {
  const s = await host(); const original = await controlled(context, s.url); await onboard(original); await write(original)
  const before = await stored(original)
  const unavailable = await context.newPage()
  await unavailable.addInitScript(() => { indexedDB.open = () => { throw new DOMException('Synthetic storage unavailable', 'SecurityError') } })
  await context.setOffline(true); s.fault.networkDown = true
  await unavailable.goto(s.url)
  await expect(unavailable.getByRole('heading', { name: 'Local journal unavailable' })).toBeVisible()
  await expect(unavailable.getByRole('button', { name: 'Get started' })).toHaveCount(0)
  expect(await unavailable.locator('body').innerText()).not.toContain(title)
  expect(await stored(original)).toEqual(before)
  await unavailable.close()
  // External browser-data removal is simulated only in this synthetic context.
  // The application has no journal-reset or bulk-deletion operation in M5.
  await original.evaluate(() => new Promise<void>((resolve, reject) => {
    const deletion = indexedDB.deleteDatabase('gibberish-db')
    deletion.onsuccess = () => resolve(); deletion.onerror = () => reject(new Error('Synthetic eviction failed'))
  }))
  await expect(original.getByRole('heading', { name: 'App compatibility needs attention' })).toBeVisible()
  expect(await original.locator('body').innerText()).not.toContain(body)
  await original.close()
  const empty = await context.newPage(); await empty.goto(s.url)
  await expect(empty.getByRole('button', { name: 'Get started' })).toBeVisible()
  await expect(empty.getByRole('button', { name: 'Restore encrypted backup', exact: true })).toBeVisible()
  await expect(empty.getByText(/A recovery key unlocks existing encrypted data; it does not back up/)).toBeVisible()
  for (const rows of Object.values(await stored(empty))) expect(rows).toEqual([])
  expect((await request(empty)).ready).toBe(true)
})

// Ensure test fixtures describe genuinely distinct production artifacts.
async function confirm(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click()
}
async function exportBytes(page: Page, readable = false) {
  await page.getByRole('button', { name: 'Journal tools', exact: true }).click()
  await page.getByRole('button', { name: 'Export journal', exact: true }).click()
  if (readable) await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: readable ? 'Generate readable Markdown' : 'Generate encrypted backup', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your file is ready' })).toBeVisible()
  const ready = page.waitForEvent('download')
  await page.getByRole('button', { name: readable ? 'Download readable Markdown' : 'Download encrypted backup', exact: true }).click()
  const download = await ready
  expect(await download.failure()).toBeNull()
  expect(download.suggestedFilename()).toBe(readable ? 'gibberish-readable.md' : 'gibberish-backup.json')
  return await readFile((await download.path())!)
}

test('M5 cold-launched offline editing, Trash, recovery restoration, export and deletion preserve M4 boundaries', async ({ context, browser }, info) => {
  test.setTimeout(90000)
  const s = await host(); const initial = await controlled(context, s.url)
  const recovery = await onboard(initial); await write(initial); await initial.close()
  await context.setOffline(true); s.fault.networkDown = true
  const cold = await context.newPage(); await cold.goto(s.url); await unlock(cold)
  await cold.getByRole('button', { name: 'Open encrypted entry' }).click()
  await cold.getByRole('button', { name: 'Reveal My Thoughts' }).click()
  await cold.getByRole('button', { name: 'Edit entry' }).click()
  await cold.getByRole('textbox', { name: 'Body', exact: true }).fill(body + ' Edited offline.')
  await cold.getByRole('button', { name: 'Save entry locally' }).click()
  await expect(cold.getByRole('status')).toContainText('Saved locally')
  await cold.getByRole('button', { name: 'Open encrypted entry' }).click(); await confirm(cold, 'Move to Trash')
  await cold.getByRole('button', { name: 'Open Trash', exact: true }).click()
  await cold.getByRole('button', { name: 'Open encrypted entry' }).click(); await confirm(cold, 'Restore entry')
  await cold.getByRole('button', { name: 'Back to journal', exact: true }).click()
  const encrypted = await exportBytes(cold)
  expect(encrypted.toString()).not.toContain(body); expect(encrypted.toString()).not.toContain(phrase); expect(encrypted.toString()).not.toContain(recovery)
  const before = await stored(cold)
  await cold.getByRole('button', { name: 'Back to journal', exact: true }).click()
  const readable = await exportBytes(cold, true); expect(readable.toString()).toContain(body + ' Edited offline.')
  const emulation = info.project.name === 'mobile-chromium' ? devices['Pixel 7'] : info.project.name === 'mobile-webkit' ? devices['iPhone 13'] : {}
  for (const mode of ['passphrase', 'recovery'] as const) {
    const target = await browser.newContext(emulation)
    try {
      s.fault.networkDown = false
      const installedTarget = await controlled(target, s.url); await installedTarget.close(); await target.setOffline(true); s.fault.networkDown = true
      const restored = await target.newPage(); await restored.goto(s.url)
      await restored.getByRole('button', { name: 'Restore encrypted backup', exact: true }).click()
      await restored.locator('input[type=file]').setInputFiles({ name: 'synthetic-backup.json', mimeType: 'application/json', buffer: encrypted })
      await restored.getByRole('button', { name: 'Continue with selected backup' }).click()
      if (mode === 'recovery') await restored.getByRole('button', { name: 'Use backup recovery key instead' }).click()
      await restored.getByLabel(mode === 'passphrase' ? 'Backup passphrase' : 'Backup recovery key', { exact: true }).fill(mode === 'passphrase' ? phrase : recovery)
      await restored.getByRole('button', { name: 'Verify encrypted backup' }).click()
      await expect(restored.getByRole('heading', { name: 'Authenticated backup summary' })).toBeVisible()
      if (mode === 'recovery') {
        await restored.getByLabel('New passphrase', { exact: true }).fill('Synthetic M5 restored recovery phrase')
        await restored.getByLabel('Confirm passphrase').fill('Synthetic M5 restored recovery phrase')
        await restored.getByRole('button', { name: 'Prepare restoration passphrase' }).click()
      }
      await restored.getByRole('checkbox').check(); await restored.getByRole('button', { name: 'Confirm encrypted restoration' }).click()
      await expect(restored.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible()
      expect((await stored(restored)).journal_revisions).toEqual(before.journal_revisions)
      await restored.getByRole('button', { name: 'Open encrypted entry' }).click(); await restored.getByRole('button', { name: 'Reveal My Thoughts' }).click()
      await expect(restored.getByRole('region', { name: 'Revealed entry' })).toContainText(body + ' Edited offline.')
    } finally { await target.close() }
  }
  await cold.getByRole('button', { name: 'Back to journal', exact: true }).click()
  await cold.getByRole('button', { name: 'Open encrypted entry' }).click(); await confirm(cold, 'Move to Trash')
  await cold.getByRole('button', { name: 'Open Trash', exact: true }).click()
  await cold.getByRole('button', { name: 'Open encrypted entry' }).click(); await confirm(cold, 'Permanently delete locally')
  await expect(cold.getByRole('status')).toContainText('Permanently deleted locally')
  const purged = await stored(cold); expect(purged.journal_tombstones).toHaveLength(1); expect(purged.journal_revisions).toEqual([])
  expect(purged.journal_keys).toEqual(before.journal_keys)
  const cacheText = await cold.evaluate(async () => {
    let text = ''
    for (const name of await caches.keys()) { const cache = await caches.open(name); for (const key of await cache.keys()) text += await (await cache.match(key))!.text() }
    return text
  })
  for (const secret of [phrase, recovery, title, body]) expect(cacheText).not.toContain(secret)
  expect(await cold.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
})

test('M5 two-release fixtures contain different built applications and worker identities', async () => {
  const a = await readFile('reports/M5/releases/A/sw.js', 'utf8'); const b = await readFile('reports/M5/releases/B/sw.js', 'utf8')
  expect(a).not.toBe(b)
  expect(a).toContain('11111111-1111-4111-8111-111111111111'); expect(b).toContain('22222222-2222-4222-8222-222222222222')
})
