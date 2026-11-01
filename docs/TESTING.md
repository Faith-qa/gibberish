# Gibberish — Testing Strategy and Quality Assurance

**Version:** 1.0  
**Product:** Gibberish  
**Platform:** Progressive Web App (PWA)  
**Status:** Technical specification — pending implementation validation

**Related documents:**
- `docs/PRD.md`
- `docs/SECURITY.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/SYNC_STRATEGY.md`
- `docs/IMPLEMENTATION_PLAN.md`

---

## 1. Purpose

This document defines the testing strategy, quality standards, test environments, and acceptance criteria for Gibberish.

Gibberish is a privacy-first journaling application. Testing must therefore verify more than whether features appear to work.

It must establish confidence that:

- Private journal content is encrypted before persistence.
- Journal keys and credentials are handled securely.
- Users can journal without internet connectivity.
- Local data survives normal application restarts.
- Google Drive synchronization does not silently discard changes.
- Conflicting revisions remain recoverable.
- Deleted entries are not accidentally restored.
- Encrypted backups can be restored.
- Locking and reveal behavior respect privacy requirements.
- The application remains usable across supported browsers and devices.

Testing is a continuous part of development, not a final project phase.

## 2. Testing Principles

The following principles apply throughout implementation.

1. **Test security-sensitive behavior first.** Cryptography, key management, locking, and persistence require automated tests.
2. **Test observable behavior.** Verify outcomes rather than implementation details wherever possible.
3. **Test failure paths.** Network failures, corrupted records, browser restarts, and conflicting writes are expected scenarios.
4. **Use deterministic fixtures.** Tests must be reproducible.
5. **Keep tests independent.** Tests must not depend on execution order.
6. **Avoid production data.** Test suites must use synthetic journal entries and dedicated test accounts.
7. **Protect test secrets.** Test credentials must never be committed to source control.
8. **Verify offline operation.** Core journaling must function without Google APIs.
9. **Preserve data integrity.** Tests must verify that failures do not silently discard encrypted records.
10. **Gate feature completion.** A feature is not complete until its required tests pass.

## 3. Testing Technology Stack

| Tool | Purpose |
|---|---|
| Vitest | Unit and integration testing |
| React Testing Library | React component behavior |
| Playwright | End-to-end browser testing |
| Dexie | Local persistence implementation |
| fake-indexeddb | Selected IndexedDB integration tests |
| Mock Service Worker or equivalent | Controlled API responses |
| TypeScript compiler | Static type checking |
| ESLint | Code quality and selected security rules |
| pnpm | Running test scripts |

Use the smallest set of additional testing dependencies necessary.

Do not introduce a second test framework without a documented reason.

## 4. Test Categories

Gibberish uses six testing categories.

### 4.1 Unit Tests

Verify isolated functions and modules.

Examples:

- Gibberish encoding and decoding
- Revision ancestry calculations
- Timestamp validation
- Data schema validation
- Synchronization state transitions
- Trash expiration calculations

Unit tests should be fast and run frequently.

### 4.2 Cryptographic Tests

Verify encryption, decryption, key wrapping, and recovery.

These tests must cover successful operations and expected failures.

### 4.3 Integration Tests

Verify interactions between application modules.

Examples:

- Journal service and IndexedDB
- Encryption before persistence
- Revision creation and synchronization queue updates
- Backup serialization and restoration
- Sync engine and mocked Google adapters

### 4.4 Component Tests

Verify user-interface behavior.

Examples:

- Locked journal screen
- Passphrase input
- Reveal and Hide controls
- Timeline ordering
- Synchronization status messages
- Conflict-resolution interface

### 4.5 End-to-End Tests

Verify complete user journeys in a browser.

Examples:

- Onboarding
- Journal creation
- Locking and unlocking
- Offline journaling
- Trash and restoration
- Backup export
- Cross-device restoration with test fixtures

