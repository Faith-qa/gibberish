# Gibberish — Implementation Plan

**Version:** 1.0  
**Product:** Gibberish  
**Architecture:** Local-first, client-side encrypted Progressive Web App  
**Development environment:** IntelliJ IDEA + Codex CLI  
**Status:** Implementation roadmap

**Related documents:**
- `AGENTS.md`
- `README.md`
- `docs/PRD.md`
- `docs/SECURITY.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/SYNC_STRATEGY.md`
- `docs/TESTING.md`

---

## 1. Purpose

This document defines the implementation sequence for Gibberish MVP.

It translates the approved product, security, architecture, data-model, synchronization, and testing specifications into manageable engineering milestones.

The implementation plan is designed for development using Codex CLI inside IntelliJ IDEA.

The objectives are to:

- Build a working encrypted local journal early.
- Establish security-sensitive foundations before adding features.
- Keep implementation tasks small and verifiable.
- Avoid unnecessary infrastructure and architectural complexity.
- Introduce Google Drive only after local journaling works reliably.
- Maintain automated testing throughout development.
- Prevent incomplete features from being mistaken for production-ready functionality.

## 2. Implementation Principles

All development must follow these rules.

1. **One milestone at a time.** Do not implement the entire MVP in one task.
2. **Local-first.** Core journal operations must not depend on Google authentication.
3. **Security before convenience.** Never bypass encryption or locking to accelerate implementation.
4. **Small changes.** Prefer focused changes that can be reviewed and tested independently.
5. **Working software.** Each milestone must leave the repository in a buildable state.
6. **Tests alongside code.** Implement relevant automated tests during each milestone.
7. **No unnecessary infrastructure.** Do not introduce a custom backend, microservices, or monorepo without a documented need.
8. **Document deviations.** Report conflicts with specifications before making architectural changes.
9. **No silent data loss.** Failed operations must preserve existing encrypted records.
10. **Explicit completion.** A milestone is complete only when its acceptance criteria pass.

## 3. Technical Stack

The MVP uses:

| Area | Technology |
|---|---|
| Frontend | React + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS |
| Package manager | pnpm |
| Local storage | IndexedDB + Dexie |
| Encryption | Web Crypto API |
| Passphrase KDF | Reviewed browser-compatible Argon2id implementation |
| Gibberish representation | Custom versioned reversible codec |
| Authentication | Google Identity Services |
| Cloud storage | Google Drive + Google Sheets |
| Unit and integration testing | Vitest |
| UI testing | React Testing Library |
| End-to-end testing | Playwright |
| PWA | Vite PWA Plugin |

The application must remain deployable as static assets.

## 4. Milestone Overview

| Milestone | Name | Primary outcome |
|---|---|---|
| M0 | Project Foundation | Running application with development tooling |
| M1 | Cryptography and Gibberish Codec | Tested encryption, key management, and reversible codec |
| M2 | Local Storage and Journal Domain | Durable encrypted local journal |
| M3 | Onboarding, Unlocking, and Core UI | Usable private journal |
| M4 | Trash, Recovery, and Export | Complete local journal lifecycle |
| M5 | PWA and Offline Hardening | Installable offline-capable application |
| M6 | Google Authentication and Cloud Setup | Optional user-owned cloud connection |
| M7 | Encrypted Synchronization | Safe revision-based synchronization |
| M8 | Cross-Device Restoration and Conflict Resolution | Portable journal and explicit conflict handling |
| M9 | Security, Accessibility, and Release Hardening | Tested MVP release candidate |

Milestones must be completed in order unless a documented dependency requires a change.

## 5. Milestone M0 — Project Foundation

### Objective

Create a clean, maintainable React application with the required development and testing tools.

### Tasks

1. Initialize a Vite React + TypeScript project.
2. Configure pnpm.
3. Install and configure Tailwind CSS.
4. Configure TypeScript strict mode.
5. Configure ESLint.
6. Configure Vitest.
7. Configure React Testing Library.
8. Configure Playwright.
9. Establish the modular folder structure.
10. Configure environment-variable handling.
11. Add baseline scripts for type checking, linting, testing, and building.
12. Configure a basic CI workflow.
13. Create a minimal application shell.

### Deliverables

