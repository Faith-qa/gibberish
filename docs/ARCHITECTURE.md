# Gibberish — System Architecture

**Version:** 1.0 (Draft)  
**Product:** Gibberish  
**Platform:** Progressive Web App (PWA)  
**Architecture:** Local-first, client-side encrypted modular monolith  
**Status:** Technical specification — pending implementation review

**Related documents:**
- `docs/PRD.md`
- `docs/SECURITY.md`
- `docs/DATA_MODEL.md`
- `docs/SYNC_STRATEGY.md`
- `docs/TESTING.md`
- `docs/IMPLEMENTATION_PLAN.md`

---

## 1. Purpose

This document defines the technical architecture of Gibberish, including application layers, module responsibilities, data flow, storage, encryption boundaries, and optional cloud synchronization.

The architecture must support the requirements established in the Product Requirements Document and Security Specification.

It should provide sufficient implementation guidance for Codex without overengineering the MVP.

## 2. Architectural Principles

Gibberish follows these principles:

1. **Local-first:** Local encrypted storage is the primary source for journal operations.
2. **Privacy-first:** Journal content is encrypted before persistence or synchronization.
3. **Offline-capable:** Core journaling must not depend on network availability.
4. **Modular:** Cryptography, storage, presentation, and synchronization must have clear boundaries.
5. **User-owned data:** Cloud storage belongs to the user, not Gibberish.
6. **Backend-free MVP:** No custom application server or database is required.
7. **Secure by default:** Locked journals expose no entries or journal metadata.
8. **Testable:** Core logic must be independently testable without rendering the UI.
9. **Simple deployment:** The application must be deployable as static assets.
10. **Explicit failure handling:** Storage and synchronization failures must never be silently ignored.

## 3. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Language | TypeScript | Type-safe application development |
| UI | React | Component-based interface |
| Build | Vite | Development and production builds |
| Styling | Tailwind CSS | Responsive styling |
| PWA | Vite PWA Plugin | Installation and offline application shell |
| Local database | IndexedDB | Persistent encrypted local records |
| Database abstraction | Dexie | IndexedDB queries and transactions |
| Encryption | Web Crypto API | AES-256-GCM encryption and secure randomness |
| Key derivation | Audited Argon2id library | Passphrase-derived key encryption |
| Authentication | Google Identity Services | Optional Google authentication |
| Cloud storage | Google Drive API | User-owned encrypted cloud files |
| Structured cloud data | Google Sheets API | Encrypted journal record storage |
| Unit testing | Vitest | Core logic and component testing |
| Browser testing | Playwright | End-to-end and offline testing |
| Package manager | pnpm | Dependency management |

No custom backend, Supabase instance, Firebase database, or dedicated application server is required for MVP.

The exact third-party libraries must be reviewed for security, browser compatibility, and maintenance before adoption.

## 4. High-Level Architecture

The system consists of five primary layers.

### 4.1 Presentation Layer

Responsible for:

- Onboarding
- Passphrase setup
- Journal unlocking
- Timeline
- Entry creation and editing
- Gibberish display
- Reveal and Hide
- Trash
- Settings
- Export and recovery
- Synchronization status

The presentation layer must not implement cryptographic algorithms or directly manage Google Sheets records.

### 4.2 Application Layer

Coordinates user actions and business rules.

Responsibilities include:

- Journal lifecycle
- Entry creation and editing
- Deletion and restoration
- Locking and unlocking
- Recovery workflows
- Export orchestration
- Synchronization orchestration

The application layer invokes specialized modules through explicit interfaces.

### 4.3 Security Layer

Responsible for:

- Journal encryption-key generation
- Passphrase-based key derivation
- Key wrapping and unwrapping
- Recovery-key handling
- AES-GCM encryption and decryption
- Encryption envelope validation
- Session key lifecycle

The security layer must remain independent of React and Google APIs.

### 4.4 Persistence Layer

Responsible for:

- Encrypted IndexedDB records
- Wrapped encryption keys
- Local journal metadata
- Pending synchronization operations
- Trash retention metadata
- Storage migrations

The persistence layer must never receive plaintext journal titles or bodies.

### 4.5 Cloud Integration Layer

Responsible for:

- Optional Google authentication
- Google Drive authorization
- Drive folder and file discovery
- Google Sheets operations
- Cloud synchronization
- Conflict detection
- Retry handling
- Authorization revocation

Cloud integration must not be required for core local journal operations.

## 5. Recommended Repository Structure

The MVP should use a single Vite application with framework-independent modules organized under `src`.

