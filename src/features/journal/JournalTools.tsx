import { useState } from 'react'
import type { AppController, AppView } from '../../app/controller'
export function JournalTools({ controller, busy }: { controller: AppController; busy: boolean }) {
  return <div className="space-y-5"><p>Local journal tools. No account or cloud connection is needed.</p><div className="flex flex-wrap gap-3">
    <button className="button" disabled={busy} onClick={() => controller.exportScreen()}>Export journal</button>
    <button className="button-secondary" disabled={busy} onClick={() => controller.changeScreen()}>Change passphrase</button>
    <button className="button-secondary" onClick={() => { void controller.backToList() }}>Back to journal</button>
  </div><p className="muted">Changing your passphrase preserves the journal encryption key and recovery key. Older backups still use their original credentials.</p></div>
}
export function ExportOptions({ controller, busy }: { controller: AppController; busy: boolean }) {
  const [acknowledged, setAcknowledged] = useState(false)
  return <div className="space-y-6">
    <section className="card space-y-4"><h2 className="text-xl font-semibold">Encrypted backup</h2>
      <p>Includes complete retained history, all conflicting versions, retained Trash (even if eligible for cleanup) and deletion markers. Journal content is encrypted; identifiers, dates, statuses and some configuration remain visible in the file.</p>
      <p>An old offline backup cannot know about later deletions elsewhere. Restoring preserves original Trash dates; it does not restart retention. The supported file limit is 32 MiB; larger exports fail without truncation.</p>
      <button className="button" disabled={busy} onClick={() => { void controller.generateExport('backup') }}>Generate encrypted backup</button>
    </section>
    <section className="card space-y-4"><h2 className="text-xl font-semibold">Readable English Markdown</h2>
      <p className="warning">This file is not encrypted. Anyone with it can read it. Gibberish cannot erase downloaded copies or guarantee how your browser or operating system stores them. Keep it somewhere private.</p>
      <p>Includes active current versions only, with conflicting active versions labelled. Trash and historical versions are excluded. Supported output limit: 16 MiB. No file is downloaded automatically.</p>
      <label className="flex items-start gap-3"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} /><span>I understand this readable file is unencrypted and may outlive this tab.</span></label>
      <button className="button-secondary" disabled={busy || !acknowledged} onClick={() => { setAcknowledged(false); void controller.generateExport('readable', acknowledged) }}>Generate readable Markdown</button>
    </section>
    <button className="button-secondary" disabled={busy} onClick={() => controller.tools()}>Back to journal tools</button>
  </div>
}
export function ExportReady({ controller, view }: { controller: AppController; view: Extract<AppView, { screen: 'export-ready' }> }) {
  return <div className="card space-y-5"><p>{view.kind === 'readable' ? 'Your unencrypted Markdown is ready for an explicit download.' : 'Your authenticated encrypted snapshot is ready. Certain metadata remains visible.'}</p>
    <p>Switching tabs, navigating or locking discards this prepared file. Once handed to the browser, the application cannot recall it or verify durable delivery.</p>
    <button className="button" onClick={() => controller.downloadExport()}>{view.kind === 'backup' ? 'Download encrypted backup' : 'Download readable Markdown'}</button>
    <button className="button-secondary" onClick={() => controller.tools()}>Discard prepared file</button></div>
}
export function ChangePassphrase({ controller, view }: { controller: AppController; view: Extract<AppView, { screen: 'change-phrase' }> }) {
  const [current, setCurrent] = useState(''); const [phrase, setPhrase] = useState(''); const [confirmation, setConfirmation] = useState('')
  if (view.retry) return <div className="space-y-5"><p>A wrapped-key change is prepared. Verify its exact outcome before starting another change.</p><button className="button" disabled={view.busy} onClick={() => { void controller.retryReset() }}>Check and retry prepared change</button></div>
  return <form className="space-y-5" aria-busy={view.busy} onSubmit={(event) => { event.preventDefault(); const a=current,b=phrase,c=confirmation;setCurrent('');setPhrase('');setConfirmation('');void controller.changePassphrase(a,b,c) }}>
    <p>Your current passphrase is authenticated locally. The encryption key, recovery key and encrypted history stay unchanged. Older backups keep their old credentials.</p>
    <fieldset className="space-y-5" disabled={view.busy}>
      <legend className="sr-only">Change your local passphrase</legend>
      <label className="field-label">Current passphrase<input type="password" autoComplete="current-password" spellCheck={false} value={current} onChange={(e)=>setCurrent(e.target.value)} required /></label>
      <p>New passphrase: at least 15 Unicode characters, nonblank, up to 1,024 UTF-8 bytes, used exactly as entered.</p>
      <label className="field-label">New passphrase<input type="password" autoComplete="new-password" spellCheck={false} value={phrase} onChange={(e)=>setPhrase(e.target.value)} required /></label>
      <label className="field-label">Confirm new passphrase<input type="password" autoComplete="new-password" spellCheck={false} value={confirmation} onChange={(e)=>setConfirmation(e.target.value)} required /></label>
      <button className="button" type="submit">Change passphrase locally</button>
    </fieldset>
    <button className="button-secondary" type="button" disabled={view.busy} onClick={()=>controller.tools()}>Cancel passphrase change</button>
  </form>
}
