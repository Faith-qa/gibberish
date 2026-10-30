# Gibberish — Synchronization Strategy

**Version:** 1.2 (Draft)
**Product:** Gibberish  
**Architecture:** Local-first, client-side encrypted PWA  
**Cloud provider:** Optional Google Drive and Google Sheets  
**Status:** Technical specification — pending implementation validation

**Related documents:**
- `docs/PRD.md`
- `docs/SECURITY.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/TESTING.md`
- `docs/IMPLEMENTATION_PLAN.md`

---

## 1. Purpose

This document defines how Gibberish synchronizes encrypted journal data between local IndexedDB storage and an optional user-owned Google Drive.

The synchronization strategy must support:

- Offline journaling
- Reliable local persistence
- Optional cloud backup
- Cross-device journal restoration
- Safe retry after network failures
- Concurrent edits across devices
- Explicit conflict detection
- Encrypted Trash and restoration
- Permanent deletion propagation
- Google authorization failures
- Data integrity verification

The primary objective is to prevent silent journal data loss while preserving Gibberish's local-first architecture.

## 2. Core Synchronization Principles

1. **Local-first:** Journal operations must succeed locally without waiting for Google APIs.
2. **Optional cloud:** Google Drive must never be required for normal journaling.
3. **Encrypted-only synchronization:** Cloud operations must not access plaintext titles, bodies, passphrases, or unwrapped encryption keys.
4. **Immutable revisions:** Published journal revisions must not be modified in place.
5. **Stable identity:** Entries and revisions must use identifiers independent of spreadsheet row positions.
6. **Idempotent processing:** Retrying an operation must not create unintended changes to journal state.
7. **Explicit conflicts:** Concurrent edits must never be silently resolved by overwriting one version.
8. **Deletion safety:** Stale devices must not silently restore permanently deleted entries.
9. **Observable state:** Users must be able to distinguish local saves from cloud synchronization.
10. **Conservative failure handling:** When synchronization state is uncertain, preserve local data and report the uncertainty.

## 3. Synchronization Scope

### 3.1 Data That Synchronizes

When Google Drive integration is enabled, the application synchronizes:

- Encrypted journal entry revisions
- Journal configuration
- Passphrase-wrapped journal encryption key
- Recovery-wrapped journal encryption key
- Deletion and restoration revisions
- Permanent deletion markers
- Required synchronization metadata

### 3.2 Data That Does Not Synchronize

The following must never be uploaded:

- Plaintext journal titles
- Plaintext journal bodies
- Journal passphrases
- Plaintext recovery keys
- Unwrapped journal encryption keys
- Decrypted entry state
- OAuth tokens
- Device-specific session state
- Readable Markdown exports

### 3.3 Local-Only Mode

When Google Drive is not connected:

- All journal operations remain local.
- No cloud synchronization requests are made.
- Entries are marked as locally saved, not cloud-backed up.
- Encrypted backup export remains available.
- The interface explains the risk of losing local browser storage.

Local-only mode is a supported operating mode, not an error condition.

## 4. Synchronization Architecture

Gibberish uses an encrypted revision log.

Each meaningful change to an entry produces an immutable revision.

The cloud stores these revisions without modifying previously published revision content.

### 4.1 High-Level Flow

```text
User creates or edits an entry
            |
            v
Encrypt entry locally
            |
            v
Commit revision to IndexedDB
            |
            v
Queue revision for synchronization
            |
            v
Confirm local save
            |
            v
Google Drive connected?
       /           \
      No           Yes
      |             |
      v             v
Local-only      Upload revision
                    |
                    v
              Read remote revisions
                    |
                    v
              Reconcile revisions
                    |
                    v
              Update sync status
```

The user must not need to wait for the cloud operation to finish before continuing to journal.

### 4.2 Cloud Storage Model

The MVP uses a Google Sheet inside the user's Gibberish Journal folder.

Recommended worksheets:

- `Revisions`
- `Config`
- `WrappedKeys`
- `Tombstones`

The `Revisions` worksheet is append-only for normal entry operations.

The other worksheets contain journal-level configuration, wrapped keys, and permanent deletion markers.

Google Sheets is treated as an external storage system, not a transactional database.

## 5. Revision-Based Data Model

### 5.1 Immutable Entry Revisions

Every entry change creates a new revision.

A revision contains:

- `journalId`
- `entryId`
- `revisionId`
- `parentRevisionIds`
- `schemaVersion`
- `createdAt`
- `updatedAt`
- `deletedAt`
- `status`
- `encryptedPayload`

Once a revision is published, its contents must not be changed.

### 5.2 Revision Ancestry

Each revision references its parent revision.

Example:

```text
Revision A
    |
    v
Revision B
    |
    v
Revision C
```

If two devices edit the same revision independently:

```text
         Revision A
          /      \
         v        v
   Revision B   Revision C
    Device 1     Device 2
```

Revisions B and C are conflicting branches.

Neither may silently overwrite the other.

### 5.3 Revision Identifiers

Every revision must have a unique, locally generated identifier.

Requirements:

- Revision identifiers must not depend on timestamps.
- Revision identifiers must not depend on Google Sheets row numbers.
- A retry must reuse the original revision identifier.
- Identical revision identifiers with different content must be treated as corruption or a synchronization integrity error.

### 5.4 Parent References

A new revision must reference the revision on which it was based.

For a newly created entry, `parentRevisionIds` is `[]`.

For an edit, deletion, or restoration, `parentRevisionIds` contains the previous revision ID.

The synchronization engine must validate revision ancestry before selecting an entry's current state.

## 6. Local Persistence Model

### 6.1 Local Database Responsibilities

IndexedDB remains the operational database.

It stores:

- Current encrypted entry records
- Immutable revision history required for synchronization
- Pending synchronization operations
- Last acknowledged cloud state
- Conflict records
- Wrapped key material
- Journal configuration
- Deletion markers

### 6.2 Atomic Local Writes

For cloud-enabled writes, the application must commit an encrypted revision and its eligible pending synchronization operation within the same IndexedDB transaction. Local-only writes create no cloud-pending row; earlier local history needs an explicit future connection/backfill policy, not a false cloud-success claim.

If the transaction fails:

- The revision must not be reported as saved.
- The queue must not contain an operation referencing an uncommitted revision.
- The application must report the storage failure.

### 6.3 Local Revision History

The application must preserve enough local revision history to:

- Retry uploads
- Detect remote conflicts
- Reconstruct revision ancestry
- Avoid losing previously saved local edits

A single mutable current-entry record is insufficient for the append-only synchronization protocol.

The local database must therefore include an immutable revision store in addition to the current-entry projection.

## 7. Synchronization Queue

### 7.1 Queue Responsibilities

The queue records cloud operations that have not been successfully acknowledged.

Supported operation types include:

- Publish encrypted revision
- Synchronize wrapped keys
- Synchronize journal configuration
- Publish permanent deletion marker

### 7.2 Queue Durability

Pending operations must survive:

- Browser restarts
- Temporary network loss
- Google API failures
- PWA suspension
- Expired OAuth sessions

### 7.3 Retry Behavior

Retryable failures include:

- Network timeouts
- Temporary server failures
- Google API rate limiting
- Interrupted requests

The synchronization engine must use bounded exponential backoff with jitter.

It must respect Google API retry guidance where applicable.

### 7.4 Idempotency

A retry must reuse the same `operationId` and `revisionId`.

Before considering an uncertain upload successful, the engine must verify whether the corresponding revision is present remotely.

Google Sheets may still contain duplicate rows if a request succeeds but its acknowledgment is lost.

The reconciliation algorithm must deduplicate revisions by stable revision identifier.

Duplicate identical revisions must not create duplicate journal entries.

Conflicting payloads under the same revision identifier must be rejected.

## 8. Synchronization Lifecycle

### 8.1 Initial Google Drive Connection

When a user enables cloud synchronization:

1. Authenticate through Google.
2. Request the required Drive permissions.
3. Locate or create the Gibberish Journal folder.
4. Locate or create the journal storage file.
5. Read and validate existing cloud journal metadata.
6. Confirm that the cloud journal identity matches the local journal.
7. If no cloud journal exists, initialize cloud storage using the local journal identity.
8. Synchronize wrapped keys and journal configuration.
9. Upload pending encrypted revisions.
10. Download and reconcile remote revisions.
11. Update synchronization status.

The application must never silently merge two unrelated journals.

If a different cloud journal already exists, the application must stop and require an explicit restore or journal-selection workflow.

### 8.2 Normal Synchronization

A normal synchronization cycle must:

1. Verify that cloud integration is enabled.
2. Verify that valid authorization is available.
3. Read and validate remote metadata.
4. Download unseen remote revisions and deletion markers.
5. Reconcile remote revisions with local history.
6. Preserve detected conflicts.
7. Upload eligible pending revisions.
8. Verify successful remote persistence.
9. Update local acknowledgment metadata.
10. Refresh synchronization status.

The implementation may optimize request ordering, but must preserve these correctness requirements.

### 8.3 Synchronization Triggers

Synchronization should run when:

- The user selects **Sync Now**.
- The application becomes active and connectivity is available.
- Connectivity returns, where detectable.
- New local changes are saved while cloud integration is enabled.
- A previously failed operation becomes eligible for retry.

The application must not rely on background synchronization being supported by every browser.

### M2 Trust Boundary for Future Synchronization

Full immutable revision metadata is authenticated by envelope/AAD v2. Locked
sync may transfer opaque ciphertext, validate structure and stage provisional
ancestry/conflict observations. It may not promote incoming records to accepted
projections, suppress/resurrect entries, expire Trash or delete content using
unverified metadata. Authentication/promotion is an unlocked crypto/domain task;
the sync engine never receives the key or decrypts. Persisted verification flags
and projection caches are not proof. Publication acknowledgment verifies exact
remote bytes and is distinct from fully authenticated inbound reconciliation.
No Google adapter, inbox/queue worker or tombstone deletion workflow is added in
M2. Future remote data must be isolated until structurally and cryptographically
acceptable; incomplete history is preserved, never replaced using timestamps.

### 8.4 Locked Journal Synchronization

The synchronization engine may transfer already encrypted revisions while the journal is locked if valid cloud authorization remains available.

It must not:

- Decrypt entries
- Unwrap journal keys
- Require the journal passphrase
- Reveal plaintext
- Access active encryption keys

Operations requiring decryption must wait until the journal is unlocked.

## 9. Conflict Detection

### 9.1 Conflict Definition

A conflict exists when two revisions of the same entry diverge from a shared ancestor and neither is a descendant of the other.

Example:

```text
          Revision A
           /      \
          v        v
     Revision B  Revision C
```

The application must preserve both revisions.

### 9.2 Non-Conflicting Changes

The following should synchronize without conflict:

- Changes to different entries
- Repeated delivery of an identical revision
- A remote revision that is a descendant of the known local revision
- A local revision that is a descendant of the known remote revision

### 9.3 Conflict Rules

The engine must not:

- Choose the latest timestamp automatically.
- Choose the last uploaded revision automatically.
- Delete one branch without confirmation.
- Overwrite an entry simply because a Google Sheets row already exists.

The engine must retain both encrypted branches until resolution.

## 10. Conflict Resolution

### 10.1 MVP Resolution Strategy

The MVP uses manual conflict resolution.

When a conflict is detected:

- Mark the entry as conflicted.
- Preserve both encrypted versions.
- Display a clear conflict indicator.
- Prevent further automatic resolution of the conflicting branches.
- Allow the user to review both versions after unlocking.

### 10.2 User Options

The user may:

1. Keep the local version.
2. Keep the remote version.
3. Keep both as separate journal entries.

The application must explain that selecting one version resolves the conflict without silently discarding the unselected version from historical records.

### 10.3 Resolution Revision

When a user resolves a conflict, the application must create a new resolution revision.

A resolution revision must identify all conflicting parent revisions it supersedes.

This requires a small extension to the original single-parent data model.

Use a canonical sorted `parentRevisionIds` array throughout: empty for roots, one element for ordinary edits, and multiple parents only for explicit future resolutions.

### 10.4 Conflict Safety

If the application cannot determine whether all relevant remote revisions have been observed, it must not claim that the conflict has been fully resolved.

A successful resolution must be synchronized and verified before being marked cloud-synchronized.

## 11. Trash Synchronization

### 11.1 Moving to Trash

Moving an entry to Trash creates a new encrypted revision.

The revision must:

- Preserve the title/body values through authenticated decryption and fresh encryption with the new revision's full immutable-metadata v2 AAD and a fresh nonce, as defined in `DATA_MODEL.md` §7.1.
- Set status to `trashed`.
- Record the deletion timestamp.
- Reference the previous revision.

The change must be committed locally before synchronization.