```text
gibberish/
├── AGENTS.md
├── README.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vite.config.ts
├── index.html
├── public/
│   ├── icons/
│   └── manifest assets
├── docs/
│   ├── PRD.md
│   ├── SECURITY.md
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   ├── SYNC_STRATEGY.md
│   ├── TESTING.md
│   ├── IMPLEMENTATION_PLAN.md
│   └── adr/
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   ├── providers/
│   │   └── routing/
│   ├── features/
│   │   ├── onboarding/
│   │   ├── journal/
│   │   ├── timeline/
│   │   ├── trash/
│   │   ├── settings/
│   │   └── recovery/
│   ├── components/
│   │   └── ui/
│   ├── core/
│   │   ├── crypto/
│   │   ├── gibberish-codec/
│   │   ├── journal/
│   │   ├── storage/
│   │   ├── google/
│   │   ├── sync/
│   │   └── export/
│   ├── hooks/
│   ├── styles/
│   ├── types/
│   └── main.tsx
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
└── .github/
    └── workflows/
```

This structure provides modular boundaries without requiring multiple packages or a complex workspace.

Codex may introduce additional files or folders when necessary, but must preserve the defined architectural boundaries.

## 6. Module Responsibilities

### 6.1 `core/crypto`

Responsible for all cryptographic operations.

Operational functions require the complete immutable v2 metadata contract:

```typescript
encryptRevision(
  plaintext: Uint8Array,
  key: CryptoKey,
  metadata: RevisionMetadata
): Promise<EncryptedJournalRevision>;

decryptRevision(
  revision: unknown,
  key: CryptoKey,
  scope: { journalId: string; entryId: string }
): Promise<Uint8Array>;
```

`generateJournalKey`, passphrase/recovery wrapping and unwrapping, strict
validators, and binary envelope serialization remain separate functions. The
legacy `decryptLegacyEnvelope` API explicitly recovers v1 payload bytes only;
no v1 metadata is promoted into operational history. Existing v1 encryption
helpers remain for regression fixtures/compatibility, not domain writes.
See `CRYPTOGRAPHY.md` and `DATA_MODEL.md` for the exact formats.

The module must not depend on React, Dexie, or Google APIs.

### 6.2 `core/gibberish-codec`

Responsible for converting encrypted bytes into pronounceable fictional text and back.

Suggested interface:

```typescript
interface GibberishCodec {
  encode(data: Uint8Array): string;

  decode(text: string): Uint8Array;
}
```

Requirements:

- Deterministic encoding
- Reversible decoding
- Versioned format
- Stable behavior across supported browsers
- No plaintext substitution
- No dependency on journal keys

The codec must operate on encrypted bytes, not original English text.

### 6.3 `core/journal`

Responsible for journal business logic.

M2 implements `initializeJournal`, `unlockJournal`, `prepareCreate`,
`prepareEdit`, `commitWrite`, `createEntry`, `editEntry`, `readEntry`,
`listEntries`, `rebuildProjections`, and `inspectCommit`. Entry operations require
an opaque in-memory `JournalSession` capability, minted only after successful
initialization/unwrap and revocable with `close()`.

The service authenticates full relevant history, validates the DAG, serializes
and encrypts content before persistence. `PreparedWrite` contains encrypted
records and non-secret metadata only. The service receives transient English
but the storage adapter does not. Domain reads never return a keyless
authoritative timeline or select a conflicted branch by timestamp. Readable
payloads returned by `readEntry` belong only in transient caller memory and must
be cleared by future UI reveal/lock handling.

See [LOCAL_STORAGE.md](LOCAL_STORAGE.md) for signatures, transactions and error
semantics. Delete/restore, conflict resolution, UI session management and Google
APIs are later milestones and are not part of the M2 service.

### 6.4 `core/storage`

Responsible for local encrypted persistence.

Use encrypted-only repository contracts defined in `LOCAL_STORAGE.md`: atomic
initialization, journal-scoped encrypted snapshots, immutable append with exact
snapshot preconditions, projection rebuild, and uncertain-commit reconciliation.
Do not expose arbitrary revision put/remove operations. The repository receives
no plaintext, passphrase, recovery credential or CryptoKey. The domain validates
and authenticates source snapshots and prepares sealed v2 revisions before a
short database transaction commits revision/projection/conflict/outbox changes.

Pure graph reducers remain framework/database independent. Dexie read/write
transactions and exact snapshot checks are the multi-tab correctness mechanism;
Web Locks are not required. Persisted projections/verification flags are hints,
not authenticated history. Domain listings require a usable key/capability and
verify metadata before returning any timeline information. The M3 application
controller owns session lifecycle and calls these domain contracts; later cloud/
deletion workflows remain unimplemented.