- Running React application
- TypeScript configuration
- Tailwind configuration
- Testing infrastructure
- Baseline CI workflow
- Modular source directory structure
- Updated README with development instructions

### Acceptance Criteria

- The application starts locally.
- TypeScript compilation passes.
- Linting passes.
- A sample unit test passes.
- A sample browser test passes.
- A production build succeeds.
- No application secrets are committed to source control.

### Verification

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

### Completion Gate

Do not begin M1 until the development environment is working and the baseline checks pass.

## 6. Milestone M1 — Cryptography and Gibberish Codec

### Objective

Implement and test the security foundation before introducing journal persistence.

### Tasks

1. Define cryptographic interfaces and runtime validators.
2. Implement secure random journal-key generation.
3. Implement AES-256-GCM encryption.
4. Implement AES-256-GCM decryption.
5. Implement versioned encrypted envelopes.
6. Implement canonical authenticated additional data.
7. Select and integrate a reviewed browser-compatible Argon2id implementation.
8. Implement passphrase-based key wrapping.
9. Implement passphrase-based key unwrapping.
10. Implement independent recovery-key generation.
11. Implement recovery-key wrapping and unwrapping.
12. Define the exact recovery-key encoding and validation rules.
13. Implement the versioned Gibberish codec.
14. Implement Gibberish encoding and decoding.
15. Add cryptographic and codec test vectors.
16. Add negative tests for tampered ciphertext, invalid keys, and malformed envelopes.

### Deliverables

- `core/crypto`
- `core/gibberish-codec`
- Cryptographic type definitions
- Envelope validators
- Key-management utilities
- Unit tests
- Codec tests

### Acceptance Criteria

- Encryption and decryption recover the original bytes.
- Incorrect credentials cannot unwrap the journal key.
- Tampered ciphertext is rejected.
- Recovery-key unlocking works independently of the passphrase.
- Gibberish encoding is reversible.
- Gibberish encoding does not depend on plaintext.
- Unsupported formats fail safely.
- Relevant security tests pass.

### Important Security Rules

- Do not implement custom encryption algorithms.
- Do not persist unwrapped journal keys.
- Do not store plaintext recovery credentials.
- Do not log plaintext, passphrases, or key material.
- Do not substitute Gibberish encoding for encryption.

### Completion Gate

Do not begin journal persistence until cryptography and codec tests pass.

## 7. Milestone M2 — Local Storage and Journal Domain

### Objective

Build the encrypted local journal independently of the UI and Google APIs.

### Tasks

1. Configure Dexie.
2. Define IndexedDB object stores.
3. Implement immutable encrypted revision storage.
4. Implement current-entry projections.
5. Implement wrapped-key persistence.
6. Implement journal configuration persistence.
7. Implement journal creation.
8. Implement encrypted entry creation.
9. Implement encrypted entry editing.
10. Implement encrypted entry retrieval.
11. Implement journal listing.
12. Implement revision ancestry tracking.
13. Implement local-only synchronization state.
14. Implement durable synchronization queue records.
15. Implement atomic local transactions.
16. Implement schema validation.
17. Implement storage migration infrastructure.
18. Add local persistence integration tests.

### Deliverables

- `core/storage`
- `core/journal`
- Dexie database schema
- Journal repository interfaces
- Journal service
- Revision projection logic
- Storage integration tests

### Acceptance Criteria

- A journal can be created without Google authentication.
- Entries are encrypted before persistence.
- Local entry creation and editing work.
- Each edit creates an immutable revision.
- Current-entry projections can be rebuilt.
- Journal data survives application restarts.
- Local writes and synchronization queue operations are atomic.
- Failed storage writes are not reported as successful.
- No plaintext journal content appears in IndexedDB.

### Completion Gate

Do not begin the full journal UI until the local journal domain works reliably through automated tests.

## 8. Milestone M3 — Onboarding, Unlocking, and Core UI

### Objective

Create the first fully usable Gibberish journaling experience.

### Tasks

