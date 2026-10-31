import { JournalCryptoError } from '../core/crypto'
import { warmKdfWorker } from '../core/crypto/argon2-worker-client'
import { JournalError } from '../core/journal'
import type { JournalPayload, JournalService, JournalSession, RecoveryHandle, SetupHandle } from '../core/journal'
import type { EntryView, PassphraseResetPlan, PreparedWrite } from '../core/storage'
import { browserClock, IdleDeadline } from './idle'
import type { Clock } from './idle'

type Detail = Awaited<ReturnType<JournalService['readEncryptedEntry']>>
type SimpleScreen = 'loading' | 'welcome' | 'setup' | 'setup-confirm' | 'locked' | 'concealed' | 'error'
interface Common { epoch: number; busy: boolean; message: string; notice: string; warning: boolean }
export type AppView = Common & (
  | { screen: SimpleScreen }
  | { screen: 'setup-key'; recoveryText: string | null }
  | { screen: 'recovery-reset'; retry: boolean }
  | { screen: 'timeline'; entries: readonly EntryView[]; pendingSave: boolean }
  | { screen: 'detail'; detail: Detail; revealed: JournalPayload | null; page: number; pendingSave: boolean }
  | { screen: 'editor'; draft: JournalPayload; entryId: string | null; baseRevisionId: string | null; dirty: boolean; pendingSave: boolean }
)
type ScreenData = AppView extends infer V ? V extends AppView ? Omit<V, keyof Common> : never : never

function safeMessage(error: unknown): string {
  if (error instanceof JournalError) {
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
  readonly #warm: () => Promise<void>
  readonly #listeners = new Set<() => void>()
  #session: JournalSession | undefined
  #setup: SetupHandle | undefined
  #recovery: RecoveryHandle | undefined
  #journalId: string | undefined
  #pendingWrite: PreparedWrite | undefined
  #pendingReset: PassphraseResetPlan | undefined
  #generation = 0
  #visible = true
  #abort: AbortController | undefined
  #timer: ReturnType<typeof setInterval> | undefined
  #view: AppView = { screen: 'loading', epoch: 0, busy: false, message: '', notice: '', warning: false }
  constructor(service: JournalService, options: { clock?: Clock; warm?: () => Promise<void> } = {}) {
    this.#service = service; this.#idle = new IdleDeadline(options.clock ?? browserClock); this.#warm = options.warm ?? warmKdfWorker
  }
  snapshot = (): AppView => this.#view
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener) } }
  #publish(view: AppView): void { this.#view = Object.freeze(view); for (const listener of this.#listeners) listener() }
  #show(data: ScreenData, notice = ''): void {
    this.#publish({ ...data, epoch: this.#generation, busy: false, message: '', notice, warning: this.#idle.remaining() <= 30_000 } as AppView)
  }
  #invalidate(): void { this.#generation++; this.#abort?.abort(); this.#abort = undefined }
  #live(epoch: number): boolean { if (this.#idle.expired()) this.lock('The five-minute inactivity deadline expired.'); return this.#visible && epoch === this.#generation }
  #guard(epoch: number): void { if (!this.#live(epoch)) throw new DOMException('Operation cancelled.', 'AbortError') }
  #authorized(): JournalSession { if (!this.#session) throw new JournalError('LOCKED'); return this.#session }
  #activity(): boolean { if (!this.#visible) return false; if (!this.#idle.activity()) { this.lock('The five-minute inactivity deadline expired.'); return false } return true }
  activity(): void { this.#activity() }
  startTimer(): void { this.#timer ??= setInterval(() => this.checkDeadline(), 1000) }
  stopTimer(): void { if (this.#timer) clearInterval(this.#timer); this.#timer = undefined }
  checkDeadline(): void {
    if (this.#idle.expired()) { this.lock('The five-minute inactivity deadline expired.'); return }
    const warning = this.#visible && this.#idle.remaining() <= 30_000
    if (warning !== this.#view.warning) this.#publish({ ...this.#view, warning })
  }
  lock(notice = 'This tab is locked. Unsaved writing was cleared.'): void {
    this.#invalidate(); this.#session?.close(); this.#setup?.close(); this.#recovery?.close()
    this.#session = undefined; this.#setup = undefined; this.#recovery = undefined; this.#idle.stop()
    this.#show({ screen: this.#journalId ? 'locked' : 'welcome' }, notice)
  }
  conceal(): void {
    this.#visible = false; this.#invalidate()
    if (this.#idle.expired()) this.lock('The five-minute inactivity deadline expired.')
    else this.#show({ screen: 'concealed' }, 'Content is concealed. Authorization may remain active until the original inactivity deadline.')
  }
  pagehide(): void { this.#visible = false; this.lock('This tab was locked when the page was left.') }
  async resume(): Promise<void> {
    this.#visible = true
    if (this.#idle.expired()) { this.lock('The five-minute inactivity deadline expired.'); return }
    if (this.#session) { await this.timeline(); return }
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
    if (this.#view.busy || !this.#visible) return
    if (this.#idle.expired()) { this.lock('The five-minute inactivity deadline expired.'); return }
    const epoch = this.#generation; const abort = new AbortController(); this.#abort = abort
    this.#publish({ ...this.#view, busy: true, message: '' })
    try { await task(abort.signal, epoch) }
    catch (error) {
      if (!this.#live(epoch)) return
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
        this.#recovery = handle
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
    await this.#loadTimeline(epoch, 'Passphrase reset was verified locally.')
  }
  async #loadTimeline(epoch: number, notice = ''): Promise<void> {
    const entries = await this.#service.listEntryViews(this.#authorized()); this.#guard(epoch)
    this.#show({ screen: 'timeline', entries, pendingSave: Boolean(this.#pendingWrite) }, notice)
  }
  async timeline(): Promise<void> {
    if (!this.#visible) return
    // Navigation discards revealed state before starting any asynchronous read.
    this.#invalidate(); this.#show({ screen: 'loading' })
    await this.#run((_, epoch) => this.#loadTimeline(epoch))
  }
  async openEntry(entryId: string, revisionId?: string): Promise<void> {
    if (!this.#activity()) return
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
    if (!this.#activity() || !this.#session || this.#pendingWrite) return
    this.#invalidate(); this.#show({ screen: 'editor', draft: { title: '', body: '' }, entryId: null, baseRevisionId: null, dirty: false, pendingSave: false })
  }
  edit(): void {
    if (!this.#activity() || this.#pendingWrite || this.#view.screen !== 'detail' || !this.#view.revealed || this.#view.detail.projection.status === 'conflicted') return
    const { detail, revealed } = this.#view
    this.#invalidate(); this.#show({ screen: 'editor', draft: { ...revealed }, entryId: detail.revision.entryId, baseRevisionId: detail.revision.revisionId, dirty: false, pendingSave: false })
  }
  updateDraft(value: JournalPayload): void {
    if (this.#activity() && this.#view.screen === 'editor' && !this.#view.busy && !this.#view.pendingSave) this.#publish({ ...this.#view, draft: { title: value.title, body: value.body }, dirty: true, message: '' })
  }
  isDirty(): boolean { return this.#view.screen === 'editor' && this.#view.dirty }
  async save(): Promise<void> {
    if (!this.#activity() || this.#view.screen !== 'editor' || this.#pendingWrite) return
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
}
