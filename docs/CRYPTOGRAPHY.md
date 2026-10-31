# Cryptographic formats and implementation

Status: operational envelope/AAD v2, legacy envelope/AAD v1, wrapping v1 and
codec integration. This document defines crypto contracts required by
`SECURITY.md` and `DATA_MODEL.md`. M2 storage/domain integration is documented
in `LOCAL_STORAGE.md`; no journal UI is implemented.

## Modules and trust boundary

`src/core/crypto` uses browser Web Crypto for key generation, AES-256-GCM,
HKDF-SHA256 and key wrapping. Only Argon2id uses `libsodium-wrappers-sumo`.
Core functions do not import React, Dexie, Google adapters, or any persistence or
network API. The separate Gibberish codec is a public reversible byte mapping,
not encryption.

External envelopes and wrapped-key records enter as `unknown` and must validate
before decryption/derivation. Identity arguments are validated too. Reject
unknown fields, unsupported versions/algorithms/profiles, wrong lengths and
noncanonical Base64url (including padding and alternate unused bits). Validators
return frozen snapshots to avoid retaining mutable input records across awaits.
Identifiers are canonical lowercase UUIDv4 strings, matching `randomUUID()`.

Error codes have fixed messages without interpolated input or underlying causes.
Incorrect credentials and structurally valid tampering both produce
`AUTHENTICATION_FAILED`. Malformed records are rejected before authenticated
operations. No caller-supplied IV or arbitrary AAD is accepted by encryption.

## Legacy v1 entry encryption and canonical AAD

Generate a 256-bit AES-GCM JEK with browser `subtle.generateKey`. Encrypt bytes
with a fresh 12-byte nonce and a 128-bit tag. The envelope is exactly:

```typescript
{ version: 1, algorithm: 'AES-256-GCM', nonce: string, ciphertext: string }
```

Strings use unpadded canonical Base64url. Ciphertext includes the tag as its last
16 bytes. Empty plaintext is supported; a ciphertext field must still contain the
tag. The helper bounds plaintext at 16 MiB (and ciphertext at 16 MiB + 16 bytes)
to limit allocation from untrusted input. This is an explicit helper limit, not
a claim that very large journal entries have been performance-qualified.

AAD is the UTF-8 encoding, without a BOM or whitespace, of this JSON array:

```text
["gibberish-entry-aad",1,1,journalId,entryId,revisionId,schemaVersion]
```

The first number is AAD format v1, the second envelope v1, and schemaVersion is
currently 1. UUID strings require no locale-specific normalization or escaping.
The order is fixed; JavaScript object property order has no effect. Both encrypt
and decrypt reconstruct it internally. This authenticates identity and the
encrypted bytes, not every visible revision field: timestamps, status and parent
IDs are not in the specified AAD. Legacy payload recovery must not treat those
fields as authenticated operational history. All new operational revisions use the full v2 contract below.

The user-approved revision-bound design is recorded in `DATA_MODEL.md` §7.1 and
`SYNC_STRATEGY.md` §11: every new revision, including Trash/restore, needs fresh
encryption under its own revision ID. Authenticate and decrypt the source first,
preserve its title/body values, and encrypt with a new nonce. Failure must not
produce a partial revision. M1 tests exercise this cryptographic transition
only; M2 implements creation/edit transactions separately. Trash and restoration
workflows are deferred to M4.

The M2 domain serializes the title and body together before encryption and
keeps the encrypted envelope separate from transient readable UI state. These
byte-oriented helpers do not render content, authorize sessions, or persist it.

## Nonces and randomness

All randomness comes from `crypto.getRandomValues` or Web Crypto key generation,
with no insecure fallback. Encryption and wrapping always request fresh 96-bit
nonces. A module-local registry of public nonces rejects repeat RNG output before
use, conservatively across all keys/handles in the current JavaScript context.
No caller can reset the registry through the public API.

This registry is not persistent or shared across tabs/devices. Across contexts
the random-IV design relies on the browser CSPRNG and has a nonzero collision
probability. Finite tests cannot prove lifetime uniqueness; neither M1 nor M2 claims an
absolute cross-device no-collision guarantee. The registry also grows with the
number of operations during a live context. M2 adds a journal-scoped unique nonce index as defense in depth and preserves
the same sealed candidate on transaction retries. It is not a cross-device
nonce registry; nonce length and AAD must not be weakened to simplify storage.

## JEK wrapping and key lifecycle

The JEK is an in-memory extractable AES `CryptoKey` with encrypt/decrypt usages.
Extractability is deliberately necessary for Web Crypto `wrapKey('raw', ...)`
and later passphrase rewrapping. This module never calls `exportKey` or returns a
raw JEK. Unwrapping returns a `CryptoKey` supporting the same lifecycle. Derived
wrapping keys are non-extractable with wrapKey/unwrapKey usages only.

Public return values are wrapped records matching `DATA_MODEL.md` §8.1. Callers
provide the expected journal ID separately (from the validated journal key bundle). AES-GCM
wrapping uses a fresh nonce, 128-bit tag, and this canonical UTF-8 JSON AAD:

```text
["gibberish-key-wrap",1,journalId,purpose,"AES-256-GCM",kdfName,salt,parameters]
```

For passphrase wrapping the ordered parameters array is
`[19,65536,3,1,32]`; for recovery it is `[32]`. The purpose, journal identity,
algorithm, KDF, salt and profile are thus bound to the wrapped bytes. Unsupported
parameters fail validation before KDF work, avoiding downgrade and unbounded
resource requests. A wrapped 32-byte JEK plus tag is exactly 48 bytes.

### Passphrase profile

- Argon2id v1.3 (`version: 19`), 65,536 KiB memory, 3 passes, parallelism 1,
  32-byte output, 16-byte secure random salt for every wrap.
- Use `crypto_pwhash_ALG_ARGON2ID13` explicitly, never a changeable default.
- Stored parameter keys: `version`, `memoryKiB`, `iterations`, `parallelism`,
  `hashLength`. V1 currently supports this exact profile only.
- Passphrase UTF-8 is used exactly as entered: no trimming or Unicode
  normalization. Reject empty, ill-formed Unicode and values over 1,024 UTF-8
  bytes. This is input-safety validation, not an onboarding strength policy.
- Wrapper-owned password and derived-key byte buffers are cleared after use,
  including failure. The caller's JS string is immutable and cannot be erased.

The profile keeps a fixed memory/security baseline instead of silently reducing
cost for slow clients. Browser tests measure it on the development host; this is
initial local calibration, not real-device qualification. Allocation/derivation
failure returns a safe error; no weaker fallback is attempted. KDF execution is
synchronous inside libsodium after its async loader is ready and may briefly
block its caller; a UI worker strategy can be added during UI work if needed.

### Recovery profile

Generate independent 32-byte CSPRNG material and encode it as exactly `gbr1.`
plus 43 canonical Base64url characters. This is 256 bits of entropy, not a
passphrase-derived credential. There is no typo-correction or checksum scheme;
format errors fail validation and a different valid credential fails GCM
authentication. The plaintext string is returned to the caller only, never saved.

Use Web Crypto HKDF-SHA256 with a fresh random 16-byte salt and this UTF-8 info:
`["gibberish-recovery-kek",1,journalId]`. Derive a non-extractable AES-256-GCM
wrapping key. Store only `{ hashLength: 32 }` parameters with the public salt,
nonce and authenticated wrapped JEK. Recovery needs no original passphrase and
can rewrap the same JEK under a new passphrase without re-encrypting entries.

## Exact encrypted bytes for Gibberish

`envelopeToBytes` emits:

| Offset | Bytes | Meaning |
|---|---|---|
| 0 | 1 | Envelope version `0x01` (legacy) or `0x02` (operational) |
| 1 | 1 | Algorithm identifier `0x01` = AES-256-GCM |
| 2 | 12 | Decoded nonce |
| 14 | remainder, at least 16 | Ciphertext followed by 16-byte tag |

Minimum size is 30 bytes, maximum 16 MiB + 30. `envelopeFromBytes` rejects
unsupported versions/algorithms and invalid lengths and reconstructs the exact
envelope. The independent codec maps this entire byte sequence using
[GIBBERISH_CODEC.md](GIBBERISH_CODEC.md). Keys, plaintext, UI state and revision
identifiers are not encoded; v2 decryption still needs the full immutable metadata tuple and independently
expected journal/entry scope; v1 recovery needs the original identity tuple. Valid-looking codec output alone never establishes integrity.

## Dependency review and CSP