Creating this revision requires an unlocked journal key. The synchronization
engine only publishes the resulting encrypted revision and never decrypts it.

### 11.2 Restoring an Entry

Restoration creates a new revision.

The revision must:

- Set status to `active`.
- Clear the deletion timestamp.
- Reference the previous trashed revision.
- Preserve the title/body values through authenticated decryption and fresh encryption with the new revision's full immutable-metadata v2 AAD and a fresh nonce, as defined in `DATA_MODEL.md` §7.1.

Creating this revision requires an unlocked journal key. Ciphertext from the
source revision must not be copied unchanged under the new revision identifier.

### 11.3 Concurrent Delete and Edit

If one device deletes an entry while another edits the same parent revision, the result is a conflict.

The application must not automatically discard either branch.

The user must explicitly resolve the conflict.

## 12. Permanent Deletion and Tombstones

### 12.1 Permanent Deletion Eligibility

An entry becomes eligible for permanent deletion when:

- The user explicitly chooses permanent deletion, or
- Its 30-day Trash retention period expires.

Automatic cleanup runs during the next applicable application activity.

### 12.2 Tombstone Record

A permanent deletion marker must include:

- `journalId`
- `entryId`
- `deletionRevisionId`
- `deletedAt`
- `permanentlyDeletedAt`

A tombstone must not contain encrypted entry content.

### 12.3 Tombstone Behavior

When a tombstone is present:

- The corresponding entry must not reappear in the active timeline.
- Stale devices must not automatically republish old entry revisions.
- Pending uploads for permanently deleted entries must be canceled or quarantined.
- The application must preserve the tombstone as necessary to prevent resurrection.

### 12.4 Cloud Cleanup

Permanent deletion must remove the entry's encrypted content from active cloud storage, including historical revisions maintained by the application.

Because the MVP uses Google Sheets, cleanup may require multiple API operations.

The application must not mark cloud deletion complete until it has verified the relevant changes.

### 12.5 Deletion Limitations

The MVP cannot guarantee:

- Exact-time deletion while the PWA is not running
- Removal from independently exported backups
- Removal from Google-managed historical file versions
- Removal from disconnected devices that never synchronize again

The interface must not promise complete erasure across every copy.

### 12.6 Deletion Failure Handling

If cloud deletion fails:

- Preserve the tombstone.
- Retry the cleanup operation.
- Keep the entry hidden locally.
- Report incomplete cloud deletion where relevant.

The system must not silently restore the entry.

## 13. Cloud Data Validation

All remote records must be treated as untrusted input.

Validation must include:

- Journal identity
- Schema version
- Encryption envelope format
- Entry identifiers
- Revision identifiers
- Parent revision relationships
- Timestamp format
- Entry status
- Duplicate revision handling
- Tombstone structure

Malformed records must be quarantined or rejected without corrupting local journal data.

The synchronization engine must not decrypt remote entries merely to validate their structural metadata.

Authenticated ciphertext integrity is verified when decryption is performed by the authorized journal session.

## 14. Google Sheets Operational Constraints

### 14.1 No Transactional Guarantees

Google Sheets does not provide database-style transactions across all synchronization operations.

Therefore:

- A multi-step synchronization may partially succeed.
- An API timeout does not prove that a write failed.
- Concurrent devices may append revisions independently.
- Cloud operations must be retryable.
- Reconciliation must tolerate duplicate records.

### 14.2 No Last-Write-Wins Policy

The application must not use last-write-wins synchronization for journal entries.

Revision ancestry determines whether a change extends known history or creates a conflict.

### 14.3 API Efficiency

The sync engine should:

- Batch compatible operations where safe.
- Avoid downloading unnecessary data when possible.
- Respect API quotas.
- Avoid excessive polling.
- Cache non-sensitive file identifiers locally.
- Limit automatic retries.

Correctness takes priority over minimizing API requests.

### 14.4 Spreadsheet Size and Growth

Append-only revision storage grows over time.

The MVP must monitor storage growth and avoid assuming unlimited Google Sheets capacity.

Compaction or archival may be introduced later, but must not discard revisions required for unresolved conflicts or safe synchronization.

## 15. Synchronization Status

The application must expose clear synchronization states.

```typescript
export type SyncStatus =
  | "local-only"
  | "pending"
  | "syncing"
  | "synced"
  | "conflict"
  | "error";
```

### 15.1 Status Definitions

