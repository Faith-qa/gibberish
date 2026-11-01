# Gibberish

**Your thoughts. Your language. Your privacy.**

Gibberish is a privacy-first, local-first journaling Progressive Web App (PWA) designed to give you a private space to write freely.

Write your thoughts in English. Gibberish encrypts your journal locally and displays your entries as a fictional, pronounceable language derived from encrypted data.

When you want to revisit your original thoughts, unlock your journal and explicitly choose **Reveal My Thoughts**.

Your journal belongs to you.

> **Project status:** M0–M3 are complete. M4 is implemented and locally verified, awaiting review. It adds encrypted Trash/restore, authenticated permanent-deletion markers, encrypted backup export/restoration, explicit readable export and current-passphrase change. Reports remain local. Google integration, synchronization and PWA cold launch remain later milestones.

---

## Why Gibberish?

Journaling should feel private.

Sometimes, the thoughts we want to write down are the ones we would least want someone else to read.

Gibberish is designed around a simple idea:

**You should be able to write honestly without giving up control over your personal thoughts.**

Instead of storing readable journal entries on a remote server, Gibberish is designed to encrypt content on your device before saving it.

Your entries appear in Gibberish by default, adding a distinctive reading experience while keeping encryption responsible for actual security.

## Core Features

The Gibberish MVP is planned to include:

- **Encrypted journaling:** Journal titles and bodies are encrypted locally using AES-256-GCM before persistence.
- **Gibberish display:** Encrypted content is represented as a fictional, pronounceable language by default.
- **Reveal My Thoughts:** Explicitly reveal original English content while your journal is unlocked.
- **Hide My Thoughts:** Return revealed content to its Gibberish representation.
- **Passphrase protection:** Unlock your journal using a passphrase.
- **Recovery key:** Recover access using an independently generated recovery key.
- **Automatic locking:** Lock the journal after five minutes of inactivity.
- **Offline journaling:** Create, edit, and read journal entries without an internet connection.
- **Encrypted Trash:** Restore deleted entries within a 30-day retention period.
- **Encrypted backups:** Export and restore portable encrypted journal backups.
- **Readable export:** Explicitly export your journal as readable Markdown when unlocked.
- **Optional Google Drive sync:** Back up and synchronize encrypted journal data using your own Google account.
- **Cross-device restoration:** Restore your encrypted journal on another supported device.

The initial release will focus on reliable, private journaling rather than social features, AI functionality, or rich-text editing.

## How Gibberish Protects Your Journal

Gibberish follows a **local-first, client-side encryption** model.

The intended data flow is:

```text
Write a journal entry in English
               |
               v
      Encrypt on your device
               |
               v
       Save encrypted data
          to IndexedDB
               |
               v
       Display Gibberish
               |
               v
     Explicitly reveal English
        when you choose
```

When optional cloud synchronization is enabled:

```text
Encrypted journal records
               |
               v
       Google Drive / Sheets
               |
               v
       Another authorized device
               |
               v
     Unlock with your credentials
```

### Encryption and Gibberish Are Different

Gibberish text is **not the encryption mechanism**.

The application uses authenticated encryption to protect journal content.

The Gibberish codec converts encrypted bytes into a reversible fictional-language representation.

This separation is intentional:

- Encryption protects confidentiality and integrity.
- Gibberish provides the default visual representation.
- Revealing English requires an unlocked journal session.

### What Gets Stored?

The application is designed to store:

- Encrypted journal revisions
- Wrapped encryption keys
- Minimal journal metadata
- Local configuration
- Synchronization metadata when cloud integration is enabled

It must not persist plaintext journal titles or bodies.

### Important Privacy Limitations

Gibberish cannot guarantee protection against every threat.

For example:

- A compromised device or malicious browser extension may expose content while the journal is unlocked.
- Someone who obtains both your encrypted journal and valid unlocking credentials may be able to read it.
- Losing both your passphrase and recovery key may make your journal unrecoverable.
- Browser storage can be cleared or evicted, so encrypted backups are important.
- Google-managed file history and independently exported backups may retain copies after application-level deletion.
- Revealed English is visible until hidden, navigated away from, backgrounded or locked. Browser/OS screenshots, clipboard contents and native memory are outside an absolute erasure guarantee.

