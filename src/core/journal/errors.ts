export type JournalErrorCode = 'INVALID_DATA' | 'INTEGRITY_ERROR' | 'INCOMPLETE_HISTORY' | 'NOT_FOUND'
  | 'JOURNAL_EXISTS' | 'STALE_SNAPSHOT' | 'STORAGE_UNAVAILABLE' | 'STORAGE_FAILURE'
  | 'COMMIT_UNCERTAIN' | 'LOCKED' | 'AUTHORIZATION_CHANGED' | 'UNSUPPORTED_DATABASE'
  | 'DELETION_REVIEW_REQUIRED' | 'RETRY_LIMIT' | 'LIMIT_EXCEEDED' | 'NONCE_COLLISION' | 'ID_COLLISION' | 'CONFLICT'
  | 'PASSPHRASE_POLICY' | 'INVALID_CONFIRMATION'

export class JournalError extends Error {
  readonly code: JournalErrorCode
  constructor(code: JournalErrorCode) {
    super(`Journal operation failed: ${code}.`)
    this.name = 'JournalError'
    this.code = code
  }
}
