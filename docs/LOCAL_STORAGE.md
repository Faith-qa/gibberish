# Encrypted local storage and access contract

The domain is independent of React. M3 composes it through a private application
controller for onboarding, UI state and inactivity management. M4 extends the
same encrypted transaction contracts with authenticated lifecycle and portability
APIs and an explicit database v2 upgrade. Revision/AAD v2, wrapping v1 and codec
v1 stay unchanged. No cloud worker or synchronization is implemented.

## Ownership and trust

`core/crypto` owns validated immutable v2 records and metadata authentication.
`core/journal` owns payload validation, in-memory capabilities, authenticated
history, prepare/commit orchestration and pure projection reducers.
`core/storage` owns runtime-validated encrypted DTOs and IndexedDB transactions.
Storage never receives a plaintext title/body, passphrase, recovery credential,
unwrapped key or CryptoKey. It has no generic revision update/delete interface.

The low-level repository returns **untrusted encrypted snapshots**, not an
authoritative timeline. Only `JournalService` authenticates content/metadata and
validates the full relevant DAG before returning domain data. Persisted
projections, conflict flags, configs and queue rows are not authentication proofs.
Raw storage observers can still see public metadata. Future locked sync may
stage structurally valid records in an isolated design, but cannot promote them
or authorize destructive actions; no synchronization is implemented here.

`JournalSession` is an opaque, revocable in-memory capability minted after journal
initialization or successful passphrase unwrap. Its associated CryptoKey lives
in a private WeakMap, never in a DTO. Fabricated/closed capabilities are rejected
before timeline reads. Keys must match the current validated bundle. Closing
the capability during an async operation prevents returned plaintext and aborts
an in-flight transaction at its authorization checks. The M3 controller closes it
on lock, manages five-minute inactivity/resume and clears caller-owned plaintext
UI state. Background concealment retains private authorization only until the
original deadline; it is not a full lock. See `M3_EXPERIENCE.md`.

## Database versions 1 and 2

Default database name: `gibberish-db`. One journal is allowed per database. Every
repository request still requires canonical journal ownership. Tests use unique
synthetic database names; production code never deletes a database on failure.

Historical M2/M3 version 1 (retained as the explicit migration source):

```typescript
{
  journal_revisions: 'revisionId, journalId, [journalId+entryId], [journalId+updatedAt], &[journalId+encryptedPayload.nonce]',
  journal_entries: 'entryId, journalId, [journalId+status+createdAt], [journalId+updatedAt], [journalId+deletedAt]',
  journal_keys: 'journalId',
  journal_config: 'journalId',
  device_config: 'deviceId',
  sync_queue: 'operationId, [journalId+state+createdAt], [journalId+revisionId]',
  sync_metadata: 'entryId, journalId',
  sync_conflicts: 'conflictId, [journalId+entryId]',
  journal_tombstones: 'entryId, journalId'
}
```

Explicit `journalId` indexes on revisions and projections are a small correction
to the design-review index sketch: virtual compound-prefix queries can omit