1. Build the welcome screen.
2. Build passphrase creation.
3. Build recovery-key generation and confirmation.
4. Build the journal unlock screen.
5. Implement journal session management.
6. Implement manual locking.
7. Implement five-minute inactivity locking.
8. Implement elapsed-time checks on resume.
9. Hide revealed content when the application backgrounds.
10. Build the timeline.
11. Build the entry editor.
12. Build the entry detail screen.
13. Display Gibberish titles and bodies by default.
14. Implement **Reveal My Thoughts**.
15. Implement **Hide My Thoughts**.
16. Implement entry editing.
17. Implement local save confirmation.
18. Add accessible loading, empty, and error states.
19. Add component and end-to-end tests.
20. Implement approved domain-owned recovery-key authentication and recovery-driven passphrase reset, exact snapshot CAS and reconciliation (approved M3 dependency).
21. Qualify same-origin KDF worker responsiveness without changing cryptographic parameters.

M3 follows the approved lifecycle and UI contracts in `M3_EXPERIENCE.md`.

### Deliverables

- Onboarding flow
- Passphrase setup
- Recovery-key display
- Unlock screen
- Journal timeline
- Entry editor
- Entry detail view
- Reveal and Hide controls
- Session-locking behavior

### Acceptance Criteria

- Users can complete onboarding without Google authentication.
- Users can create and edit encrypted journal entries.
- Entries display in Gibberish by default.
- English appears only after explicit reveal.
- Hiding an entry removes its revealed English from UI state.
- Backgrounding hides revealed English.
- Manual locking works.
- Five-minute inactivity locking works.
- Locked journals expose no entry metadata.
- Relevant end-to-end tests pass.

### Completion Gate

The application must now function as a usable local-only encrypted journal.

Do not proceed if plaintext persistence or locking defects remain unresolved.

## 9. Milestone M4 — Trash, Recovery, and Export

### Objective

Complete the local journal lifecycle and provide safe recovery options.

### Tasks

1. Implement moving entries to Trash.
2. Implement Trash listing.
3. Implement entry restoration.
4. Implement 30-day retention checks.
5. Implement early permanent deletion.
6. Implement durable tombstone creation.
7. Remove permanently deleted content from active local revision storage.
8. Retain/regress the recovery-driven reset delivered in M3; extend only approved recovery lifecycle needs.
9. Implement general passphrase changes/settings (recovery-driven reset is already M3).
10. Implement encrypted backup export.
11. Implement encrypted backup validation.
12. Implement encrypted backup restoration.
13. Implement readable Markdown export.
14. Add explicit privacy confirmation before readable export.
15. Add recovery, Trash, deletion, and backup tests.

### Deliverables

- Trash interface
- Restore functionality
- Permanent deletion workflow
- Tombstone storage
- Recovery workflow
- Passphrase-change workflow
- Encrypted backup export
- Encrypted backup restoration
- Readable Markdown export

### Acceptance Criteria

- Trashed entries remain recoverable during retention.
- Expired Trash entries are processed during subsequent application activity.
- Permanent deletion removes active encrypted entry content.
- Tombstones remain available.
- Recovery keys can unlock the journal.
- Passphrase changes preserve existing entries.
- Encrypted backups can be restored.
- Backup restoration does not silently overwrite another journal.
- Readable Markdown export requires explicit confirmation.
- No plaintext is automatically uploaded or persisted.

### Completion Gate

The local journal must support its complete lifecycle before optional cloud functionality is introduced.

## 10. Milestone M5 — PWA and Offline Hardening

### Objective

Make Gibberish installable and reliable during offline operation.

### Tasks

1. Configure the PWA manifest.
2. Add application icons.
3. Configure the service worker.
4. Cache the application shell and appropriate static assets.
5. Exclude sensitive API responses from caching.
6. Verify offline application startup.
7. Verify offline journal unlocking.
8. Verify offline entry creation and editing.
9. Verify offline Trash and restoration.
10. Implement safe application-update behavior.
11. Add local-only data-loss guidance.
12. Test representative mobile browsers.
13. Add offline and PWA end-to-end tests.

### Deliverables

- Installable PWA
- Offline application shell
- Offline journal workflows
- Safe service worker configuration
- Storage persistence guidance
- PWA test coverage

### Acceptance Criteria

- The application loads offline after initial installation or caching.
- Core journal operations work offline.
- IndexedDB data survives normal PWA updates.
- Service workers do not cache plaintext journal content.
- Local-only users receive clear backup guidance.
- PWA tests pass on supported browsers.

### Completion Gate

The application must be independently useful without Google Drive.

## 11. Milestone M6 — Google Authentication and Cloud Setup

