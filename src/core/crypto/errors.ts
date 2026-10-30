export type CryptoErrorCode =
  | 'INVALID_INPUT' | 'INVALID_KEY' | 'UNSUPPORTED_VERSION'
  | 'AUTHENTICATION_FAILED' | 'CRYPTO_UNAVAILABLE' | 'KEY_DERIVATION_FAILED'
  | 'ENCRYPTION_FAILED' | 'NONCE_REUSE'

const messages: Record<CryptoErrorCode, string> = {
  INVALID_INPUT: 'Invalid cryptographic input.',
  INVALID_KEY: 'A valid AES-256 journal key is required.',
  UNSUPPORTED_VERSION: 'Unsupported cryptographic format version.',
  AUTHENTICATION_FAILED: 'Authentication failed. The credentials or encrypted data may be invalid.',
  CRYPTO_UNAVAILABLE: 'Browser cryptography is unavailable.',
  KEY_DERIVATION_FAILED: 'Key derivation could not be completed.',
  ENCRYPTION_FAILED: 'Encryption could not be completed.',
  NONCE_REUSE: 'Encryption stopped because a repeated nonce was detected.',
}

export class JournalCryptoError extends Error {
  readonly code: CryptoErrorCode

  constructor(code: CryptoErrorCode) {
    super(messages[code])
    this.name = 'JournalCryptoError'
    this.code = code
  }
}
