# Gibberish — Data Model Specification

**Version:** 2.0
**Product:** Gibberish  
**Architecture:** Local-first, client-side encrypted PWA  
**Status:** Technical specification — pending implementation validation

**Related documents:**
- `docs/PRD.md`
- `docs/SECURITY.md`
- `docs/ARCHITECTURE.md`
- `docs/SYNC_STRATEGY.md`
- `docs/TESTING.md`

---

## 1. Purpose

This document defines the data structures, persistence rules, encryption envelopes, local database schema, and optional Google Drive storage format for Gibberish.

It provides a consistent data contract for the cryptography, journal, storage, export, and synchronization modules.

The data model must support:

- Local-first encrypted journaling
- Offline journal creation and editing
- Passphrase-based unlocking
- Independent recovery-key unlocking
- Gibberish display
- Optional Google Drive synchronization
- Immutable encrypted revision history
- Concurrent-edit conflict detection
- Encrypted Trash with 30-day retention
- Safe permanent deletion propagation
- Encrypted backup export and restoration

## 2. Data Modeling Principles

1. **Encrypt sensitive content:** Original English titles and bodies must never be persisted in plaintext.
2. **Local-first:** IndexedDB is the primary operational database.
3. **Stable identifiers:** Journal, entry, revision, and operation identifiers must not depend on Google Sheets row numbers.
4. **Immutable revisions:** Every meaningful entry change creates a new revision.
5. **Explicit versioning:** Encryption, schema, codec, and backup formats must be versioned.
6. **Atomic local writes:** Entry revisions, current-entry projections, and synchronization operations must be committed consistently.
7. **Safe synchronization:** Concurrent changes must not silently overwrite one another.
8. **Minimal metadata:** Store only metadata required for application functionality.
9. **Portable records:** Encrypted journal records must be transferable across supported devices.
10. **Recoverable keys:** The journal encryption key must be recoverable through either approved credential.
11. **Deletion safety:** Permanently deleted entries must not be silently restored by stale devices.
12. **No plaintext persistence:** Decrypted journal content exists only in transient application memory or an explicitly generated readable export.

## 3. Storage Overview

Gibberish uses two storage locations.

### 3.1 Local Storage

**Technology:** IndexedDB, accessed through Dexie.

Local storage contains:

- Current encrypted entry projections
- Immutable encrypted entry revisions
- Wrapped journal encryption keys
- Journal configuration
- Synchronization metadata
- Pending synchronization operations
- Conflict records
- Permanent deletion tombstones

Local storage is required for MVP functionality.

### 3.2 Optional Cloud Storage

**Technology:** Google Drive API and Google Sheets API.

Cloud storage contains:

- Immutable encrypted journal revisions
- Wrapped encryption keys
- Non-secret journal configuration
- Permanent deletion tombstones
- Required synchronization metadata

Cloud storage must not be required for creating or accessing a local journal.

Google authentication is required only when the user enables cloud integration.

## 4. Identifier Strategy

All identifiers must be generated locally using a cryptographically secure random source.

Use UUIDs generated through `crypto.randomUUID()` where supported.

| Identifier | Purpose |
|---|---|
| `journalId` | Identifies a journal across devices |
| `entryId` | Identifies a logical journal entry |
| `revisionId` | Identifies an immutable entry revision |
| `operationId` | Identifies a synchronization operation |
| `deviceId` | Identifies a local installation |
| `conflictId` | Identifies a synchronization conflict |

Requirements:

- Identifiers must remain stable across synchronization.
- Entry identifiers must not be derived from plaintext titles.
- Revision identifiers must not be derived from timestamps.
- A synchronization retry must reuse the original operation and revision identifiers.
- Google Sheets row numbers must never serve as logical identifiers.
- Journals with different `journalId` values must not be silently merged.

## 5. Core Data Types

The following TypeScript definitions describe the logical data contracts.

Implementation may organize these types into separate files while preserving their semantics.

### 5.1 Encrypted Envelope

```typescript
export interface EncryptedEnvelope {
  version: 1 | 2; // v1 legacy recovery; v2 required for operational revisions
  algorithm: "AES-256-GCM";
  nonce: string;
  ciphertext: string;
}
```

Fields:

- `version`: Encryption envelope format version.
- `algorithm`: Authenticated encryption algorithm.
- `nonce`: Base64url-encoded AES-GCM nonce.
- `ciphertext`: Base64url-encoded ciphertext including its authentication tag.

