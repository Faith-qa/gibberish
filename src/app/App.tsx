import { useEffect, useRef, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import type { ReactNode } from 'react'
import type { AppController } from './controller'
import { PassphraseForm, RecoveryConfirmation, UnlockForm } from '../features/onboarding/AccessForms'
import { JournalTools, ExportOptions, ExportReady, ChangePassphrase } from '../features/journal/JournalTools'
import { RestoreFile, RestoreCredentials, RestoreSummary } from '../features/recovery/BackupRestore'
import { EntryDetail, EntryEditor, Timeline } from '../features/journal/JournalViews'

export function AppFrame({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="min-h-dvh bg-stone-50 text-stone-900">
    <a tabIndex={0} className="skip-link" href="#main">Skip to content</a>
    <header className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-6 sm:px-10">
      <span className="text-xl font-semibold tracking-tight">Gibberish<span aria-hidden="true" className="text-emerald-800">.</span></span>
      {action}
    </header>
    {children}
    <footer className="mx-auto max-w-5xl px-5 py-8 text-sm text-stone-600 sm:px-10">Gibberish · Local on this device. A private space to write.</footer>
  </div>
}

export function App({ controller }: { controller: AppController }) {
  const view = useSyncExternalStore(controller.subscribe, controller.snapshot)
  const main = useRef<HTMLElement>(null)
  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState === 'hidden') flushSync(() => controller.conceal())
      else void controller.resume()
    }
    const pagehide = () => flushSync(() => controller.pagehide())
    const pageshow = () => { if (document.visibilityState !== 'hidden') void controller.resume() }
    const activity = (event: Event) => { if (event.isTrusted && document.visibilityState !== 'hidden') controller.activity() }
    const focus = () => controller.refreshOnFocus()
    const beforeunload = (event: BeforeUnloadEvent) => { if (controller.isDirty()) event.preventDefault() }
    document.addEventListener('visibilitychange', visibility)
    // Layout/programmatic scroll events can be trusted browser events. Count
    // deliberate wheel/touch/keyboard input, not scroll restoration on resume.
    for (const event of ['pointerdown', 'keydown', 'input', 'wheel', 'touchmove']) document.addEventListener(event, activity, { capture: true, passive: true })
    window.addEventListener('pagehide', pagehide); window.addEventListener('pageshow', pageshow)
    window.addEventListener('focus', focus); window.addEventListener('beforeunload', beforeunload)
    const tick = setInterval(() => { flushSync(() => controller.checkDeadline()); void controller.maintenance() }, 1000)
    void controller.boot()
    if (document.visibilityState === 'hidden') controller.conceal()
    return () => {
      clearInterval(tick)
      document.removeEventListener('visibilitychange', visibility)
      for (const event of ['pointerdown', 'keydown', 'input', 'wheel', 'touchmove']) document.removeEventListener(event, activity, true)
      window.removeEventListener('pagehide', pagehide); window.removeEventListener('pageshow', pageshow)
      window.removeEventListener('focus', focus); window.removeEventListener('beforeunload', beforeunload)
      controller.lock('')
    }
  }, [controller])
  useEffect(() => { if (!['loading', 'welcome'].includes(view.screen)) main.current?.focus({ preventScroll: true }) }, [view.screen, view.epoch])

  const privateScreen = ['timeline', 'detail', 'editor', 'setup', 'setup-key', 'setup-confirm', 'recovery-reset', 'trash', 'tools', 'export', 'export-ready', 'change-phrase', 'restore-file', 'restore-credentials', 'restore-summary'].includes(view.screen)
  const titles = { loading: 'Opening your local journal', welcome: 'Your thoughts. Your language. Your privacy.', setup: 'Create your journal passphrase', 'setup-key': 'Save your recovery key', 'setup-confirm': 'Confirm your recovery key', locked: 'Unlock your journal', 'recovery-reset': 'Choose a new passphrase', timeline: 'Your journal', detail: 'A private moment', editor: 'Write your thoughts', concealed: 'Your content is concealed', error: 'Local journal unavailable', trash: 'Encrypted Trash', tools: 'Journal tools', export: 'Export your journal', 'export-ready': 'Your file is ready', 'change-phrase': 'Change passphrase', 'restore-file': 'Restore an encrypted backup', 'restore-credentials': 'Verify backup credentials', 'restore-summary': 'Review encrypted restoration' }
  return <AppFrame action={(privateScreen || view.busy) && <button className="button-secondary" onClick={() => flushSync(() => controller.lock())}>{view.screen.startsWith('setup') ? 'Cancel setup' : view.screen.startsWith('restore') ? 'Cancel restoration' : view.screen === 'locked' ? 'Cancel unlocking' : 'Lock this tab'}</button>}>
    <main key={view.epoch} id="main" ref={main} tabIndex={-1} className="mx-auto max-w-4xl space-y-6 px-5 py-8 sm:px-10 sm:py-14">
      <h1 className="max-w-3xl text-3xl font-medium leading-tight tracking-tight sm:text-5xl">{titles[view.screen]}</h1>
      {view.notice && <p role="status" className="notice">{view.notice}</p>}
      {view.message && <p role="alert" className="warning">{view.message}</p>}
      {view.warning && <div className="warning"><p role="status">This tab will lock in less than 30 seconds without activity. Unsaved writing will be cleared.</p><button className="button-secondary" onClick={() => controller.activity()}>Stay unlocked</button></div>}
      {view.busy && <p role="status">Working locally…</p>}
      {view.screen === 'loading' && <p>Checking local storage and cryptographic support.</p>}
      {view.screen === 'error' && <button className="button" onClick={() => { void controller.boot() }}>Retry local detection</button>}
      {view.screen === 'welcome' && <>
        <p className="text-lg text-stone-600">A calm, private place to write. No account is needed. Your entries are encrypted on this device before they are saved.</p>
        <div className="card space-y-4"><h2 className="text-xl font-medium">A local journal, with a recovery key</h2><p>Choose a passphrase and save an independent recovery key. There is no email or Google reset if you lose both credentials.</p><p>Browser data can be cleared or lost. A recovery key unlocks existing encrypted data; it does not back up your journal. Export encrypted backups from Journal tools. Cloud connection is not available in this version.</p></div>
        <button className="button" onClick={() => controller.beginSetup()}>Get started</button>
        <button className="button-secondary" onClick={() => controller.beginRestore()}>Restore encrypted backup</button>
        <button className="button-secondary" onClick={() => { void controller.boot() }}>Check local journal</button>
      </>}
      {view.screen === 'setup' && <PassphraseForm controller={controller} busy={view.busy} />}
      {view.screen === 'setup-key' && <>
        <p>Keep this key somewhere safe, separate from this browser. It unlocks existing encrypted data, but cannot restore journal data deleted from browser storage.</p>
        <p className="warning">There is no email or Google reset. Losing both credentials can make your journal inaccessible. No journal is committed before confirmation.</p>
        {view.recoveryText ? <div className="card"><p className="field-label">Recovery key</p><p className="break-all select-all font-mono" data-testid="recovery-key">{view.recoveryText}</p></div>
          : <button className="button-secondary" onClick={() => controller.showRecoveryKey()}>Show recovery key</button>}
        <p className="muted">Copy only deliberately. Clipboard contents can outlive this app. Switching apps or tabs conceals this key; the original inactivity deadline still applies.</p>
        <button className="button" onClick={() => controller.confirmRecoveryScreen()}>I saved the key — continue</button>
      </>}
      {view.screen === 'setup-confirm' && <RecoveryConfirmation controller={controller} busy={view.busy} />}
      {view.screen === 'locked' && <UnlockForm controller={controller} busy={view.busy} />}
      {view.screen === 'recovery-reset' && <>
        <p>The recovery key was authenticated locally. Your entries and recovery key remain unchanged. The new passphrase becomes active only after its wrapped key is committed.</p>
        {view.retry ? <button className="button" disabled={view.busy} onClick={() => { void controller.retryReset() }}>Check and retry prepared reset</button> : <PassphraseForm controller={controller} reset busy={view.busy} />}
      </>}
      {view.screen === 'concealed' && <p>Plaintext and unsaved writing were cleared. This page is concealed, not necessarily locked; authorization can remain active until the original five-minute deadline.</p>}
      {view.clockReview && privateScreen && <div className="warning"><p>Automatic Trash cleanup is paused. Review this device’s date and time; the app cannot prove elapsed time while closed.</p><button className="button-secondary" onClick={()=>controller.reviewClock(true)}>I reviewed the device date</button></div>}
      {view.screen === 'tools' && <JournalTools controller={controller} busy={view.busy} />}
      {view.screen === 'export' && <ExportOptions controller={controller} busy={view.busy} />}
      {view.screen === 'export-ready' && <ExportReady controller={controller} view={view} />}
      {view.screen === 'change-phrase' && <ChangePassphrase controller={controller} view={view} />}
      {view.screen === 'restore-file' && <RestoreFile controller={controller} view={view} />}
      {view.screen === 'restore-credentials' && <RestoreCredentials controller={controller} busy={view.busy} />}
      {view.screen === 'restore-summary' && <RestoreSummary controller={controller} view={view} />}
      {view.screen === 'trash' && <><p>Trash stays encrypted. After 30 elapsed days entries become eligible for permanent deletion during later unlocked use. Restore remains possible until actual deletion. Device clock changes can affect eligibility. Known conflicts are preserved without automatic deletion.</p><Timeline controller={controller} view={view} /></>}
      {view.screen === 'timeline' && <Timeline controller={controller} view={view} />}
      {view.screen === 'detail' && <EntryDetail controller={controller} view={view} />}
      {view.screen === 'editor' && <EntryEditor controller={controller} view={view} />}
    </main>
  </AppFrame>
}
