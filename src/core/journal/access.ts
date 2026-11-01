import { generateJournalKey, generateRecoveryKey, unwrapWithRecoveryKey, unwrapWithPassphrase, wrapWithPassphrase, wrapWithRecoveryKey } from '../crypto'
import { browserCrypto } from '../crypto/random'
import type { EncryptedJournalRepository, JournalKeys, JournalSnapshot, JournalState, PassphraseResetPlan } from '../storage'
import { check, same, validateKeys, validateResetPlan, validateState } from '../storage/validation'
import type { JournalSession } from './session'
import { authenticateHistory, preserveHistory, notAborted } from './content'
import { projectJournal } from './graph'
import { JournalError } from './errors'

export interface SetupHandle { close(): void }
export interface RecoveryHandle { close(): void }
interface Setup { key: CryptoKey; recovery: string; journal: JournalState }
interface Recovery { key: CryptoKey; snapshot: JournalSnapshot; plan?: PassphraseResetPlan }
type Mint = (state: { key: CryptoKey; journalId: string; keys: JournalKeys }) => JournalSession

export function validateNewPassphrase(value: string, confirmation: string): void {
  check(typeof value === 'string' && typeof confirmation === 'string', 'PASSPHRASE_POLICY')
  check(value.length <= 1024, 'PASSPHRASE_POLICY')
  const bytes = new TextEncoder().encode(value)
  try {
    check(value.trim().length > 0 && Array.from(value).length >= 15 && bytes.length <= 1024
      && new TextDecoder('utf-8', { fatal: true }).decode(bytes) === value, 'PASSPHRASE_POLICY')
  } finally { bytes.fill(0) }
  check(value === confirmation, 'INVALID_CONFIRMATION')
}

