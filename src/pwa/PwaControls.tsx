import { useSyncExternalStore } from 'react'
import type { AppController } from '../app/controller'
import type { PwaClient } from './client'

export function PwaControls({ pwa, controller }: { pwa: PwaClient; controller: AppController }) {
  const state = useSyncExternalStore(pwa.subscribe, pwa.snapshot)
  const view = useSyncExternalStore(controller.subscribe, controller.snapshot)
  const resting = !view.busy && ['locked', 'welcome'].includes(view.screen)
  const text = {
    preparing: 'Preparing offline files. Offline startup is not yet verified.',
    unverified: 'Offline files are not verified. Compatible local journaling can continue; reconnect and check again.',
    unsupported: 'Offline installation is unavailable in this browser. Keep encrypted backups of local data.',
    downloaded: 'Offline files downloaded. Close and reopen to confirm offline use in this browser.',
    verified: 'Offline files checked for this browser. Browser cleanup can still remove files or journal data.',
  }
  return <aside aria-label="Installation and offline availability" className="mx-auto max-w-4xl space-y-4 px-5 pb-6 text-sm text-stone-700 sm:px-10">
    <p aria-live="polite" aria-atomic="true">{text[state.readiness]}</p>
    {state.installed && <p aria-live="polite">Installation was reported by this browser. Open the installed app online and verify its offline files and journal; installation is not a backup.</p>}
    {state.waiting && <div className="notice space-y-3"><p aria-live="polite">An update is ready. Finish your work, then close all Gibberish tabs and app windows and reopen. This app will not reload your writing automatically.</p><button className="button-secondary" disabled={view.screen === 'prepared-close' || view.screen === 'compatibility'} onClick={() => controller.prepareToClose()}>Prepare this window to close</button></div>}
    <div className="flex flex-wrap gap-3">
      {state.readiness !== 'unsupported' && <button className="button-secondary" onClick={() => { void pwa.checkForUpdate() }}>Check offline files and updates</button>}
      {state.installable && <button className="button-secondary" disabled={!resting} onClick={() => { void pwa.install() }}>Install Gibberish</button>}
    </div>
    {state.installable && !resting && <p>Lock this tab or finish setup before opening the installation prompt.</p>}
    <details className="card space-y-3">
      <summary className="cursor-pointer font-medium">Installation help and local data safety</summary>
      <p>Installation is optional and is not a backup. A recovery key unlocks existing encrypted data; it cannot recover journal data removed from browser storage.</p>
      <div className="space-y-2">
        <p>Chrome or Edge: use the browser’s Install app menu or the Install Gibberish button when offered.</p>
        <p>iPhone or iPad Safari: use Share → Add to Home Screen, and Open as Web App where offered.</p>
        <p>Mac Safari: use Share → Add to Dock where supported.</p>
        <p>Firefox on supported Windows installations: use the browser’s web-app button. Other browsers may offer only a bookmark or browser-based offline use.</p>
      </div>
      <p>An installed app can have separate storage, especially Safari Home Screen and Dock apps. Open it online first to install its own offline files. To transfer an existing journal, export an encrypted backup from Journal tools and restore into the installed app’s empty journal. Verify the restored journal before deleting any original data.</p>
      <p>Keep encrypted backups separately. Clearing browser data, changing profiles, uninstalling or storage eviction can remove local data. Switching apps or tabs conceals content and may discard unsaved writing. Installation does not sign you in or unlock your journal.</p>
    </details>
  </aside>
}