### Objective

Add optional Google Drive connectivity without changing local journal behavior.

### Tasks

1. Configure Google Cloud project requirements.
2. Configure OAuth consent and authorized origins.
3. Integrate Google Identity Services.
4. Implement optional Google sign-in.
5. Implement Google authorization handling.
6. Select and verify the minimum required API scopes.
7. Implement Google Drive folder discovery.
8. Implement journal storage file discovery.
9. Implement cloud journal initialization.
10. Implement journal identity validation.
11. Implement cloud connection status.
12. Implement disconnect and reconnect behavior.
13. Handle expired or revoked authorization.
14. Add Google API adapter tests.
15. Validate the connection flow with dedicated test accounts.

### Deliverables

- `core/google`
- Optional Google connection flow
- Drive folder and file discovery
- Cloud journal initialization
- Authorization failure handling
- Mocked API integration tests

### Acceptance Criteria

- Local journaling remains available without Google.
- Users can explicitly connect Google Drive.
- Required authorization scopes are validated.
- Cloud journal identity is checked.
- Unrelated journals are not silently merged.
- Authorization failures do not affect local journal access.
- OAuth credentials are handled according to the security specification.
- Relevant tests pass.

### Completion Gate

Do not begin cloud synchronization until cloud discovery, identity validation, and authorization handling are reliable.

## 12. Milestone M7 — Encrypted Synchronization

### Objective

Implement the append-only, revision-based synchronization protocol.

### Tasks

1. Implement cloud revision serialization.
2. Implement remote revision validation.
3. Implement encrypted revision publication.
4. Implement remote revision discovery.
5. Implement durable queue processing.
6. Implement retry and backoff.
7. Implement uncertain-upload acknowledgment handling.
8. Implement duplicate revision detection.
9. Implement revision ancestry reconciliation.
10. Implement remote head calculation.
11. Implement conflict detection.
12. Implement encrypted tombstone publication.
13. Implement permanent deletion propagation.
14. Implement cloud cleanup retry behavior.
15. Implement synchronization status reporting.
16. Implement explicit **Sync Now**.
17. Add comprehensive synchronization integration tests.
18. Perform the Google Sheets concurrency validation defined in `TESTING.md`.

### Deliverables

- `core/sync`
- Revision-based synchronization engine
- Durable retry handling
- Conflict detection
- Tombstone synchronization
- Cloud cleanup
- Synchronization status UI
- Concurrency validation results

### Acceptance Criteria

- Local changes synchronize after reconnection.
- Failed operations remain retryable.
- Duplicate remote revisions do not duplicate entries.
- Conflicting revisions remain recoverable.
- Synchronization does not require plaintext decryption.
- Permanent deletion markers prevent stale-entry resurrection.
- Cloud status is not marked successful before verification.
- No plaintext journal content is uploaded.
- Google Sheets concurrency validation passes.

### Critical Release Gate

Google Sheets synchronization must not be considered production-ready unless concurrent-write, retry, and deletion behavior satisfy the no-silent-data-loss requirements.

If the chosen Google Sheets protocol cannot meet those requirements, stop and document the limitation.

Revise the cloud adapter or protocol before releasing synchronization.

Do not weaken the security or data-integrity requirements.

## 13. Milestone M8 — Cross-Device Restoration and Conflict Resolution

### Objective

Enable users to restore their journal on another device and resolve concurrent edits safely.

### Tasks

1. Implement cloud journal discovery on a new device.
2. Download wrapped keys and journal configuration.
3. Download encrypted revisions and tombstones.
4. Validate imported cloud data.
5. Reconstruct current-entry projections.
6. Implement passphrase-based cloud restoration.
7. Implement recovery-key-based cloud restoration.
8. Implement conflict indicators.
9. Build the conflict-resolution interface.
10. Implement **Keep Local**.
11. Implement **Keep Remote**.
12. Implement **Keep Both**.
13. Create resolution revisions with appropriate ancestry.
14. Synchronize conflict resolutions.
15. Add cross-device and conflict-resolution end-to-end tests.

### Deliverables

- Cross-device restoration flow
- Cloud recovery flow
- Conflict indicators
- Conflict-resolution UI
- Resolution revision logic
- Cross-device test coverage

### Acceptance Criteria

