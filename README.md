# Gibberish

**Your thoughts. Your language. Your privacy.**

Gibberish is a privacy-first, local-first journaling Progressive Web App (PWA) designed to give you a private space to write freely.

Write your thoughts in English. Gibberish encrypts your journal locally and displays your entries as a fictional, pronounceable language derived from encrypted data.

When you want to revisit your original thoughts, unlock your journal and explicitly choose **Reveal My Thoughts**.

Your journal belongs to you.

> **Project status:** M0 application foundation implemented. The responsive shell and development tooling are available. All journaling features described below remain planned; this version accepts and stores no journal content.

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
- Revealed English is visible on your screen until hidden or locked.

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

M0 requires no environment variables or credentials. `.env.example` documents this; copying it is optional. Vite loads `.env` and `.env.local` if present; only `VITE_*` values are exposed to browser code. Environment files are ignored by Git except `.env.example`. Do not add unused Google configuration before M6.

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

M0 was verified locally with Node 26.13.0 and pnpm 12.16.1. Node 24 is the CI target; the hosted GitHub Actions run is pending a push. TypeScript is pinned to 6.0.3 for compatibility with the ESLint parser.

M0 adds two React component tests and two browser scenarios across five projects (10 browser tests). Browser checks cover layout overflow, runtime errors, external requests, and keyboard skip navigation. Unit/integration suites are discovered under `tests/unit` and `tests/integration`; integration tests begin when domain modules exist.

CI runs frozen installation, typecheck, lint, unit tests, production build, browser tests, and `pnpm audit --audit-level=high`. Run the audit locally as well when reviewing dependency changes.

Tests for encryption, data integrity, persistence, and offline operation belong to later milestones. No service worker or PWA manifest is configured in M0 (M5). The shell includes a baseline CSP; production HTTP security headers and CSP hardening remain release work. The HTML policy is applied to production builds only; Vite development removes it to support React Fast Refresh. Production permits inline styles for Tailwind and restricts scripts and connections to the same origin.

See [`docs/TESTING.md`](docs/TESTING.md) for the complete testing strategy.

## Development Roadmap

Development is divided into ten milestones.

| Milestone | Description | Status |
|---|---|---|
| M0 | Project Foundation | Complete |
| M1 | Cryptography and Gibberish Codec | Not started |
| M2 | Local Storage and Journal Domain | Not started |
| M3 | Onboarding, Unlocking, and Core UI | Not started |
| M4 | Trash, Recovery, and Export | Not started |
| M5 | PWA and Offline Hardening | Not started |
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