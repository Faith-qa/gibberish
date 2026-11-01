import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { SCHEMA_V1 } from '../../src/core/storage/database'

const phrase = 'Synthetic M4 failure qualification phrase'
const body = 'Synthetic M4 failure private body'
async function raw(page: Page) {
  return page.evaluate(() => new Promise<{ version: number; stores: Record<string, unknown[]> }>((resolve, reject) => {
    const r = indexedDB.open('gibberish-db'); r.onerror = () => reject(new Error('Synthetic inspection failed'))
    r.onsuccess = () => {
      const db = r.result, names = Array.from(db.objectStoreNames), tx = db.transaction(names)
      const rows: Record<string, unknown[]> = {}
      for (const name of names) { const q = tx.objectStore(name).getAll(); q.onsuccess = () => { rows[name] = q.result as unknown[] } }
      tx.oncomplete = () => { const version = db.version; db.close(); resolve({ version, stores: rows }) }
      tx.onabort = () => { db.close(); reject(new Error('Synthetic inspection failed')) }
    }
  }))
}
async function setup(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByLabel('Passphrase', { exact: true }).fill(phrase); await page.getByLabel('Confirm passphrase').fill(phrase)
  await page.getByRole('button', { name: 'Prepare recovery key' }).click()
  const key = (await page.getByTestId('recovery-key').textContent())!
  await page.getByRole('button', { name: 'I saved the key — continue' }).click()
  await page.getByLabel('Full recovery key').fill(key); await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Confirm key and create journal' }).click()
  await page.getByRole('button', { name: 'New entry', exact: true }).click()
  await page.getByLabel('Title', { exact: true }).fill('Synthetic M4 failure title'); await page.getByLabel('Body', { exact: true }).fill(body)
  await page.getByRole('button', { name: 'Save entry locally' }).click()
  await expect(page.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible()
}
async function confirm(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name, exact: true }).click()
}
async function moveToTrash(page: Page) {
  await page.getByRole('button', { name: 'Open encrypted entry' }).click(); await confirm(page, 'Move to Trash')
  await expect(page.getByRole('heading', { name: 'Your journal', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open Trash', exact: true }).click(); await page.getByRole('button', { name: 'Open encrypted entry' }).click()
  await expect(page.getByRole('button', { name: 'Permanently delete locally', exact: true })).toBeVisible()
}
async function hide(page: Page, hidden: boolean) {
  await page.evaluate((hidden) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
}

test('M4 native quota failure after marker/source writes rolls back the complete purge and exact retry succeeds', async ({ page }) => {
  await setup(page); await moveToTrash(page); const before = await raw(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.delete; let fail = true
    IDBObjectStore.prototype.delete = function (key) {
      if (this.name === 'journal_entries' && fail) { fail = false; throw new DOMException('Synthetic quota failure', 'QuotaExceededError') }
      return original.call(this, key)
    }
  })
  await confirm(page, 'Permanently delete locally')
  await expect(page.getByRole('alert')).toBeVisible()
  expect(await raw(page)).toEqual(before)
  expect(await page.locator('body').textContent()).not.toContain('Permanently deleted locally.')
  await page.getByRole('button', { name: 'Check and retry deletion', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Permanent deletion was verified locally')
  const after = (await raw(page)).stores
  expect(after.journal_tombstones).toHaveLength(1); expect(after.journal_revisions).toHaveLength(0)
})

test('M4 encrypted stale edit from another tab preserves an active/Trash conflict instead of choosing a winner', async ({ page, context }) => {
  await setup(page)
  await page.getByRole('button', { name: 'Open encrypted entry' }).click(); await page.getByRole('button', { name: 'Reveal My Thoughts' }).click()
  await page.getByRole('button', { name: 'Edit entry', exact: true }).click(); await page.getByRole('textbox', { name: 'Body', exact: true }).fill('Synthetic M4 pending branch')
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add; let fail = true
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === 'journal_revisions' && fail) { fail = false; throw new DOMException('Synthetic quota failure', 'QuotaExceededError') }
      return key === undefined ? add.call(this, value) : add.call(this, value, key)
    }
  })
  await page.getByRole('button', { name: 'Save entry locally' }).click(); await expect(page.getByRole('alert')).toBeVisible()
  const other = await context.newPage(); await other.goto('/')
  await other.getByLabel('Passphrase', { exact: true }).fill(phrase); await other.getByRole('button', { name: 'Unlock journal', exact: true }).click()
  await moveToTrash(other)
  await page.bringToFront()
  // Real foreground changes may conceal the original draft. The encrypted
  // prepared revision intentionally survives and is retried without plaintext.
  await hide(page, false)
  await page.getByRole('button', { name: 'Retry prepared save', exact: true }).click()
  await expect(page.getByText('Multiple versions need review. Every branch is preserved; resolution is unavailable here.')).toBeVisible()
  const data = (await raw(page)).stores
  expect(data.journal_revisions).toHaveLength(3); expect(data.sync_conflicts).toHaveLength(1)
  await page.getByRole('button', { name: 'Open version 1', exact: true }).click()
  await expect(page.getByText(/This is a preserved branch/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Permanently delete locally', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Move to Trash', exact: true })).toHaveCount(0)
})

