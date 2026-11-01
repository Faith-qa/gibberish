import { JournalCryptoError } from '../core/crypto'
import { warmKdfWorker } from '../core/crypto/argon2-worker-client'
import { JournalError } from '../core/journal'
import type { JournalPayload, JournalService, JournalSession, RecoveryHandle, SetupHandle, RestoreHandle } from '../core/journal'
import type { EntryView, PassphraseResetPlan, PreparedWrite, PreparedDelete, RestorePlan } from '../core/storage'
import { MAX_BACKUP_BYTES } from '../core/export/backup'
import { trashExpired } from '../core/journal/lifecycle'
import { handoffDownload } from './download'
import type { ExportKind } from './download'
import { RetentionClock } from './retention-clock'
import { browserClock, IdleDeadline } from './idle'
import type { Clock } from './idle'

type Detail = Awaited<ReturnType<JournalService['readEncryptedEntry']>>
type SimpleScreen = 'loading' | 'welcome' | 'setup' | 'setup-confirm' | 'locked' | 'concealed' | 'error' | 'tools' | 'export' | 'compatibility' | 'prepared-close'
interface Common { epoch: number; busy: boolean; message: string; notice: string; warning: boolean; pendingDelete: boolean; clockReview: boolean }
export type AppView = Common & (
  | { screen: SimpleScreen }
  | { screen: 'setup-key'; recoveryText: string | null }
  | { screen: 'recovery-reset'; retry: boolean }
  | { screen: 'trash'; entries: readonly EntryView[]; pendingSave: boolean }
  | { screen: 'change-phrase'; retry: boolean }
  | { screen: 'export-ready'; kind: ExportKind; size: number }
  | { screen: 'restore-file'; selected: boolean }
  | { screen: 'restore-credentials' }
  | { screen: 'restore-summary'; summary: ReturnType<JournalService['backupRestoreSummary']> }
  | { screen: 'timeline'; entries: readonly EntryView[]; pendingSave: boolean }
  | { screen: 'detail'; detail: Detail; revealed: JournalPayload | null; page: number; pendingSave: boolean }
  | { screen: 'editor'; draft: JournalPayload; entryId: string | null; baseRevisionId: string | null; dirty: boolean; pendingSave: boolean }
)
type ScreenData = AppView extends infer V ? V extends AppView ? Omit<V, keyof Common> : never : never

function safeMessage(error: unknown): string {
  if (error instanceof JournalError) {
    if (error.code === 'STALE_SNAPSHOT') return 'Journal data changed. Refresh and confirm the operation again; no destructive rebase was attempted.'
    if (error.code === 'CLOCK_REVIEW_REQUIRED') return 'Check this device’s date and time before changing Trash retention or deleting content.'
    if (error.code === 'EXPORT_TOO_LARGE') return 'The file exceeds the supported size or record limit. No data was truncated or deleted.'
    if (error.code === 'INVALID_BACKUP') return 'This encrypted backup is invalid, corrupted, noncanonical or unsupported. No journal was overwritten.'

    if (error.code === 'PASSPHRASE_POLICY') return 'Use at least 15 characters and no more than 1,024 UTF-8 bytes. A passphrase cannot be blank.'
    if (error.code === 'INVALID_CONFIRMATION') return 'The full confirmation must match, and saving the recovery key must be acknowledged.'
    if (error.code === 'COMMIT_UNCERTAIN') return 'The operation outcome is uncertain. Check its outcome before retrying.'
    if (error.code === 'CONFLICT') return 'Multiple versions need review. All saved versions have been preserved.'
    if (error.code === 'JOURNAL_EXISTS') return 'A journal already exists in this browser. Reload detection to unlock it.'
    if (['INTEGRITY_ERROR', 'INCOMPLETE_HISTORY', 'ID_COLLISION', 'DELETION_REVIEW_REQUIRED', 'UNSUPPORTED_DATABASE'].includes(error.code)) return 'Local journal data needs attention. Encrypted records have been preserved.'
    if (error.code === 'RETRY_LIMIT') return 'Other changes kept racing this operation. Check its outcome and try again.'
    if (error.code === 'LIMIT_EXCEEDED') return 'The local journal size limit was reached. Existing encrypted data has been preserved.'
    return 'Local storage could not complete the operation. Check its outcome before retrying.'
  }
  if (error instanceof JournalCryptoError) {
    if (['AUTHENTICATION_FAILED', 'INVALID_INPUT'].includes(error.code)) return 'These credentials could not unlock the journal, or the encrypted data could not be verified.'
    return 'Cryptography could not complete in this browser. No weaker fallback was used.'
  }
  return 'The operation was interrupted. Check its outcome before retrying.'
}

