import type { JournalKeys, JournalState } from '../storage'
import { JournalError } from './errors'
import { check, same } from '../storage/validation'
/** Opaque, revocable in-memory capability. It contains no serializable key. */
export interface JournalSession { close(): void }
interface SessionState { journalId: string; key: CryptoKey; keys: JournalKeys }
const sessions = new WeakMap<JournalSession, SessionState>()

export function sessionState(session: JournalSession): SessionState {
  const state = sessions.get(session)
  if (!state) throw new JournalError('LOCKED')
  return state
}
export function mint(state: SessionState): JournalSession {
  const session = Object.freeze({ close() { sessions.delete(session) } })
  sessions.set(session, state)
  return session
}

export function authorize(session: JournalSession, journal: JournalState): SessionState {
  const state = sessionState(session); check(state.journalId === journal.config.journalId, 'LOCKED')
  if (!same(state.keys, journal.keys)) { session.close(); throw new JournalError('AUTHORIZATION_CHANGED') }
  return state
}