records whose trailing fields are missing/null. Active entries have a null
deletedAt. Journal-wide validation/rebuild must include them, including malformed
records with a valid journal ID. Compound indexes require all indexed values to
be valid keys; see [Dexie's index documentation](https://dexie.org/docs/Compound-Index).
There is no boolean `resolved` index and no plaintext/ciphertext/key index.
The unique public nonce index rejects a collision within the journal; it does
not reserve nonces across devices or eliminate random-IV collision probability.

M4 version 2 keeps all nine stores and changes only `journal_tombstones` to
`'entryId, journalId, &[journalId+authentication.nonce]'`. The upgrade preserves
all M3 ciphertext, wrappers, configuration and caches byte for byte. M3 never
wrote tombstones: unexpected legacy markers abort the upgrade and preserve v1.
M4 writes authenticated content-free markers; malformed or unauthenticated
markers never authorize erasure. `sync_metadata` remains reserved for future
cloud acknowledgments. See [M4_LIFECYCLE.md](M4_LIFECYCLE.md).

Dynamic schema inspection precedes declared-schema opening; unknown stores,
indexes or versions fail closed. Opening is bounded to five seconds per attempt
and fails if a blocked upgrade has not completed by that deadline. A transient
blocked notification while an old connection closes does not bypass validation
or prematurely cancel the upgrade. Version changes close old connections. Future
upgrades must retain explicit schema history, use atomic upgrade transactions,
preserve ciphertext on abort and do no KDF/decryption in the upgrade transaction.
See [Dexie's dynamic open contract](https://dexie.org/docs/Dexie/Dexie.open()).
There is no encrypted-format migration in M2; v1 is explicit read-only legacy
payload recovery through the crypto module and never operational history.

## Public domain APIs

Create `new JournalService(await openRepository())`. Exposed operations are:

| API | Responsibility |
|---|---|
| `initializeJournal(passphrase)` | Non-UI M2 compatibility helper; the application exclusively uses confirmed two-phase setup below |
| `discoverJournal()` | Return empty/existing and a private journal locator, or fail closed on partial/unsupported data; never return timeline metadata |
| `prepareJournal(passphrase, confirmation, signal?)` | Validate new-passphrase policy and prepare JEK, recovery material and wrappers in an opaque volatile setup capability; write nothing |
| `getRecoveryKey(setup)` / `confirmJournal(setup, fullKey, acknowledged, signal?)` | Deliberate recovery-key display, exact full-key confirmation and acknowledgment before atomic initialization; reconcile uncertain persistence before session adoption |
| `unlockJournal(journalId, passphrase)` | Validate bundle and unwrap into an opaque capability |
| `authenticateRecovery(journalId, credential, signal?)` | Authenticate the recovery wrapper and complete immutable history into an opaque recovery capability |
| `preparePassphraseReset` / `preparedPassphraseReset` | Prepare and retain one owned encrypted replacement plan; no persistence or raw-key return |
| `commitPassphraseReset` / `reconcileRecoveryReset` / `inspectPassphraseReset` | Exact bundle/config/device/revision snapshot CAS, bounded races and authenticated exact-outcome reconciliation; retain JEK, recovery wrapper and revisions |
| `prepareCreate(session, payload)` | Validate title/body, prepare fresh active root and stable operation/conflict IDs |
| `prepareEdit(session, entryId, baseRevisionId, payload)` | Authenticate history and prepare a fresh child of the explicitly selected active base |
| `commitWrite(session, prepared)` | Authenticate, commit with exact preconditions, preserve races, reconcile uncertainty |
| `createEntry` / `editEntry` | Convenience prepare plus commit; callers needing retry evidence should retain their prepared plan |
| `listEntries(session)` | Authenticate all local history and return metadata projections, withholding errors/conflicts from automatic winner selection |
| `readEntry(session, entryId, revisionId?)` | Authenticate full entry history; return transient payload; require explicit revision selection for conflicts |
| `listEntryViews(session)` / `readEncryptedEntry(session, entryId, revisionId?)` | Authenticate and validate history before returning encrypted heads and metadata from the same snapshot, without a plaintext payload |
| `rebuildProjections(session)` | Authenticate a journal snapshot and atomically replace disposable caches |
| `inspectCommit(session, prepared)` | Reauthenticate and reconcile a retained encrypted plan after an uncertain receipt |

Payloads are exactly `{ title: string, body: string }`, both nonblank. Whitespace
and content are retained as entered, serialized together as UTF-8 JSON and sealed
once. The 16 MiB helper bound applies to serialized bytes. English exists only
transiently in caller memory and decrypt buffers; owned byte buffers are cleared
in finally blocks. JavaScript strings and browser memory cannot be securely erased.

Repository contracts: `discoverJournal`, `initializeJournal`, `replaceJournalKeys`, `readJournal`, `readEntrySnapshot`,
`readJournalSnapshot`, `commitPreparedRevision`, `reconcileCommit`,
`rebuildProjectionCache`, `close`. The concrete Dexie adapter is internal to the
storage module. The domain supplies the authorization check and authenticated
snapshot; no key or cryptographic operation enters the transaction.

## Two-phase writes and concurrency

1. Read a consistent scoped source/config/key/device snapshot. Validate and
   authenticate every source revision, validate payload and DAG, then seal the
   destination v2 revision with a fresh revision ID and nonce **outside** IDB.
2. Open one short read/write transaction over config, keys, device, revisions,
   projections, conflicts, queue and reserved tombstones. Compare the exact
   validated canonical source/config/key/device DTOs with the prepared snapshot.
   A set of head IDs alone is insufficient. Add the immutable revision, reduce
   heads, replace the projection/conflict cache and add an eligible outbox row.
   Return a receipt only after Dexie resolves the committed transaction.
3. On a stale snapshot, reload and authenticate the new history. Require every
   original source record to remain present and byte-for-byte equal. Recompute
   projections but retain the candidate's parents, ciphertext, nonce, revision
   ID and operation ID. Retry at most three times; never silently rebase or
   select a timestamp winner. No Web Locks dependency is needed.

Heads come from ancestry. Missing parents, cycles, duplicate IDs, multiple roots,
cross-entry parents and inconsistent creation timestamps fail closed. Multiple
heads are retained with `conflicted` status, sorted head IDs and a stable conflict
record. A maximum head timestamp is display/sort metadata only, never a winner.
An explicit edit of an old active base is permitted and can create a branch.
Conflict resolution is deferred; there is no automatic merge.

Initialization atomically writes key bundle, journal config and local-only device
config, after checking every store is empty. Exact initialization replay is
idempotent. A second/different journal never overwrites the existing one.

## Queue and receipts

Default local-only writes produce no cloud-pending operation and return
`syncStatus: 'local-only'`. A validated cloud-enabled device fixture exercises
the future eligible path: the same transaction adds a stable `publish-revision`
operation with `pending`, attempts 0 and null lastAttemptAt. M2 provides no product
API to enable Google/cloud integration, no worker, acknowledgments or success
claim. Backfill of earlier local revisions is deferred to M6/M7.

Exact replay of a present revision returns `already-committed`, without encryption
or another row. A different canonical record with the same ID fails `ID_COLLISION`.
A required outbox row must also exist and match the stable operation/revision IDs
before a cloud-eligible receipt can be recovered. Pending is never cloud success.

## Recovery, bounds and limitations

Quota, transaction abort and unavailable-storage errors never fall back to
localStorage/sessionStorage/plaintext. Failed transactions roll back revision,
projection, conflict and outbox together. Safe error codes contain no content or
underlying exception messages. If a post-commit receipt is lost, re-read the
original IDs and exact canonical encrypted candidate. If that cannot be determined,
return `COMMIT_UNCERTAIN` and retain the prepared encrypted plan. Reopen, unlock
and call `inspectCommit` or retry the same plan; do not create a replacement
revision merely because the outcome was uncertain.

Snapshots and total accepted revisions are bounded to **10,000** per database in
this initial implementation. Reads fetch at most limit+1 and reject oversized
history; writes fail `LIMIT_EXCEEDED` before exceeding it, without pruning data.
Parents are capped at 256, payloads at the documented crypto bound, stale retries
at three, and open attempts at five seconds. These are defensive limits, not
large-journal performance qualification; scalable authenticated batching is
future work. No partial history is promoted to avoid the limit.

Rebuilds modify derived caches only after complete authentication and an exact
snapshot precondition. They preserve encrypted records and outbox, including
corrupt records. A corrupted cache never triggers deletion of history. Detected
corrupt/missing history withholds the timeline until repair; no automatic repair
rewrites or deletes ciphertext. M4 restoration is a separate authenticated
empty-target transaction, never a repair/merge into an existing journal.

AAD cannot detect every omitted leaf, complete valid-history rollback or deletion
of all local state. Shared-JEK authentication does not identify which device wrote
a revision or prove wall-clock truth. Browser eviction, user clearing, power loss
and disk failure are outside ordinary transaction/restart guarantees. IndexedDB
is not a backup. M4 provides authenticated tombstones and explicit portable
backups. Real-device qualification, sync protocol validation and release security
review remain later milestone gates.

## Dependency review

Pin `dexie@4.4.7` (Apache-2.0) for the required IndexedDB adapter and
`fake-indexeddb@6.2.6` (Apache-2.0, dev-only) for deterministic Node integration
tests. Dexie's [4.4.7 maintenance release](https://github.com/dexie/Dexie.js/releases/tag/v4.4.7)
includes database lifecycle and production export fixes. No cloud add-on is used.
The [fake-indexeddb project](https://github.com/dumbmatter/fakeIndexedDB) is an
in-memory test implementation; browser persistence needs separate real-engine
tests. Review covered package metadata, licensing, dependency scope, relevant
upstream APIs/releases, transaction semantics and exercised browser behavior.
This is not an independent security audit or provenance verification of every
instruction. The lockfile and vulnerability audit remain required gates.

## M3 approved extensions

Minimal discovery distinguishes truly empty (all nine stores empty), valid existing
configuration and unavailable/corrupt/unsupported state without a keyless timeline.
Confirmed onboarding prepares volatile material before the existing atomic init.
Authenticated encrypted views return matching heads/projections from one validated
snapshot. React never consumes low-level untrusted snapshots or verification flags.

Recovery-driven reset adds a dedicated exact snapshot/bundle CAS and reconciliation
contract. Crypto/authentication/wrapping stays outside IDB; preserve immutable rows
and recovery wrapper. Sealed retry plans may be retained privately in memory after
lock but are not persisted as drafts or fake cloud operations. No database/table
format changes. See [M3_EXPERIENCE.md](M3_EXPERIENCE.md).


## M4 approved implementation contract

Decisions A–G Option 1 are approved. [M4_LIFECYCLE.md](M4_LIFECYCLE.md) defines
the precise lifecycle, authenticated marker/backup formats, database v2 migration,
retention, restoration, download and passphrase-change contracts. These supersede
older draft tombstone/backup shapes and M2-only lifecycle exclusions. Revision/AAD
v2, wrapping v1, codec v1 and the five-minute M3 privacy policy remain unchanged.

## Approved M5 offline and update contract

[M5_OFFLINE.md](M5_OFFLINE.md) defines the approved static-only PWA inventory,
readiness, installation and conservative close/reopen update protocol. IndexedDB
remains operational v2 with the existing explicit v1→v2 migration. Storage
invalidation revokes the affected tab; build/profile/schema incompatibility fails
closed, while registration/cache verification failure leaves compatible online
journaling available. All M1–M4 crypto, sessions, authenticated history, tombstone,
backup and exact reconciliation contracts remain. No cloud/background worker or
M6 behavior is introduced. Native-device and actual-host qualification must be
reported separately from local production browser tests.
