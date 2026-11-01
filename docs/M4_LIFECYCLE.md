# M4 approved lifecycle, backup and export contracts

Decisions A–G, recommended Option 1, approved 2026-10-31. The approved local
reports/M4/DESIGN_REVIEW.md remains the primary implementation contract. This
tracked specification records its interoperable formats and operational rules.
M1–M3 revision/wrapping/codec formats, KDF profile and five-minute policy remain.

## Lifecycle and authoritative reads

Trash and restore require a live authorized capability and an authenticated
complete sole-head entry snapshot with no permanent marker. Trash confirms an
active head, decrypts internally and freshly encrypts the same title/body under a
new v2 revision ID/nonce, original createdAt, updatedAt=deletedAt=current UTC.
Restore creates an active child, fresh encryption, original createdAt, new
updatedAt and explicit deletedAt=null. Never edit Trash or refresh a Trash date.
Existing parent cap/canonical validation is unchanged. Clock before creation
blocks Trash rather than clamping it. Every retry retains its exact candidate.
Racing reversible writes preserve branches. Known conflicts prohibit lifecycle
destruction (including all-trashed conflicts); no M8 resolution is introduced.

All read/rebuild/recovery/change/write paths must validate and authenticate
markers with the JEK. No keyless timeline, cached verified flag or marker presence
is authoritative. A main-store overlap of marker and entry revisions is an
integrity error; never erase on read. Purge removes a whole entry, never part of a
DAG. Every stale append/replay against a verified marker is terminally fenced;
it is not proof the earlier save ever committed.

## Retention and purge

Retention is 2,592,000,000 ms from the current sole trashed head's authenticated
deletedAt. Expiry grants eligibility; restore remains possible while content
exists and no purge has committed. Retrash after restore starts a new interval.
Cleanup runs in bounded sequential batches during visible authorization, away
from dirty editors and uncertain mutations. It neither unlocks nor extends idle
deadlines. Defer automatic destruction on observed wall-clock regression,
unexplained forward drift or future dates. Device time across a closed-app gap
cannot be independently trusted; no exact-time deletion guarantee.

Prepare an immutable marker and exact entry/config/keys/device/marker/affected
queue+sync-metadata snapshot outside IDB. One all-nine-store transaction compares
that snapshot, checks live authorization, adds the marker, removes all this
entry's revisions/projection/conflicts/sync metadata, cancels superseded entry
uploads and adds a stable eligible publish-tombstone intent only in cloud mode.
Check authorization before/after writes; report success only after commit or
exact authenticated reconciliation. A stale purge never rebases over new history.
A different verified marker can establish another delete won, not that ours did.
Keep unrelated queue rows. publish-tombstone requires entryId and revisionId=null.
No actual cloud worker/integration is part of M4. Never garbage-collect markers.

## Authenticated tombstone v1

Exact fields: version=1, journalId, entryId, deletionRevisionId (purged sole Trash
head), deletedAt, permanentlyDeletedAt, authentication. The authentication has
exactly version=1, algorithm='AES-256-GCM', nonce, tag. IDs are canonical lowercase
UUIDv4; dates use exact UTC milliseconds and permanent time cannot precede Trash.
Nonce is canonical unpadded Base64url of 12 bytes; tag is 16 bytes. No entry body,
title or encrypted entry envelope may be retained in this record.

AES-256-GCM encrypts empty plaintext under the existing JEK with a fresh nonce,
128-bit tag and exact compact UTF-8 JSON AAD:

```text
["gibberish-tombstone-aad",1,1,"AES-256-GCM",journalId,entryId,deletionRevisionId,deletedAt,permanentlyDeletedAt]
```

Verify with native GCM decryption of the tag and empty result. This is a new
application protocol using the existing primitive, not an entry v3 format.
The marker is an irreversible entryId-wide fence, including unseen stale branches.
It proves neither per-device authorship, true clock time nor global completeness.

## IndexedDB v2

Retain the exact historical v1 declaration and nine stores. Version 2 changes only
journal_tombstones to 'entryId, journalId, &[journalId+authentication.nonce]'.
Recognize the exact historical schema before explicit upgrade; unknown schemas
fail closed. Upgrade does no crypto, copies ciphertext/wrappers/config unchanged
and rejects unexpected pre-existing legacy markers without blessing/deleting them.
Blocked/failed/aborted upgrades preserve v1. Old tabs close on versionchange; old
clients cannot reopen v2 as v1. Check cross-store nonce collisions in transactions.
Allow an already-closing connection to drain within the existing five-second
open deadline; a blocked notification alone is not a completed upgrade or proof
of permanent blockage. On timeout, close and report unavailable without deletion.

Entry/journal snapshots now carry explicit tombstones arrays. A removed prior row
may be explained only by an authenticated marker for that exact journal/entry.
Surviving changed rows still fail integrity checks. Recovery/change exact CAS must
include marker state; no generic tolerance of missing history.

## Portable backup v2

Exact fields in canonical order: format='gibberish-backup', version=2, exportId,
exportedAt, journalConfig, journalKeys, revisions, tombstones, authentication.
ExportId is a fresh UUIDv4; exportedAt is canonical UTC. Authentication has the
same exact v1 AES-GCM nonce/tag shape as above, with a separate AAD purpose.
Include both wrapped keys, portable config, complete retained history/all heads,
all retained Trash (including expiry backlog) and every authenticated marker.
Exclude device config/IDs, queue/acks/conflict caches, verification flags, UI,
credentials and unwrapped keys. Deleted entry ciphertext must never coexist with
its marker in an accepted file. Export is read-only, not an implicit purge.
Metadata (IDs, dates, statuses, inventory and config) remains visible; only journal
content is encrypted. This is a snapshot file, not a Drive synchronization copy.