Pinned `libsodium-wrappers-sumo@0.8.4`; the lockfile resolves `libsodium-sumo`
0.8.4 (native library reports 1.0.22). Its
[upstream wrapper documentation](https://github.com/jedisct1/libsodium.js)
identifies the sumo build as the variant containing `crypto_pwhash`. Only that
KDF is used here; AES-GCM, randomness and HKDF use browser primitives. The library
is dynamically imported when passphrase derivation is needed.

[Libsodium's KDF documentation](https://doc.libsodium.org/password_hashing/default_phf)
describes explicit Argon2id13 selection and a 64 MiB interactive baseline.
The chosen 3-pass profile is checked against an independently generated native
Node Argon2id vector, with separate browser round trips.

The [2017 library assessment](https://www.privateinternetaccess.com/blog/wp-content/uploads/2017/08/libsodium.pdf)
reviewed libsodium 1.0.12/1.0.13, not this wrapper release or all later changes.
Its historical audit is supporting evidence, not a claim that Gibberish or this
exact packaged build has been independently audited. Current wrapper/package
metadata, public API, profile behavior and browser bundling were reviewed;
signatures/provenance and every compiled instruction were not independently
verified. Dependency advisories must continue to be monitored.

The production CSP adds only `wasm-unsafe-eval` for WebAssembly compilation. It
does not allow general JavaScript `unsafe-eval`, inline scripts, external scripts
or external connections. Browser tests load a bundled test-only harness under
that policy; no harness/diagnostic UI ships in `dist/`.

Noble-hashes was considered but not selected: its
[published audit scope](https://github.com/paulmillr/noble-hashes#security)
excludes Argon2. A package-level audit badge must not be read as a specific
Argon2 implementation audit.

## Verification and remaining limits

Tests cover successful round trips, fixed native-reference vectors, tampering,
wrong keys/credentials/identities, fresh nonces and repeated-RNG rejection,
bounded format/profile validation, independent recovery/rewrapping, memory-copy
cleanup and absent logging/persistence/network calls. Browser tests exercise the
actual bundled implementation in all configured engines under the CSP.

No tests prove invulnerability or complete memory erasure. Caller plaintext and
key references remain the caller's responsibility; JS strings, browser internals,
WebAssembly memory and garbage collection cannot be guaranteed erased by this
module. Compromised origins/devices/extensions remain outside its protection.
M2 adds revocable domain capabilities, storage and lifecycle transactions; M1
alone did not implement them. UI locking/inactivity/background handling is M3,
and real-device release qualification remains future work.

## M2 operational envelope/AAD v2

The approved v2 AAD is the UTF-8 encoding without BOM/whitespace of this tuple:

```text
["gibberish-revision-aad",2,2,"AES-256-GCM",schemaVersion,journalId,entryId,revisionId,parentRevisionIds,status,createdAt,updatedAt,deletedAt]
```

DATA_MODEL §7 defines canonical lowercase UUIDv4 IDs, exact UTC millisecond
ISO timestamps, sorted unique non-self parent IDs (maximum 256), explicit
null for active deletedAt, trashed deletedAt equal to updatedAt, updatedAt not
before createdAt, and active roots with createdAt equal to updatedAt. Reject
noncanonical inputs before cryptographic work rather than normalizing them.
These constraints fix the only supported profile; future profiles need explicit
versioning. Envelope version and algorithm are validated constants as well as
AAD members. Changing an immutable field requires a new revision and nonce.

V1 bytes, wrapping, KDF parameters and vectors do not change. New `encryptRevision` and
`decryptRevision` APIs require complete frozen metadata and expected scope;
operational storage refuses v1. V1 helpers remain for regression/explicit legacy
payload recovery only, never automatic promotion or migration. There is no
cross-version retry after authentication failure.

The binary envelope keeps the same layout but uses version byte 0x02 for v2
(algorithm byte 0x01); serializers dispatch exactly by version. Gibberish `gib1:`
is independent of crypto version and unchanged. Record schemaVersion and database
version remain 1. New journal configuration declares encryptionVersion 2.

Canonical UUIDs, timestamps, explicit deletedAt null, parent ordering/uniqueness
and cap 256 are validated before crypto. Context/parent arrays are copied and
frozen before awaiting. AES-GCM verifies both content and metadata; it does not
prove timestamp truth, complete history, per-device authorship or prevent whole
valid-history rollback. Structural DAG validation follows authentication.

Sync can transfer bytes while locked, but promotion is deferred until the unlocked
crypto/domain layer authenticates them. Verification can transiently decrypt and
clear buffers without displaying content. See LOCAL_STORAGE.md for two-phase
preparation/commit; crypto never runs inside database transactions.

## M3 worker execution and creation policy

Browser passphrase KDF execution is isolated in a same-origin module worker.
Use unchanged libsodium Argon2id/profile, salts, exact UTF-8 and native reference
vectors. A derived non-extractable KEK may be cloned through a private worker
message, never persisted; no raw JEK is exported or sent to React. Serialize jobs,
validate responses and logically revoke/discard aborted jobs; terminate on
timeout/error. Node-only regression
tests may execute the same derivation directly; browsers must not silently fall
back to a blocking/cheaper implementation. Qualify bundling/CSP/offline already-
loaded operation and responsiveness in real browser engines.

The 15-code-point minimum is a new setup/reset policy in core/journal, not a
change to wrapping validation or legacy unlock. All cryptographic formats and
codec vectors stay unchanged. See [M3_EXPERIENCE.md](M3_EXPERIENCE.md).

### Resident worker cancellation and offline retries

An ordinary cancelled KDF job rejects immediately in the main thread, aborts its
application generation and never adopts its result. The resident worker receives
a content-free cancellation ID, finishes/clears already executing derivation in
its finally path, discards the KEK, and becomes idle for a later offline attempt.
A late cloned key is also discarded by the main receiver. No JEK or journal text
enters this worker, no credential/key is retained in idle worker state, and no
wrapping/unwrap/session adoption continues from a rejected job. This preserves
the same best-effort limitation as already-running Web Crypto: cancellation does
not guarantee immediate native memory erasure. Startup/job timeout or protocol/
worker failure still terminates it, with no weaker fallback. Serialize a bounded
single queued retry while a cancelled job drains. Keeping static code resident
avoids a network dependency for ordinary offline cancellation/retry; this is not
persistent application caching or an offline cold-launch guarantee.