Requirements:

- Use a fresh 96-bit nonce for each AES-GCM encryption operation.
- Nonces must never repeat under the same encryption key.
- Use a 128-bit authentication tag.
- Validate nonce and ciphertext encoding before decryption.
- Reject ciphertext when authentication fails.
- Use a consistent authenticated additional data policy.
- Do not silently accept unsupported encryption versions.

### 5.2 Journal Entry Payload

```typescript
export interface JournalEntryPayload {
  title: string;
  body: string;
}
```

The title and body must be serialized and encrypted together.

Sensitive fields introduced in the future must be added through a documented schema migration.

### 5.3 Entry Status

```typescript
export type EntryStatus = "active" | "trashed";
```

The status describes the state of an entry revision.

Permanent deletion is represented separately through a tombstone.

### 5.4 Immutable Journal Revision

Every meaningful entry operation creates an immutable revision.

```typescript
export interface EncryptedJournalRevision {
  journalId: string;
  entryId: string;

  revisionId: string;
  parentRevisionIds: string[];

  schemaVersion: 1;

  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;

  status: EntryStatus;

  encryptedPayload: EncryptedEnvelope & { version: 2 };
}
```

Field descriptions:

| Field | Description |
|---|---|
| `journalId` | Owning journal |
| `entryId` | Stable logical entry identifier |
| `revisionId` | Unique immutable revision identifier |
| `parentRevisionIds` | Direct parent revisions |
| `schemaVersion` | Revision schema version |
| `createdAt` | Original entry creation timestamp |
| `updatedAt` | Revision creation timestamp |
| `deletedAt` | Timestamp when the entry entered Trash |
| `status` | Active or trashed |
| `encryptedPayload` | Encrypted title and body |

Requirements:

- Revisions must never be modified after creation.
- A newly created entry must have an empty `parentRevisionIds` array.
- An ordinary edit, deletion, or restoration must reference one parent.
- A conflict-resolution revision may reference multiple parents.
- Every revision must use a unique `revisionId`.
- Every new revision, including Trash, restoration, and conflict resolution, must freshly encrypt the title/body with a fresh encryption nonce and that revision's AAD.
- Deletion and restoration must create new revisions.
- Timestamps must use UTC ISO 8601 format.
- Timestamps must not determine conflict winners.
- Sensitive entry content must not appear in plaintext fields.

### 5.5 Current Entry Projection

The application maintains a current-entry projection for efficient timeline queries.

```typescript
export interface JournalEntryProjection {
  journalId: string;
  entryId: string;

  headRevisionIds: string[];

  status: "active" | "trashed" | "conflicted";

  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
```

The projection is derived from immutable revisions and tombstones.

Requirements:

- It must not contain plaintext titles or bodies.
- It must be rebuildable from revision history.
- It must not be treated as the authoritative revision history.
- Multiple unresolved heads must result in a conflicted state.
- A permanently deleted entry must not appear as an active projection.

## 6. Revision Ancestry

Revision ancestry determines whether an update extends known history or creates a conflict.

### 6.1 Linear History

```text
Revision A
    |
    v
Revision B
    |
    v
Revision C
```

Each revision references its predecessor.

### 6.2 Concurrent Branches

```text
        Revision A
         /      \
        v        v
   Revision B  Revision C
```

Revisions B and C are conflicting branches.

Neither may silently overwrite the other.

### 6.3 Conflict Resolution

A resolution revision references all branches it resolves.

```text
   Revision B    Revision C
        \         /
         v       v
        Revision D
```

Revision D contains the user's selected or combined outcome.

For MVP, supported outcomes are:

- Keep the local version
- Keep the remote version
- Keep both as separate entries

The implementation must preserve enough ancestry information to verify that a resolution supersedes the conflicting branches.

Keeping both versions as separate entries requires explicit entry identifiers and provenance handling.

## 7. Encryption and Authenticated Data

The application must authenticate the relationship between encrypted content and its record identity.

Operational revisions use envelope/AAD version 2. AAD is UTF-8 without BOM of
this exact compact JSON tuple:

```text
["gibberish-revision-aad",2,2,"AES-256-GCM",schemaVersion,journalId,entryId,revisionId,parentRevisionIds,status,createdAt,updatedAt,deletedAt]
```