- A journal can be restored on a second device.
- Restoration requires valid credentials.
- Wrapped keys are sufficient for authorized recovery.
- Current-entry projections reconstruct correctly.
- Conflicting branches remain available.
- Users can explicitly resolve conflicts.
- Resolution revisions preserve required ancestry.
- No conflicting entry is silently discarded.
- Relevant tests pass.

### Completion Gate

Cross-device restoration and conflict handling must work before cloud synchronization is declared complete.

## 14. Milestone M9 — Security, Accessibility, and Release Hardening

### Objective

Prepare Gibberish for a reliable MVP release.

### Tasks

1. Run the complete automated test suite.
2. Review cryptographic implementation and key lifecycle.
3. Review plaintext persistence risks.
4. Review OAuth token handling.
5. Review service worker caching.
6. Validate security headers and CSP.
7. Review dependency vulnerabilities.
8. Validate locked-state privacy.
9. Test browser suspension and resume behavior.
10. Test accessibility and keyboard navigation.
11. Test representative mobile and desktop layouts.
12. Test PWA installation.
13. Test encrypted backup restoration.
14. Validate cloud synchronization with dedicated test accounts.
15. Document known limitations.
16. Update README and setup instructions.
17. Complete the release checklist.

### Deliverables

- Release candidate
- Passing automated test suite
- Security review results
- Accessibility validation
- Browser compatibility results
- Updated documentation
- Known limitations list

### Acceptance Criteria

- Critical security tests pass.
- Data-integrity tests pass.
- Required end-to-end tests pass.
- No known critical plaintext exposure remains.
- No known silent data-loss path remains.
- Core offline functionality works.
- Google synchronization release gates pass.
- Supported browsers are validated.
- Documentation matches implemented behavior.

### Completion Gate

The MVP is release-ready only after all critical acceptance criteria are satisfied.

## 15. Recommended Development Workflow with Codex CLI

Use a consistent workflow for every milestone.

### Step 1 — Read the Relevant Specifications

Before implementation, Codex must read:

- `AGENTS.md`
- `docs/PRD.md`
- `docs/SECURITY.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/SYNC_STRATEGY.md`
- `docs/TESTING.md`
- `docs/IMPLEMENTATION_PLAN.md`

Codex should prioritize the sections relevant to the current milestone.

### Step 2 — Inspect the Existing Repository

Codex must inspect existing code before creating new files or changing interfaces.

It must avoid duplicating existing modules.

### Step 3 — Propose a Focused Plan

Before making changes, Codex should summarize:

- The milestone objective
- Files likely to change
- Dependencies required
- Tests to add
- Expected verification commands

### Step 4 — Implement the Milestone

Codex should implement only the approved milestone.

Do not begin unrelated features.

### Step 5 — Add and Run Tests

Codex must add relevant tests and run applicable checks.

### Step 6 — Review the Changes

Verify:

- Architectural boundaries
- Security requirements
- Data model consistency
- Error handling
- Test results

### Step 7 — Report Completion

Codex must provide:

- What was implemented
- Files changed
- Tests added
- Commands executed
- Passing and failing checks
- Known limitations
- Any deviations from the specifications

### Step 8 — Stop

Codex must stop after the milestone.

Do not automatically proceed to the next milestone.

## 16. Codex Task Size

Prefer small implementation tasks.

A milestone may be divided into smaller tasks when necessary.

For example, M1 may be implemented as:

- M1.1 — Encryption envelopes and AES-GCM
- M1.2 — Passphrase derivation and key wrapping
- M1.3 — Recovery-key management
- M1.4 — Gibberish codec
- M1.5 — Security tests and integration review

Each task must leave the repository in a testable state.

Do not combine unrelated features into a single large change.

## 17. Required Verification Commands

The project should provide these commands:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

A combined verification command is recommended:

```bash
pnpm check
```

Codex must not report a command as passing unless it actually executed successfully.

If a command cannot run, Codex must explain why.

## 18. Milestone Completion Report Template

At the end of each milestone, Codex should produce a concise report.

```markdown id="zfnwmv"
## Milestone Completion Report

### Milestone
M[number] — [name]

### Implemented
- ...

### Files Changed
- ...

### Tests Added
- ...

### Verification
- Typecheck:
- Lint:
- Unit tests:
- Integration tests:
- E2E tests:
- Production build:

### Known Limitations
- ...

### Specification Deviations
- ...

### Status
Complete / Blocked / Incomplete
```