Canonical tuples:
- Config: [journalId,schemaVersion,createdAt,autoLockMinutes,codecVersion,encryptionVersion].
- Bundle: [journalId,version,passphraseWrapper,recoveryWrapper].
- Wrapper: [version,purpose,algorithm,kdfName,salt,orderedParameters,nonce,wrappedKey].
  Argon2id parameters are [19,65536,3,1,32]; recovery parameters [32].
- Revision: [journalId,entryId,revisionId,parentRevisionIds,status,createdAt,updatedAt,
  deletedAt,schemaVersion,[envelopeVersion,algorithm,nonce,ciphertext]].
- Tombstone: [version,journalId,entryId,deletionRevisionId,deletedAt,permanentlyDeletedAt,
  [proofVersion,algorithm,nonce,tag]].
- Manifest: [exportId,exportedAt,configTuple,keyBundleTuple,revisionTuples,tombstoneTuples].

Revision and marker arrays are strictly sorted by revisionId and entryId. Reject
all duplicate IDs/nonces, unknown fields and noncanonical parent arrays. Backup
AAD is exact compact UTF-8 JSON of:

```text
["gibberish-backup-aad",1,"gibberish-backup",2,"AES-256-GCM",Manifest]
```

Authenticate using fresh-nonce AES-256-GCM with empty plaintext under the JEK.
The backup's own proof is excluded from Manifest; marker proofs are included.
An unkeyed checksum is insufficient. Legacy unauthenticated backup v1 is rejected,
with no fallback to M1 legacy entry recovery or relaxed cryptography.

Maximum encoded file 32 MiB, maximum 10,000 revisions and 10,000 markers, existing
16-MiB individual payload bound. Refuse an over-limit export/purge/import without
truncation/marker eviction. Before KDF, reject oversized bytes, malformed UTF-8,
invalid strict shape/profiles/counts. Require exact canonical compact JSON bytes
(no BOM/trailing newline); validated reserialization detects duplicate JSON keys
or alternate ordering. Freeze DTOs. Authenticate manifest, every marker/revision,
and complete DAG before any restore write. No arbitrary recursive object merging.

Use one consistent snapshot, authenticate it, generate, then exact-snapshot
validate before marking an artifact ready. A change before validation fails the
candidate. Creation linearizes at validation; later deletion cannot recall an
already prepared/handed-off snapshot. File authentication does not prove latest
state or detect a leaf omitted from source storage before export.

## Restoration

File selection precedes credentials. A private bounded restore intent/capability
handles selection/validation; no untrusted file metadata appears as unlocked UI.
No late picker/KDF/crypto result revives an expired, hidden or revoked generation.
After passphrase or recovery authentication show a safe summary and require
explicit restore confirmation. Recovery mode prepares a new confirmed phrase
wrapper before commit; preserve JEK, recovery wrapper, journal identity/revisions.
All nine target stores must be empty atomically. Write the full authenticated
snapshot plus rebuilt projections/conflicts and a fresh local-only device in one
transaction. No cloud IDs/queue/acks or merge/replacement. Adopt a session only
after commit or exact authenticated reconciliation. Never alter the source file.
Original Trash dates remain; normal maintenance can process already expired Trash.
An old offline backup cannot know about later deletion elsewhere. Explain this
point-in-time limitation and old-wrapper credentials. Existing journals are never
silently overwritten, including another copy of the same journalId.

## Readable export and native handoff

Require an unlocked foreground session and explicit unencrypted-file privacy
acknowledgment before generation. Use one authenticated snapshot. Export active
current heads only, label all active conflicting versions, omit Trash/deleted and
historical heads. Do not choose timestamp winners. Include original title/body
and authenticated dates in literal Markdown sections/fences; no HTML preview or
auto-open. Fail atomically on corruption/revocation/size errors, no partial file.
Maximum final UTF-8 size 16 MiB; format/decrypt in bounded yielding work units.
Separate Generate and Download actions. Keep artifact bytes/Blob private, no
React plaintext payload for export, no app-managed persistent staging. Generic
filenames: gibberish-backup.json and gibberish-readable.md. Blob URLs are opaque,
never content-encoded/logged/persisted; clean them up with a bounded qualified
policy, immediately on navigation/Hide/hidden/lock/deadline/pagehide. No automatic
restoration/download on resume. Native handoff cannot be recalled, may spool and
does not prove durable OS file storage. Say Download requested, not safely backed
up. No browser RAM-only/erasure/WCAG/real-device reliability guarantee.

## Passphrase change and scope

Minimal Change Passphrase reauthenticates the current phrase through the existing
worker, applies the new 15-code-point/nonblank/exact-UTF8/1024-byte policy and
confirmation, prepares a new wrapper outside IDB and uses marker-aware exact
snapshot CAS/reconciliation. Preserve JEK/recovery wrapper/history; no key rotation
or unrelated settings. Existing recovery-driven reset continues to work.
Failed current-phrase authentication conservatively locks this tab; it never
changes the stored bundle. A fresh unlock is required before another attempt.
All M3 per-tab conceal/revoke/deadline/dirty-draft rules remain. No Google/sync,
conflict resolution, bulk deletion, service worker or M5+ work.

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