### 4.6 Manual and Exploratory Tests

Verify behavior that is difficult to reproduce reliably in automated environments.

Examples:

- Real Google OAuth consent
- PWA installation
- Mobile browser suspension
- Browser storage eviction behavior
- Accessibility with assistive technology
- Actual Google Sheets API limitations

Manual testing supplements automated testing; it does not replace it.

## 5. Recommended Test Organization

```text
tests/
├── unit/
│   ├── crypto/
│   ├── gibberish-codec/
│   ├── journal/
│   ├── validation/
│   └── sync/
├── integration/
│   ├── storage/
│   ├── journal/
│   ├── recovery/
│   ├── backup/
│   └── sync/
├── e2e/
│   ├── onboarding.spec.ts
│   ├── journal.spec.ts
│   ├── locking.spec.ts
│   ├── offline.spec.ts
│   ├── trash.spec.ts
│   ├── recovery.spec.ts
│   ├── backup.spec.ts
│   └── sync.spec.ts
└── fixtures/
    ├── encrypted-records/
    ├── revision-graphs/
    └── google-api/
```

Tests may also be colocated with implementation modules where this improves maintainability.

The important requirement is consistent organization and clear ownership.

## 6. Cryptography Test Requirements

Cryptography is a critical security boundary.

### CRYPTO-01: Encryption Round Trip

**Given:** A valid plaintext payload and journal encryption key.

**When:** The payload is encrypted and decrypted.

**Then:** The original bytes are recovered exactly.

### CRYPTO-02: Fresh Encryption Nonces

**Given:** The same plaintext and encryption key.

**When:** The plaintext is encrypted repeatedly.

**Then:** Each operation uses a freshly generated nonce and produces an independently authenticated envelope.

Tests must verify nonce-generation behavior without claiming that finite sampling mathematically proves uniqueness.

### CRYPTO-03: Incorrect Key Rejection

**Given:** An encrypted payload.

**When:** Decryption is attempted with a different key.

**Then:** Authentication fails and no plaintext is returned.

### CRYPTO-04: Ciphertext Tampering

**Given:** A valid encrypted envelope.

**When:** Its ciphertext is modified.

**Then:** Decryption fails safely.

### CRYPTO-05: Nonce Tampering

**Given:** A valid encrypted envelope.

**When:** Its nonce is modified.

**Then:** Decryption fails safely.

### CRYPTO-06: Authenticated Metadata Tampering

**Given:** A valid encrypted journal revision.

**When:** An authenticated identity field is changed.

**Then:** Decryption fails because authenticated additional data no longer matches.

### CRYPTO-07: Passphrase Unlock

**Given:** A journal key wrapped using a valid passphrase.

**When:** The correct passphrase is supplied.

**Then:** The original journal encryption key becomes available for the unlocked session.

### CRYPTO-08: Incorrect Passphrase

**Given:** A passphrase-wrapped journal key.

**When:** An incorrect passphrase is supplied.

**Then:** Unlocking fails without exposing the journal key.

### CRYPTO-09: Recovery-Key Unlock

**Given:** A recovery-wrapped journal key.

**When:** The valid recovery key is supplied.

**Then:** The original journal encryption key is recovered.

### CRYPTO-10: Invalid Recovery Key

**Given:** A recovery-wrapped journal key.

**When:** An invalid recovery key is supplied.

**Then:** Recovery fails safely.

### CRYPTO-11: Passphrase Change

**Given:** An existing encrypted journal.

**When:** The user changes the passphrase.

**Then:**

- The new passphrase unlocks the journal.
- The previous passphrase no longer unlocks the updated passphrase-wrapped key.
- Existing encrypted entries remain readable.
- The journal encryption key does not need to change.

### CRYPTO-12: Unsupported Encryption Version

**Given:** An envelope using an unsupported version.

**When:** The application attempts to process it.

**Then:** The envelope is rejected without corrupting stored data.

