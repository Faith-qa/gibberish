import { useState } from 'react'
import type { FormEvent } from 'react'
import type { AppController } from '../../app/controller'

export function PassphraseForm({ controller, reset, restore, busy }: { controller: AppController; reset?: boolean; restore?: boolean; busy: boolean }) {
  const [phrase, setPhrase] = useState(''); const [confirmation, setConfirmation] = useState('')
  function submit(event: FormEvent) {
    event.preventDefault(); const value = phrase; const repeated = confirmation
    setPhrase(''); setConfirmation('')
    void (restore ? controller.restorePassphrase(value, repeated) : reset ? controller.resetPassphrase(value, repeated) : controller.prepareSetup(value, repeated))
  }
  return <form onSubmit={submit} aria-busy={busy}>
    <fieldset disabled={busy} className="space-y-5">
      <legend className="sr-only">{reset ? 'Choose a replacement passphrase' : 'Create a journal passphrase'}</legend>
      <p id="phrase-help">Use at least 15 characters. Spaces and password managers are welcome. Your passphrase is used exactly as entered, up to 1,024 UTF-8 bytes.</p>
      <label className="field-label">{reset || restore ? 'New passphrase' : 'Passphrase'}<input type="password" autoComplete="new-password" spellCheck={false} value={phrase} onChange={(event) => setPhrase(event.target.value)} aria-describedby="phrase-help" required /></label>
      <label className="field-label">Confirm passphrase<input type="password" autoComplete="new-password" spellCheck={false} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>
      <button className="button" type="submit">{restore ? 'Prepare restoration passphrase' : reset ? 'Reset passphrase locally' : 'Prepare recovery key'}</button>
    </fieldset>
  </form>
}

export function UnlockForm({ controller, busy }: { controller: AppController; busy: boolean }) {
  const [recovery, setRecovery] = useState(false); const [credential, setCredential] = useState('')
  function submit(event: FormEvent) {
    event.preventDefault(); const value = credential; setCredential('')
    void controller.unlock(value, recovery)
  }
  return <>
    <p>Unlocking happens on this device. No account is required.</p>
    <form onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy} className="space-y-5">
        <legend className="sr-only">Unlock this tab</legend>
        <label className="field-label">{recovery ? 'Recovery key' : 'Passphrase'}<input type="password" value={credential} onChange={(event) => setCredential(event.target.value)} autoComplete={recovery ? 'off' : 'current-password'} spellCheck={false} autoCapitalize="none" required /></label>
        <button className="button" type="submit">{recovery ? 'Verify recovery key' : 'Unlock journal'}</button>
        <button type="button" className="button-secondary" onClick={() => { setCredential(''); setRecovery(!recovery) }}>{recovery ? 'Use passphrase instead' : 'Use recovery key instead'}</button>
      </fieldset>
    </form>
    <p className="muted">A recovery key unlocks existing encrypted data. It cannot restore journal data lost from browser storage. Losing both credentials can make your journal inaccessible.</p>
  </>
}

export function RecoveryConfirmation({ controller, busy }: { controller: AppController; busy: boolean }) {
  const [key, setKey] = useState(''); const [acknowledged, setAcknowledged] = useState(false)
  function submit(event: FormEvent) {
    event.preventDefault(); const value = key; const acknowledgment = acknowledged
    setKey(''); setAcknowledged(false); void controller.confirmSetup(value, acknowledgment)
  }
  return <form onSubmit={submit} aria-busy={busy}>
    <fieldset disabled={busy} className="space-y-5">
      <legend className="sr-only">Confirm your saved recovery key</legend>
      <p>Paste or enter the entire key from your saved copy. It must match exactly.</p>
      <label className="field-label">Full recovery key<input type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} required /></label>
      <label className="flex items-start gap-3"><input className="mt-1" type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} required /><span>I saved my recovery key securely. I understand that losing both credentials can make my journal inaccessible, and that the key is not a backup of my journal data.</span></label>
      <button className="button" type="submit">Confirm key and create journal</button>
      <button className="button-secondary" type="button" onClick={() => controller.showRecoveryKey()}>Back to recovery key</button>
    </fieldset>
  </form>
}
