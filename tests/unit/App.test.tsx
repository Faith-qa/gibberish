import { webcrypto } from 'node:crypto'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/app/App'
import { AppController } from '../../src/app/controller'
import { cleanup as cleanupStorage, connect, content, fixture, phrase } from '../integration/storage/fixture'

// JSDOM has no production module-worker runtime. This test-only KEK fixture
// isolates UI behavior; native vectors and actual KDF workers stay covered in
// the unchanged Node crypto suite and real browser acceptance tests.
vi.mock('../../src/core/crypto/argon2', () => ({
  passphraseKek: async () => crypto.subtle.importKey('raw', new Uint8Array(32).fill(17), 'AES-GCM', false, ['wrapKey', 'unwrapKey']),
}))
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto)
  // Node's TextEncoder/WebCrypto return Node-realm buffers, while JSDOM supplies
  // another Uint8Array constructor. Keep the synthetic crypto adapter in one realm.
  vi.stubGlobal('Uint8Array', new TextEncoder().encode('').constructor)
  const syntheticKey = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  vi.stubGlobal('CryptoKey', syntheticKey.constructor)
})
afterEach(async () => { await cleanupStorage(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function landing() {
  const f = await connect()
  const controller = new AppController(f.service, { warm: async () => {} })
  const rendered = render(<App controller={controller} />)
  await screen.findByRole('button', { name: 'Get started' })
  return { ...f, controller, ...rendered }
}
async function opened() {
  const f = await fixture()
  const saved = await f.service.createEntry(f.session, content)
  const controller = new AppController(f.service, { warm: async () => {} })
  const rendered = render(<App controller={controller} />)
  await screen.findByRole('button', { name: 'Unlock journal' })
  await act(() => controller.unlock(phrase))
  return { ...f, saved, controller, ...rendered }
}

describe('application shell and approved M3 experience', () => {
  it('retains the application landmarks and welcoming headline', async () => {
    await landing()
    expect(screen.getByRole('banner')).toHaveTextContent('Gibberish')
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your thoughts.')
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  })

  it('offers setup deliberately, preserves skip navigation, and explains recovery is not backup', async () => {
    await landing()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main')
    expect(screen.getByText(/does not back up your journal/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Get started' })).toBeEnabled()
  })

  it('clears credential inputs and writes nothing until full recovery confirmation', async () => {
    const f = await landing()
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: phrase } })
    fireEvent.change(screen.getByLabelText('Confirm passphrase'), { target: { value: phrase } })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare recovery key' }))
    expect(screen.getByLabelText('Passphrase')).toHaveValue('')
    const key = (await screen.findByTestId('recovery-key')).textContent!
    expect(await f.db.journal_config.count()).toBe(0)
    expect(screen.queryByRole('status')?.textContent ?? '').not.toContain(key)
    fireEvent.click(screen.getByRole('button', { name: 'I saved the key — continue' }))
    expect(screen.queryByTestId('recovery-key')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Full recovery key'), { target: { value: key } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm key and create journal' }))
    await screen.findByRole('button', { name: 'New entry' })
    expect(await f.db.journal_config.count()).toBe(1)
    expect(document.body.textContent).not.toContain(key)
    expect(document.body.textContent).not.toContain(phrase)
  })

  it('exposes English only through Reveal and removes it on Hide and navigation', async () => {
    const f = await opened()
    expect(screen.queryByText(content.title)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open encrypted entry' }))
    await screen.findByRole('button', { name: 'Reveal My Thoughts' })
    expect(screen.queryByRole('button', { name: 'Edit entry' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reveal My Thoughts' }))
    await screen.findByText(content.title)
    fireEvent.click(screen.getByRole('button', { name: 'Hide My Thoughts' }))
    expect(screen.queryByText(content.title)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to journal' }))
    await screen.findByRole('button', { name: 'New entry' })
    expect(JSON.stringify(f.controller.snapshot())).not.toContain(content.body)
  })

  it('clears real draft DOM values immediately on backgrounding and never restores them', async () => {
    const f = await opened()
    fireEvent.click(screen.getByRole('button', { name: 'New entry' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Synthetic unsaved title' } })
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'Synthetic unsaved body' } })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    fireEvent(document, new Event('visibilitychange'))
    expect(screen.queryByDisplayValue('Synthetic unsaved title')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Synthetic unsaved body')
    expect(f.controller.snapshot().screen).toBe('concealed')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    fireEvent(document, new Event('visibilitychange'))
    await screen.findByRole('button', { name: 'New entry' })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(await f.db.journal_revisions.count()).toBe(1)
  })

  it('removes all journal metadata and moves focus on manual lock', async () => {
    const f = await opened()
    fireEvent.click(screen.getByRole('button', { name: 'Lock this tab' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Unlock your journal')
    expect(screen.queryByRole('list', { name: 'Encrypted entries' })).not.toBeInTheDocument()
    expect(document.querySelector('time')).toBeNull()
    expect(document.body.textContent).not.toContain(f.saved.entryId)
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus())
  })
})