### CRYPTO-13: Key Persistence

Verify that plaintext journal encryption keys are not written to:

- IndexedDB
- Local storage
- Session storage
- Application logs
- Cloud requests

### CRYPTO-14: KDF Parameter Validation

Verify that malformed, unsupported, or unsafe key-derivation parameters are rejected.

### CRYPTO-15: Browser Compatibility

Verify supported browser implementations of Web Crypto and the selected Argon2id library.

### CRYPTO-16: Reference Interoperability

Use fixed, non-production test vectors to verify that supported implementations produce compatible encryption envelopes and key-wrapping results.

## 7. Gibberish Codec Tests

The Gibberish codec must be reversible and independent of encryption.

### CODEC-01: Round Trip

For arbitrary byte sequences:

```typescript
decode(encode(bytes)) === bytes
```

### CODEC-02: Empty Input

Verify defined behavior for an empty byte sequence.

### CODEC-03: Binary Coverage

Verify encoding and decoding for all possible byte values.

### CODEC-04: Large Payloads

Verify correct round trips for large encrypted payloads.

### CODEC-05: Deterministic Encoding

The same input bytes must produce the same Gibberish output under the same codec version.

### CODEC-06: Version Compatibility

Verify that supported historical codec versions remain decodable.

### CODEC-07: Invalid Input

Malformed Gibberish text must be rejected safely.

### CODEC-08: No Plaintext Dependency

Verify that the codec accepts encrypted bytes and does not require original English content.

### CODEC-09: Display Safety

Verify that codec output is rendered as text rather than interpreted as HTML or executable markup.

### CODEC-10: Performance

Verify that encoding and decoding remain responsive for representative journal sizes.

## 8. Data Model and Validation Tests

### DATA-01: Required Fields

Reject records missing required fields.

### DATA-02: Identifier Validation

Reject malformed journal, entry, revision, and operation identifiers.

### DATA-03: Envelope Validation

Reject malformed Base64url values, invalid nonce lengths, and unsupported algorithms.

### DATA-04: Timestamp Validation

Reject invalid timestamp formats.

### DATA-05: Revision Parent Rules

Verify:

- New entries have no parents.
- Ordinary edits have one parent.
- Conflict-resolution revisions may have multiple parents.

### DATA-06: Duplicate Revisions

Identical duplicate revisions must be deduplicated logically.

### DATA-07: Revision Identifier Collision

The same revision identifier with different content must produce an integrity error.

### DATA-08: Unsupported Schema

Unsupported schema versions must be rejected safely.

### DATA-09: Tombstone Validation

Reject malformed permanent deletion markers.

### DATA-10: Backup Schema Validation

Reject malformed or incompatible backup files before restoration begins.

## 9. Local Storage Integration Tests

### STORAGE-01: Encrypted Persistence

Create a journal entry and inspect the persisted record.

Verify that plaintext title and body values do not appear in IndexedDB.

### STORAGE-02: Durable Local Save

Save an entry, recreate the application storage connection, and verify that the encrypted entry remains available.

### STORAGE-03: Atomic Entry Creation

Verify that entry revision creation, current projection updates, and synchronization queue updates succeed or fail together.

### STORAGE-04: Atomic Entry Editing

Verify that an edit does not partially update the current projection if revision persistence fails.

### STORAGE-05: Storage Failure

Simulate an IndexedDB write failure.

Verify that the application does not report the entry as saved.

### STORAGE-06: Revision Immutability

Verify that existing revisions are not modified when an entry is edited.

### STORAGE-07: Projection Reconstruction

Rebuild current-entry projections from immutable revisions.

Verify that the resulting state matches the expected journal state.

### STORAGE-08: Database Migration

Verify that supported schema migrations preserve encrypted records.

### STORAGE-09: Concurrent Local Access

Simulate multiple tabs or storage clients and verify that local operations preserve consistency.

