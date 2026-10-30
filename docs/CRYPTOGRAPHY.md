# M1 cryptographic format and implementation

Status: implementation format for encrypted envelope v1, wrapping v1 and codec
integration. This document fills in byte-level details required by
`SECURITY.md` and `DATA_MODEL.md`; it does not introduce storage or a journal UI.

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

## Entry encryption and canonical AAD

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
IDs are not in the specified AAD. Future domain/sync code must not assume those
fields have received cryptographic authentication or use timestamps as winners.

The user-approved revision-bound design is recorded in `DATA_MODEL.md` §7.1 and
`SYNC_STRATEGY.md` §11: every new revision, including Trash/restore, needs fresh
encryption under its own revision ID. Authenticate and decrypt the source first,
preserve its title/body values, and encrypt with a new nonce. Failure must not
produce a partial revision. M1 tests exercise this cryptographic transition only;
no journal lifecycle or database transaction has been implemented.

The M2 domain will serialize the title and body together before encryption, and
keep the encrypted envelope separate from transient readable UI state. These
byte-oriented helpers do not render content, authorize sessions, or persist it.

## Nonces and randomness

All randomness comes from `crypto.getRandomValues` or Web Crypto key generation,
with no insecure fallback. Encryption and wrapping always request fresh 96-bit
nonces. A module-local registry of public nonces rejects repeat RNG output before
use, conservatively across all keys/handles in the current JavaScript context.
No caller can reset the registry through the public API.

This registry is not persistent or shared across tabs/devices. Across contexts
the random-IV design relies on the browser CSPRNG and has a nonzero collision
probability. Finite tests cannot prove lifetime uniqueness; M1 does not claim an
absolute cross-device no-collision guarantee. The registry also grows with the
number of operations during a live context. Multi-tab lifecycle and any durable
key-use accounting belong to later local/domain work; the nonce length and AAD
must not be weakened to simplify it.

## JEK wrapping and key lifecycle

The JEK is an in-memory extractable AES `CryptoKey` with encrypt/decrypt usages.
Extractability is deliberately necessary for Web Crypto `wrapKey('raw', ...)`
and later passphrase rewrapping. This module never calls `exportKey` or returns a
raw JEK. Unwrapping returns a `CryptoKey` supporting the same lifecycle. Derived
wrapping keys are non-extractable with wrapKey/unwrapKey usages only.

Public return values are wrapped records matching `DATA_MODEL.md` §8.1. Callers
provide the expected journal ID separately (from a future key bundle). AES-GCM
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
| 0 | 1 | Envelope version `0x01` |
| 1 | 1 | Algorithm identifier `0x01` = AES-256-GCM |
| 2 | 12 | Decoded nonce |
| 14 | remainder, at least 16 | Ciphertext followed by 16-byte tag |

Minimum size is 30 bytes, maximum 16 MiB + 30. `envelopeFromBytes` rejects
unsupported versions/algorithms and invalid lengths and reconstructs the exact
envelope. The independent codec maps this entire byte sequence using
[GIBBERISH_CODEC.md](GIBBERISH_CODEC.md). Keys, plaintext, UI state and revision
identifiers are not encoded; decryption still needs the correct external
revision identity. Valid-looking codec output alone never establishes integrity.

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
Session locking, actual journal storage, lifecycle transactions and real-device
release qualification are not implemented or certified by M1.