### 6.5 `core/google`

Responsible for optional Google integration.

Submodules may include:

- Google authentication
- OAuth authorization
- Drive file discovery
- Google Sheets read/write operations
- Token lifecycle management

The module must expose operations through typed interfaces.

The rest of the application must not depend directly on Google SDK implementation details.

### 6.6 `core/sync`

Responsible for synchronization between local encrypted storage and Google Drive.

Responsibilities:

- Detect pending changes
- Queue encrypted operations
- Upload local changes
- Download remote changes
- Detect conflicting revisions
- Handle retryable failures
- Update synchronization status
- Prevent stale records from restoring deleted entries

The synchronization engine must operate on encrypted records and must not require journal plaintext.

### 6.7 `core/export`

Responsible for:

- Encrypted backup creation
- Encrypted backup validation
- Journal restoration
- Readable Markdown export
- Privacy confirmation requirements

Readable export must be available only through an explicitly unlocked journal session.

## 7. Core Data Flow

### 7.1 Journal Setup

```text
User creates passphrase
        |
        v
Generate random Journal Encryption Key
        |
        v
Derive wrapping key from passphrase
        |
        v
Wrap Journal Encryption Key
        |
        v
Generate independent recovery key
        |
        v
Create recovery-wrapped key record
        |
        v
Display recovery key from volatile setup state
        |
        v
Full-key confirmation and explicit saved/loss acknowledgment
        |
        v
Atomically persist wrapped keys/config/device locally
        |
        v
Journal ready
```

No Google account is required.

Nothing is persisted before confirmation. Keep prepared material only in a
revocable setup capability; cancellation/expiry/pagehide discards it. New
passphrase policy and uncertain initialization follow `M3_EXPERIENCE.md`.

### 7.2 Creating an Entry

```text
User writes English title and body
        |
        v
Journal application service
        |
        v
Encrypt title and body locally
        |
        v
Create versioned encrypted record
        |
        v
Persist encrypted record in IndexedDB
        |
        v
Confirm local save
        |
        +----------------------+
        |                      |
        v                      v
Generate Gibberish      Queue encrypted sync
for display             if Drive is connected
```

The application must confirm a successful local write before displaying a saved state.

### 7.3 Viewing an Entry

```text
User unlocks journal
        |
        v
Load encrypted entry
        |
        v
Encode encrypted bytes as Gibberish
        |
        v
Display Gibberish by default
        |
        v
User selects Reveal My Thoughts
        |
        v
Decrypt entry in memory
        |
        v
Display original English
```

The original English must never be persisted during this process.

### 7.4 Hiding an Entry

```text
User selects Hide My Thoughts
        |
        v
Remove revealed plaintext from UI state
        |
        v
Display Gibberish representation
```

Revealed content must also be hidden on navigation, backgrounding, or locking.

### 7.5 Unlocking the Journal

```text
User enters passphrase
        |
        v
Derive wrapping key
        |
        v
Authenticate and unwrap Journal Encryption Key
        |
        +----------------------+
        |                      |
        v                      v
Success                  Failure
        |                      |
        v                      v
Open journal             Remain locked
```

### 7.6 Recovery

```text
User provides recovery key
        |
        v
Authenticate recovery-wrapped key
        |
        v
Recover Journal Encryption Key
        |
        v
User creates new passphrase
        |
        v
Create new passphrase-wrapped key record
        |
        v
Persist updated wrapping metadata
        |
        v
Unlock journal
```

Recovery must preserve the existing encrypted journal entries.

## 8. Journal Session Management

The application must maintain an explicit session state.

Suggested states:

```typescript
type JournalSessionState =
  | "uninitialized"
  | "locked"
  | "unlocking"
  | "preparing"
  | "confirming"
  | "concealed"
  | "unlocked"
  | "recovering"
  | "error";
```

Rules:

- Only privately authenticated, live journal/recovery authorization may decrypt
  history. Recovery authentication verifies history privately; timeline access
  follows the committed/reconciled reset. It never exposes a raw key to React.
- Locking must clear decrypted content and active key references as far as technically possible.
- The journal must lock after five minutes of inactivity.
- The application must recheck elapsed inactivity when returning from the background.
- Backgrounding immediately clears plaintext UI, revealed English, credentials
  and unsealed drafts. Concealed authorization expires at the original deadline;
  it is distinct from a full lock. Manual lock, expiry and pagehide fully revoke,
  per tab, and stale async results must not restore the old state.