### STORAGE-10: No Plaintext Draft Persistence

Verify that unfinished plaintext drafts are not persisted automatically.

The application must communicate that unsaved text may be lost when a page is closed or refreshed.

## 10. Journal Feature Tests

### JOURNAL-01: Create Entry

A user can create an entry containing a title and body.

The entry is encrypted before persistence.

### JOURNAL-02: Edit Entry

Editing an entry creates a new immutable revision.

### JOURNAL-03: Empty Title or Body

Validate required fields according to the product requirements.

### JOURNAL-04: Timeline Ordering

Entries appear in reverse chronological order.

### JOURNAL-05: Gibberish Titles

The timeline displays Gibberish titles by default.

### JOURNAL-06: Reveal Entry

Selecting **Reveal My Thoughts** displays the original English title and body for the selected entry.

### JOURNAL-07: Hide Entry

Selecting **Hide My Thoughts** removes the revealed English from the interface.

### JOURNAL-08: Navigation Privacy

Navigating away from a revealed entry hides its plaintext.

### JOURNAL-09: Background Privacy

Backgrounding the application immediately hides revealed English.

### JOURNAL-10: Manual Lock

Manual locking removes journal access and hides all journal content.

### JOURNAL-11: Locked Metadata

While locked, the application must not display:

- Entry titles
- Gibberish titles
- Timeline items
- Entry dates
- Trash entries
- Other journal metadata

### JOURNAL-12: Five-Minute Inactivity Lock

Verify automatic locking after five minutes of inactivity.

### JOURNAL-13: Background Timer Throttling

Simulate a suspended or throttled browser.

Verify that elapsed-time checks lock the journal correctly when the application resumes.

### JOURNAL-14: Offline Editing

Verify that users can create and edit entries without network connectivity.

## 11. Trash and Deletion Tests

### TRASH-01: Move to Trash

Deleting an active entry creates a trashed revision.

### TRASH-02: Trash Visibility

Trashed entries appear in Trash and not in the active timeline.

### TRASH-03: Restore Entry

Restoring an entry creates a new active revision.

### TRASH-04: Retention Boundary

Verify behavior immediately before and after the 30-day retention threshold.

### TRASH-05: Offline Expiration

Verify that expired Trash entries are processed during the next applicable application activity.

### TRASH-06: Early Permanent Deletion

Verify that the user can permanently delete an entry before the retention period expires.

### TRASH-07: Local Content Removal

Permanent deletion removes the entry's encrypted content from current projections and local revision history.

### TRASH-08: Tombstone Preservation

Verify that non-content tombstones remain available to prevent stale-entry resurrection.

### TRASH-09: Stale Device Protection

A stale device must not automatically restore a permanently deleted entry during synchronization.

### TRASH-10: Partial Cloud Cleanup

If cloud cleanup fails, the tombstone and retry state must remain available.

## 12. Synchronization Tests

Synchronization tests must use controlled Google API adapters and deterministic revision fixtures.

### SYNC-01: Local-Only Mode

Verify that journaling works without Google authentication.

### SYNC-02: Initial Cloud Connection

Verify that the application can initialize a cloud journal without uploading plaintext.

### SYNC-03: Journal Identity Validation

A cloud journal with a different `journalId` must not be silently merged.

### SYNC-04: Encrypted Revision Upload

Verify that only encrypted revision data is sent to Google APIs.

### SYNC-05: Remote Revision Download

Verify that valid remote revisions can be imported and reconciled.

### SYNC-06: Offline Queue

Create multiple revisions while offline.

Verify that pending operations survive a restart.

### SYNC-07: Reconnection

Verify that pending revisions synchronize when connectivity returns.

### SYNC-08: Lost Upload Acknowledgment

Simulate an upload that succeeds remotely but whose response is lost.

Verify that retry logic identifies the existing revision.

### SYNC-09: Duplicate Rows

Verify that identical duplicate remote revisions do not create duplicate entries.