See [`docs/SECURITY.md`](docs/SECURITY.md) for the complete security design and limitations.

## Local-First by Design

A Google account is **not required** to use Gibberish.

The application is designed to work locally through IndexedDB.

Users can:

- Create a journal
- Unlock it
- Write entries
- Edit entries
- Read entries
- Use Trash
- Export encrypted backups

All without connecting Google Drive.

Google integration is optional and exists to provide encrypted backup and cross-device synchronization.

## Technology Stack

| Area | Technology |
|---|---|
| Language | TypeScript |
| Frontend | React |
| Build tool | Vite |
| Styling | Tailwind CSS |
| Package manager | pnpm |
| Local database | IndexedDB + Dexie |
| Encryption | Web Crypto API |
| Passphrase derivation | Argon2id |
| Cloud authentication | Google Identity Services |
| Cloud storage | Google Drive + Google Sheets APIs |
| Unit testing | Vitest |
| Component testing | React Testing Library |
| End-to-end testing | Playwright |
| PWA | Vite PWA Plugin |

Gibberish is planned as a single modular frontend application, deployable as static assets.

No custom backend is required for the MVP.

## Getting Started

### Prerequisites

For development, you will need:

- Node.js 24 or newer (Node 24 is selected by `.nvmrc` and CI)
- pnpm 12.16.1, pinned in `package.json`
- Git
- A modern browser
- An editor such as IntelliJ IDEA or VS Code

### Clone the Repository

```bash
git clone <repository-url>
cd gibberish
```

Replace `<repository-url>` with the actual repository URL.

### Install Dependencies

```bash
pnpm install --frozen-lockfile
```

### Start the Development Server

```bash
pnpm dev
```

Vite will print the local development URL.

### Create a Production Build

```bash
pnpm build
```

### Preview the Production Build

```bash
pnpm preview
```

The production build is written to `dist/` for static hosting. Use HTTPS in production. `pnpm preview` is a local verification server, not a production server.

Install the browser engines before running end-to-end tests:

```bash
pnpm exec playwright install chromium firefox webkit
# On Linux, install browser system dependencies too:
pnpm exec playwright install --with-deps chromium firefox webkit
```