- Google authentication must not alter journal unlock state.

The application must avoid storing decrypted journal content in persistent state managers.

## 9. Local Database Architecture

IndexedDB is the primary local persistence layer.

The database must support:

- Encrypted journal entries
- Wrapped journal keys
- Journal configuration
- Synchronization metadata
- Pending synchronization operations
- Encrypted Trash records

Suggested logical stores:

```text
journal_entries
journal_keys
journal_config
sync_queue
sync_metadata
```

Trash may be represented through encrypted entry records with deletion metadata rather than requiring a separate database store.

The final schema must be defined in `DATA_MODEL.md`.

## 10. Google Drive Architecture

### 10.1 Optional Cloud Setup

Google Drive integration must be enabled only after explicit user authorization.

The cloud integration must:

1. Authenticate the user through Google.
2. Request the required Drive permissions.
3. Create or locate the Gibberish journal folder.
4. Create or locate the master Google Sheets file.
5. Establish synchronization metadata.
6. Begin synchronizing encrypted records.

### 10.2 Cloud Storage Layout

Proposed structure:

```text
Google Drive
└── Gibberish Journal/
    └── journal-data (Google Sheet)
        ├── Entries
        ├── Config
        └── WrappedKeys
```

The exact Google Drive and Sheets schema must be finalized in `DATA_MODEL.md`.

### 10.3 Cloud Storage Restrictions

Google Drive may store:

- Encrypted entry payloads
- Wrapped journal keys
- Version information
- Non-secret synchronization metadata

Google Drive must not store:

- Plaintext titles
- Plaintext bodies
- Passphrases
- Plaintext recovery keys
- Unwrapped encryption keys

### 10.4 Cloud Access Revocation

If Google Drive access is revoked:

- Local journaling must continue.
- Cloud synchronization must stop.
- The application must display a connection warning.
- Pending local changes must remain available.
- Users must be able to reconnect through an explicit authorization flow.

## 11. Synchronization Architecture

### 11.1 Local-First Write Model

All journal changes must be committed locally before synchronization.

The application must not require successful cloud synchronization before confirming a local save.

### 11.2 Synchronization Queue

Each local change that requires cloud synchronization must create a durable pending operation.

The queue must survive:

- Browser restarts
- Network interruptions
- Temporary API failures
- PWA suspension

### 11.3 Synchronization States

Suggested states:

```typescript
type SyncStatus =
  | "local-only"
  | "synced"
  | "pending"
  | "syncing"
  | "conflict"
  | "error";
```

### 11.4 Conflict Handling

The synchronization engine must:

- Track local and remote revisions.
- Detect incompatible concurrent edits.
- Avoid silently overwriting changes.
- Preserve conflicting encrypted records.
- Surface unresolved conflicts to the user.

The MVP does not require automatic merging of simultaneous conflicting edits.

### 11.5 Deletion Propagation

Deleted entries must remain recoverable in encrypted Trash for 30 days.

Permanent deletion must be represented through synchronization-safe deletion metadata so stale devices do not unintentionally restore deleted entries.

Detailed synchronization algorithms belong in `SYNC_STRATEGY.md`.

### 11.6 Google Sheets Limitations

Google Sheets is not a transactional database.

The synchronization design must account for:

- API rate limits
- Request failures
- Non-atomic multi-request operations
- Concurrent device writes
- Row ordering changes
- Partial synchronization
- Retry safety

Row position must not be treated as a permanent record identifier.

The MVP must not claim strong transactional guarantees that Google Sheets does not provide.

## 12. PWA and Offline Architecture

The PWA must provide:

- Installable application shell
- Offline access to cached resources
- Encrypted IndexedDB persistence
- Offline journal CRUD
- Safe application updates
- Clear connectivity and synchronization indicators

### 12.1 Service Worker

The service worker must primarily cache application assets.

It must not cache:

- Journal plaintext
- Passphrases
- Recovery keys
- Unwrapped encryption keys
- Sensitive OAuth responses

### 12.2 Background Synchronization

The application must not rely exclusively on browser background synchronization.

Synchronization should run when:

- The user explicitly selects Sync Now.
- The application becomes active and connectivity is available.
- Network connectivity returns, where detectable.
- Local changes occur while cloud synchronization is enabled.

Background synchronization may be used as an enhancement where supported, but it must not be required for correctness.

## 13. Error Handling

Errors must be classified according to their source.

Suggested categories:

- Encryption failure
- Incorrect passphrase
- Invalid recovery key
- Corrupted encrypted data
- Local storage failure
- Google authentication failure
- Drive authorization failure
- Network failure
- API rate limiting
- Synchronization conflict
- Backup incompatibility

Requirements:

- Do not expose secrets in error messages.
- Do not silently discard encrypted records.
- Do not report failed writes as successful.
- Provide actionable messages for recoverable failures.
- Preserve local changes during cloud failures.

## 14. Testing Architecture

### Unit Tests

Cover:

- Cryptographic operations
- Gibberish codec
- Journal business rules
- Key wrapping and recovery
- Trash retention
- Synchronization state transitions

### Integration Tests

Cover:

- Journal service and IndexedDB
- Encryption before persistence
- Backup export and restore
- Synchronization queue behavior
- Google API adapters with controlled test responses

### End-to-End Tests

Cover:

- First-time onboarding
- Local-only journal creation
- Passphrase unlock
- Entry creation and editing
- Reveal and Hide
- Five-minute inactivity locking
- Offline journaling
- Trash and restoration
- Backup export
- Cloud connection and synchronization using suitable test fixtures or controlled environments

Tests must avoid relying on production Google accounts or real user journal data.

## 15. Deployment Architecture

Gibberish must be deployable as a static web application.

Deployment must support:

- HTTPS
- Correct SPA routing behavior
- PWA manifest and service worker
- Environment-specific Google OAuth client configuration
- Restrictive security headers
- Secure production builds

No application server is required for MVP.

Environment variables exposed through the Vite client build must never contain secrets.

Google OAuth client identifiers are public configuration, not confidential credentials.

## 16. Architectural Boundaries

The following dependency rules must be enforced:

- React components must not implement encryption.
- UI components must not directly query Google Sheets.
- The cryptography module must not depend on React.
- The Gibberish codec must not depend on React or Google APIs.
- The storage layer must not receive plaintext journal content.
- The synchronization engine must operate on encrypted records.
- The Google integration layer must not decrypt journal entries.
- Core journaling must function without Google authentication.
- Domain logic must not depend on browser UI components.
- New infrastructure must not be introduced without a documented need.

## 17. Implementation Guidance for Codex

Codex must:

1. Read `PRD.md`, `SECURITY.md`, and this architecture document before implementing dependent features.
2. Preserve the local-first architecture.
3. Implement core cryptography and storage independently from React UI components.
4. Use typed interfaces between modules.
5. Avoid introducing unnecessary dependencies or infrastructure.
6. Write tests alongside security-sensitive logic.
7. Implement bounded, verifiable milestones.
8. Report architectural conflicts before changing established requirements.
9. Keep documentation aligned with implementation.
10. Avoid claiming features are complete without passing relevant tests.

## 18. Architecture Acceptance Criteria

The architecture is considered correctly implemented when:

1. Users can create a journal without Google authentication.
2. All persisted journal content is encrypted.
3. The application can operate offline after initial setup.
4. Cryptography, storage, and synchronization are independently testable.
5. The UI cannot bypass journal locking requirements.
6. Google Drive synchronization can be enabled or disabled without breaking local journaling.
7. Failed synchronization does not discard local changes.
8. Cloud adapters never receive plaintext journal content.
9. Encrypted backups support restoration.
10. The PWA can be deployed without a custom backend.
11. Automated unit, integration, and end-to-end tests pass.

## 19. Document Governance

This document defines the system architecture for Gibberish MVP v1.

Detailed data schemas belong in `DATA_MODEL.md`.

Synchronization algorithms and conflict-resolution rules belong in `SYNC_STRATEGY.md`.

Security controls and cryptographic requirements belong in `SECURITY.md`.

Implementation sequencing belongs in `IMPLEMENTATION_PLAN.md`.

Changes to the architectural model must be documented before dependent code is modified.

## M3 approved application boundary

Use a small framework-independent application controller and a React view adapter;
no new routing/state framework. The controller privately owns JournalSession,
setup/recovery handles, deadlines, abort/generation guards and sealed retry plans.
React receives commands and view data, never a key or Dexie/table handle.

Add minimal validated journal discovery, confirmed two-phase setup, domain-owned
recovery/reset and authenticated encrypted-view APIs. Snapshot authentication
remains in core/journal, encryption in core/crypto and transactions in core/storage.
The native KDF worker changes execution location, not any cryptographic format.
The view-state union must not carry journal metadata while locked/concealed.
[M3_EXPERIENCE.md](M3_EXPERIENCE.md) defines lifecycle, UI and failure contracts.