### SYNC-10: Conflicting Revision Identifier

Verify that the same revision identifier with different content is rejected.

### SYNC-11: Concurrent Edits

Simulate two devices editing the same parent revision.

Verify that both branches are preserved and a conflict is detected.

### SYNC-12: Concurrent Changes to Different Entries

Verify that unrelated changes synchronize without conflict.

### SYNC-13: Concurrent Edit and Delete

Verify that a deletion and edit based on the same parent produce a conflict.

### SYNC-14: Conflict Resolution

Verify that resolving a conflict creates a revision referencing all relevant conflicting parents.

### SYNC-15: Keep Both

Verify that choosing to keep both versions preserves both entries with distinct identifiers.

### SYNC-16: API Rate Limiting

Simulate rate-limit responses and verify bounded retry with backoff.

### SYNC-17: Authorization Expiration

Verify that synchronization pauses safely when authorization expires.

### SYNC-18: Authorization Revocation

Verify that local journaling remains available after Google access is revoked.

### SYNC-19: Partial Cloud Failure

Simulate a partially completed multi-request synchronization.

Verify that local data remains intact and incomplete operations are retried.

### SYNC-20: Browser Restart During Sync

Verify that unfinished operations resume safely.

### SYNC-21: Remote Tombstone

Verify that a permanent deletion marker prevents an old revision from becoming active.

### SYNC-22: Tombstone Publication

Verify that permanent deletion markers are synchronized and acknowledged correctly.

### SYNC-23: Cloud Cleanup

Verify that application-managed encrypted revisions are removed from active cloud storage after permanent deletion.

### SYNC-24: Locked Synchronization

Verify that synchronization of already encrypted records can proceed without decrypting journal content.

### SYNC-25: Multiple Cloud Journals

Verify that ambiguous cloud journal discovery does not silently select a journal.

### SYNC-26: No False Success

Verify that synchronization is not marked complete until required remote persistence is confirmed.

## 13. Google Sheets Concurrency Validation

This section is a mandatory technical validation gate.

The append-only synchronization strategy reduces overwrite risk, but Google Sheets does not provide the same transactional guarantees as a database.

Before declaring cloud synchronization production-ready, the team must verify actual Google Sheets behavior.

### GOOGLE-01: Concurrent Append

Using dedicated test journals, issue concurrent append requests from separate clients.

Verify that every acknowledged logical revision remains discoverable.

### GOOGLE-02: Interrupted Append

Simulate request interruption after submission.

Verify that the client can determine whether the revision was persisted.

### GOOGLE-03: Duplicate Append

Retry the same revision publication.

Verify that duplicate rows do not create duplicate logical revisions.

### GOOGLE-04: Concurrent Read and Write

Read revisions while another client appends new revisions.

Verify that reconciliation eventually discovers all valid revisions.

### GOOGLE-05: Row Reordering

Reorder test worksheet rows.

Verify that synchronization still identifies records by stable identifiers.

### GOOGLE-06: Partial Multi-Sheet Updates

Interrupt a sequence involving revisions, keys, configuration, or tombstones.

Verify that recovery does not silently lose journal data.

### GOOGLE-07: Concurrent Deletion and Publication

Simulate one device publishing a stale revision while another performs permanent deletion.

Verify that the tombstone prevents resurrection and that cleanup remains retryable.

### GOOGLE-08: Quota and Size Limits

Validate representative API quota, spreadsheet size, and payload limits against the chosen storage design.

### Release Gate

**Google Drive synchronization must not be released as production-ready unless these tests demonstrate that the implementation meets Gibberish's no-silent-data-loss requirement.**

If Google Sheets cannot provide adequate guarantees, the cloud adapter or storage protocol must be revised.

Do not weaken the data-integrity requirements to make the existing design pass.

## 14. Recovery and Backup Tests

### BACKUP-01: Encrypted Backup Creation