| Status | Meaning |
|---|---|
| `local-only` | Journal is stored locally; Google Drive is not connected |
| `pending` | Local changes exist that have not been confirmed in cloud storage |
| `syncing` | A synchronization operation is in progress |
| `synced` | Known pending changes have been confirmed in cloud storage |
| `conflict` | Divergent revisions require resolution |
| `error` | A synchronization operation failed or authorization is unavailable |

### 15.2 User-Facing Language

The interface should use understandable language.

Examples:

- **Saved on this device**
- **Waiting to back up**
- **Syncing encrypted entries**
- **Backed up to Google Drive**
- **Sync needs attention**
- **Two versions need your review**

The application must not display **Backed up to Google Drive** until remote persistence has been confirmed.

## 16. Authentication and Authorization Failures

### 16.1 Expired Authorization

If Google authorization expires:

- Stop affected cloud operations.
- Preserve pending local changes.
- Keep local journaling available.
- Request reauthorization when necessary.
- Resume synchronization after authorization is restored.

### 16.2 Revoked Access

If the user revokes Google Drive access:

- Stop synchronization.
- Preserve encrypted local records.
- Preserve the pending queue.
- Display a disconnected state.
- Allow explicit reconnection.

### 16.3 Google Account Changes

If the user connects a different Google account:

- Do not assume it contains the same journal.
- Validate journal identity.
- Do not silently upload or merge journal data into an unrelated cloud journal.
- Require explicit confirmation before initializing a new cloud backup destination.

## 17. Cross-Device Restoration

### 17.1 Cloud Restoration

A user restoring their journal on another device must:

1. Connect the appropriate Google account.
2. Authorize access to the Gibberish journal files.
3. Locate and validate the cloud journal.
4. Download wrapped keys, configuration, revisions, and tombstones.
5. Unlock using the journal passphrase or recovery key.
6. Reconstruct the current entry state from valid revisions.
7. Store encrypted records locally.
8. Verify restoration before reporting success.

### 17.2 Encrypted Backup Restoration

A user restoring from an exported backup must:

1. Select the encrypted backup file.
2. Validate its format and supported version.
3. Provide valid passphrase or recovery credentials.
4. Verify encrypted records.
5. Restore journal data locally.
6. Rebuild the current-entry projection.
7. Avoid silently overwriting another existing journal.

### 17.3 Restoration Failure

If restoration fails:

- Preserve the original backup.
- Do not partially overwrite an existing journal.
- Report the failure.
- Allow the user to retry.

## 18. Concurrency and Coordination

### 18.1 Local Concurrency

Multiple tabs of the same browser may access the same IndexedDB database.

The application must prevent unsafe concurrent local operations.

Where supported, use browser coordination mechanisms such as the Web Locks API.

Where unavailable, use an explicit fallback that preserves correctness.

### 18.2 Cross-Device Concurrency

Different devices may publish revisions concurrently.

The append-only model must preserve these revisions without relying on a global lock.

### 18.3 Concurrent Cloud Initialization

Two devices must not silently create competing master journal files.

The application must detect multiple candidate cloud journals and require explicit resolution rather than choosing one arbitrarily.

### 18.4 Cloud Consistency Limitations

The application must not claim strict global serializability.

Concurrent Google Sheets operations may require later reconciliation.

The synchronization engine must detect uncertainty and avoid declaring a journal fully synchronized while unresolved conditions remain.

## 19. Failure Scenarios

| Scenario | Required behavior |
|---|---|
| Device goes offline | Continue local journaling |
| Google API returns rate limit | Retry with backoff |
| Upload succeeds but response is lost | Verify remote revision before retry |
| Duplicate revision appears | Deduplicate by revision ID |
| Same revision ID has different content | Reject as integrity error |
| Two devices edit the same entry | Preserve both branches and flag conflict |
| One device deletes while another edits | Flag conflict |
| Google access is revoked | Stop cloud sync; retain local data |
| Browser closes during sync | Resume from durable queue |
| Cloud record is malformed | Reject or quarantine |
| Permanent deletion partially fails | Retain tombstone and retry |
| User connects unrelated cloud journal | Stop and require explicit action |
| Local storage write fails | Do not report success |

## 20. Synchronization Testing Requirements

Automated tests must cover:

1. Local-only journaling without Google authentication.
2. Offline entry creation.
3. Durable synchronization queue.
4. Successful encrypted revision upload.
5. Remote revision download.
6. Duplicate revision handling.
7. Retry after uncertain upload acknowledgment.
8. Two-device concurrent editing.
9. Concurrent edit and deletion.
10. Conflict preservation.
11. Conflict-resolution revision creation.
12. Trash synchronization.
13. Permanent deletion propagation.
14. Tombstone protection against stale devices.
15. Google authorization revocation.
16. API rate limiting.
17. Partial cloud write failures.
18. Browser restart during synchronization.
19. Cross-device restoration.
20. Encrypted backup restoration.
21. Malformed cloud record rejection.
22. Prevention of plaintext cloud uploads.

Tests must use controlled Google API adapters or fixtures rather than real user journals.

## 21. Required Changes to DATA_MODEL.md

The append-only synchronization strategy requires the following updates to the data model.

### 21.1 Add an Immutable Revision Store

Add an IndexedDB store:

`journal_revisions`

Primary key: `revisionId`

Purpose:

- Preserve immutable encrypted entry revisions.
- Support retryable uploads.
- Support ancestry validation.
- Support conflict reconstruction.

The existing `journal_entries` store remains a current-entry projection.

### 21.2 Rename the Cloud Entries Sheet

Replace the proposed mutable `Entries` worksheet with:

`Revisions`

Each row represents one immutable encrypted revision.

### 21.3 Support Multiple Parents for Resolution

Extend revision metadata to support multiple parent revision IDs for conflict-resolution revisions.

Ordinary revisions continue to reference one parent.

### 21.4 Add Durable Tombstone Storage

Add an IndexedDB store:

`journal_tombstones`

Primary key: `entryId`

This store contains permanent deletion markers without entry content.

### 21.5 Extend Synchronization Operations

Add explicit operation types for:

- Publishing immutable revisions
- Publishing permanent deletion markers

Pending operations must reference immutable revision IDs rather than relying solely on the current entry projection.

### 21.6 Update Backup Format

Encrypted backups must include:

- Immutable revisions needed to reconstruct journal state
- Wrapped key bundle
- Journal configuration
- Permanent deletion markers

The backup must not include plaintext journal content.

### 21.7 Define Cloud Publication Semantics

The data model must distinguish between:

- A locally committed revision
- A remotely observed revision
- A remotely acknowledged revision
- A conflicted revision
- A permanently deleted entry

These states must not be inferred solely from timestamps.

## 22. Implementation Guidance for Codex

Codex must:

1. Implement local encrypted journaling before cloud synchronization.
2. Preserve immutable revisions.
3. Use stable revision identifiers.
4. Make synchronization operations retryable.
5. Validate all remote data.
6. Never rely on Google Sheets row numbers as stable identifiers.
7. Never silently overwrite divergent revisions.
8. Preserve tombstones to prevent stale-data resurrection.
9. Keep synchronization independent of journal decryption.
10. Write concurrency and failure tests before declaring synchronization complete.
11. Document any deviations from this strategy.
12. Update `DATA_MODEL.md` before implementing the synchronization schema.

Codex must not replace this protocol with last-write-wins synchronization merely because it is easier to implement.

## 23. Synchronization Acceptance Criteria

The synchronization implementation is acceptable when:

1. Local journaling works without Google Drive.
2. Encrypted local changes survive offline operation and browser restarts.
3. Pending changes synchronize after connectivity returns.
4. Successful cloud persistence is verified before reporting synchronized status.
5. Concurrent edits do not silently overwrite one another.
6. Duplicate operations do not create duplicate journal entries.
7. Conflicting revisions remain recoverable.
8. Trash and restoration synchronize correctly.
9. Permanent deletion markers prevent stale-entry resurrection.
10. Authorization failures do not interrupt local journaling.
11. Cross-device restoration reconstructs the journal correctly.
12. No plaintext journal content is uploaded.
13. Automated synchronization and failure tests pass.

## 24. Document Governance

This document defines the synchronization protocol for Gibberish MVP v1.

`DATA_MODEL.md` must be updated to reflect the immutable revision log, conflict-resolution ancestry, and tombstone storage described here.

`SECURITY.md` remains authoritative for encryption and key-management requirements.

`ARCHITECTURE.md` remains authoritative for module boundaries.

Any change to the synchronization protocol must be documented and tested before dependent implementation begins.
