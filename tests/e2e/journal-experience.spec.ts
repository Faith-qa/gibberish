import { mkdir, readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Harness } from '../browser/m2'

const phrase = 'Synthetic M3 journal passphrase 🌱'
const content = { title: 'Synthetic M3 private title', body: 'Synthetic M3 private body — never real journal data' }
type Stores = Record<string, unknown[]>

async function stores(page: Page): Promise<Stores> {
  return page.evaluate(() => new Promise<Stores>((resolve, reject) => {
    const request = indexedDB.open('gibberish-db')
    request.onerror = () => reject(new Error('Synthetic database inspection failed.'))
    request.onsuccess = () => {
      const db = request.result; const names = Array.from(db.objectStoreNames)
      const transaction = db.transaction(names, 'readonly')
      Promise.all(names.map((name) => new Promise<[string, unknown[]]>((done, fail) => {
        const read = transaction.objectStore(name).getAll()
        read.onsuccess = () => done([name, read.result as unknown[]]); read.onerror = () => fail(new Error('Synthetic store inspection failed.'))
      }))).then((rows) => { db.close(); resolve(Object.fromEntries(rows)) }, () => { db.close(); reject(new Error('Synthetic store inspection failed.')) })
    }
  }))
}

async function prepareSetup(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByLabel('Passphrase', { exact: true }).fill(phrase)
  await page.getByLabel('Confirm passphrase').fill(phrase)
  await page.getByRole('button', { name: 'Prepare recovery key' }).click()
  return (await page.getByTestId('recovery-key').textContent())!
}
async function onboard(page: Page) {
  const key = await prepareSetup(page)
  expect((await stores(page)).journal_config).toHaveLength(0)
  await page.getByRole('button', { name: 'I saved the key — continue' }).click()
  await page.getByLabel('Full recovery key').fill(key)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Confirm key and create journal' }).click()
  await expect(page.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible()
  return key
}
async function write(page: Page, value = content) {
  await page.getByRole('button', { name: 'New entry', exact: true }).click()
  await page.getByLabel('Title', { exact: true }).fill(value.title)
  await page.getByLabel('Body', { exact: true }).fill(value.body)
  await page.getByRole('button', { name: 'Save entry locally' }).click()
  await expect(page.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Saved locally')
}
async function unlock(page: Page, value = phrase) {
  await page.getByLabel('Passphrase', { exact: true }).fill(value)
  await page.getByRole('button', { name: 'Unlock journal', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible()
}
async function concealed(page: Page, hidden: boolean) {
  await page.evaluate((hidden) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
}
async function privateDomAbsent(page: Page, secrets: string[]) {
  const result = await page.evaluate((values) => {
    const visible = [document.body.textContent ?? '', document.title, location.href,
      ...Array.from(document.querySelectorAll('input,textarea'), (element) => (element as HTMLInputElement).value)].join('\n')
    return values.some((value) => visible.includes(value))
  }, secrets)
  expect(result).toBe(false)
}
async function routeM2(page: Page) {
  await page.context().route('**/__m2/**', async (route) => {
    const name = basename(new URL(route.request().url()).pathname)
    if (!name.endsWith('.js')) { await route.abort(); return }
    await route.fulfill({ contentType: 'text/javascript', body: await readFile(resolve('reports/M2/browser', name)) })
  })
  await page.addScriptTag({ type: 'module', url: '/__m2/m2-harness.js' })
  await page.waitForFunction(() => '__m2' in globalThis)
}

test('M3 onboarding, writing, reveal, edit and locked reload preserve privacy and ciphertext', async ({ page }, testInfo) => {
  const errors: string[] = []; const external: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('request', (request) => { if (new URL(request.url()).origin !== 'http://127.0.0.1:4173') external.push(request.url()) })
  const key = await onboard(page); await write(page)
  await mkdir('reports/M3/screens', { recursive: true })
  await page.screenshot({ path: resolve('reports/M3/screens', `${testInfo.project.name}-timeline.png`), fullPage: true })
  await privateDomAbsent(page, [content.title, content.body, phrase, key])
  await expect(page.getByText(/Preview · Incomplete/)).toBeVisible()
  expect((await page.locator('li h2').textContent())!.split(' ')).toHaveLength(8)
  await page.getByRole('button', { name: 'Open encrypted entry' }).click()
  await expect(page.getByRole('button', { name: 'Reveal My Thoughts' })).toBeVisible()
  await page.screenshot({ path: resolve('reports/M3/screens', `${testInfo.project.name}-detail.png`), fullPage: true })
  await expect(page.getByRole('button', { name: 'Edit entry' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Reveal My Thoughts' }).click()
  await expect(page.getByRole('region', { name: 'Revealed entry' })).toContainText(content.body)
  await page.getByRole('button', { name: 'Hide My Thoughts' }).click()
  await privateDomAbsent(page, [content.title, content.body])
  await page.getByRole('button', { name: 'Reveal My Thoughts' }).click()
  await page.getByRole('button', { name: 'Edit entry' }).click()
  await page.getByLabel('Body').fill('Synthetic edited M3 body')
  await page.getByRole('button', { name: 'Save entry locally' }).click()
  await expect(page.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible()
  const raw = await stores(page)
  expect(raw.journal_revisions).toHaveLength(2)
  expect(raw.sync_queue).toEqual([])
  for (const value of [phrase, key, content.title, content.body, 'Synthetic edited M3 body']) expect(JSON.stringify(raw)).not.toContain(value)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Unlock your journal', exact: true })).toBeVisible()
  await page.screenshot({ path: resolve('reports/M3/screens', `${testInfo.project.name}-locked.png`), fullPage: true })
  expect(await page.locator('time').count()).toBe(0)
  expect(await page.locator('li').count()).toBe(0)
  await privateDomAbsent(page, [content.title, content.body, phrase, key, 'gib1:'])
  await unlock(page)
  await page.getByRole('button', { name: 'Open encrypted entry' }).click()
  await privateDomAbsent(page, ['Synthetic edited M3 body'])
  await page.getByRole('button', { name: 'Reveal My Thoughts' }).click()
  await expect(page.getByRole('region', { name: 'Revealed entry' })).toContainText('Synthetic edited M3 body')
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
  expect(errors).toEqual([]); expect(external).toEqual([])
})

test('M3 accepts a shorter pre-existing M2 passphrase without weakening new setup policy', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible()
  await routeM2(page)
  await page.evaluate(async () => {
    const h = (globalThis as unknown as { __m2: Harness }).__m2
    await h.initialize('gibberish-db', 'short'); h.close()
  })
  await page.reload()
  await unlock(page, 'short')
  await expect(page.getByRole('button', { name: 'New entry', exact: true })).toBeVisible()
})

test('M3 cancelling KDF offline does not revive setup and the loaded app can retry', async ({ page, context }) => {
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible()
  await context.setOffline(true)
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage; let cancel = true
    Worker.prototype.postMessage = function (this: Worker, message: unknown, transfer: Transferable[] = []) {
      Reflect.apply(post, this, [message, transfer])
      if (cancel) {
        cancel = false
        queueMicrotask(() => (document.querySelector('header button') as HTMLButtonElement | null)?.click())
      }
    } as Worker['postMessage']
  })
  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByLabel('Passphrase', { exact: true }).fill(phrase)
  await page.getByLabel('Confirm passphrase').fill(phrase)
  await page.getByRole('button', { name: 'Prepare recovery key' }).click()
  await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible()
  await expect(page.getByTestId('recovery-key')).toHaveCount(0)
  expect((await stores(page)).journal_keys).toHaveLength(0)
  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByLabel('Passphrase', { exact: true }).fill(phrase)
  await page.getByLabel('Confirm passphrase').fill(phrase)
  await page.getByRole('button', { name: 'Prepare recovery key' }).click()
  await expect(page.getByTestId('recovery-key')).toBeVisible()
})

test('M3 interrupted and incorrect setup never persists partially confirmed keys', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByLabel('Passphrase', { exact: true }).fill('too short')
  await page.getByLabel('Confirm passphrase').fill('too short')
  await page.getByRole('button', { name: 'Prepare recovery key' }).click()
  await expect(page.getByRole('alert')).toContainText('at least 15')
  await page.getByLabel('Passphrase', { exact: true }).fill(phrase)
  await page.getByLabel('Confirm passphrase').fill(phrase)
  await page.getByRole('button', { name: 'Prepare recovery key' }).click()
  await expect(page.getByTestId('recovery-key')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible()
  expect((await stores(page)).journal_keys).toHaveLength(0)
  const key = await prepareSetup(page)
  await concealed(page, true); await privateDomAbsent(page, [key])
  await concealed(page, false)
  await expect(page.getByRole('button', { name: 'Show recovery key' })).toBeVisible()
  await page.getByRole('button', { name: 'Show recovery key' }).click()
  await expect(page.getByTestId('recovery-key')).toHaveText(key)
  await page.getByRole('button', { name: 'I saved the key — continue' }).click()
  await page.getByLabel('Full recovery key').fill('gbr1.' + 'A'.repeat(43))
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Confirm key and create journal' }).click()
  await expect(page.getByRole('alert')).toContainText('confirmation must match')
  expect((await stores(page)).journal_keys).toHaveLength(0)
  await page.getByLabel('Full recovery key').fill(key)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Confirm key and create journal' }).click()
  await expect(page.getByRole('button', { name: 'New entry', exact: true })).toBeVisible()
})

test('M3 recovery reset verifies credentials and preserves immutable ciphertext and recovery wrapper', async ({ page }) => {
  const key = await onboard(page); await write(page)
  const before = await stores(page)
  await page.getByRole('button', { name: 'Lock this tab' }).click()
  await page.getByLabel('Passphrase', { exact: true }).fill('Wrong synthetic phrase')
  await page.getByRole('button', { name: 'Unlock journal', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('could not unlock')
  await page.getByRole('button', { name: 'Use recovery key instead' }).click()
  await page.getByLabel('Recovery key', { exact: true }).fill('invalid')
  await page.getByRole('button', { name: 'Verify recovery key' }).click()
  await expect(page.getByRole('alert')).toContainText('could not unlock')
  await page.getByLabel('Recovery key', { exact: true }).fill(key)
  await page.getByRole('button', { name: 'Verify recovery key' }).click()
  const replacement = 'New synthetic M3 recovery phrase'
  await page.getByLabel('New passphrase', { exact: true }).fill(replacement)
  await page.getByLabel('Confirm passphrase').fill(replacement)
  await page.getByRole('button', { name: 'Reset passphrase locally' }).click()
  await expect(page.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('reset was verified')
  const after = await stores(page)
  expect(after.journal_revisions).toEqual(before.journal_revisions)
  expect((after.journal_keys?.[0] as { recoveryWrappedKey: unknown }).recoveryWrappedKey).toEqual((before.journal_keys?.[0] as { recoveryWrappedKey: unknown }).recoveryWrappedKey)
  await page.reload()
  await page.getByLabel('Passphrase', { exact: true }).fill(phrase)
  await page.getByRole('button', { name: 'Unlock journal', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('could not unlock')
  await unlock(page, replacement)
  await privateDomAbsent(page, [content.title, content.body, key, replacement])
})

test('M3 background concealment clears drafts and original deadlines survive resume', async ({ page }) => {
  await page.clock.install()
  await onboard(page)
  await page.getByRole('button', { name: 'New entry', exact: true }).click()
  await page.getByLabel('Title').fill(content.title); await page.getByLabel('Body').fill(content.body)
  await page.clock.fastForward(240000)
  await concealed(page, true)
  await expect(page.getByRole('heading', { name: 'Your content is concealed' })).toBeVisible()
  await privateDomAbsent(page, [content.title, content.body])
  await page.clock.fastForward(59000)
  await concealed(page, false)
  await expect(page.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await page.clock.fastForward(2000)
  await expect(page.getByRole('heading', { name: 'Unlock your journal', exact: true })).toBeVisible()
  expect((await stores(page)).journal_revisions).toHaveLength(0)
  await privateDomAbsent(page, ['gib1:', content.title, content.body])
})

test('M3 storage failure preserves the visible draft and exact prepared retry', async ({ page }) => {
  await onboard(page); await write(page)
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add; let fail = true
    IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'journal_revisions' && fail) { fail = false; throw new DOMException('Synthetic quota failure', 'QuotaExceededError') }
      return key === undefined ? add.call(this, value) : add.call(this, value, key)
    }
  })
  await page.getByRole('button', { name: 'New entry', exact: true }).click()
  await page.getByLabel('Title').fill(content.title); await page.getByLabel('Body').fill(content.body)
  await page.getByRole('button', { name: 'Save entry locally' }).click()
  await expect(page.getByRole('alert')).toContainText('could not complete')
  await expect(page.getByLabel('Body')).toHaveValue(content.body)
  expect((await stores(page)).journal_revisions).toHaveLength(1)
  await expect(page.getByText('Saved locally.', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel editing' }).click()
  await page.getByRole('button', { name: 'Discard draft' }).click()
  await expect(page.getByRole('button', { name: 'New entry', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Open encrypted entry' }).click()
  await page.getByRole('button', { name: 'Reveal My Thoughts' }).click()
  await expect(page.getByRole('button', { name: 'Edit entry' })).toBeDisabled()
  await expect(page.getByText(/An interrupted save needs its outcome checked/)).toBeVisible()
  await page.getByRole('button', { name: 'Back to journal' }).click()
  await page.getByRole('button', { name: 'Retry prepared save' }).click()
  await expect(page.getByRole('status')).toContainText('Saved locally')
  expect((await stores(page)).journal_revisions).toHaveLength(2)
})

test('M3 UI and an independent connection preserve concurrent branches without resolution', async ({ page }) => {
  await onboard(page); await write(page)
  const stored = await stores(page)
  const root = stored.journal_revisions?.[0] as { journalId: string; entryId: string; revisionId: string }
  await page.getByRole('button', { name: 'Open encrypted entry' }).click()
  await page.getByRole('button', { name: 'Reveal My Thoughts' }).click()
  await page.getByRole('button', { name: 'Edit entry' }).click()
  await page.getByLabel('Body').fill('Synthetic foreground UI branch')
  await routeM2(page)
  await page.evaluate(async ({ phrase, root }) => {
    const h = (globalThis as unknown as { __m2: Harness }).__m2
    await h.unlock('gibberish-db', root.journalId, phrase)
    await h.commit(await h.prepareEdit(root.entryId, root.revisionId, { title: 'Synthetic external branch', body: 'Synthetic second connection' }))
    h.close()
  }, { phrase, root })
  await page.getByRole('button', { name: 'Save entry locally' }).click()
  await expect(page.getByText(/Multiple versions need review/)).toBeVisible()
  expect((await stores(page)).journal_revisions).toHaveLength(3)
  await page.getByRole('button', { name: 'Open version 1' }).click()
  await page.getByRole('button', { name: 'Reveal My Thoughts' }).click()
  await expect(page.getByRole('button', { name: 'Edit entry' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Keep local|Keep remote|Merge|Resolve/ })).toHaveCount(0)
})

test('M3 an already loaded app unlocks and writes offline without additional requests', async ({ page, context }) => {
  await onboard(page)
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Lock this tab' }).click()
  await unlock(page); await write(page)
  await page.getByRole('button', { name: 'Open encrypted entry' }).click()
  await page.getByRole('button', { name: 'Reveal My Thoughts' }).click()
  await expect(page.getByRole('region', { name: 'Revealed entry' })).toContainText(content.body)
  expect(requests).toEqual([])
})

test('M3 KDF runs without freezing the main thread and pagehide cannot revive a session', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByLabel('Passphrase', { exact: true }).fill(phrase)
  await page.getByLabel('Confirm passphrase').fill(phrase)
  await page.evaluate(() => {
    const state = globalThis as unknown as { __heartbeat: number; __timer: number }
    state.__heartbeat = 0; state.__timer = window.setInterval(() => { state.__heartbeat++ }, 5)
  })
  await page.getByRole('button', { name: 'Prepare recovery key' }).click()
  await expect(page.getByTestId('recovery-key')).toBeVisible()
  const ticks = await page.evaluate(() => {
    const state = globalThis as unknown as { __heartbeat: number; __timer: number }
    clearInterval(state.__timer); return state.__heartbeat
  })
  expect(ticks).toBeGreaterThan(0)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect(page.getByTestId('recovery-key')).toHaveCount(0)
  expect((await stores(page)).journal_keys).toHaveLength(0)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')))
  await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible()
})

test('M3 keyboard editing provides a native discard dialog and focused locked screen', async ({ page }) => {
  await onboard(page)
  await page.getByRole('button', { name: 'New entry', exact: true }).click()
  await page.getByLabel('Title').fill(content.title); await page.getByLabel('Body').fill(content.body)
  await page.getByRole('button', { name: 'Cancel editing' }).click()
  await expect(page.getByRole('dialog', { name: 'Unsaved writing' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stay here' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('Body')).toHaveValue(content.body)
  await page.getByRole('button', { name: 'Cancel editing' }).click()
  await page.getByRole('button', { name: 'Discard draft' }).click()
  await page.getByRole('button', { name: 'Lock this tab' }).click()
  await expect(page.getByRole('main')).toBeFocused()
  await privateDomAbsent(page, [content.title, content.body, 'gib1:'])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
