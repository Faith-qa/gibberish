export { openRepository, EncryptedJournalRepository } from './repository'
export type { JournalConfig, JournalKeys, DeviceConfig, JournalState, EntrySnapshot, JournalSnapshot, EntryProjection, PreparedWrite, CommitReceipt } from './types'
export type { JournalDiscovery, PassphraseResetPlan, EntryView } from './types'

export type { Tombstone, PreparedDelete, DeleteReceipt, RestorePlan, DeletionSnapshot } from './types'