Authenticate every listed immutable field. The first 2 identifies the AAD format,
the second the encrypted-envelope format. Record schemaVersion remains 1. UUIDv4
IDs must be canonical lowercase. Parent IDs are a strictly ascending ASCII set,
unique, non-self-referential and limited to 256; never truncate. Writers sort
before sealing; validators reject noncanonical input. Dates must round-trip as
`YYYY-MM-DDTHH:mm:ss.sssZ`. Active deletedAt is explicit null; trashed deletedAt
matches updatedAt. updatedAt must not precede createdAt; roots must be active
with equal createdAt and updatedAt. Reject unsupported fields, formats and implicit defaults.
Freeze metadata including parent arrays before async work. Changing metadata
requires a new revision ID and fresh encryption, never an in-place patch.

Mutable projections, verification flags, transport acknowledgments and local
configuration are not part of immutable revision AAD. They are not proof of
authenticity. Graph/parent relationships require validation after tag verification.
AAD makes metadata authentic, not secret: only minimal non-content metadata is
clear for indexing and transport, and none is exposed through locked domain reads.

M1 v1 identity-only AAD and vectors remain unchanged. V1 is legacy payload
recovery only, never accepted into operational history or silently migrated.
V2 authentication failures must not fall back to v1. Key wrapping stays v1;
codec word mapping stays v1. See [CRYPTOGRAPHY.md](CRYPTOGRAPHY.md) and
[LOCAL_STORAGE.md](LOCAL_STORAGE.md) for byte and persistence contracts.

### 7.1 Revision-Bound Encryption

The approved M1 design retains the revision identifier in AAD. An encrypted
payload must never be copied unchanged to a new revision identifier: its
authentication tag is bound to the original revision.

Creating any new revision, including Trash or restoration, requires an unlocked
journal key. Preserve the original title/body values by authenticated decryption
of the source revision followed by fresh encryption under the destination
revision's identity and a new nonce. Keep plaintext transient and never expose it
in the UI merely because this internal operation occurred. If source validation,
decryption, or destination encryption fails, do not create a partial revision or
report success. Future persistence must commit the complete change atomically.

Synchronization continues to transfer already encrypted revisions without
decryption. This does not implement journal lifecycle or synchronization in M1.

## 8. Journal Key Records

Each journal has one randomly generated 256-bit Journal Encryption Key (JEK).

The JEK must never be persisted unwrapped.

### 8.1 Wrapped Key Record

```typescript
export interface WrappedKeyRecord {
  version: 1;

  purpose: "passphrase" | "recovery";

  algorithm: "AES-256-GCM";

  kdf: {
    name: "argon2id" | "hkdf-sha256";
    salt: string;
    parameters: Record<string, number>;
  };

  nonce: string;
  wrappedKey: string;
}
```

Requirements:

- Passphrase wrapping must use Argon2id.
- Recovery wrapping must use an independent recovery credential.
- All salts and nonces must be securely generated.
- KDF parameters must be validated before use.
- Wrapped key records must not contain plaintext credentials.
- Wrapped key formats must be versioned.

The M1 recovery-key derivation, encoding, bounded KDF profiles and in-memory key
wrapping lifecycle are defined and tested as described in
[CRYPTOGRAPHY.md](CRYPTOGRAPHY.md). No key record is persisted by M1.

### 8.2 Journal Key Bundle

```typescript
export interface JournalKeyBundle {
  journalId: string;
  version: 1;

  passphraseWrappedKey: WrappedKeyRecord;
  recoveryWrappedKey: WrappedKeyRecord;
}
```

The bundle must be included in encrypted backups.

When Google Drive synchronization is enabled, the wrapped key bundle must also be synchronized.

This enables restoration on another supported device.

### 8.3 Passphrase Changes

Changing the journal passphrase must:

1. Unlock the JEK using valid credentials.
2. Derive a new passphrase wrapping key.
3. Rewrap the existing JEK.
4. Persist the new wrapped key record.
5. Preserve existing encrypted journal revisions.

Re-encrypting every entry is not required for a normal passphrase change.

## 9. Journal Configuration

```typescript
export interface JournalConfig {
  journalId: string;
  schemaVersion: 1;

  createdAt: string;

  autoLockMinutes: 5;

  codecVersion: 1;
  encryptionVersion: 2;
}
```

Requirements:

- Automatic locking is fixed at five minutes for MVP.
- Configuration must not contain plaintext journal content.
- Security-sensitive values must be validated.
- Portable configuration must be included in encrypted backups.