Playwright tests the production build; run `pnpm build` first. It starts and stops its own preview server on `127.0.0.1:4173`, which must be free. The suite covers desktop Chromium, Firefox, WebKit and emulated Android/iPhone viewports. Emulation does not replace real-device validation. On macOS the test setup creates and cleans up isolated Firefox app-data directories to avoid touching an installed Firefox profile and to work around [the upstream macOS profile issue](https://github.com/microsoft/playwright/issues/42768).

## Environment Configuration

M0 through M5 require no environment variables or credentials. `.env.example` documents this; copying it is optional. Vite loads `.env` and `.env.local` if present; only `VITE_*` values are exposed to browser code. Environment files are ignored by Git except `.env.example`. Do not add unused Google configuration before M6.

Optional Google integration will require Google Cloud project configuration and OAuth client settings.

When this integration is implemented, the repository will provide an example environment file containing only non-secret client-side configuration.

Important rules:

- Never commit secrets or OAuth access tokens.
- Never place confidential server credentials in Vite environment variables.
- Browser-exposed environment variables are not secret.
- Do not require Google authentication for local journaling.

Google Cloud setup instructions will be added when the integration is implemented.

## Project Structure

The established application structure is (reserved modules are empty until their milestone):

```text
gibberish/
├── public/
├── src/
│   ├── app/
│   ├── components/
│   ├── features/
│   ├── core/
│   │   ├── crypto/
│   │   ├── gibberish-codec/
│   │   ├── journal/
│   │   ├── storage/
│   │   ├── google/
│   │   ├── sync/
│   │   └── export/
│   └── main.tsx
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
├── docs/
│   ├── PRD.md
│   ├── SECURITY.md
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   ├── SYNC_STRATEGY.md
│   ├── TESTING.md
│   └── IMPLEMENTATION_PLAN.md
├── AGENTS.md
├── README.md
└── package.json
```

This structure may evolve as implementation progresses, provided the documented module boundaries are preserved.

## Running Tests

Run the following checks:

```bash
# TypeScript validation
pnpm typecheck

# Linting
pnpm lint

# Unit and integration tests
pnpm test

# End-to-end browser tests
pnpm test:e2e

# Production build
pnpm build
```

Run all five checks, including a fresh build before browser tests:

```bash
pnpm check
```

M0 was verified locally with Node 26.13.0 and pnpm 12.16.1. Node 24 is the CI target; hosted CI status is not inferred from local verification. TypeScript is pinned to 6.0.3 for compatibility with the ESLint parser.

M0 adds two React component tests and two browser scenarios across five projects (10 browser tests). Browser checks cover layout overflow, runtime errors, external requests, and keyboard skip navigation. Unit/integration suites are discovered under `tests/unit` and `tests/integration`; M2 integration tests exercise the encrypted storage/domain modules.

M1 adds AES-GCM, key-wrapping, recovery, validation, privacy-boundary and codec
tests, plus browser tests for the pure codec and actual bundled cryptographic
modules. Playwright builds a test-only harness under ignored `reports/M1/browser/`
and serves it from memory under the production CSP; it is not shipped in `dist/`.
The initial Argon2id profile uses 64 MiB, three passes, parallelism one, and a
32-byte output. Browser measurements are from the development host, including
mobile emulation; real-device qualification remains future release work.

The revision-bound AAD design requires fresh encryption for every new revision,
including Trash and restore. See [the cryptographic format](docs/CRYPTOGRAPHY.md)
and [codec format](docs/GIBBERISH_CODEC.md) for exact encodings, dependency review,
limits and tests. The crypto helpers remain independent of storage and UI.

Milestone completion reports are local-only at `reports/M{number}/COMPLETION_REPORT.md`
with supporting output in `logs/`. Incomplete work uses `STATUS_REPORT.md`.
The entire root `reports/` directory is ignored and must never be committed.

CI runs frozen installation, typecheck, lint, unit tests, production build, browser tests, and `pnpm audit --audit-level=high`. Run the audit locally as well when reviewing dependency changes.

M2 adds full immutable-metadata envelope/AAD v2, pinned Dexie/fake-indexeddb,
atomic encrypted revision/projection/conflict/outbox transactions, authenticated
history reads/rebuilds, and explicit uncertain-commit recovery. V1 vectors and
read-only legacy payload recovery remain supported without a downgrade path.
See [the local storage contract](docs/LOCAL_STORAGE.md) for APIs, schema,
10,000-revision defensive limit and security limitations. Browser harnesses under
ignored `reports/M2/browser/` cover reloads, independent tabs, offline domain
operations and normal persistent-browser restarts. These do not prove power-loss
durability or qualify real mobile devices. No storage harness ships in `dist/`. M2 did not configure a service worker; M5 adds the explicitly inventoried static
PWA shell described below. The baseline production CSP restricts scripts and connections
to the same origin, adds `wasm-unsafe-eval` for Argon2id's WebAssembly (not general
JavaScript `unsafe-eval`), and permits inline styles for Tailwind. M5 verifies local production MIME/security headers; actual-host qualification and
further release hardening remain explicit release work. Vite development removes
the HTML policy to support React Fast Refresh.

M3 adds domain/controller/component tests and real browser journeys for confirmed
setup, legacy and recovery unlock, exact passphrase reset, privacy, save failures,
concurrent branches, deadline checks, keyboard/focus and already-loaded offline
use. A same-origin module worker keeps the unchanged Argon2id computation off the
UI thread; native non-extractable key transport is qualified in all five projects.
Cancellation rejects immediately and discards late keys while the worker drains;
timeout/error fails closed. Browser emulation and passing tests do not establish
a security guarantee, real-device qualification or complete WCAG conformance.
The M3 final local run passed 238 unit/integration/component tests and 105 browser
tests (21 per project), with no failures, skips or retries. The required audit at
the high threshold passed with one moderate development-dependency advisory:
`minimatch` 10.2.6 ([GHSA-g3hv-75wg-m249](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249)).
An earlier desktop WebKit worker key clone raised `DataCloneError`; subsequent
qualification and full-suite runs passed. Transport errors still fail closed;
these host results do not establish universal WebKit or real-device reliability.
Details and earlier verification failures remain in the local report.

