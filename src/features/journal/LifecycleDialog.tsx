import { useEffect, useRef } from 'react'
export function LifecycleDialog({ kind, cancel, confirm }: { kind: 'trash' | 'restore' | 'delete'; cancel(): void; confirm(): void }) {
  const dialog = useRef<HTMLDialogElement>(null); const safe = useRef<HTMLButtonElement>(null)
  useEffect(() => { const d = dialog.current; d?.showModal(); safe.current?.focus(); return () => d?.close() }, [])
  const action = kind === 'delete' ? 'Permanently delete locally' : kind === 'trash' ? 'Move to Trash' : 'Restore entry'
  const close = (callback: () => void) => { dialog.current?.close(); callback() }
  return <dialog ref={dialog} className="card max-w-lg space-y-5" aria-labelledby="lifecycle-heading" onCancel={(event) => { event.preventDefault(); close(cancel) }}>
    <h2 id="lifecycle-heading" className="text-xl font-semibold">{action}?</h2>
    <p>{kind === 'delete' ? 'This removes all encrypted versions of this entry from this browser. A content-free deletion marker remains. This cannot be undone here or erase older backups, browser snapshots or copies elsewhere.'
      : kind === 'trash' ? 'The encrypted entry leaves the main journal. After 30 days it becomes eligible for permanent deletion when this app next runs unlocked. Check your device date; exact-time background deletion is not guaranteed.'
        : 'Restore this encrypted entry to the journal with a new authenticated revision. Original versions remain in history.'}</p>
    <div className="flex flex-wrap gap-3"><button className="button-secondary" ref={safe} onClick={() => close(cancel)}>Cancel</button><button className="button" onClick={() => close(confirm)}>{action}</button></div>
  </dialog>
}