Verify that a backup contains encrypted records, wrapped keys, and required metadata.

### BACKUP-02: No Plaintext in Backup

Verify that plaintext titles, bodies, passphrases, and recovery keys are absent.

### BACKUP-03: Passphrase Restoration

Restore an encrypted backup using the valid passphrase.

### BACKUP-04: Recovery-Key Restoration

Restore an encrypted backup using the valid recovery key.

### BACKUP-05: Incorrect Credentials

Verify that invalid credentials cannot unlock the restored journal.

### BACKUP-06: Corrupted Backup

Verify that malformed or tampered backup files fail safely.

### BACKUP-07: Existing Journal Protection

Verify that importing a backup does not silently overwrite another journal.

### BACKUP-08: Tombstone Preservation

Verify that restored journals retain permanent deletion markers.

### BACKUP-09: No Deleted Content Resurrection

Verify that newly generated backups exclude permanently deleted entry content.

### BACKUP-10: Readable Markdown Export

Verify that readable Markdown export requires an unlocked session and explicit confirmation.

### BACKUP-11: Export Privacy

Verify that readable Markdown is not automatically uploaded or persisted in IndexedDB.

### BACKUP-12: Cross-Device Compatibility

Verify that encrypted backups created in one supported browser can be restored in another supported browser.

## 15. PWA and Offline Tests

### PWA-01: Installation

Verify that the application meets the requirements for installation on supported browsers.

### PWA-02: Offline Application Shell

After an initial successful load, the application must open without network connectivity.

### PWA-03: Offline Journal Access

An existing journal must remain available offline after valid unlocking.

### PWA-04: Offline Entry Creation

Users must be able to create entries offline.

### PWA-05: Offline Entry Editing

Users must be able to edit entries offline.

### PWA-06: Offline Trash

Trash and restoration must work locally without Google APIs.

### PWA-07: Service Worker Privacy

Verify that the service worker does not cache plaintext journal content or sensitive Google API responses.

### PWA-08: Application Update

Verify that a PWA update does not discard IndexedDB journal records.

### PWA-09: Storage Persistence Warning

Verify that local-only users receive clear guidance about browser data loss and encrypted backups.

### PWA-10: Network Recovery

Verify that pending synchronization resumes after connectivity returns.

## 16. User Interface and Accessibility Tests

### UI-01: Mobile Layout

Verify usability at representative mobile viewport sizes.

### UI-02: Desktop Layout

Verify usability at representative desktop viewport sizes.

### UI-03: Keyboard Navigation

All essential controls must be accessible by keyboard.

### UI-04: Focus Management

Verify appropriate focus movement after dialogs, navigation, and security-sensitive actions.

### UI-05: Accessible Labels

Inputs and buttons must have meaningful accessible names.

### UI-06: Error Messages

Validation and failure messages must be understandable and accessible.

### UI-07: Sync Status

Synchronization status must be communicated through text, not color alone.

### UI-08: Contrast

Verify that interface contrast meets the selected accessibility standard.

### UI-09: Reduced Motion

Respect reduced-motion preferences where animation is used.

### UI-10: Sensitive Screen Privacy

Verify that locking immediately removes journal content from the rendered interface.

## 17. Browser Compatibility

The MVP must be tested in current supported versions of:

- Google Chrome
- Microsoft Edge
- Mozilla Firefox
- Safari

Mobile validation must include:

- Safari on iOS
- Chrome on Android

Testing must focus particularly on:

- IndexedDB
- Web Crypto
- Argon2id compatibility
- PWA installation
- Service worker behavior
- Backgrounding and resuming
- Browser storage persistence
- Google OAuth flows

Where automated browser coverage is unavailable, document the manual validation performed.

## 18. Security Testing

Security testing must verify the controls defined in `SECURITY.md`.

Required checks include:

- No plaintext journal content in persistent browser storage
- No plaintext journal content in cloud requests
- No secrets in application logs
- No credentials in URLs
- No unsafe HTML rendering of journal content
- No plaintext caching by service workers
- No journal metadata visible while locked
- No decryption without an unlocked session
- No automatic readable export
- No bypass of recovery-key authentication
- No acceptance of malformed encrypted envelopes
- No unsafe dependency or build configuration

Security tests must include negative cases and malformed-input cases.

Automated tests do not establish that the application is invulnerable. They verify defined security properties and help detect regressions.

## 19. Performance Testing

Performance tests must use synthetic journal data.

Suggested representative scenarios:

| Scenario | Goal |
|---|---|
| 100 entries | Smooth everyday use |
| 1,000 entries | Responsive timeline and search-free navigation |
| 5,000 revisions | Acceptable local reconciliation |
| Large individual entry | Responsive encryption and Gibberish rendering |
| Large encrypted backup | Successful export and import without data loss |
| Offline queue with many revisions | Stable retry and reconciliation |

Specific timing thresholds should be established from measurements on representative devices.

Do not invent performance guarantees before benchmarking.

Performance optimizations must not weaken encryption or data-integrity requirements.

## 20. Test Fixtures and Synthetic Data

Tests must use synthetic content.

Recommended fixtures include:

- Empty journal
- Single-entry journal
- Journal with multiple entries
- Journal with long entries
- Journal with trashed entries
- Journal with expired Trash entries
- Journal with conflicting revisions
- Journal with permanent deletion tombstones
- Journal with pending synchronization operations
- Journal with malformed encrypted records
- Journal with corrupted backup data

Test fixtures must not contain real user secrets or private journal entries.

## 21. CI Quality Gates

The repository should run automated checks for every pull request or equivalent code change.

Required checks:

1. Dependency installation
2. TypeScript type checking
3. Linting
4. Unit tests
5. Integration tests
6. Production build
7. Relevant Playwright tests
8. Dependency vulnerability review