M4 verification passed 336 unit/integration/component tests and 155 browser tests
(31 per project) with no final failures, skips or retries. Native downloads,
cross-engine restoration, M3 database migration, transaction failures and already
loaded offline flows were exercised. Every configured project prepared, restored
and downloaded a 33,524,361-byte encrypted file and downloaded 16,761,251-byte
readable output; larger outputs failed without truncation. These measurements
qualify the automated host, including emulation, rather than physical low-memory
phones or OS download managers. All seven required gates passed; the same moderate
development-dependency advisory remains. No dependency/lockfile changes were made.
The historical WebKit transport caveat above still applies.

## Using the Local Journal

1. Choose **Get started**, enter a new passphrase (at least 15 Unicode code points,
   at most 1,024 UTF-8 bytes), and save the independent recovery key separately.
   Confirm the entire key and acknowledge its importance before initialization.
2. Create an entry and choose **Save entry locally**. The confirmation follows a
   committed or verified transaction. Titles use an eight-word envelope preview;
   detail pages contain the complete reversible encrypted representation.
3. Choose **Reveal My Thoughts** to read English or edit an existing entry. Hide,
   navigation, backgrounding and locking clear that English from the UI. Conflicts
   retain every branch for read-only review; resolution is a later milestone.
4. Lock this tab manually or allow the five-minute inactivity deadline to expire.
   Switching apps/tabs immediately conceals content and discards unsaved writing;
   private authorization may remain until the original deadline. Page exit fully
   revokes it. This is per-tab locking, not an all-tab lock.
5. Unlock with the original passphrase, or authenticate with the recovery key to
   set a replacement passphrase. Existing shorter passphrases still unlock. Reset
   preserves the journal identity, encryption key, recovery wrapper and revisions.

Passphrases are used exactly as entered. A recovery key unlocks existing encrypted
data; it cannot restore journal data lost from browser storage. There is no email
reset or cloud backup in this milestone. Offline writing/unlocking works after application assets are available. M5 adds
cold launch after complete asset installation and a verified controlling build.
First use requires an online load; browser storage can still be removed.
Do not clear browser data as a way to fix an error. See
[`docs/M3_EXPERIENCE.md`](docs/M3_EXPERIENCE.md) for the approved behavior.

Open an encrypted entry and choose **Move to Trash**, then confirm. Trash and
restoration create fresh authenticated encrypted revisions and preserve history.
**Open Trash** provides the same default Gibberish and explicit Reveal controls.
**Restore entry** works while ciphertext remains; **Permanently delete locally**
requires a separate confirmation and removes all encrypted versions of that entry.
A content-free authenticated marker remains. Conflicted branches are preserved
for review and cannot be purged or resolved here.

Trash becomes eligible for cleanup after 30 elapsed days on the device clock.
Small batches run during visible, authorized use away from drafts and uncertain
operations. Cleanup is not an exact-time background service; clock anomalies pause
it for date review. A closed browser cannot independently establish trusted elapsed
time. Deletion cannot erase old exports, browser snapshots or replicas elsewhere.

**Journal tools → Export journal** offers an encrypted JSON backup or readable
Markdown. The encrypted backup includes complete retained history, all branches,
retained Trash and deletion markers. It protects content while exposing identifiers,
dates, statuses and some configuration. A 32-MiB file/10,000-revision/10,000-marker
bound fails explicitly without truncation. Export is a read-only snapshot, separate
from future Google synchronization. Keep backups in a private location.

On an empty welcome screen, **Restore encrypted backup** validates a file using
its passphrase or independent recovery key, then requires confirmation. Recovery
restoration prepares a new passphrase. Restoration commits atomically into an
entirely empty database with original journal/revision IDs and a new local device;
it never merges or replaces another journal. Trash keeps its original retention
dates. Older offline backups cannot know about later deletions elsewhere. A newer
passphrase does not unlock an older file unless it was exported with that phrase.

Readable Markdown requires acknowledgment before generation and a separate
**Download readable Markdown** action. It includes active current heads only,
labels active conflicting versions, and excludes Trash/history. The final UTF-8
limit is 16 MiB. Prepared files remain private in memory and are discarded on
navigation, hiding, locking or expiry. Native downloads may outlive the tab and
may be spooled by the browser/OS; “Download requested” is not a durable backup
receipt. No app-managed persistent plaintext staging is used.

