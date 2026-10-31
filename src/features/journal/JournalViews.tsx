import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppController, AppView } from '../../app/controller'
import { encryptedPresentation, encryptedPreview } from './presentation'

export function Timeline({ controller, view }: { controller: AppController; view: Extract<AppView, { screen: 'timeline' }> }) {
  return <>
    <div className="flex flex-wrap gap-3">
      <button className="button" disabled={view.busy || view.pendingSave} onClick={() => controller.newEntry()}>New entry</button>
      {view.pendingSave && <><button className="button-secondary" disabled={view.busy} onClick={() => { void controller.checkSave() }}>Check interrupted save</button><button className="button-secondary" disabled={view.busy} onClick={() => { void controller.checkSave(true) }}>Retry prepared save</button></>}
      <button className="button-secondary" disabled={view.busy} onClick={() => { void controller.timeline() }}>Refresh entries</button>
    </div>
    <p className="muted">Entries are shown newest first. Preview words come from the encrypted envelope, not your English title.</p>
    {view.entries.length === 0 && <div className="card"><h2 className="text-xl font-medium">A little space to begin</h2><p>Your journal has no active entries. Choose New entry when you are ready.</p></div>}
    <ul className="space-y-4" aria-label="Encrypted entries">
      {view.entries.map(({ projection, heads }, index) => <li className="card space-y-3" key={projection.entryId}>
        {projection.status === 'conflicted' && <p className="font-semibold text-amber-900">Multiple versions need review. Every branch is preserved; resolution is unavailable here.</p>}
        {heads.map((revision, branch) => <div className="space-y-2" key={revision.revisionId}>
          <h2 id={`entry-${index}-${branch}`} className="gibberish text-xl font-medium">{encryptedPreview(revision.encryptedPayload)}</h2>
          <p className="muted">Preview · Incomplete encrypted-envelope representation{heads.length > 1 ? ` · Version ${branch + 1}` : ''}</p>
          <button className="button-secondary" disabled={view.busy} aria-describedby={`entry-${index}-${branch}`} onClick={() => { void controller.openEntry(projection.entryId, revision.revisionId) }}>{heads.length > 1 ? `Open version ${branch + 1}` : 'Open encrypted entry'}</button>
        </div>)}
        <p className="muted">Created <time dateTime={projection.createdAt}>{new Date(projection.createdAt).toLocaleDateString()}</time> · Local only</p>
      </li>)}
    </ul>
  </>
}

export function EntryDetail({ controller, view }: { controller: AppController; view: Extract<AppView, { screen: 'detail' }> }) {
  const presentation = useMemo(() => encryptedPresentation(view.detail.revision.encryptedPayload), [view.detail.revision])
  const page = Math.min(view.page, presentation.pages - 1)
  return <>
    <div className="flex flex-wrap gap-3">
      <button className="button-secondary" onClick={() => { void controller.timeline() }}>Back to journal</button>
      {view.revealed ? <button className="button" onClick={() => controller.hide()}>Hide My Thoughts</button>
        : <button className="button" disabled={view.busy} onClick={() => { void controller.reveal() }}>Reveal My Thoughts</button>}
      {view.revealed && view.detail.projection.status !== 'conflicted' && <button className="button-secondary" disabled={view.busy || view.pendingSave} onClick={() => controller.edit()}>Edit entry</button>}
    </div>
    {view.detail.projection.status === 'conflicted' && <p className="warning">This is a preserved branch. Editing and conflict resolution are unavailable for a known-conflicted entry.</p>}
    {view.pendingSave && <p className="warning">An interrupted save needs its outcome checked. Return to the journal to check or retry it before editing another entry.</p>}
    {view.revealed ? <section className="card space-y-5" aria-label="Revealed entry">
      <h2 className="break-words text-2xl font-medium">{view.revealed.title}</h2>
      <p className="whitespace-pre-wrap break-words">{view.revealed.body}</p>
    </section> : <section className="card space-y-5" aria-labelledby="encrypted-heading">
      <h2 id="encrypted-heading" className="text-xl font-medium">Encrypted entry in Gibberish</h2>
      <p className="muted">This text reversibly represents the complete encrypted envelope. Gibberish is presentation; encryption protects the entry.</p>
      <pre className="gibberish whitespace-pre-wrap font-sans" aria-label="Gibberish representation">{presentation.page(page)}</pre>
      <nav aria-label="Encrypted representation pages" className="flex flex-wrap items-center gap-3">
        <button className="button-secondary" disabled={page === 0} onClick={() => controller.page(page - 1)}>Previous page</button>
        <span>Page {page + 1} of {presentation.pages}</span>
        <button className="button-secondary" disabled={page + 1 === presentation.pages} onClick={() => controller.page(page + 1)}>Next page</button>
      </nav>
      {presentation.pages > 1 && <p className="muted">Each page is incomplete on its own. Pages in order form one reversible representation; no stored bytes are truncated.</p>}
    </section>}
  </>
}