/** Domain-only capability owner. Neither handles nor mint callbacks are DTOs. */
export class JournalAccess {
  readonly #repository: EncryptedJournalRepository
  readonly #mint: Mint
  readonly #setups = new WeakMap<SetupHandle, Setup>()
  readonly #recoveries = new WeakMap<RecoveryHandle, Recovery>()
  constructor(repository: EncryptedJournalRepository, mint: Mint) { this.#repository = repository; this.#mint = mint }

  #setup(handle: SetupHandle, signal?: AbortSignal): Setup {
    notAborted(signal); const state = this.#setups.get(handle); check(state, 'LOCKED'); return state
  }
  #recovery(handle: RecoveryHandle, signal?: AbortSignal): Recovery {
    notAborted(signal); const state = this.#recoveries.get(handle); check(state, 'LOCKED'); return state
  }
  async prepareJournal(passphrase: string, confirmation: string, signal?: AbortSignal): Promise<SetupHandle> {
    notAborted(signal); validateNewPassphrase(passphrase, confirmation)
    check((await this.#repository.discoverJournal()).kind === 'empty', 'JOURNAL_EXISTS')
    const journalId = browserCrypto().randomUUID(); const key = await generateJournalKey()
    const recovery = generateRecoveryKey()
    const journal = validateState({
      config: { journalId, schemaVersion: 1, createdAt: new Date().toISOString(), autoLockMinutes: 5, codecVersion: 1, encryptionVersion: 2 },
      keys: { journalId, version: 1, passphraseWrappedKey: await wrapWithPassphrase(key, passphrase, journalId, signal),
        recoveryWrappedKey: await wrapWithRecoveryKey(key, recovery, journalId) },
      device: { deviceId: browserCrypto().randomUUID(), cloudEnabled: false, googleSpreadsheetId: null, googleDriveFolderId: null, lastSuccessfulSyncAt: null },
    })
    notAborted(signal)
    const handle = Object.freeze({ close: () => { this.#setups.delete(handle) } })
    this.#setups.set(handle, { key, recovery, journal })
    return handle
  }
  getRecoveryKey(handle: SetupHandle): string { return this.#setup(handle).recovery }

  async confirmJournal(handle: SetupHandle, confirmation: string, acknowledged: boolean, signal?: AbortSignal): Promise<{ journalId: string; session: JournalSession }> {
    const state = this.#setup(handle, signal)
    check(acknowledged === true && state.recovery === confirmation, 'INVALID_CONFIRMATION')
    const live = () => { this.#setup(handle, signal) }
    try { await this.#repository.initializeJournal(state.journal, live) } catch (error) {
      if (!(error instanceof JournalError) || !['COMMIT_UNCERTAIN', 'STORAGE_FAILURE', 'STORAGE_UNAVAILABLE'].includes(error.code)) throw error
      try { check(same(await this.#repository.readJournal(state.journal.config.journalId), state.journal), 'INTEGRITY_ERROR') }
      catch (recoveryError) {
        if (recoveryError instanceof JournalError && recoveryError.code === 'NOT_FOUND') throw error
        throw new JournalError('COMMIT_UNCERTAIN')
      }
    }
    live()
    const session = this.#mint({ journalId: state.journal.config.journalId, key: state.key, keys: state.journal.keys })
    handle.close()
    return { journalId: state.journal.config.journalId, session }
  }

  async authenticatePassphraseChange(journalId: string, expectedKeys: JournalKeys, currentPhrase: string, signal?: AbortSignal): Promise<RecoveryHandle> {
    notAborted(signal)
    const snapshot = await this.#repository.readJournalSnapshot(journalId)
    check(!snapshot.journal.device.cloudEnabled); check(same(snapshot.journal.keys, expectedKeys), 'AUTHORIZATION_CHANGED')
    const key = await unwrapWithPassphrase(snapshot.journal.keys.passphraseWrappedKey, currentPhrase, journalId, signal)
    await authenticateHistory(key, journalId, snapshot.revisions, snapshot.tombstones, () => notAborted(signal))
    projectJournal(snapshot.revisions); notAborted(signal)
    const handle = Object.freeze({ close: () => { this.#recoveries.delete(handle) } })
    this.#recoveries.set(handle, { key, snapshot }); return handle
  }

  async authenticateRecovery(journalId: string, credential: string, signal?: AbortSignal): Promise<RecoveryHandle> {
    notAborted(signal)
    const snapshot = await this.#repository.readJournalSnapshot(journalId)
    check(!snapshot.journal.device.cloudEnabled)
    const key = await unwrapWithRecoveryKey(snapshot.journal.keys.recoveryWrappedKey, credential, journalId)
    await authenticateHistory(key, journalId, snapshot.revisions, snapshot.tombstones, () => notAborted(signal))
    projectJournal(snapshot.revisions)
    const handle = Object.freeze({ close: () => { this.#recoveries.delete(handle) } })
    this.#recoveries.set(handle, { key, snapshot })
    return handle
  }

  async preparePassphraseReset(handle: RecoveryHandle, passphrase: string, confirmation: string, signal?: AbortSignal): Promise<PassphraseResetPlan> {
    const state = this.#recovery(handle, signal); check(!state.plan)
    validateNewPassphrase(passphrase, confirmation)
    const nextKeys = validateKeys({ ...state.snapshot.journal.keys,
      passphraseWrappedKey: await wrapWithPassphrase(state.key, passphrase, state.snapshot.journal.config.journalId, signal) })
    this.#recovery(handle, signal)
    const plan = Object.freeze({ expected: state.snapshot, nextKeys })
    state.plan = plan
    return plan
  }
  preparedPassphraseReset(handle: RecoveryHandle): PassphraseResetPlan | undefined { return this.#recovery(handle).plan }

  async #inspect(state: Recovery, plan: PassphraseResetPlan, live: () => void): Promise<{ snapshot: JournalSnapshot; committed: boolean }> {
    check(plan.nextKeys.journalId === state.snapshot.journal.config.journalId, 'LOCKED')
    const current = await this.#repository.readJournalSnapshot(plan.nextKeys.journalId)
    const committed = same(current.journal.keys, plan.nextKeys)
    check(committed || same(current.journal.keys, plan.expected.journal.keys), 'AUTHORIZATION_CHANGED')
    check(!current.journal.device.cloudEnabled)
    await authenticateHistory(state.key, plan.nextKeys.journalId, current.revisions, current.tombstones, live)
    projectJournal(current.revisions)
    preserveHistory(plan.expected.revisions, current.revisions, current.tombstones)
    live()
    return { snapshot: current, committed }
  }

  async reconcileRecoveryReset(handle: RecoveryHandle, input: PassphraseResetPlan): Promise<{ journalId: string; session: JournalSession } | null> {
    const state = this.#recovery(handle); const plan = validateResetPlan(input)
    const result = await this.#inspect(state, plan, () => { this.#recovery(handle) })
    if (!result.committed) return null
    this.#recovery(handle)
    const session = this.#mint({ key: state.key, journalId: plan.nextKeys.journalId, keys: plan.nextKeys })
    handle.close()
    return { journalId: plan.nextKeys.journalId, session }
  }

  async commitPassphraseReset(handle: RecoveryHandle, plan: PassphraseResetPlan, signal?: AbortSignal): Promise<{ journalId: string; session: JournalSession }> {
    const state = this.#recovery(handle, signal)
    check(state.plan === plan, 'INVALID_DATA')
    const live = () => { this.#recovery(handle, signal) }
    const finish = () => {
      live()
      const session = this.#mint({ key: state.key, journalId: plan.nextKeys.journalId, keys: plan.nextKeys })
      handle.close()
      return { journalId: plan.nextKeys.journalId, session }
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.#inspect(state, plan, live)
      if (current.committed) return finish()
      try { await this.#repository.replaceJournalKeys(current.snapshot, plan.nextKeys, live); return finish() }
      catch (error) {
        if (error instanceof JournalError && error.code === 'STALE_SNAPSHOT') continue
        if (error instanceof JournalError && ['COMMIT_UNCERTAIN', 'STORAGE_FAILURE', 'STORAGE_UNAVAILABLE'].includes(error.code)) {
          try { if ((await this.#inspect(state, plan, live)).committed) return finish() }
          catch (inspectionError) {
            if (inspectionError instanceof JournalError && ['STORAGE_UNAVAILABLE', 'STORAGE_FAILURE'].includes(inspectionError.code)) throw new JournalError('COMMIT_UNCERTAIN')
            throw inspectionError
          }
        }
        throw error
      }
    }
    throw new JournalError('RETRY_LIMIT')
  }
}
