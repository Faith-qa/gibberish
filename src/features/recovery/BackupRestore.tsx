import { useRef, useState } from 'react'
import type { AppController, AppView } from '../../app/controller'
import { PassphraseForm } from '../onboarding/AccessForms'
export function RestoreFile({ controller, view }: { controller: AppController; view: Extract<AppView, { screen: 'restore-file' }> }) {
  const picker = useRef<HTMLInputElement>(null)
  return <div className="space-y-5"><p>Restore a supported authenticated encrypted backup into this empty browser. Existing journals are never merged or replaced. The original file is not modified.</p>
    <p>A backup protects journal content but contains visible metadata. A recovery key unlocks an existing backup; it cannot replace lost journal data. Maximum file size: 32 MiB.</p>
    <input ref={picker} type="file" accept="application/json,.json" hidden onChange={(event) => { const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void controller.selectBackup(file) }} />
    <button className="button-secondary" disabled={view.busy} onClick={()=>picker.current?.click()}>Choose encrypted backup file</button>
    {view.selected && <><p role="status">File selected. Continue to verify its credentials.</p><button className="button" onClick={()=>controller.continueRestore()}>Continue with selected backup</button></>}
  </div>
}
export function RestoreCredentials({ controller, busy }: { controller: AppController; busy: boolean }) {
  const [recovery,setRecovery]=useState(false);const [credential,setCredential]=useState('')
  return <form className="space-y-5" aria-busy={busy} onSubmit={(event)=>{event.preventDefault();const value=credential;setCredential('');void controller.authenticateBackup(value,recovery?'recovery':'passphrase')}}>
    <p>The passphrase saved with this backup or its independent recovery key is required. A newer passphrase might not unlock an older file.</p>
    <fieldset className="space-y-5" disabled={busy}><legend className="sr-only">Authenticate the backup</legend>
      <label className="field-label">{recovery?'Backup recovery key':'Backup passphrase'}<input type="password" spellCheck={false} autoCapitalize="none" autoComplete={recovery?'off':'current-password'} value={credential} onChange={(e)=>setCredential(e.target.value)} required /></label>
      <button className="button" type="submit">Verify encrypted backup</button>
      <button className="button-secondary" type="button" onClick={()=>{setCredential('');setRecovery(!recovery)}}>{recovery?'Use backup passphrase instead':'Use backup recovery key instead'}</button>
    </fieldset>
  </form>
}
export function RestoreSummary({ controller, view }: { controller: AppController; view: Extract<AppView, { screen: 'restore-summary' }> }) {
  const [acknowledged,setAcknowledged]=useState(false)
  return <div className="space-y-5"><div className="card space-y-3"><h2 className="text-xl font-semibold">Authenticated backup summary</h2>
    <p>Snapshot exported <time dateTime={view.summary.exportedAt}>{new Date(view.summary.exportedAt).toLocaleString()}</time>.</p>
    <p>Entries: {view.summary.entries}. Trash: {view.summary.trash}. Conflicts: {view.summary.conflicts}. Permanent deletion markers: {view.summary.tombstones}.</p></div>
    <p className="warning">This is a point-in-time snapshot. It cannot know about later deletions elsewhere and may restore older content. Original Trash dates remain; expired Trash can be cleaned during normal unlocked use. This does not restart the 30-day period.</p>
    {view.summary.needsPassphrase ? <><p>Recovery was authenticated. Choose a replacement passphrase before any journal is committed.</p><PassphraseForm controller={controller} restore busy={view.busy} /></> : <form className="space-y-5" onSubmit={(event)=>{event.preventDefault();const value=acknowledged;setAcknowledged(false);void controller.confirmRestore(value)}}>
      <label className="flex items-start gap-3"><input type="checkbox" checked={acknowledged} onChange={(e)=>setAcknowledged(e.target.checked)} disabled={view.busy} required /><span>I understand this restores the selected snapshot, including original Trash retention dates, into this empty browser only.</span></label>
      <button className="button" type="submit" disabled={view.busy}>Confirm encrypted restoration</button>
    </form>}
  </div>
}