## 10. Local Device Configuration

Device-specific settings remain separate from portable journal configuration.

```typescript
export interface LocalDeviceConfig {
  deviceId: string;

  cloudEnabled: boolean;

  googleSpreadsheetId: string | null;
  googleDriveFolderId: string | null;

  lastSuccessfulSyncAt: string | null;
}
```

Requirements:

- `deviceId` identifies a local installation.
- Google file identifiers are not authorization credentials.
- OAuth tokens must not be stored in this record.
- Cloud settings must not be required for local journaling.
- Device-specific settings must not overwrite portable journal configuration during restoration.

## 11. IndexedDB Schema

The MVP uses one IndexedDB database.

**Database name:** `gibberish-db`

### 11.1 Object Stores

| Store | Primary key | Purpose |
|---|---|---|
| `journal_entries` | `entryId` | Current-entry projections |
| `journal_revisions` | `revisionId` | Immutable encrypted revision history |
| `journal_keys` | `journalId` | Wrapped journal encryption keys |
| `journal_config` | `journalId` | Portable journal configuration |
| `device_config` | `deviceId` | Local device configuration |
| `sync_queue` | `operationId` | Pending cloud operations |
| `sync_metadata` | `entryId` | Last acknowledged synchronization state |
| `sync_conflicts` | `conflictId` | Preserved conflict information |
| `journal_tombstones` | `entryId` | Permanent deletion markers |

### 11.2 Initial Dexie Schema (database version 1)

The database schema version is independent of envelope/AAD version 2. Its exact
nine-store index definitions and transaction contracts are documented in
[LOCAL_STORAGE.md](LOCAL_STORAGE.md). Use compound journal-scoped indexes and a
unique `[journalId+encryptedPayload.nonce]` index as a collision-detection guard.
Explicit `journalId` indexes on revisions/projections ensure full journal reads
do not depend on an optional/null trailing compound key. This corrects the
design-review index sketch without changing any stored record format.
Do not index plaintext, ciphertext, key blobs or boolean `resolved`. Null dates
are not indexable; query active/trashed entries by status. The MVP database holds
one journal; every repository request still validates journal ownership.

### 11.3 Atomic Transaction Requirements

The following operations must be atomic within IndexedDB:

- Creating a revision and updating its current-entry projection
- Creating a revision and recording its eligible pending synchronization operation
  (local-only writes have no cloud-pending row)
- Moving an entry to Trash and recording the new revision
- Restoring an entry and recording the new revision
- Creating a permanent deletion tombstone and removing local encrypted content
- Recording synchronization acknowledgment and updating local sync metadata
- Preserving conflicting revisions and recording the conflict

A failed transaction must not leave partially committed local journal state.

### 11.4 Local Revision Retention

The application must preserve revision history needed for:

- Synchronization retries
- Conflict detection
- Revision ancestry reconstruction
- Conflict resolution
- Restoration

Revision cleanup must not remove history required for unresolved conflicts or pending operations.

Permanent deletion is an exception: it must remove the corresponding encrypted content from active local storage while retaining non-content tombstone metadata.

## 12. Synchronization Queue

Every pending cloud operation must have a stable identifier.

```typescript
export type SyncOperationType =
  | "publish-revision"
  | "publish-tombstone"
  | "sync-keys"
  | "sync-config";

export type SyncOperationState =
  | "pending"
  | "in-progress"
  | "failed";

export interface SyncOperation {
  operationId: string;

  journalId: string;

  entryId: string | null;
  revisionId: string | null;

  type: SyncOperationType;
  state: SyncOperationState;

  createdAt: string;
  attempts: number;

  lastAttemptAt: string | null;
}
```

Requirements:

- Each operation must have a unique `operationId`.
- Revision publication must reference an immutable `revisionId`.
- Retries must reuse the original operation and revision identifiers.
- Failed operations must not be silently discarded.
- Queue records must survive browser restarts.
- Operations must not contain plaintext journal content.
- Permanent deletion must cancel or quarantine pending uploads for the deleted entry.

A queue operation is considered complete only after the required cloud persistence has been verified.

## 13. Synchronization Metadata

```typescript
export interface EntrySyncMetadata {
  entryId: string;
  journalId: string;

  acknowledgedRevisionIds: string[];

  lastSyncedAt: string | null;

  remoteHeadRevisionIds: string[];
}
```

