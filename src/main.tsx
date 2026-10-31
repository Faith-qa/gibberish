import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App, AppFrame } from './app/App'
import { AppController } from './app/controller'
import { JournalService } from './core/journal'
import { openRepository } from './core/storage'
import { PrivacyBoundary } from './app/PrivacyBoundary'
import './styles/index.css'

const root = document.getElementById('root')
if (!root) throw new Error('Application root is missing')

// Boundary errors get a fixed local message, never automatic error/props logging.
const application = createRoot(root, { onCaughtError: () => {} })
function start() {
  application.render(<AppFrame><main id="main" tabIndex={-1} className="mx-auto max-w-4xl space-y-6 px-5 py-12"><h1 className="text-3xl">Opening your local journal</h1><p>Checking local storage.</p></main></AppFrame>)
  void openRepository().then((repository) => {
    const controller = new AppController(new JournalService(repository))
    application.render(<StrictMode><PrivacyBoundary controller={controller}><App controller={controller} /></PrivacyBoundary></StrictMode>)
  }, () => {
    application.render(<AppFrame><main id="main" tabIndex={-1} className="mx-auto max-w-4xl space-y-6 px-5 py-12"><h1 className="text-3xl">Local journal unavailable</h1><p role="alert">Local storage could not be opened. Existing encrypted data has not been deleted.</p><button className="button" onClick={start}>Retry local storage</button></main></AppFrame>)
  })
}
start()
