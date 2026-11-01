export interface EncryptedEnvelope {
  readonly version: 1
  readonly algorithm: 'AES-256-GCM'
  readonly nonce: string
  /** Base64url ciphertext followed by the 128-bit authentication tag. */
  readonly ciphertext: string
}

export interface RevisionIdentity {
  readonly journalId: string
  readonly entryId: string
  readonly revisionId: string
  readonly schemaVersion: 1
}

export interface RevisionEnvelope extends Omit<EncryptedEnvelope, 'version'> {
  readonly version: 2
}

export type SupportedEnvelope = EncryptedEnvelope | RevisionEnvelope

export interface RevisionMetadata extends RevisionIdentity {
  readonly parentRevisionIds: readonly string[]
  readonly status: 'active' | 'trashed'
  readonly createdAt: string
  readonly updatedAt: string
  readonly deletedAt: string | null
}

export interface EncryptedJournalRevision extends RevisionMetadata {
  readonly encryptedPayload: RevisionEnvelope
}

export interface WrappedKeyRecord {
  readonly version: 1
  readonly purpose: 'passphrase' | 'recovery'
  readonly algorithm: 'AES-256-GCM'
  readonly kdf: {
    readonly name: 'argon2id' | 'hkdf-sha256'
    readonly salt: string
    readonly parameters: Readonly<Record<string, number>>
  }
  readonly nonce: string
  readonly wrappedKey: string
}

export const ARGON2ID_PARAMETERS = Object.freeze({
  version: 19, memoryKiB: 65536, iterations: 3, parallelism: 1, hashLength: 32,
})
export const RECOVERY_PARAMETERS = Object.freeze({ hashLength: 32 })

// Bound untrusted envelopes before base64 decoding; this is a crypto-helper limit.
export const MAX_PLAINTEXT_BYTES = 16 * 1024 * 1024

export interface AuthenticationProof {
  readonly version: 1
  readonly algorithm: 'AES-256-GCM'
  readonly nonce: string
  readonly tag: string
}
export interface TombstoneMetadata {
  readonly version: 1
  readonly journalId: string
  readonly entryId: string
  readonly deletionRevisionId: string
  readonly deletedAt: string
  readonly permanentlyDeletedAt: string
}
export interface AuthenticatedTombstone extends TombstoneMetadata { readonly authentication: AuthenticationProof }
export type BackupManifest = readonly [string, string, readonly unknown[], readonly unknown[], readonly unknown[], readonly unknown[]]
