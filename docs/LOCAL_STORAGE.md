# M2 encrypted local storage contract

The domain is independent of React. The application shell does not instantiate
these modules yet; onboarding, UI state and inactivity management belong to M3.
M2 implements no cloud worker, import, Trash, retention or permanent deletion.

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
an in-flight transaction at its authorization checks. M3 must close it on lock,
manage five-minute inactivity/resume and clear caller-owned plaintext UI state.
M2 has no event/timer-based UI session manager.

## Database version 1

Default database name: `gibberish-db`. One journal is allowed per database. Every
repository request still requires canonical journal ownership. Tests use unique
synthetic database names; production code never deletes a database on failure.

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

`sync_metadata` and `journal_tombstones` reserve future contracts and receive no
M2 writes. Any unexpected tombstone causes `DELETION_REVIEW_REQUIRED`, preserving
ciphertext until an authenticated deletion design is approved for M4/M7.

Dynamic schema inspection precedes declared-schema opening; unknown stores,
indexes or versions fail closed. Opening is bounded to five seconds per attempt
and fails on a blocked event. Version changes close old connections. Future
upgrades must retain explicit schema history, use atomic upgrade transactions,
preserve ciphertext on abort and do no KDF/decryption in the upgrade transaction.
See [Dexie's dynamic open contract](https://dexie.org/docs/Dexie/Dexie.open()).
There is no encrypted-format migration in M2; v1 is explicit read-only legacy
payload recovery through the crypto module and never operational history.

## Public domain APIs

Create `new JournalService(await openRepository())`. Exposed operations are:

| API | Responsibility |
|---|---|
| `initializeJournal(passphrase)` | Generate journal/device IDs, JEK, independent recovery material and two wrappers; atomically persist only config/wrappers/device; return journalId, recoveryKey and session in memory |
| `unlockJournal(journalId, passphrase)` | Validate bundle and unwrap into an opaque capability |
| `prepareCreate(session, payload)` | Validate title/body, prepare fresh active root and stable operation/conflict IDs |
| `prepareEdit(session, entryId, baseRevisionId, payload)` | Authenticate history and prepare a fresh child of the explicitly selected active base |
| `commitWrite(session, prepared)` | Authenticate, commit with exact preconditions, preserve races, reconcile uncertainty |
| `createEntry` / `editEntry` | Convenience prepare plus commit; callers needing retry evidence should retain their prepared plan |
| `listEntries(session)` | Authenticate all local history and return metadata projections, withholding errors/conflicts from automatic winner selection |
| `readEntry(session, entryId, revisionId?)` | Authenticate full entry history; return transient payload; require explicit revision selection for conflicts |
| `rebuildProjections(session)` | Authenticate a journal snapshot and atomically replace disposable caches |
| `inspectCommit(session, prepared)` | Reauthenticate and reconcile a retained encrypted plan after an uncertain receipt |

Payloads are exactly `{ title: string, body: string }`, both nonblank. Whitespace
and content are retained as entered, serialized together as UTF-8 JSON and sealed
once. The 16 MiB helper bound applies to serialized bytes. English exists only
transiently in caller memory and decrypt buffers; owned byte buffers are cleared
in finally blocks. JavaScript strings and browser memory cannot be securely erased.

Repository contracts: `initializeJournal`, `readJournal`, `readEntrySnapshot`,
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
corrupt/missing history withholds the timeline until repair; M2 does not import
or automatically repair ciphertext.

AAD cannot detect every omitted leaf, complete valid-history rollback or deletion
of all local state. Shared-JEK authentication does not identify which device wrote
a revision or prove wall-clock truth. Browser eviction, user clearing, power loss
and disk failure are outside ordinary transaction/restart guarantees. IndexedDB
is not a backup. Real-device qualification, authenticated tombstones, backup,
sync protocol and release security review remain later milestone gates.

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