/** Owns capabilities and sealed retry evidence; never exposes them in React state. */
export class AppController {
  readonly #service: JournalService
  readonly #idle: IdleDeadline
  readonly #clock: Clock
  readonly #retention: RetentionClock
  readonly #download: typeof handoffDownload
  readonly #warm: () => Promise<void>
  readonly #close: () => void
  readonly #compatibility: () => Promise<boolean>
  #blocked = false
  #checking = false
  #resumeRequest = 0
  readonly #listeners = new Set<() => void>()
  #session: JournalSession | undefined
  #setup: SetupHandle | undefined
  #recovery: RecoveryHandle | undefined
  #journalId: string | undefined
  #pendingWrite: PreparedWrite | undefined
  #pendingReset: PassphraseResetPlan | undefined
  #pendingDelete: PreparedDelete | undefined
  #pendingRestoration: RestorePlan | undefined
  #restoreFlow: { bytes?: Uint8Array<ArrayBuffer>; handle?: RestoreHandle; selection: number } | undefined
  #artifact: { bytes: Uint8Array<ArrayBuffer>; kind: ExportKind } | undefined
  #downloadCleanup: (() => void) | undefined
  #scope: 'active' | 'trash' = 'active'
  #selectedEntry: string | undefined
  #resetKind: 'recovery' | 'change' = 'recovery'
  #nextMaintenance = 0
  #generation = 0
  #visible = true
  #abort: AbortController | undefined
  #timer: ReturnType<typeof setInterval> | undefined
  #view: AppView = { screen: 'loading', epoch: 0, busy: false, message: '', notice: '', warning: false, pendingDelete: false, clockReview: false }
  constructor(service: JournalService, options: { clock?: Clock; warm?: () => Promise<void>; download?: typeof handoffDownload; close?: () => void; compatibility?: () => Promise<boolean> } = {}) {
    this.#service = service; this.#clock = options.clock ?? browserClock; this.#retention = new RetentionClock(this.#clock); this.#idle = new IdleDeadline(this.#clock); this.#warm = options.warm ?? warmKdfWorker; this.#download = options.download ?? handoffDownload
    this.#close = options.close ?? (() => {}); this.#compatibility = options.compatibility ?? (async () => true)
  }
  snapshot = (): AppView => this.#view
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener) } }
  #publish(view: AppView): void { this.#view = Object.freeze(view); for (const listener of this.#listeners) listener() }
  #show(data: ScreenData, notice = ''): void {
    this.#publish({ ...data, epoch: this.#generation, busy: false, message: '', notice, warning: this.#idle.remaining() <= 30_000, pendingDelete: Boolean(this.#pendingDelete), clockReview: this.#retention.unsafe } as AppView)
  }
  #disposeExport(): void { this.#artifact?.bytes.fill(0); this.#artifact = undefined; this.#downloadCleanup?.(); this.#downloadCleanup = undefined }
  #invalidate(): void { this.#disposeExport(); this.#generation++; this.#abort?.abort(); this.#abort = undefined }
  #live(epoch: number): boolean { if (this.#blocked || this.#checking) return false; if (this.#idle.expired()) this.lock('The five-minute inactivity deadline expired.'); return this.#visible && epoch === this.#generation }
  #guard(epoch: number): void { if (!this.#live(epoch)) throw new DOMException('Operation cancelled.', 'AbortError') }
  #authorized(): JournalSession { if (!this.#session) throw new JournalError('LOCKED'); return this.#session }
  #activity(): boolean { if (this.#blocked || this.#checking || !this.#visible) return false; if (!this.#idle.activity()) { this.lock('The five-minute inactivity deadline expired.'); return false } return true }
  activity(): void { this.#activity() }
  startTimer(): void { this.#timer ??= setInterval(() => this.checkDeadline(), 1000) }
  stopTimer(): void { if (this.#timer) clearInterval(this.#timer); this.#timer = undefined }
  checkDeadline(): void {
    if (this.#blocked) return
    this.#retention.sample()
    if (this.#idle.expired()) { this.lock('The five-minute inactivity deadline expired.'); return }
    const clockReview = this.#retention.unsafe
    const warning = this.#visible && this.#idle.remaining() <= 30_000
    if (warning !== this.#view.warning || clockReview !== this.#view.clockReview) this.#publish({ ...this.#view, warning, clockReview })
  }
  lock(notice = 'This tab is locked. Unsaved writing was cleared.'): void {
    if (this.#blocked) return
    this.#resumeRequest++; this.#checking = false
    this.#invalidate(); this.#session?.close(); this.#setup?.close(); this.#recovery?.close()
    this.#restoreFlow?.bytes?.fill(0); this.#restoreFlow?.handle?.close(); this.#restoreFlow = undefined; this.#selectedEntry = undefined; this.#scope = 'active'
    this.#session = undefined; this.#setup = undefined; this.#recovery = undefined; this.#idle.stop()
    this.#show({ screen: this.#journalId ? 'locked' : 'welcome' }, notice)
  }
  conceal(): void {
    if (this.#blocked) return
    this.#resumeRequest++; this.#checking = false
    this.#visible = false; this.#invalidate()
    if (this.#idle.expired()) this.lock('The five-minute inactivity deadline expired.')
    else this.#show({ screen: 'concealed' }, 'Content is concealed. Authorization may remain active until the original inactivity deadline.')
  }
  pagehide(): void { this.#visible = false; this.lock('This tab was locked when the page was left.') }
  async resume(): Promise<void> {
    if (this.#blocked) return
    this.#visible = true
    if (this.#idle.expired()) { this.lock('The five-minute inactivity deadline expired.'); return }
    if (this.#checking) return
    this.#checking = true
    const request = ++this.#resumeRequest
    const checkingEpoch = this.#generation
    let compatible: boolean
    try { compatible = await this.#compatibility() } catch { compatible = false }
    if (request !== this.#resumeRequest) return
    this.#checking = false
    if (this.#blocked || checkingEpoch !== this.#generation || !this.#visible) return
    if (!compatible) { this.invalidateCompatibility(); return }
    if (this.#idle.expired()) { this.lock('The five-minute inactivity deadline expired.'); return }
    if (this.#restoreFlow) {
      await this.#run(async (_, epoch) => {
        const found = await this.#service.discoverJournal(); this.#guard(epoch)
        if (found.kind === 'existing') { this.#journalId = found.journalId; this.lock('Restoration persistence was detected. Unlock to verify its outcome.'); return }
        const flow = this.#restoreFlow
        if (flow?.handle) this.#show({ screen: 'restore-summary', summary: this.#service.backupRestoreSummary(flow.handle) })
        else this.#show({ screen: 'restore-file', selected: Boolean(flow?.bytes) }, 'Continue explicitly; no credentials or previous private view were restored.')
      }); return
    }
    if (this.#recovery && this.#resetKind === 'change' && this.#pendingReset) { this.#show({ screen: 'change-phrase', retry: true }); return }
    if (this.#session) { await this.backToList(); return }
    if (this.#setup) {
      await this.#run(async (_, epoch) => {
        const found = await this.#service.discoverJournal(); this.#guard(epoch)
        if (found.kind === 'existing') { this.#journalId = found.journalId; this.lock('Setup persistence was detected. Unlock to continue.'); return }
        this.#show({ screen: 'setup-key', recoveryText: null }, 'The recovery key is concealed. Show it or continue to confirmation.')
      }); return
    }
    if (this.#recovery) {
      this.#pendingReset ??= this.#service.preparedPassphraseReset(this.#recovery)
      this.#show({ screen: 'recovery-reset', retry: Boolean(this.#pendingReset) }); return
    }
    await this.boot()
  }
  async #run(task: (signal: AbortSignal, epoch: number) => Promise<void>): Promise<void> {
    if (this.#blocked || this.#checking || this.#view.busy || !this.#visible) return
    if (this.#idle.expired()) { this.lock('The five-minute inactivity deadline expired.'); return }
    const epoch = this.#generation; const abort = new AbortController(); this.#abort = abort
    this.#publish({ ...this.#view, busy: true, message: '', notice: '' })
    try { await task(abort.signal, epoch) }
    catch (error) {
      if (!this.#live(epoch)) return
      if (error instanceof JournalError && error.code === 'ENTRY_DELETED' && this.#session) {
        const entryId = this.#view.screen === 'editor' ? this.#view.entryId : this.#selectedEntry
        if (this.#pendingWrite?.revision.entryId === entryId) this.#pendingWrite = undefined
        if (this.#pendingDelete?.tombstone.entryId === entryId) this.#pendingDelete = undefined
        try { await this.#loadTimeline(epoch, 'This entry is permanently deleted. An earlier save outcome cannot be inferred from that fact.') }
        catch { this.lock('Journal data needs attention. Encrypted records were preserved.') }
        return
      }
      if (error instanceof JournalError && error.code === 'STALE_SNAPSHOT' && this.#pendingDelete) {
        this.#pendingDelete = undefined
        this.#publish({ ...this.#view, pendingDelete: false })
      }
      if (error instanceof JournalError && ['LOCKED', 'AUTHORIZATION_CHANGED'].includes(error.code)) { this.lock('Authorization changed. Unlock this tab again.'); return }
      if (this.#session && ((error instanceof JournalCryptoError && error.code === 'AUTHENTICATION_FAILED')
        || (error instanceof JournalError && ['INTEGRITY_ERROR', 'INCOMPLETE_HISTORY', 'ID_COLLISION', 'DELETION_REVIEW_REQUIRED'].includes(error.code)))) {
        this.lock(safeMessage(error)); return
      }
      if (this.#session && ['locked', 'loading'].includes(this.#view.screen)) {
        this.lock(safeMessage(error)); return
      }
      this.#publish({ ...this.#view, busy: false, message: safeMessage(error) })
    } finally {
      if (this.#abort === abort) this.#abort = undefined
      if (this.#live(epoch) && this.#view.busy) this.#publish({ ...this.#view, busy: false })
    }
  }
  async boot(): Promise<void> {
    if (this.#blocked || this.#checking) return
    this.lock(''); this.#visible = true; this.#show({ screen: 'loading' })
    await this.#run(async (_, epoch) => {
      const [found] = await Promise.all([this.#service.discoverJournal(), this.#warm()]); this.#guard(epoch)
      this.#journalId = found.kind === 'existing' ? found.journalId : undefined
      this.#show({ screen: this.#journalId ? 'locked' : 'welcome' })
    })
    if (this.#view.screen === 'loading' && !this.#view.busy && this.#view.message) this.#publish({ ...this.#view, screen: 'error' })
  }
  beginSetup(): void { if (!this.#activity()) return; this.#idle.start(); this.#invalidate(); this.#show({ screen: 'setup' }) }
  async prepareSetup(passphrase: string, confirmation: string): Promise<void> {
    if (!this.#activity()) return
    await this.#run(async (signal, epoch) => {
      const handle = await this.#service.prepareJournal(passphrase, confirmation, signal)
      if (!this.#live(epoch)) { handle.close(); return }
      this.#setup = handle
      this.#show({ screen: 'setup-key', recoveryText: this.#service.getRecoveryKey(handle) })
    })
  }
  showRecoveryKey(): void {
    if (!this.#activity() || !this.#setup) return
    this.#show({ screen: 'setup-key', recoveryText: this.#service.getRecoveryKey(this.#setup) })
  }
  confirmRecoveryScreen(): void { if (this.#activity() && this.#setup) this.#show({ screen: 'setup-confirm' }) }
  async confirmSetup(key: string, acknowledged: boolean): Promise<void> {
    if (!this.#activity() || !this.#setup) return
    const handle = this.#setup
    await this.#run(async (signal, epoch) => {
      const result = await this.#service.confirmJournal(handle, key, acknowledged, signal)
      if (!this.#live(epoch)) { result.session.close(); return }
      this.#setup = undefined; this.#session = result.session; this.#journalId = result.journalId
      await this.#loadTimeline(epoch, 'Journal initialized locally. Keep your recovery key safe.')
    })
  }
  async unlock(credential: string, recovery = false): Promise<void> {
    if (!this.#activity() || !this.#journalId) return
    this.#idle.start()
    const journalId = this.#journalId
    await this.#run(async (signal, epoch) => {
      if (recovery) {
        const handle = await this.#service.authenticateRecovery(journalId, credential, signal)
        if (!this.#live(epoch)) { handle.close(); return }
        this.#recovery = handle; this.#resetKind = 'recovery'
        if (this.#pendingReset) {
          const result = await this.#service.reconcileRecoveryReset(handle, this.#pendingReset)
          if (!this.#live(epoch)) { result?.session.close(); return }
          this.#pendingReset = undefined
          if (result) {
            this.#recovery = undefined; this.#session = result.session
            await this.#loadTimeline(epoch, 'Passphrase reset was verified locally.'); return
          }
        }
        // A fresh recovery flow never blindly adopts an uncommitted old plan.
        this.#show({ screen: 'recovery-reset', retry: false })
      } else {
        const session = await this.#service.unlockJournal(journalId, credential, signal)
        if (!this.#live(epoch)) { session.close(); return }
        this.#session = session
        let notice = ''
        if (this.#pendingReset) {
          const outcome = await this.#service.inspectPassphraseReset(session, this.#pendingReset); this.#guard(epoch)
          notice = outcome === 'committed' ? 'Passphrase reset was verified locally.' : 'The earlier passphrase reset was not committed.'
          this.#pendingReset = undefined
        }
        if (this.#pendingRestoration && this.#pendingRestoration.snapshot.journal.config.journalId === journalId) {
          await this.#service.inspectBackupRestore(session, this.#pendingRestoration); this.#guard(epoch)
          this.#pendingRestoration = undefined; notice = 'Encrypted restoration was verified locally.'
        }
        await this.#loadTimeline(epoch, notice)
      }
    })
  }
  async resetPassphrase(passphrase: string, confirmation: string): Promise<void> {
    if (!this.#activity() || !this.#recovery) return
    const handle = this.#recovery
    await this.#run(async (signal, epoch) => {
      const plan = await this.#service.preparePassphraseReset(handle, passphrase, confirmation, signal)
      this.#guard(epoch); this.#pendingReset = plan
      this.#show({ screen: 'recovery-reset', retry: true }); this.#publish({ ...this.#view, busy: true })
      await this.#finishReset(handle, plan, signal, epoch)
    })
  }
  async retryReset(): Promise<void> {
    if (!this.#activity() || !this.#recovery || !this.#pendingReset) return
    const handle = this.#recovery; const plan = this.#pendingReset
    await this.#run((signal, epoch) => this.#finishReset(handle, plan, signal, epoch))
  }
  async #finishReset(handle: RecoveryHandle, plan: PassphraseResetPlan, signal: AbortSignal, epoch: number): Promise<void> {
    const result = await this.#service.commitPassphraseReset(handle, plan, signal)
    if (!this.#live(epoch)) { result.session.close(); return }
    this.#recovery = undefined; this.#pendingReset = undefined; this.#session?.close(); this.#session = result.session
    await this.#loadTimeline(epoch, this.#resetKind === 'change' ? 'Passphrase change was verified locally.' : 'Passphrase reset was verified locally.')
  }
  async #loadTimeline(epoch: number, notice = ''): Promise<void> {
    if (notice) this.#nextMaintenance = Math.max(this.#nextMaintenance, this.#clock.monotonic() + 2_000)
    const entries = this.#scope === 'trash' ? await this.#service.listTrashViews(this.#authorized()) : await this.#service.listEntryViews(this.#authorized()); this.#guard(epoch)
    this.#show({ screen: this.#scope === 'trash' ? 'trash' : 'timeline', entries, pendingSave: Boolean(this.#pendingWrite) }, notice)
  }
  async timeline(): Promise<void> {
    this.#scope = 'active'
    if (!this.#visible) return
    // Navigation discards revealed state before starting any asynchronous read.
    this.#invalidate(); this.#show({ screen: 'loading' })
    await this.#run((_, epoch) => this.#loadTimeline(epoch))
  }
  async openEntry(entryId: string, revisionId?: string): Promise<void> {
    if (!this.#activity()) return
    this.#selectedEntry = entryId
    this.#invalidate(); this.#show({ screen: 'loading' })
    await this.#run(async (_, epoch) => {
      const detail = await this.#service.readEncryptedEntry(this.#authorized(), entryId, revisionId); this.#guard(epoch)
      this.#show({ screen: 'detail', detail, revealed: null, page: 0, pendingSave: Boolean(this.#pendingWrite) })
    })
  }
  async reveal(): Promise<void> {
    if (!this.#activity() || this.#view.screen !== 'detail') return
    const detail = this.#view.detail
    await this.#run(async (_, epoch) => {
      const read = await this.#service.readEntry(this.#authorized(), detail.revision.entryId, detail.revision.revisionId); this.#guard(epoch)
      this.#show({ screen: 'detail', detail, revealed: read.payload, page: 0, pendingSave: Boolean(this.#pendingWrite) })
    })
  }
  hide(): void {
    if (!this.#activity() || this.#view.screen !== 'detail') return
    const detail = this.#view.detail; const page = this.#view.page
    this.#invalidate(); this.#show({ screen: 'detail', detail, page, revealed: null, pendingSave: Boolean(this.#pendingWrite) })
  }
  page(index: number): void {
    if (this.#activity() && this.#view.screen === 'detail' && Number.isSafeInteger(index) && index >= 0) this.#publish({ ...this.#view, page: index })
  }
  newEntry(): void {
    if (!this.#activity() || !this.#session || this.#pendingWrite || this.#pendingDelete || this.#pendingReset) return
    this.#selectedEntry = undefined; this.#invalidate(); this.#show({ screen: 'editor', draft: { title: '', body: '' }, entryId: null, baseRevisionId: null, dirty: false, pendingSave: false })
  }
  edit(): void {
    if (!this.#activity() || this.#pendingWrite || this.#pendingDelete || this.#pendingReset || this.#view.screen !== 'detail' || !this.#view.revealed || this.#view.detail.projection.status === 'conflicted' || this.#view.detail.revision.status !== 'active') return
    const { detail, revealed } = this.#view
    this.#invalidate(); this.#show({ screen: 'editor', draft: { ...revealed }, entryId: detail.revision.entryId, baseRevisionId: detail.revision.revisionId, dirty: false, pendingSave: false })
  }
  updateDraft(value: JournalPayload): void {
    if (this.#activity() && this.#view.screen === 'editor' && !this.#view.busy && !this.#view.pendingSave) this.#publish({ ...this.#view, draft: { title: value.title, body: value.body }, dirty: true, message: '' })
  }
  isDirty(): boolean { return this.#view.screen === 'editor' && this.#view.dirty }

  invalidateCompatibility(): void {
    if (this.#blocked) return
    this.lock(''); this.#blocked = true; this.#close()
    this.#show({ screen: 'compatibility' }, 'App or storage version changed. This tab was locked. Close this window and reopen with a compatible version. This tab did not reset journal storage.')
  }
  prepareToClose(): boolean {
    if (this.#blocked) return false
    if (this.#checking || this.#view.busy || this.isDirty() || this.#setup || this.#recovery || this.#restoreFlow
      || this.#artifact || this.#downloadCleanup || this.#pendingWrite || this.#pendingDelete || this.#pendingReset || this.#pendingRestoration
      || ['setup', 'setup-key', 'setup-confirm', 'change-phrase', 'export', 'export-ready', 'restore-file', 'restore-credentials', 'restore-summary'].includes(this.#view.screen)) {
      this.#publish({ ...this.#view, message: 'Finish, cancel or check interrupted operations before preparing this window to close. Save writing or explicitly discard it first.' })
      return false
    }
    this.lock(''); this.#blocked = true; this.#close()
    this.#show({ screen: 'prepared-close' }, 'This window is locked and ready to close. Close all Gibberish tabs and app windows, then reopen. Other windows have not been locked or saved by this action.')
    return true
  }
  async save(): Promise<void> {
    if (!this.#activity() || this.#view.screen !== 'editor' || this.#pendingWrite || this.#pendingDelete || this.#pendingReset) return
    const view = this.#view; const session = this.#authorized()
    await this.#run(async (_, epoch) => {
      const plan = view.entryId && view.baseRevisionId
        ? await this.#service.prepareEdit(session, view.entryId, view.baseRevisionId, view.draft)
        : await this.#service.prepareCreate(session, view.draft)
      this.#guard(epoch); this.#pendingWrite = plan
      if (this.#view.screen === 'editor') this.#publish({ ...this.#view, pendingSave: true })
      await this.#commitSave(plan, epoch)
    })
  }
  async #commitSave(plan: PreparedWrite, epoch: number): Promise<void> {
    await this.#service.commitWrite(this.#authorized(), plan); this.#guard(epoch)
    this.#pendingWrite = undefined
    await this.#loadTimeline(epoch, 'Saved locally. This is not a cloud backup.')
  }
  async checkSave(retry = false): Promise<void> {
    if (!this.#activity() || !this.#pendingWrite) return
    const plan = this.#pendingWrite
    await this.#run(async (_, epoch) => {
      const receipt = await this.#service.inspectCommit(this.#authorized(), plan); this.#guard(epoch)
      if (receipt) { this.#pendingWrite = undefined; await this.#loadTimeline(epoch, 'Saved locally. The interrupted save was verified.'); return }
      if (retry) { await this.#commitSave(plan, epoch); return }
      await this.#loadTimeline(epoch, 'The prepared entry has not been saved. You can retry the same encrypted entry.')
    })
  }
  async trash(): Promise<void> { this.#scope = 'trash'; await this.backToList() }
  async backToList(): Promise<void> {
    if (!this.#visible) return
    this.#invalidate(); this.#show({ screen: 'loading' })
    await this.#run((_, epoch) => this.#loadTimeline(epoch))
  }
  refreshOnFocus(): void {
    this.checkDeadline()
    if (this.#visible && this.#session && !this.#view.busy && ['detail', 'timeline', 'trash'].includes(this.#view.screen)) void this.backToList()
  }
  tools(): void {
    if (!this.#activity() || !this.#session || this.#pendingWrite || this.#pendingDelete || this.#pendingReset) return
    this.#invalidate(); this.#show({ screen: 'tools' })
  }
  exportScreen(): void { if (this.#activity() && this.#session) { this.#invalidate(); this.#show({ screen: 'export' }) } }
  changeScreen(): void { if (this.#activity() && this.#session && !this.#pendingWrite && !this.#pendingDelete) { this.#invalidate(); this.#show({ screen: 'change-phrase', retry: Boolean(this.#pendingReset) }) } }
  async changePassphrase(current: string, phrase: string, confirmation: string): Promise<void> {
    if (!this.#activity() || !this.#session || this.#pendingReset) return
    const session = this.#session
    await this.#run(async (signal, epoch) => {
      const prepared = await this.#service.preparePassphraseChange(session, current, phrase, confirmation, signal)
      if (!this.#live(epoch)) { prepared.handle.close(); return }
      this.#resetKind = 'change'; this.#recovery = prepared.handle; this.#pendingReset = prepared.plan
      this.#show({ screen: 'change-phrase', retry: true }); this.#publish({ ...this.#view, busy: true })
      await this.#finishReset(prepared.handle, prepared.plan, signal, epoch)
    })
  }
  async transitionEntry(target: 'trash' | 'restore', confirmed: boolean): Promise<void> {
    if (!this.#activity() || this.#view.screen !== 'detail' || !confirmed || this.#pendingWrite || this.#pendingDelete) return
    const detail = this.#view.detail
    this.hide()
    await this.#run(async (signal, epoch) => {
      const plan = target === 'trash' ? await this.#service.prepareTrash(this.#authorized(), detail.revision.entryId, detail.revision.revisionId, signal)
        : await this.#service.prepareRestore(this.#authorized(), detail.revision.entryId, detail.revision.revisionId, signal)
      this.#guard(epoch); this.#pendingWrite = plan
      await this.#service.commitWrite(this.#authorized(), plan); this.#guard(epoch); this.#pendingWrite = undefined
      await this.#loadTimeline(epoch, 'The encrypted transition was saved locally. Any concurrent versions remain preserved.')
    })
  }
  async deleteEntry(confirmed: boolean): Promise<void> {
    if (!this.#activity() || this.#view.screen !== 'detail' || !confirmed || this.#pendingWrite || this.#pendingDelete) return
    const detail = this.#view.detail; this.hide()
    await this.#run(async (signal, epoch) => {
      const plan = await this.#service.preparePermanentDelete(this.#authorized(), detail.revision.entryId, detail.revision.revisionId, 'manual', true, signal)
      this.#guard(epoch); this.#pendingDelete = plan; this.#publish({ ...this.#view, pendingDelete: true })
      await this.#service.commitPermanentDelete(this.#authorized(), plan, signal); this.#guard(epoch); this.#pendingDelete = undefined
      await this.#loadTimeline(epoch, 'Permanently deleted locally. A content-free deletion marker remains; older backups cannot be erased.')
    })
  }
  async checkDeletion(): Promise<void> {
    if (!this.#activity() || !this.#pendingDelete) return
    const plan = this.#pendingDelete
    await this.#run(async (signal, epoch) => {
      this.#selectedEntry = plan.tombstone.entryId
      const receipt = await this.#service.inspectPermanentDelete(this.#authorized(), plan, signal); this.#guard(epoch)
      if (!receipt) { await this.#service.commitPermanentDelete(this.#authorized(), plan, signal); this.#guard(epoch) }
      this.#pendingDelete = undefined
      await this.#loadTimeline(epoch, 'Permanent deletion was verified locally.')
    })
  }
  reviewClock(acknowledged: boolean): void {
    if (acknowledged && this.#activity() && this.#session) { this.#retention.review(); this.#nextMaintenance = 0; this.#publish({ ...this.#view, clockReview: false }) }
  }
  async maintenance(): Promise<void> {
    if (!this.#retention.sample()) return
    if (!this.#visible || !this.#session || this.#view.busy || !['timeline', 'trash'].includes(this.#view.screen)
      || this.#pendingWrite || this.#pendingDelete || this.#pendingReset || this.#clock.monotonic() < this.#nextMaintenance) return
    if (this.#idle.expired()) { this.lock(); return }
    this.#nextMaintenance = this.#clock.monotonic() + 60_000
    await this.#run(async (signal, epoch) => {
      const rows = await this.#service.listTrashViews(this.#authorized()); this.#guard(epoch)
      if (rows.some(({ projection }) => projection.deletedAt && Date.parse(projection.deletedAt) > this.#clock.wall())) {
        this.#retention.defer(); this.#publish({ ...this.#view, clockReview: true }); return
      }
      const eligible = rows.filter(({ projection }) => projection.status === 'trashed' && projection.deletedAt && trashExpired(projection.deletedAt, this.#clock.wall()))
      for (const { projection } of eligible.slice(0, 3)) {
        this.#guard(epoch)
        const plan = await this.#service.preparePermanentDelete(this.#authorized(), projection.entryId, projection.headRevisionIds[0]!, 'expiry', false, signal)
        this.#guard(epoch); this.#pendingDelete = plan
        await this.#service.commitPermanentDelete(this.#authorized(), plan, signal); this.#guard(epoch); this.#pendingDelete = undefined
      }
      if (eligible.length) await this.#loadTimeline(epoch, 'Eligible Trash entries were processed locally. Cleanup is not an exact-time background service.')
      if (eligible.length > 3) this.#nextMaintenance = this.#clock.monotonic() + 5_000
    })
  }
  async generateExport(kind: ExportKind, acknowledged = false): Promise<void> {
    if (!this.#activity() || !this.#session) return
    this.#disposeExport()
    await this.#run(async (signal, epoch) => {
      const bytes = kind === 'backup' ? await this.#service.prepareEncryptedBackup(this.#authorized(), signal)
        : await this.#service.prepareReadableExport(this.#authorized(), acknowledged, signal)
      if (!this.#live(epoch)) { bytes.fill(0); return }
      this.#artifact = { bytes, kind }; this.#show({ screen: 'export-ready', kind, size: bytes.length })
    })
  }
  downloadExport(): void {
    if (!this.#activity() || !this.#session || !this.#artifact || this.#view.screen !== 'export-ready') return
    const artifact = this.#artifact
    try {
      this.#downloadCleanup = this.#download(artifact.bytes, artifact.kind)
      artifact.bytes.fill(0); this.#artifact = undefined
      this.#show({ screen: 'tools' }, 'Download requested. Check the saved file; the application cannot verify durable file delivery.')
    } catch { this.#disposeExport(); this.#show({ screen: 'export' }, 'The browser could not hand off the download. Generate it again explicitly.') }
  }
  beginRestore(): void {
    if (!this.#activity() || this.#journalId) return
    this.#idle.start(); this.#invalidate(); this.#restoreFlow = { selection: 0 }; this.#show({ screen: 'restore-file', selected: false })
  }
  async selectBackup(file: File): Promise<void> {
    const flow = this.#restoreFlow; if (!flow || flow.handle) return
    this.#invalidate(); flow.bytes?.fill(0); delete flow.bytes
    if (this.#visible) this.#show({ screen: 'restore-file', selected: false })
    const selection = ++flow.selection
    if (file.size > MAX_BACKUP_BYTES) { if (this.#visible) this.#publish({ ...this.#view, message: safeMessage(new JournalError('EXPORT_TOO_LARGE')) }); return }
    let bytes: Uint8Array<ArrayBuffer> | undefined
    try {
      bytes = new Uint8Array(await file.arrayBuffer())
      if (bytes.byteLength > MAX_BACKUP_BYTES) { bytes.fill(0); throw new JournalError('EXPORT_TOO_LARGE') }
      if (this.#idle.expired()) this.lock()
      if (this.#restoreFlow !== flow || selection !== flow.selection) { bytes.fill(0); return }
      flow.bytes = bytes
      if (this.#visible) this.#show({ screen: 'restore-file', selected: true })
    } catch (error) { bytes?.fill(0); if (this.#restoreFlow === flow && selection === flow.selection && this.#visible) this.#publish({ ...this.#view, message: error instanceof JournalError ? safeMessage(error) : 'The selected file could not be read. No journal was changed.' }) }
  }
  continueRestore(): void { if (this.#activity() && this.#restoreFlow?.bytes) this.#show({ screen: 'restore-credentials' }) }
  async authenticateBackup(credential: string, mode: 'passphrase' | 'recovery'): Promise<void> {
    if (!this.#activity() || !this.#restoreFlow?.bytes) return
    const flow = this.#restoreFlow; const bytes = flow.bytes!
    await this.#run(async (signal, epoch) => {
      const handle = await this.#service.prepareBackupRestore(bytes, credential, mode, signal)
      if (!this.#live(epoch) || this.#restoreFlow !== flow) { handle.close(); return }
      flow.handle = handle; bytes.fill(0); delete flow.bytes
      this.#show({ screen: 'restore-summary', summary: this.#service.backupRestoreSummary(handle) })
    })
  }
  async restorePassphrase(phrase: string, confirmation: string): Promise<void> {
    if (!this.#activity() || !this.#restoreFlow?.handle) return
    const handle = this.#restoreFlow.handle
    await this.#run(async (signal, epoch) => {
      await this.#service.setRestorePassphrase(handle, phrase, confirmation, signal); this.#guard(epoch)
      this.#show({ screen: 'restore-summary', summary: this.#service.backupRestoreSummary(handle) })
    })
  }
  async confirmRestore(acknowledged: boolean): Promise<void> {
    if (!this.#activity() || !acknowledged || !this.#restoreFlow?.handle) return
    const handle = this.#restoreFlow.handle
    await this.#run(async (signal, epoch) => {
      const plan = this.#service.backupRestorePlan(handle); if (!plan) throw new JournalError('INVALID_CONFIRMATION')
      this.#pendingRestoration = plan
      const result = await this.#service.commitBackupRestore(handle, signal)
      if (!this.#live(epoch)) { result.session.close(); return }
      this.#restoreFlow = undefined; this.#pendingRestoration = undefined; this.#session = result.session; this.#journalId = result.journalId
      await this.#loadTimeline(epoch, 'Encrypted restoration was verified locally. Original Trash retention dates remain in effect.')
    })
  }

}