Recommended scripts:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "build": "vite build",
    "check": "pnpm typecheck && pnpm lint && pnpm test && pnpm build"
  }
}
```

Scripts may be adjusted to match the actual repository configuration.

A failing required check must block release until resolved or explicitly documented and approved.

## 22. Coverage Expectations

Code coverage is a supporting metric, not proof of correctness.

Recommended initial thresholds:

| Area | Target |
|---|---|
| Cryptography and key management | 90%+ |
| Gibberish codec | 95%+ |
| Journal domain logic | 85%+ |
| Synchronization logic | 90%+ |
| Storage adapters | 85%+ |
| UI components | Risk-based coverage |

These are engineering targets rather than guarantees of security.

Critical security and data-integrity behaviors must have explicit tests regardless of aggregate coverage.

## 23. Definition of Done

A feature is considered complete only when:

- Its behavior matches the PRD.
- Its security requirements are satisfied.
- Its data model matches the approved schema.
- Its failure paths are handled.
- Its relevant unit tests pass.
- Its relevant integration tests pass.
- Its applicable end-to-end tests pass.
- It does not introduce plaintext persistence.
- It does not silently discard journal data.
- Documentation is updated where necessary.

A feature must not be marked complete merely because the happy path works.

## 24. Release Readiness Checklist

Before releasing the MVP, verify:

- [ ] Onboarding works without Google authentication.
- [ ] Passphrase unlocking works.
- [ ] Recovery-key unlocking works.
- [ ] Encrypted entries persist locally.
- [ ] Gibberish encoding and decoding work correctly.
- [ ] Reveal and Hide work correctly.
- [ ] Manual locking works.
- [ ] Five-minute inactivity locking works.
- [ ] Locked journals expose no entry metadata.
- [ ] Offline journal creation and editing work.
- [ ] Trash and restoration work.
- [ ] Permanent deletion creates durable tombstones.
- [ ] Encrypted backup export and restoration work.
- [ ] Readable Markdown export requires explicit confirmation.
- [ ] Google authorization failures do not interrupt local journaling.
- [ ] Concurrent revision conflicts are preserved.
- [ ] Cloud synchronization never uploads plaintext.
- [ ] Google Sheets concurrency validation passes.
- [ ] PWA installation and offline loading work.
- [ ] Supported browser testing is complete.
- [ ] Required automated checks pass.
- [ ] Known limitations are documented.

## 25. Implementation Instructions for Codex

Codex must:

1. Write tests alongside implementation rather than postponing testing.
2. Prioritize cryptographic and data-integrity tests.
3. Use deterministic synthetic fixtures.
4. Mock external Google APIs in automated tests.
5. Test failure and retry behavior.
6. Verify IndexedDB transaction boundaries.
7. Test revision ancestry and conflict detection.
8. Verify that deleted content cannot be silently restored.
9. Run relevant tests after each milestone.
10. Report failing tests rather than ignoring them.
11. Avoid changing requirements merely to satisfy an implementation.
12. Update tests when approved specifications change.
13. Treat the Google Sheets concurrency validation as a mandatory release gate.

## 26. Document Governance

This document defines the testing and quality assurance strategy for Gibberish MVP v1.

`PRD.md` defines product behavior.

`SECURITY.md` defines security requirements.

`ARCHITECTURE.md` defines module boundaries.

`DATA_MODEL.md` defines persisted data contracts.

`SYNC_STRATEGY.md` defines synchronization behavior.

`IMPLEMENTATION_PLAN.md` defines implementation milestones and their required verification.

Changes to critical security or synchronization behavior must include corresponding test updates.
## M2 approved verification gates

Keep all M1 v1 known-answer and codec regression vectors. Add v2 exact canonical
AAD/metadata mutations for every immutable field, malformed dates/nulls/parent
ordering/duplicates/cap, cross-version failure without downgrade, and v1/v2 binary
codec round trips. Operational repositories must reject legacy v1 records.

Add fake-indexeddb integration tests for ciphertext-only stores, strict DTOs
(including rejecting CryptoKey objects), all transaction-step rollbacks, immutable
IDs and idempotency, exact snapshot races, concurrent sibling preservation,
missing/corrupt/cyclic history, authenticated projection rebuild, outbox mode
changes, uncertain receipts and bounded retry failures. Assert no Web Crypto
operation runs inside a Dexie transaction. Test unsupported database versions,
upgrade failure and closed/unavailable database without automatic deletion.

Use real Playwright IndexedDB cases for reload, multi-tab writes, offline domain
operation, and persistent-profile browser restart. A fake database cannot prove
on-disk browser persistence. Do not implement onboarding or journal UI just to
exercise these APIs. Save raw verification output locally under reports/M2/logs;
no M2 completion report until required checks and acceptance criteria pass.

## M3 approved acceptance gates

Preserve all M1/M2 regressions. Add confirmed-before-write setup, discovery errors,
new/legacy passphrase policy, recovery authentication and exact reset CAS/races/
rollback/uncertain outcomes, locked metadata privacy, deadline boundaries/resume/
clock changes, background draft clearing, late asynchronous result suppression,
per-tab session disposal, KDF worker cancellation/responsiveness, authenticated
ciphertext-only views, exact paged codec output, reveal-before-edit, commit-before-
saved messaging, failed saves/retries and concurrent branch preservation.

Use unit/integration/component and all five browser projects, synthetic data only.
Test real UI plus IndexedDB across reload, offline use of already loaded assets,
keyboard/focus/reflow and error cases. Distinguish simulated lifecycle events from
real-device suspension; record actual counts/failures/retries and NOT RUN manual
scenarios. No claims of offline cold launch, guaranteed erasure or WCAG certification.
Run all seven commands in [M3_EXPERIENCE.md](M3_EXPERIENCE.md); keep output ignored.


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
