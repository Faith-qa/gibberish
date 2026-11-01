import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { App, AppFrame } from './app/App'
import { AppController } from './app/controller'
import { JournalService } from './core/journal'
import { openRepository } from './core/storage'
import { JournalError } from './core/journal/errors'
import { PrivacyBoundary } from './app/PrivacyBoundary'
import { PwaClient } from './pwa/client'
import './styles/index.css'

const root = document.getElementById('root')
if (!root) throw new Error('Application root is missing')
// Boundary errors get fixed local messages, never error/props logging.
const application = createRoot(root, { onCaughtError: () => {} })
let controller: AppController | undefined
let generation = 0
// Install the replacement listener before any asynchronous bootstrap.
const pwa = import.meta.env.PROD ? new PwaClient() : undefined
pwa?.subscribe(() => { if (!pwa.snapshot().compatible && controller) flushSync(() => controller?.invalidateCompatibility()) })
window.addEventListener('pagehide', () => { generation++; controller?.pagehide() })

function compatibilityScreen() {
  application.render(<AppFrame><main ref={(node) => node?.focus({ preventScroll: true })} id="main" tabIndex={-1} className="mx-auto max-w-4xl space-y-6 px-5 py-12"><h1 className="text-3xl">App compatibility needs attention</h1><p role="alert">Close all Gibberish windows and reopen with a compatible version. This check did not reset journal storage.</p></main></AppFrame>)
}
async function start() {
  const epoch = ++generation
  application.render(<AppFrame><main id="main" tabIndex={-1} className="mx-auto max-w-4xl space-y-6 px-5 py-12"><h1 className="text-3xl">Opening your local journal</h1><p>Checking local storage and app compatibility.</p></main></AppFrame>)
  if (pwa && !await pwa.compatible()) { compatibilityScreen(); return }
  if (epoch !== generation) return
  try {
    const repository = await openRepository()
    if (epoch !== generation || (pwa && !pwa.snapshot().compatible)) { repository.close(); if (epoch === generation) compatibilityScreen(); return }
    controller = new AppController(new JournalService(repository), { close: () => repository.close(), compatibility: async () => {
      if (!pwa) return true
      const compatible = await pwa.compatible()
      if (compatible) void pwa.verify()
      return compatible
    } })
    const owner = controller
    repository.onInvalidated(() => flushSync(() => owner.invalidateCompatibility()))
    application.render(<StrictMode><PrivacyBoundary controller={controller}><App controller={controller} {...(pwa ? { pwa } : {})} /></PrivacyBoundary></StrictMode>)
    void pwa?.start()
  } catch (error) {
    if (epoch !== generation) return
    if (error instanceof JournalError && error.code === 'UNSUPPORTED_DATABASE') { compatibilityScreen(); return }
    application.render(<AppFrame><main id="main" tabIndex={-1} className="mx-auto max-w-4xl space-y-6 px-5 py-12"><h1 className="text-3xl">Local journal unavailable</h1><p role="alert">Local storage could not be opened. This check did not reset journal storage. Close other Gibberish windows if an upgrade is blocked.</p><button className="button" onClick={() => { void start() }}>Retry local storage</button></main></AppFrame>)
  }
}
void start()