Do not mark a milestone complete if required tests are failing.

## 19. Dependency Rules

Milestones have the following dependencies:

```text id="yrg0mk"
M0 — Project Foundation
 |
 v
M1 — Cryptography and Codec
 |
 v
M2 — Local Storage and Journal Domain
 |
 v
M3 — Core Journal UI
 |
 v
M4 — Trash, Recovery, Export
 |
 v
M5 — PWA and Offline
 |
 v
M6 — Google Connection
 |
 v
M7 — Encrypted Synchronization
 |
 v
M8 — Restoration and Conflicts
 |
 v
M9 — Release Hardening
```

The sequence prioritizes a complete local-first journal before introducing cloud complexity.

## 20. Out-of-Scope Implementation Work

Codex must not introduce the following into MVP without an approved specification change:

- Custom application backend
- Supabase or Firebase database
- Microservices
- Multi-package monorepo
- AI-generated journal prompts
- AI analysis of journal content
- Rich-text editing
- Image or audio attachments
- Social features
- Shared journals
- Payment infrastructure
- Multiple cloud providers
- Email-based passphrase reset
- Automatic merging of conflicting journal content
- Native iOS or Android applications

## 21. Risk Register

| Risk | Mitigation |
|---|---|
| Cryptographic implementation error | Reviewed primitives, test vectors, security review |
| Lost passphrase | Independent recovery key |
| Lost local browser storage | Encrypted backup and optional cloud sync |
| Plaintext persistence | Explicit security boundaries and automated tests |
| IndexedDB transaction failure | Atomic writes and failure reporting |
| Browser suspension | Elapsed-time locking checks |
| Google OAuth expiration | Reauthorization without interrupting local journaling |
| Google API rate limiting | Durable queue and bounded retries |
| Concurrent cloud writes | Immutable revisions and concurrency validation |
| Conflicting device edits | Revision ancestry and manual conflict resolution |
| Deleted entry resurrection | Durable tombstones and stale-device protection |
| Google Sheets storage limitations | Dedicated integration validation and protocol review |
| PWA update issues | Offline and migration tests |
| Scope creep | Milestone gates and out-of-scope rules |

## 22. MVP Release Criteria

Gibberish MVP is complete when:

1. A user can create a journal without Google authentication.
2. Journal titles and bodies are encrypted before persistence.
3. The journal displays Gibberish by default.
4. Users can explicitly reveal and hide English.
5. Passphrase unlocking and recovery-key unlocking work.
6. Manual and automatic locking work.
7. Locked journals expose no journal metadata.
8. Journal creation and editing work offline.
9. Trash and restoration work.
10. Permanent deletion uses durable tombstones.
11. Encrypted backup export and restoration work.
12. Readable Markdown export requires explicit confirmation.
13. Optional Google Drive connection works.
14. Encrypted revisions synchronize without silent overwrites.
15. Conflicts are detected and can be resolved.
16. Cross-device restoration works.
17. The PWA is installable.
18. Critical security and data-integrity tests pass.
19. Supported browsers have been validated.
20. Documentation matches the released application.

## 23. First Codex Execution Task

The first implementation task is M0 — Project Foundation.

Codex must:

1. Read the project specifications.
2. Inspect the existing repository.
3. Initialize the Vite React + TypeScript application if one does not already exist.
4. Configure Tailwind CSS.
5. Configure TypeScript, ESLint, Vitest, and Playwright.
6. Establish the modular directory structure.
7. Add baseline tests.
8. Verify the development and production builds.
9. Report results.
10. Stop before starting M1.

The first task must not implement encryption, journaling, Google authentication, or synchronization.

## 24. Document Governance

This document defines the implementation sequence for Gibberish MVP v1.

`PRD.md` defines what the product must do.

`SECURITY.md` defines security requirements.

`ARCHITECTURE.md` defines module boundaries.

`DATA_MODEL.md` defines persistent data contracts.

`SYNC_STRATEGY.md` defines synchronization behavior.

`TESTING.md` defines verification requirements.

Changes to implementation sequencing must preserve security and data-integrity dependencies.

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