**Journal tools → Change passphrase** reauthenticates the current passphrase and
commits a new wrapper using exact snapshot checks. It preserves the journal key,
independent recovery wrapper and encrypted history. A failed current-passphrase
check locks the tab. Neither a change nor recovery reset revokes old backup files.
All operations retain the fixed five-minute per-tab session policy. See
[`docs/M4_LIFECYCLE.md`](docs/M4_LIFECYCLE.md) for formats, boundaries and limitations.

See [`docs/TESTING.md`](docs/TESTING.md) for the complete testing strategy.

## Installation, offline files and application updates

Build and test the production application with `pnpm build`, then `pnpm preview`.
The service worker is intentionally disabled in Vite development. Production uses
root `/` scope on a stable HTTPS origin; loopback HTTP is the local test exception.
The build verifies every serialized worker inventory entry against actual files.
No Google account or environment credential is needed.

Installation and offline readiness are separate. After all assets download, the
initial uncontrolled page asks you to close and reopen. A controlling matching
build and complete size/type/SHA-256 cache check produce **Offline files checked
for this browser**. A timeout, missing asset or cache failure leaves readiness
unverified while compatible online journaling can continue. Use **Check offline
files and updates** to retry the exact public assets. Readiness is point-in-time;
browser eviction or clearing can remove assets and journal data.

Use **Install Gibberish** when the browser offers it, or **Installation help and
local data safety** for browser-menu instructions. Installation prompts are offered
only from the locked/welcome screen. Safari Home Screen/Dock apps can use storage
independent of the original browser. Open the installed app online first. Transfer
an existing journal with an M4 encrypted backup and empty-target restoration;
verify the restored journal before deleting any original data. A recovery key and
an installed icon are not backups.

An update downloads into a separate bounded cache and waits. Finish/cancel/check
interrupted operations, save or explicitly discard writing, then choose **Prepare
this window to close**. This locks only this window. Close all Gibberish tabs/app
windows and reopen for natural activation; the app does not force a reload or
claim to save other windows. A storage/app incompatibility locks the affected tab
and requires a compatible reopen, preserving encrypted records. Hidden pages still
conceal immediately, pagehide/expiry/manual lock revoke, and English never reveals
automatically after restart or resume.

Only exact public HTML/JS/CSS, KDF worker/sodium dependencies, icons and the manifest
are cached. No plaintext, credentials, journal DTOs, file imports, Blob downloads,
backups, arbitrary responses or Google endpoints are cached. Limits are 128 files,
2 MiB per file, 8 MiB per release and three release caches; essential oversize
outputs fail without truncation. The static manifest is explicitly project-owned
so plugin-added entries cannot bypass inventory validation. No background sync,
retention cleanup, push, account integration or service-worker journal access is
introduced. IndexedDB stays at v2 with M4's exact v1→v2 migration.

See [M5_OFFLINE](docs/M5_OFFLINE.md) and the [static deployment contract](docs/DEPLOYMENT.md)
for HTTPS root scope, correct MIME/security headers, atomic publication, old hashed
asset retention and rollback limits. Local browser tests do not qualify an actual
host, native OS installation or physical devices. M5 final local verification passed 398 unit/integration/component tests and 230
browser tests (46 per project, including 15 M5 PWA scenarios). All seven required
gates passed. The final audit reports two moderate development advisories
(minimatch and glob) and one low development advisory (deepmerge), with no
high/critical findings; no finding was suppressed. The prior WebKit worker
transport caveat remains. Native OS installation, physical devices, actual-host
HTTPS deployment and hosted CI have not been qualified by these local runs.
Detailed evidence and earlier failures remain in the ignored local M5 report.

## Development Roadmap

Development is divided into ten milestones.

| Milestone | Description | Status |
|---|---|---|
| M0 | Project Foundation | Complete |
| M1 | Cryptography and Gibberish Codec | Complete; verified report kept locally |
| M2 | Local Storage and Journal Domain | Complete |
| M3 | Onboarding, Unlocking, and Core UI | Complete |
| M4 | Trash, Recovery, and Export | Complete |
| M5 | PWA and Offline Hardening | Automated acceptance verified; actual-host and physical-device qualification pending |
| M6 | Google Authentication and Cloud Setup | Not started |
| M7 | Encrypted Synchronization | Not started |
| M8 | Cross-Device Restoration and Conflict Resolution | Not started |
| M9 | Security, Accessibility, and Release Hardening | Not started |

