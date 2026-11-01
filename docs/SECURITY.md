# Gibberish — Security Specification

**Version:** 1.1 (Draft)
**Product:** Gibberish  
**Platform:** Progressive Web App (PWA)  
**Status:** Technical specification — pending implementation and security review  
**Related documents:** `PRD.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `SYNC_STRATEGY.md`, `TESTING.md`

---

## 1. Purpose

This document defines the security requirements, cryptographic architecture, key management, authentication boundaries, and privacy protections for Gibberish.

Gibberish is a privacy-first, local-first journaling application. Users write personal journal entries in English, which are encrypted locally before being persisted or synchronized.

Saved entries are displayed by default in a fictional, pronounceable language called Gibberish.

The Gibberish language is a presentation layer, not a security mechanism.

The primary security objective is to ensure that journal plaintext remains inaccessible to unauthorized parties, including cloud storage providers, without the user's journal passphrase or recovery key.

This specification establishes mandatory security requirements for all implementations.

## 2. Security Principles

Gibberish must follow these principles:

1. **Encrypt before persistence:** Journal plaintext must be encrypted before it is stored locally or uploaded.
2. **Client-side cryptography:** Encryption, decryption, and key derivation must occur on the user's device.
3. **No custom cryptographic primitives:** Use established, reviewed cryptographic algorithms and implementations.
4. **Separate authentication from decryption:** Google sign-in must never substitute for the journal passphrase.
5. **Minimum necessary access:** Request only the Google permissions required for the selected features.
6. **No plaintext telemetry:** Never log or transmit journal content, passphrases, recovery keys, or unwrapped encryption keys.
7. **Fail securely:** Authentication, encryption, storage, and synchronization failures must not silently weaken protections.
8. **Explicit recovery:** Journal recovery must use an approved recovery mechanism, not an account-based password reset.
9. **Minimize sensitive metadata:** Avoid exposing entry titles, bodies, or unnecessary personal information outside encrypted payloads.
10. **Defense in depth:** Protect against web vulnerabilities even when stored journal content is encrypted.

## 3. Threat Model

### 3.1 Assets to Protect

The following assets are considered sensitive:

- Original English journal titles and bodies
- Journal encryption keys
- Journal passphrases
- Recovery keys
- Decrypted journal content in application memory
- OAuth access tokens
- Encrypted journal backups and their recovery metadata
- Journal metadata that may reveal private activity patterns

### 3.2 Threats Addressed

Gibberish must mitigate:

- Unauthorized reading of locally stored journal files
- Unauthorized reading of cloud-stored journal content
- Casual observation of an unlocked journal
- Accidental exposure of plaintext through logs or exports
- Exposure caused by overly broad Google Drive permissions
- Data corruption or loss caused by failed synchronization
- Reuse of encryption nonces
- Tampering with encrypted journal records
- Cross-site scripting and malicious content injection
- Unauthorized access through an unlocked browser session
- Accidental loss of local data without a backup

### 3.3 Security Limitations

Gibberish cannot guarantee protection against every threat.

The MVP does not guarantee confidentiality when:

- The user's device or operating system is compromised.
- A malicious browser extension can access the application.
- Malicious JavaScript executes within the application's trusted origin.
- The user intentionally exports plaintext and stores it insecurely.
- An attacker observes the screen while plaintext is revealed.
- An attacker obtains the passphrase or recovery key.

Client-side encryption protects stored data, but it does not make an actively unlocked browser environment immune to compromise.

## 4. Cryptographic Architecture

### 4.1 Approved Cryptographic Components

The MVP must use established cryptographic components.

| Purpose | Approved approach |
|---|---|
| Journal content encryption | AES-256-GCM |
| Journal encryption key | Random 256-bit key |
| Randomness | Cryptographically secure browser random number generator |
| Passphrase-based key derivation | Argon2id through a vetted, browser-compatible implementation |
| Key wrapping | Authenticated encryption using a derived key |
| Recovery-key wrapping | Authenticated encryption using an independently derived or generated wrapping key |
| Integrity protection | AES-GCM authentication tag |
| Encrypted payload encoding | Versioned binary-safe representation |
| Gibberish display | Reversible bytes-to-syllables codec |

The implementation must not substitute a weaker cryptographic algorithm merely to simplify development.

### 4.2 Journal Encryption Key

Each journal must have a randomly generated 256-bit Journal Encryption Key (JEK).

The JEK is responsible for encrypting journal content.

Requirements:

- Generate the JEK using a cryptographically secure random source.
- Never derive the JEK directly from the user's passphrase.
- Never store the unwrapped JEK in IndexedDB, localStorage, sessionStorage, Google Drive, or Google Sheets.
- Never upload the unwrapped JEK.
- Keep the usable JEK in memory only while the journal is unlocked.
- Clear application references to the JEK when the journal locks, as far as browser capabilities permit.
- Use a consistent, documented key lifecycle across devices.

### 4.3 Journal Entry Encryption

Every journal entry must be encrypted before persistence.

The encrypted payload must include:

- Original English title
- Original English body
- Any sensitive entry metadata

Each encryption operation must use a fresh, unique nonce appropriate for AES-GCM.

Requirements:

- Never reuse a nonce with the same encryption key.
- Authenticate encrypted content and relevant record metadata.
- Reject ciphertext when authentication fails.
- Never display corrupted or unauthenticated plaintext.
- Use a versioned encryption envelope to support future format changes.
- Editing an entry must produce a newly encrypted payload with a fresh nonce.
- Every new revision, including Trash and restoration, must use fresh encryption with its own revision-bound AAD; preserving content means preserving the title/body values, not reusing ciphertext (`DATA_MODEL.md` §7.1).

The exact envelope structure must be defined in `DATA_MODEL.md`.

M1 implements the byte-level AAD, key-wrapping and recovery profiles documented
in [CRYPTOGRAPHY.md](CRYPTOGRAPHY.md). That document also records dependency-review
scope, nonce collision limits, memory-handling limitations and the narrow
WebAssembly CSP allowance. Tests verify specific properties, not an overall
security guarantee.

### M2 Immutable Metadata Authentication

Operational revisions use envelope/AAD v2 and bind journalId, entryId, revisionId,
parentRevisionIds, status, createdAt, updatedAt, deletedAt, schemaVersion, envelope
version and algorithm. Canonical serialization, strict validation and the
256-parent cap are specified in DATA_MODEL §7. No fallback to identity-only v1
is permitted after a v2 failure; legacy v1 payload recovery never authorizes old
unauthenticated ancestry/status/dates as operational history.

Ciphertext-only synchronization can transfer and structurally stage records
without a key. It cannot authoritatively promote incoming metadata, apply
retention or delete content while locked. Verification occurs through the
unlocked crypto/domain layer; no persisted verified flag or secret verification
key is trusted while locked. Authenticated metadata remains visible to raw
storage observers; locked UI/domain reads reveal none of it.

No plaintext, credentials, raw keys or CryptoKey objects may cross the storage
DTO boundary. Encrypt and authenticate outside IndexedDB transactions; perform
revision/projection/conflict/outbox writes atomically with exact snapshot checks.
Separate authenticated tombstone design remains a gate before destructive M4/M7
work; M2 does not implement deletion based on untrusted markers.

### 4.4 Encryption Format Versioning

Every encrypted journal record must identify its encryption format version.

The application must:

- Recognize supported versions.
- Reject unsupported formats safely.
- Avoid silently modifying or re-encrypting unknown formats.
- Preserve data during future encryption migrations.
- Test compatibility before migrating encrypted records.

## 5. Passphrase and Key Management

### 5.1 Journal Passphrase

During onboarding, the user must create a journal passphrase.

The passphrase protects access to the JEK.

Requirements:

- The passphrase must not be stored in plaintext.
- The passphrase must not be transmitted to Google or another service.
- A vetted Argon2id implementation must derive a Key Encryption Key (KEK) from the passphrase.
- Use a cryptographically random salt.
- Store the salt and non-secret derivation parameters alongside the encrypted key material.
- Calibrate Argon2id parameters for supported devices while maintaining an appropriate security baseline.
- Use the KEK to protect the JEK through authenticated encryption.
- Reject incorrect passphrases without exposing decrypted data.
- Do not retain the passphrase after it is no longer needed for the unlock operation.
- New setup/recovery phrases require at least 15 Unicode code points, nonblank
  well-formed UTF-8, exact confirmation and the existing 1,024-byte maximum.
  Never normalize/trim/truncate. Existing shorter phrases still unlock.

### 5.2 Wrapped Journal Encryption Key

The JEK must be stored only in an encrypted, wrapped form.

The wrapped-key record must contain sufficient non-secret information to support unlocking, including:

- Key-wrapping format version
- Key derivation parameters
- Salt
- Nonce
- Authenticated encrypted key material

The record must not contain the plaintext passphrase, recovery key, or JEK.

### 5.3 Unlocking

The journal unlock process must:

1. Accept the journal passphrase.
2. Derive the appropriate KEK locally.
3. Attempt authenticated decryption of the wrapped JEK.
4. Reject incorrect passphrases or corrupted key material.
5. Make the JEK available only to the active unlocked session.
6. Transition to the unlocked interface only after successful verification.

Google authentication must not automatically unlock the journal.

## 6. Recovery Key

### 6.1 Recovery-Key Generation

During initial setup, Gibberish must generate a separate recovery key using a cryptographically secure random source.

The recovery key must be independent of the user's passphrase.

The recovery key must provide an alternative method for unlocking the JEK.

### 6.2 Recovery-Key Storage

Requirements:

- Display the recovery key to the user during onboarding.
- Instruct the user to save it in a secure location.
- Do not upload or store the plaintext recovery key.
- Store only the independently wrapped JEK and the non-secret metadata required for recovery.
- Ensure the recovery key is not included in logs, analytics, or exported journal plaintext.
- Require the user to acknowledge the importance of saving the recovery key.

### 6.3 Recovery Process

The recovery process must:

1. Accept the recovery key.
2. Validate the recovery-key format.
3. Derive or reconstruct the appropriate recovery wrapping key.
4. Authenticate and decrypt the recovery-wrapped JEK.
5. Allow the user to establish a new journal passphrase.
6. Rewrap the JEK using the new passphrase.
7. Preserve existing encrypted journal entries.

The application must not require decrypting and re-encrypting every journal entry merely to change the passphrase.

### 6.4 Recovery Limitations

If the user loses both the passphrase and recovery key, Gibberish may be unable to recover the journal.

Google authentication must not bypass this limitation.

The application must communicate this clearly during onboarding and recovery.

## 7. Journal Locking and Session Security

### 7.1 Fully Locked State

Gibberish must remain fully locked until the user successfully unlocks the journal.

While locked:

- Do not display journal entries.
- Do not display journal titles.
- Do not display entry dates.
- Do not display the journal timeline.
- Do not display Gibberish representations.
- Do not expose decrypted journal content through application state or rendered components.

### 7.2 Automatic Locking

The journal must automatically lock after five consecutive minutes of user inactivity.

Requirements:

- Reset the inactivity timer on meaningful user interaction.
- Support manual locking.
- Use elapsed-time checks rather than relying exclusively on JavaScript timers.
- Recheck the inactivity deadline when the application returns from the background.
- Clear decrypted content and active key references when locking.
- Require a new unlock after the session expires.

Browser limitations may prevent guaranteed immediate memory erasure.

### 7.3 Reveal and Hide

Saved entries must display as Gibberish by default.

Users must explicitly select **Reveal My Thoughts** to view the original English.

Requirements:

- Reveal only the selected entry.
- Never persist revealed plaintext.
- Hide revealed content when navigating away.
- Hide revealed content when the application enters the background.
- Hide revealed content when the journal locks.
- Do not automatically reveal entries after unlocking.
- Do not include revealed plaintext in logs or diagnostic output.

### 7.4 Browser Session Considerations

The application must not assume that browser timers continue running while a PWA is suspended.

On resuming, it must verify whether the journal should still be unlocked.

The application must also avoid preserving revealed plaintext through browser navigation history or persistent state restoration.

## 8. Local Storage Security

### 8.1 IndexedDB

Gibberish uses IndexedDB for local encrypted journal storage.

Dexie may be used as the IndexedDB abstraction layer.

Requirements:

- Persist encrypted journal payloads only.
- Persist wrapped key material and necessary non-secret metadata.
- Do not store journal plaintext.
- Do not store the journal passphrase.
- Do not store the plaintext recovery key.
- Do not store the unwrapped JEK.
- Handle storage errors without silently losing data.

### 8.2 Browser Storage Limitations

IndexedDB is not a guaranteed permanent backup.

Browser data may be deleted through:

- User actions
- Browser storage cleanup
- Device loss
- Browser profile changes
- Application removal
- Storage eviction

The application must communicate these risks, especially when Google Drive is not connected.

### 8.3 Local-Only Mode

Users must be able to journal without Google authentication.

In local-only mode:

- Encryption requirements remain unchanged.
- The journal must work without network connectivity after initialization.
- Encrypted backup export must remain available.
- The interface must indicate that entries are not cloud-backed up.
- The application must not silently upload journal data.

## 9. Google Authentication and Cloud Security

### 9.1 Optional Authentication

Google authentication is required only when the user chooses Google Drive integration.

Google sign-in must not be required for local journaling.

Authentication and journal decryption are separate security boundaries.

### 9.2 Google Drive Permissions

The application must request the minimum permissions needed to manage its journal files.

Requirements:

- Prefer narrowly scoped Google Drive authorization where technically supported.
- Avoid broad access to unrelated Google Drive files.
- Request authorization only when the user enables cloud functionality.
- Explain the permissions requested.
- Handle denied or revoked authorization gracefully.
- Do not silently reconnect or upload data without appropriate authorization.

The exact OAuth scopes and API access model must be verified during implementation.

### 9.3 Cloud Storage

Google Drive and Google Sheets may store:

- Encrypted journal records
- Wrapped encryption keys
- Non-secret cryptographic metadata
- Synchronization metadata
- Version identifiers

They must never store:

- Plaintext journal titles
- Plaintext journal bodies
- Journal passphrases
- Plaintext recovery keys
- Unwrapped journal encryption keys

### 9.4 OAuth Token Handling

OAuth tokens must be treated as sensitive credentials.

Requirements:

- Never log OAuth tokens.
- Never embed client secrets in the PWA.
- Do not place tokens in URLs.
- Avoid persistent token storage where possible.
- Clear application-held tokens when disconnecting Google Drive.
- Do not confuse Google authentication with journal unlocking.

Browser-based OAuth integration must use an approved flow suitable for public clients.

## 10. Gibberish Codec Security Boundary

The Gibberish codec converts encrypted bytes into pronounceable fictional-language text.

Its purpose is presentation, not encryption.

Requirements:

- Encode encrypted data without losing information.
- Decode the representation back to the original encrypted bytes.
- Use a deterministic, versioned mapping.
- Never derive Gibberish directly from plaintext through simple substitution.
- Never rely on the secrecy of the codec for confidentiality.
- Test round-trip correctness across supported inputs.
- Treat malformed Gibberish data as invalid rather than attempting unsafe recovery.

Because encryption uses fresh nonces, identical English entries should not be expected to produce identical Gibberish representations.

## 11. Export Security

### 11.1 Encrypted Backup

Encrypted backups must:

- Contain encrypted journal data.
- Include the metadata needed for restoration.
- Exclude plaintext journal content.
- Exclude plaintext passphrases and recovery keys.
- Exclude unwrapped encryption keys.
- Support integrity verification during restoration.
- Be generated locally.

### 11.2 Readable English Export

Users may explicitly export their journal in readable English.

Requirements:

- Require an unlocked journal.
- Display a privacy warning.
- Require explicit confirmation.
- Generate the export locally.
- Support Markdown format for MVP.
- Avoid retaining plaintext export data in persistent application storage.
- Avoid logging exported content.
- Do not automatically upload readable exports to Google Drive.

Once a readable export is downloaded, Gibberish cannot guarantee its confidentiality.

## 12. Trash and Deletion Security

Deleted journal entries must move to encrypted Trash.

Requirements:

- Retain trashed entries for 30 days.
- Keep trashed entries encrypted.
- Allow restoration while the journal is unlocked.
- Permit early permanent deletion.
- Automatically initiate permanent deletion after expiration during the next applicable cleanup operation.
- Synchronize deletion and restoration when Google Drive is connected.
- Prevent deleted entries from being silently restored by stale synchronization data.

Because the MVP has no continuously running backend, cleanup cannot be guaranteed to occur at the exact expiration time.

Permanent deletion from active application storage does not guarantee removal from historical Google-managed versions or external backups.

## 13. Web Application Security

### 13.1 Cross-Site Scripting Protection

The application must:

- Treat all user-provided content as untrusted.
- Render journal content as text rather than executable HTML.
- Avoid unsafe HTML injection.
- Avoid evaluating dynamically supplied code.
- Use a restrictive Content Security Policy.
- Minimize third-party scripts and dependencies.
- Review dependencies for known vulnerabilities.

### 13.2 Network Security

- Serve the application over HTTPS in production.
- Use secure API endpoints.
- Do not transmit journal plaintext to external services.
- Do not transmit passphrases or recovery keys.
- Avoid third-party analytics that could capture sensitive content.

### 13.3 Error Handling

Security-related errors must not expose sensitive information.

The application must:

- Avoid including plaintext in exceptions.
- Avoid logging cryptographic keys or credentials.
- Distinguish authentication failures from data corruption where appropriate without leaking secrets.
- Fail securely when encrypted payload authentication fails.
- Preserve encrypted records when decryption or migration fails.

### 13.4 Dependency Security

- Use maintained, established dependencies.
- Pin and lock dependency versions.
- Review security-sensitive packages before adoption.
- Run dependency vulnerability checks.
- Do not add new cryptographic libraries without reviewing their implementation and maintenance status.

## 14. Security Testing Requirements

The security implementation must include automated tests covering:

1. Encryption and decryption round trips.
2. Incorrect passphrase rejection.
3. Recovery-key unlocking.
4. Passphrase reset through recovery.
5. Corrupted ciphertext rejection.
6. Authentication-tag verification.
7. Unique nonce generation.
8. Locked-state privacy.
9. Five-minute inactivity locking.
10. Reveal and Hide behavior.
11. Backgrounding and navigation privacy.
12. Encrypted IndexedDB persistence.
13. Absence of plaintext in cloud payloads.
14. Encrypted backup creation and restoration.
15. Readable export confirmation.
16. Trash retention and deletion behavior.
17. Gibberish codec round-trip correctness.
18. OAuth permission failure and revocation.
19. Offline operation and recovery from synchronization failures.

Security-sensitive changes must not be considered complete without relevant tests.

## 15. Security Rules for Codex

Codex must follow these requirements during implementation:

- Do not invent cryptographic algorithms.
- Do not replace authenticated encryption with encoding or obfuscation.
- Do not persist plaintext journal content.
- Do not hardcode secrets or credentials.
- Do not add a backend without approval.
- Do not add third-party analytics without approval.
- Do not weaken cryptographic parameters to make tests pass.
- Do not bypass passphrase verification.
- Do not disable authentication-tag validation.
- Do not silently change the encryption format.
- Do not claim security properties that have not been verified.
- Document security-sensitive architectural decisions.
- Run relevant security tests before completing implementation tasks.

If a security requirement conflicts with a proposed implementation, Codex must report the conflict rather than silently overriding the requirement.

## 16. Security Acceptance Criteria

The MVP security implementation is acceptable when:

1. All persisted journal titles and bodies are encrypted.
2. Journal plaintext is never uploaded to Google Drive.
3. The journal cannot be unlocked without valid credentials.
4. Google authentication does not unlock the journal.
5. Recovery works without exposing the JEK.
6. The journal locks after five minutes of inactivity.
7. Revealed content is hidden on navigation and backgrounding.
8. Locked screens do not display journal content or metadata.
9. Encrypted backups can be restored successfully.
10. Readable exports require explicit confirmation.
11. Corrupted encrypted records are rejected safely.
12. Security-sensitive automated tests pass.
13. Known high-severity security issues have been resolved before release.

## 17. Document Governance

This document defines mandatory security requirements for Gibberish MVP v1.

The detailed encryption envelope, key-record schema, and synchronization metadata must be specified in `DATA_MODEL.md`.

The application architecture and module boundaries must be specified in `ARCHITECTURE.md`.

Security testing procedures must be expanded in `TESTING.md`.

Any change to the cryptographic architecture requires explicit review and documentation before implementation.

Security requirements must not be weakened solely for implementation convenience.

## M3 approved session and recovery contract

The approved policy is specified in [M3_EXPERIENCE.md](M3_EXPERIENCE.md).
Concealment on visibility hidden clears all plaintext React/form state and drafts
but retains only private capabilities until the original 300,000-ms deadline.
Do not describe concealment as lock. Manual lock, expiry and pagehide revoke
capabilities and invalidate asynchronous generations. Every sensitive command,
resume and result delivery checks expiry before accepting activity. Per-tab only.

Confirmed setup writes no journal before recovery display/full confirmation and
acknowledgment. Recovery reset authenticates the entire relevant history with the
recovered JEK and uses exact bundle/config/device/revision snapshot CAS; preserve
the JEK, journalId, recovery wrapper and immutable ciphertext. Reconcile uncertain
outcomes by exact encrypted plans; never infer that revocation undid a committed
transaction. No keys reach React or persistent storage.

The browser Argon2id computation runs in a same-origin dedicated worker with
unchanged profile/vectors, bounded jobs, cancellation and typed private messages.
There is no weaker/main-thread browser fallback. Owned buffers are cleared and
late keys discarded; browser/GC/engine memory erasure cannot be guaranteed.


## M4 approved implementation contract

Decisions A–G Option 1 are approved. [M4_LIFECYCLE.md](M4_LIFECYCLE.md) defines
the precise lifecycle, authenticated marker/backup formats, database v2 migration,
retention, restoration, download and passphrase-change contracts. These supersede
older draft tombstone/backup shapes and M2-only lifecycle exclusions. Revision/AAD
v2, wrapping v1, codec v1 and the five-minute M3 privacy policy remain unchanged.