Requirements:

- Track revisions confirmed in cloud storage.
- Track the most recently observed remote heads.
- Distinguish local-only revisions from acknowledged revisions.
- Never infer successful synchronization solely from timestamps.
- Never mark a revision as synchronized before remote persistence is verified.
- Preserve enough metadata to detect divergent branches.

## 14. Conflict Records

Conflicting encrypted revisions must be preserved.

```typescript
export interface SyncConflict {
  conflictId: string;

  journalId: string;
  entryId: string;

  conflictingRevisionIds: string[];

  detectedAt: string;
  resolved: boolean;

  resolutionRevisionId: string | null;
}
```

Requirements:

- Conflict records must reference immutable encrypted revisions.
- All conflicting branches must remain available until resolution.
- Keyless conflict detection is provisional structural comparison only. Authoritative projection/conflict promotion requires authenticated metadata through the unlocked crypto/domain layer; sync itself never decrypts.
- The application must not silently choose a winner.
- Resolution must create a new revision.
- Conflict records must not contain plaintext titles or bodies.

The user-facing conflict-resolution workflow is defined in `SYNC_STRATEGY.md`.

## 15. Trash and Permanent Deletion

### 15.1 Moving an Entry to Trash

Moving an entry to Trash creates a new immutable revision.

The revision must:

- Set `status` to `trashed`.
- Set `deletedAt` to the deletion timestamp.
- Preserve the title/body values by authenticating and decrypting the source revision, then freshly encrypting them with the new revision's AAD and a fresh nonce (§7.1).
- Reference the previous revision.
- Be committed locally before synchronization.

### 15.2 Restoring an Entry

Restoration creates a new immutable revision.

The revision must:

- Set `status` to `active`.
- Clear `deletedAt`.
- Preserve the title/body values by authenticating and decrypting the source revision, then freshly encrypting them with the new revision's AAD and a fresh nonce (§7.1).
- Reference the previous trashed revision.

### 15.3 Permanent Deletion Tombstone

```typescript
export interface JournalTombstone {
  journalId: string;
  entryId: string;

  deletionRevisionId: string;

  deletedAt: string;
  permanentlyDeletedAt: string;
}
```

The tombstone contains no journal title or body.

### 15.4 Permanent Deletion Requirements

Permanent deletion must:

1. Create a durable tombstone.
2. Remove the current-entry projection.
3. Remove the corresponding encrypted local revisions.
4. Cancel or quarantine pending revision uploads.
5. Queue cloud tombstone publication when synchronization is enabled.
6. Remove the entry's encrypted revisions from active cloud storage.
7. Preserve the tombstone to prevent stale-device resurrection.

Cloud deletion must not be marked complete until verified.

### 15.5 Deletion and Synchronization Limitations

The MVP cannot guarantee:

- Cleanup at the exact 30-day expiration time while the application is inactive.
- Removal from independently exported backups.
- Removal from Google-managed historical file versions.
- Removal from devices that never reconnect.

The interface must not promise complete erasure across every historical copy.

### 15.6 Tombstone Retention

Tombstones must be retained for as long as necessary to prevent stale devices from republishing deleted entries.

The MVP must not automatically discard tombstones based solely on a short fixed retention period.

Tombstone compaction or garbage collection requires a separately documented synchronization-safe strategy.

## 16. Google Drive and Google Sheets Data Model

### 16.1 Cloud Folder Structure

Proposed layout:

```text
Google Drive/
└── Gibberish Journal/
    └── journal-data (Google Sheet)
        ├── Revisions
        ├── Config
        ├── WrappedKeys
        └── Tombstones
```

The Google Sheet is the master cloud storage file for one journal.

### 16.2 Revisions Sheet

The `Revisions` worksheet is append-only during normal journal operations.

Each row represents one immutable encrypted revision.

Suggested columns:

| Column | Type |
|---|---|
| `journal_id` | String |
| `entry_id` | String |
| `revision_id` | String |
| `parent_revision_ids` | Serialized string array |
| `schema_version` | Number |
| `created_at` | ISO 8601 string |
| `updated_at` | ISO 8601 string |
| `deleted_at` | ISO 8601 string / empty |
| `status` | String |
| `encrypted_payload` | Serialized encrypted envelope |

Requirements:

