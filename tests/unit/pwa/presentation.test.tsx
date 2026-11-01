import { webcrypto } from 'node:crypto'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from '../../../src/app/App'
import { AppController } from '../../../src/app/controller'
import { PwaClient } from '../../../src/pwa/client'
import { profile } from '../../../src/pwa/protocol'
import { cleanup, connect, content, fixture, phrase } from '../../integration/storage/fixture'

// UI-only KDF fixture, as in the existing component suite. Real native KDF and
// transport qualification remain unchanged in Node vectors and browser tests.
vi.mock('../../../src/core/crypto/argon2', () => ({ passphraseKek: async () => crypto.subtle.importKey('raw', new Uint8Array(32).fill(17), 'AES-GCM', false, ['wrapKey', 'unwrapKey']) }))
const id = '11111111-1111-4111-8111-111111111111'
let register: ReturnType<typeof vi.fn>
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Uint8Array', new TextEncoder().encode('').constructor)
  const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  vi.stubGlobal('CryptoKey', key.constructor)
  register = vi.fn(async () => { throw new Error('Synthetic registration unavailable') })
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: null, addEventListener: vi.fn(), register } })
})
afterEach(async () => { await cleanup(); delete (navigator as unknown as Record<string, unknown>).serviceWorker; vi.unstubAllGlobals(); vi.restoreAllMocks() })
function promptEvent() {
  const event = new Event('beforeinstallprompt', { cancelable: true }); const prompt = vi.fn(async () => {})
  Object.defineProperty(event, 'prompt', { value: prompt }); return { event, prompt }
}
it('keeps compatible online onboarding available after registration failure and distinguishes a backup', async () => {
  const f = await connect(); const controller = new AppController(f.service, { warm: async () => {} }); const pwa = new PwaClient(profile(id))
  render(<App controller={controller} pwa={pwa} />)
  await screen.findByRole('button', { name: 'Get started' }); await act(() => pwa.start())
  expect(screen.getByText(/^Offline files are not verified/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Get started' })).toBeEnabled()
  expect(screen.getByText(/Installation is optional and is not a backup/)).toBeInTheDocument()
  expect(screen.getByText(/Verify the restored journal before deleting any original/)).toBeInTheDocument()
})
it('defers a native install prompt until an explicit action and never auto-prompts setup', async () => {
  const f = await connect(); const controller = new AppController(f.service, { warm: async () => {} }); const pwa = new PwaClient(profile(id))
  render(<App controller={controller} pwa={pwa} />); await screen.findByRole('button', { name: 'Get started' })
  const first = promptEvent(); act(() => { window.dispatchEvent(first.event) })
  expect(first.event.defaultPrevented).toBe(true); expect(first.prompt).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Install Gibberish' })); expect(first.prompt).toHaveBeenCalledOnce()
  const second = promptEvent(); act(() => { window.dispatchEvent(second.event); controller.beginSetup() })
  expect(screen.getByRole('button', { name: 'Install Gibberish' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Install Gibberish' })); expect(second.prompt).not.toHaveBeenCalled()
})
it('waiting-update status does not steal editor focus or discard writing and close preparation refuses it', async () => {
  const f = await fixture(); const controller = new AppController(f.service, { warm: async () => {} }); const pwa = new PwaClient(profile(id))
  render(<App controller={controller} pwa={pwa} />); await screen.findByRole('button', { name: 'Unlock journal' })
  await act(() => controller.unlock(phrase)); act(() => { controller.newEntry(); controller.updateDraft(content) })
  const editor = screen.getByRole('textbox', { name: 'Body' }); editor.focus()
  register.mockResolvedValueOnce({ scope: location.origin + '/', active: null, installing: null, waiting: { state: 'installed' }, addEventListener: vi.fn() })
  await act(() => pwa.start())
  expect(editor).toHaveFocus(); expect(editor).toHaveValue(content.body)
  fireEvent.click(screen.getByRole('button', { name: 'Prepare this window to close' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Finish, cancel or check')
  expect(editor).toHaveValue(content.body)
  expect(screen.getByRole('complementary')).not.toHaveTextContent(content.body)
})