See [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) for tasks, dependencies, and acceptance criteria.

## Engineering Documentation

The project maintains specifications for its key architectural and product decisions.

| Document | Description |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | Product vision, requirements, and user journeys |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model, encryption, and key management |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Application architecture and module responsibilities |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Encrypted records, revision history, and persistence schemas |
| [`docs/CRYPTOGRAPHY.md`](docs/CRYPTOGRAPHY.md) | Exact v2/legacy v1 cryptographic profiles |
| [`docs/LOCAL_STORAGE.md`](docs/LOCAL_STORAGE.md) | M2 APIs, transactions, schema and failure recovery |
| [`docs/M3_EXPERIENCE.md`](docs/M3_EXPERIENCE.md) | Approved setup, recovery, session lifecycle and journal UI contracts |
| [`docs/M5_OFFLINE.md`](docs/M5_OFFLINE.md) | Approved static PWA, readiness, session and update contracts |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | HTTPS root deployment, asset integrity, headers and release qualification |
| [`docs/M4_LIFECYCLE.md`](docs/M4_LIFECYCLE.md) | Approved Trash, tombstone, backup/restoration, export and passphrase-change contracts |
| [`docs/SYNC_STRATEGY.md`](docs/SYNC_STRATEGY.md) | Offline synchronization, conflicts, and deletion propagation |
| [`docs/TESTING.md`](docs/TESTING.md) | Testing strategy and quality gates |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | Step-by-step implementation milestones |
| [`AGENTS.md`](AGENTS.md) | Instructions for coding agents working on the repository |

## Working with Coding Agents

Gibberish is designed to support milestone-based development with Codex CLI.

Coding agents must:

1. Read `AGENTS.md`.
2. Read relevant specifications.
3. Inspect the existing codebase.
4. Propose a focused implementation plan.
5. Implement only the requested milestone.
6. Add and run relevant tests.
7. Report changes and unresolved issues.
8. Stop before proceeding to another milestone.

Security and data-integrity requirements must not be bypassed to accelerate development.

## Known Technical Challenges

Some implementation details require validation before release.

### Google Sheets Synchronization

Google Sheets does not provide database-style transactions.

Gibberish therefore proposes an append-only encrypted revision protocol with explicit conflict detection.

The implementation must validate concurrent writes, retries, and deletion propagation before cloud synchronization can be considered production-ready.

### Browser Storage

IndexedDB is suitable for local-first journaling but does not guarantee permanent retention against browser storage eviction or user-initiated clearing.

Encrypted backups and optional cloud synchronization are important recovery mechanisms.

### Key Recovery

Gibberish does not provide email-based passphrase reset.

Recovery depends on the user's independently generated recovery key.

Losing both unlocking credentials may make the journal permanently inaccessible.

## MVP Scope

The MVP focuses on:

- Private encrypted journaling
- Gibberish representation
- Explicit reveal and hide
- Passphrase and recovery-key access
- Local-first offline operation
- Trash and deletion
- Encrypted backup and restoration
- Optional Google Drive synchronization
- Cross-device restoration

The following are outside MVP scope:

- AI journal analysis
- Social sharing
- Collaborative journals
- Rich-text editing
- Image and audio attachments
- Mood tracking
- Payments
- Native mobile applications
- Multiple cloud storage providers
- Custom backend infrastructure

## Contributing

Development is currently guided by the documented implementation milestones.

Before contributing:

1. Read `AGENTS.md`.
2. Review the relevant specifications.
3. Keep changes focused.
4. Include tests for new behavior.
5. Preserve encryption and data-integrity requirements.
6. Avoid unrelated architectural changes.

Contribution guidelines may be expanded as the project evolves.

## License

A license has not yet been selected.

Until a license is added, do not assume that the source code is licensed for unrestricted reuse.

---

**Gibberish — Your thoughts. Your language. Your privacy.**