- No plaintext title or body columns.
- Each logical revision must have a stable `revision_id`.
- Row positions must not be used as permanent identifiers.
- Duplicate identical revisions must be deduplicated logically.
- Identical revision IDs with different payloads must be treated as integrity errors.
- Remote records must be validated before import.
- Published revisions must not be modified during normal synchronization.

Permanent deletion may remove historical revision rows containing the deleted entry's encrypted content.

### 16.3 Config Sheet

Suggested columns:

| Column | Type |
|---|---|
| `journal_id` | String |
| `schema_version` | Number |
| `created_at` | ISO 8601 string |
| `auto_lock_minutes` | Number |
| `codec_version` | Number |
| `encryption_version` | Number |

### 16.4 WrappedKeys Sheet

Suggested columns:

| Column | Type |
|---|---|
| `journal_id` | String |
| `key_bundle_version` | Number |
| `passphrase_wrapped_key` | Serialized wrapped key |
| `recovery_wrapped_key` | Serialized wrapped key |

### 16.5 Tombstones Sheet

Suggested columns:

| Column | Type |
|---|---|
| `journal_id` | String |
| `entry_id` | String |
| `deletion_revision_id` | String |
| `deleted_at` | ISO 8601 string |
| `permanently_deleted_at` | ISO 8601 string |

Tombstones must not contain encrypted or plaintext journal content.

### 16.6 Cloud Storage Limitations

Google Sheets is not a transactional database.

The implementation must account for:

- Concurrent writes
- Partial updates
- API failures
- Rate limits and quotas
- Row reordering
- Duplicate operations
- Delayed synchronization
- Non-atomic multi-sheet updates

The application must not assume that an append-only worksheet provides strict transactional guarantees.

Concurrent write behavior must be validated before the cloud synchronization feature is considered production-ready.

## 17. Cloud Publication and Revision States

The implementation must distinguish the following states:

### 17.1 Locally Committed

A revision has been durably stored in IndexedDB.

This state does not imply cloud backup.

### 17.2 Pending Publication

A revision is queued for cloud synchronization.

The application must retain the encrypted revision until publication is confirmed.

### 17.3 Remotely Observed

A revision has been downloaded or discovered in cloud storage.

Remote observation does not imply that the local device originally published the revision.

### 17.4 Remotely Acknowledged

The application has verified that the expected encrypted revision exists in cloud storage.

Only then may the corresponding pending operation be considered complete.

### 17.5 Conflicted

Multiple incompatible revision heads exist for the same entry.

All branches must be preserved until explicit resolution.

### 17.6 Permanently Deleted

A tombstone identifies the entry as permanently deleted.

Stale encrypted revisions must not restore the entry automatically.

## 18. Gibberish Representation

Gibberish is a reversible representation of encrypted bytes.

Requirements:

- The codec must accept a defined byte sequence.
- Encoding must be deterministic.
- Decoding must recover the exact original bytes.
- The codec format must be versioned.
- Gibberish must not be treated as encryption.
- Gibberish must not be generated from plaintext using a substitution cipher.

For MVP, Gibberish text must be derived when needed rather than persisted as a separate source of truth.

The exact bytes encoded for display are the complete binary encrypted envelope
defined in [CRYPTOGRAPHY.md](CRYPTOGRAPHY.md): version byte, algorithm identifier,
12-byte nonce, then ciphertext including its authentication tag. These bytes,
never title/body plaintext, are mapped using the independent v1 format in
[GIBBERISH_CODEC.md](GIBBERISH_CODEC.md).

## 19. Encrypted Backup Format

Encrypted backups must contain a portable representation of the journal.

```typescript
export interface EncryptedJournalBackup {
  format: "gibberish-backup";
  version: 1;

  exportedAt: string;

  journalConfig: JournalConfig;
  journalKeys: JournalKeyBundle;

  revisions: EncryptedJournalRevision[];
  tombstones: JournalTombstone[];
}
```

Requirements:

- Backups must not contain plaintext titles or bodies.
- Backups must not contain plaintext credentials or unwrapped keys.
- Backups must contain the wrapped key material needed for restoration.
- Backups must preserve sufficient revision history to reconstruct current journal state.
- Backups must include permanent deletion tombstones.
- Permanently deleted entry content must not be reintroduced into new backups.
- Backup imports must validate supported versions and record structure.
- Restoration must require valid credentials.
- Restoration must not silently overwrite an existing journal.

The MVP may use a versioned JSON file containing encrypted records.

## 20. Readable Markdown Export