test('M4 export concealment discards plaintext artifact and explicit native handoff revokes its opaque URL on lock', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL
    const counters = { created: 0, revoked: 0 }; Object.assign(globalThis, { __m4Urls: counters })
    URL.createObjectURL = (blob) => { counters.created++; return create.call(URL, blob) }
    URL.revokeObjectURL = (url) => { counters.revoked++; revoke.call(URL, url) }
  })
  async function generate() {
    await page.getByRole('button', { name: 'Journal tools', exact: true }).click(); await page.getByRole('button', { name: 'Export journal', exact: true }).click()
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Generate readable Markdown' }).click()
    await expect(page.getByRole('button', { name: 'Download readable Markdown' })).toBeVisible()
  }
  await generate(); await hide(page, true)
  await expect(page.getByRole('heading', { name: 'Your content is concealed' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download readable Markdown' })).toHaveCount(0)
  expect(await page.locator('body').textContent()).not.toContain(body)
  await hide(page, false); await generate()
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download readable Markdown' }).click()
  const file = await downloaded; expect(await file.failure()).toBeNull()
  await page.getByRole('button', { name: 'Lock this tab' }).click()
  expect(await page.evaluate(() => (globalThis as unknown as { __m4Urls: { created: number; revoked: number } }).__m4Urls)).toEqual({ created: 1, revoked: 1 })
  expect(await page.locator('body').textContent()).not.toContain(body)
})

test('M4 refuses unexpected legacy markers during migration and preserves every v1 record', async ({ page, context }) => {
  const fixture = JSON.parse(await readFile('tests/fixtures/m3-journal.json', 'utf8')) as { stores: Record<string, unknown[]> }
  fixture.stores.journal_tombstones = [{ entryId: crypto.randomUUID(), journalId: crypto.randomUUID() }]
  await context.route('**/__legacy', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic legacy migration</title>' }))
  await page.goto('/__legacy')
  await page.evaluate(({ schema, rows }) => new Promise<void>((resolve, reject) => {
    const r = indexedDB.open('gibberish-db', 10)
    r.onupgradeneeded = () => {
      for (const [name, spec] of Object.entries(schema)) {
        const [key, ...indexes] = spec.split(',').map((v) => v.trim()), store = r.result.createObjectStore(name, { keyPath: key! })
        for (const i of indexes) { const name = i.replace(/^&/, ''); store.createIndex(name, name.startsWith('[') ? name.slice(1, -1).split('+') : name, { unique: i.startsWith('&') }) }
      }
    }
    r.onerror = () => reject(new Error('Synthetic fixture failure'))
    r.onsuccess = () => {
      const db = r.result, tx = db.transaction(Object.keys(rows), 'readwrite')
      for (const [name, values] of Object.entries(rows)) for (const value of values) tx.objectStore(name).add(value)
      tx.oncomplete = () => { db.close(); resolve() }
    }
  }), { schema: SCHEMA_V1, rows: fixture.stores })
  const before = await raw(page); expect(before.version).toBe(10)
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Local journal unavailable' })).toBeVisible()
  expect(await raw(page)).toEqual(before)
  expect(await page.locator('time,li').count()).toBe(0)
})