function DiscardDialog({ onStay, onDiscard, onSave }: { onStay(): void; onDiscard(): void; onSave(): void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const stay = useRef<HTMLButtonElement>(null)
  useEffect(() => { const element = dialog.current; element?.showModal(); stay.current?.focus(); return () => { element?.close() } }, [])
  const close = (action: () => void) => { dialog.current?.close(); action() }
  return <dialog ref={dialog} className="card max-w-md space-y-5" onCancel={(event) => { event.preventDefault(); close(onStay) }} aria-labelledby="discard-heading">
    <h2 id="discard-heading" className="text-xl font-medium">Unsaved writing</h2>
    <p>Save before leaving, discard this visible draft, or stay here. An interrupted prepared save may still need its outcome checked.</p>
    <div className="flex flex-wrap gap-3"><button className="button" onClick={() => close(onSave)}>Save and leave</button><button className="button-secondary" onClick={() => close(onDiscard)}>Discard draft</button><button className="button-secondary" ref={stay} onClick={() => close(onStay)}>Stay here</button></div>
  </dialog>
}

export function EntryEditor({ controller, view }: { controller: AppController; view: Extract<AppView, { screen: 'editor' }> }) {
  const [confirm, setConfirm] = useState(false)
  return <>
    <p className="warning">Unsaved writing stays only in memory. Switching apps or tabs, locking, closing, or refreshing may discard it. Save before leaving.</p>
    <form onSubmit={(event) => { event.preventDefault(); void (view.pendingSave ? controller.checkSave(true) : controller.save()) }} aria-busy={view.busy}>
      <fieldset className="space-y-5" disabled={view.busy || view.pendingSave}>
        <legend className="sr-only">Write your entry</legend>
        <label className="field-label">Title<input autoComplete="off" spellCheck={false} autoCorrect="off" value={view.draft.title} onChange={(event) => controller.updateDraft({ ...view.draft, title: event.target.value })} required /></label>
        <label className="field-label">Body<textarea rows={12} autoComplete="off" spellCheck={false} autoCorrect="off" value={view.draft.body} onChange={(event) => controller.updateDraft({ ...view.draft, body: event.target.value })} required /></label>
      </fieldset>
      <div className="mt-6 flex flex-wrap gap-3">
        <button className="button" type="submit" disabled={view.busy}>{view.pendingSave ? 'Retry prepared save' : 'Save entry locally'}</button>
        {view.pendingSave && <button className="button-secondary" type="button" disabled={view.busy} onClick={() => { void controller.checkSave() }}>Check save outcome</button>}
        <button className="button-secondary" type="button" disabled={view.busy} onClick={() => { if (view.dirty) setConfirm(true); else void controller.timeline() }}>Cancel editing</button>
      </div>
    </form>
    {confirm && <DiscardDialog onStay={() => setConfirm(false)} onDiscard={() => { setConfirm(false); void controller.timeline() }} onSave={() => { setConfirm(false); void (view.pendingSave ? controller.checkSave(true) : controller.save()) }} />}
  </>
}