Readable exports must be generated only after unlocking and explicit user confirmation.

Suggested structure:

```markdown
# My Gibberish Journal

## Entry Title

Created: YYYY-MM-DD
Updated: YYYY-MM-DD

Original English journal content.
```

Requirements:

- Decrypt entries locally.
- Generate Markdown only after explicit confirmation.
- Do not persist plaintext export content in IndexedDB.
- Do not upload readable exports automatically.
- Do not include encryption keys or credentials.
- Warn users that readable exports are unencrypted.
- Exclude permanently deleted entries.

## 21. Schema Versioning and Migration

The application must use explicit schema versions.

Requirements:

- IndexedDB migrations must be versioned.
- Encrypted envelope versions must be checked.
- Revision schema versions must be validated.
- Cloud record versions must be validated.
- Backup format versions must be validated.
- Unsupported versions must fail safely.
- Migrations must not silently discard encrypted records.
- Security-sensitive migrations must have automated tests.

A migration must preserve the ability to recover supported encrypted data.

## 22. Data Validation

All data entering the application from IndexedDB, backup files, or Google APIs must be validated.

Validation must cover:

- Required fields
- Identifier formats
- Supported schema versions
- Supported encryption algorithms
- Base64url encoding
- Nonce lengths
- Timestamp formats
- Entry status values
- Revision ancestry
- Duplicate revision identifiers
- Key-wrapping metadata
- Tombstone structure

Malformed remote data must not be trusted merely because it came from the user's Google Drive.

## 23. Data Model Rules for Codex

Codex must:

1. Implement typed data contracts before building storage adapters.
2. Validate persisted and imported records at runtime.
3. Keep plaintext journal content separate from encrypted persistence types.
4. Preserve immutable revision history.
5. Maintain current-entry projections separately from revision history.
6. Avoid storing redundant Gibberish representations.
7. Use stable identifiers independent of Google Sheets row positions.
8. Preserve revision ancestry for conflict detection.
9. Keep local writes and pending synchronization operations atomic.
10. Never mark cloud data as synchronized before verification.
11. Preserve conflicting encrypted revisions.
12. Use durable tombstones to prevent deleted-entry resurrection.
13. Remove permanently deleted entry content from active revision storage.
14. Use explicit migrations for schema changes.
15. Write tests for serialization, validation, storage, synchronization, backup, and restoration.
16. Avoid unnecessary database tables or cloud files without a documented requirement.

## 24. Data Model Acceptance Criteria

The data model is ready for implementation when:

1. Every journal entry has a stable identifier.
2. Titles and bodies are encrypted before persistence.
3. Every encrypted payload has a versioned envelope.
4. Journal keys are stored only in wrapped form.
5. Recovery metadata supports independent recovery-key unlocking.
6. Local records remain usable without Google authentication.
7. Every meaningful entry change creates an immutable revision.
8. Current-entry projections can be rebuilt from revision history.
9. Local writes and pending sync operations are atomic.
10. Cloud records contain no plaintext journal content.
11. Revision ancestry supports conflict detection and resolution.
12. Trash and permanent deletion are represented safely.
13. Tombstones prevent stale-entry resurrection.
14. Encrypted backups support restoration without reintroducing permanently deleted content.
15. Runtime validation rejects malformed or unsupported records.
16. Automated data model tests pass.

## 25. Document Governance

This document defines the data contracts for Gibberish MVP v1.

`SECURITY.md` is authoritative for cryptographic requirements.

`ARCHITECTURE.md` is authoritative for application module boundaries.

`SYNC_STRATEGY.md` is authoritative for synchronization sequencing, conflict handling, and deletion propagation.

Changes to persisted record formats require explicit schema versioning, migration consideration, and relevant tests.

## M3 integration (unchanged persisted formats)

Database schema 1, envelope/AAD 2, wrapping 1 and codec 1 remain unchanged.
Setup/recovery/session handles are opaque volatile capabilities, never DTOs.
Encrypted reset plans contain only an exact authenticated journal snapshot and
validated replacement wrapped-key bundle. Reset CAS writes journal_keys only and
compares config/device/bundle/revisions atomically. Unsupported cloud-enabled
replacement fails closed; M3 adds no cloud publication worker or pending-key flow.
Gibberish is derived on demand from authenticated envelope bytes, never persisted
as redundant title/body fields. See [M3_EXPERIENCE.md](M3_EXPERIENCE.md).
