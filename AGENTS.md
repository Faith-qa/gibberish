# Gibberish — Coding Agent Instructions

## 1. Project Overview

Gibberish is a privacy-first, local-first journaling Progressive Web App (PWA).

Users write journal entries in English. Their content is encrypted locally before persistence and displayed by default as a fictional, pronounceable language called Gibberish, derived reversibly from encrypted bytes.

Users may explicitly reveal their original English entries after unlocking the journal.

The application must work offline without an account. Google Drive integration is optional and provides encrypted backup and cross-device synchronization.

**Primary priorities:**
1. User privacy and security
2. Journal data integrity
3. Reliable offline functionality
4. Simple, maintainable architecture
5. Accessible, mobile-first user experience

## 2. Authoritative Documentation

Before implementing a task, read this file and the relevant specifications in `docs/`.

| Document | Responsibility |
|---|---|
| `docs/PRD.md` | Product requirements and user journeys |
| `docs/SECURITY.md` | Security, encryption, and key management |
| `docs/ARCHITECTURE.md` | Technology stack and module boundaries |
| `docs/DATA_MODEL.md` | Persistent schemas and data contracts |
| `docs/SYNC_STRATEGY.md` | Cloud synchronization and conflict handling |
| `docs/TESTING.md` | Test requirements and quality gates |
| `docs/IMPLEMENTATION_PLAN.md` | Implementation milestones and acceptance criteria |

**Rules:**
- Do not invent product requirements that conflict with these documents.
- Do not silently change documented architectural decisions.
- When documents conflict, identify the conflict and request clarification before implementing the affected behavior.
- Use the latest approved version of each document.
- Keep documentation aligned with approved implementation changes.
- Do not treat this file as permission to implement features outside the current task.

## 3. Technology Stack

Use the following technologies:

- TypeScript with strict mode
- React
- Vite
- Tailwind CSS
- pnpm
- IndexedDB with Dexie
- Web Crypto API for AES-256-GCM
- A reviewed browser-compatible Argon2id implementation
- Google Identity Services for optional authorization
- Google Drive API and Google Sheets API
- Vitest
- React Testing Library
- Playwright
- Vite PWA Plugin

Do not introduce additional frameworks, databases, or infrastructure without a documented need.

Use established libraries for cryptographic and authentication functionality.

## 4. Architecture Rules

- Follow a local-first architecture.
- Keep the application deployable as static assets.
- Use a single modular application repository.
- Do not introduce Supabase, Firebase, or a custom backend without approval.
- Keep domain logic independent of React components.
- Keep encryption, Gibberish encoding, storage, and synchronization as separate modules.
- Use typed interfaces at module boundaries.
- Keep Google API integrations behind adapters.
- Prefer simple functions and modules over unnecessary abstractions.
- Do not introduce microservices, dependency-injection frameworks, or additional state-management libraries without a demonstrated requirement.

## 5. Security and Privacy Rules

Security requirements are non-negotiable.

- Encrypt journal titles and bodies before persistence.
- Never store plaintext journal entries in IndexedDB, local storage, or session storage.
- Never upload plaintext journal content to Google APIs.
- Never persist unwrapped journal encryption keys.
- Never log plaintext journal content, passphrases, recovery keys, OAuth tokens, or encryption keys.
- Never commit credentials or secrets.
- Never implement custom cryptographic algorithms.
- Use authenticated encryption and validate encrypted envelopes.
- Generate cryptographic randomness using secure browser APIs.
- Keep Gibberish encoding separate from encryption.
- Do not describe Gibberish encoding as a security mechanism.
- Do not expose journal entries or metadata while the journal is locked.
- Clear revealed English from application UI state when hidden, locked, navigated away from, or backgrounded.
- Enforce the documented five-minute inactivity lock.
- Treat data imported from Google APIs or backup files as untrusted input.
- Never claim an implementation is secure solely because tests pass.

If a security requirement cannot be implemented as specified, stop and explain the limitation.

## 6. Data Integrity Rules

Journal content must never be silently lost or overwritten.

- Use stable identifiers for journals, entries, revisions, and synchronization operations.
- Preserve immutable encrypted entry revisions.
- Keep current-entry projections separate from revision history.
- Use atomic IndexedDB transactions for related local writes.
- Preserve pending synchronization operations across restarts.
- Never use Google Sheets row positions as stable entry identifiers.
- Never use last-write-wins to silently resolve conflicting revisions.
- Detect and preserve concurrent editing conflicts.
- Use durable tombstones to prevent permanently deleted entries from being restored by stale devices.
- Do not report cloud synchronization as successful before persistence has been verified.
- Treat Google Sheets as a non-transactional storage system.
- Validate the cloud synchronization protocol before considering it production-ready.

If an operation's result is uncertain, preserve local encrypted data and report the uncertainty.

## 7. Implementation Milestones

Follow `docs/IMPLEMENTATION_PLAN.md`.

The milestone sequence is:

1. **M0:** Project Foundation
2. **M1:** Cryptography and Gibberish Codec
3. **M2:** Local Storage and Journal Domain
4. **M3:** Onboarding, Unlocking, and Core UI
5. **M4:** Trash, Recovery, and Export
6. **M5:** PWA and Offline Hardening
7. **M6:** Google Authentication and Cloud Setup
8. **M7:** Encrypted Synchronization
9. **M8:** Cross-Device Restoration and Conflict Resolution
10. **M9:** Security, Accessibility, and Release Hardening

### Milestone Boundary Rules

- Implement only the milestone or subtask explicitly requested.
- Do not start subsequent milestones automatically.
- Do not implement unrelated features while completing a milestone.
- Break large milestones into smaller, testable tasks when necessary.
- Stop after completing the requested scope.
- Report blockers instead of bypassing requirements.
- Ask for approval before making significant architectural changes.

## 8. Development Workflow

For every implementation task:

### Step 1 — Inspect

Read the relevant documentation and inspect the existing repository.

Understand existing modules before creating new ones.

### Step 2 — Plan

Provide a concise implementation plan covering:

- Objective
- Files to create or modify
- Dependencies
- Tests
- Verification commands

For routine implementation details within the approved architecture, make reasonable engineering decisions without requesting unnecessary clarification.

### Step 3 — Implement

Make focused changes within the approved scope.

Prefer maintainable, readable code.

Avoid unnecessary dependencies and abstractions.

### Step 4 — Test

Write or update tests covering:

- Expected behavior
- Relevant failure cases
- Security boundaries
- Data integrity
- Regression risks

### Step 5 — Verify

Run the applicable commands:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

If a command cannot run, explain why.

Do not claim tests passed unless they were actually executed successfully.

### Step 6 — Report

Use a separate local directory for each milestone:

```text
reports/
  M0/
    COMPLETION_REPORT.md
  M1/
    COMPLETION_REPORT.md
    logs/
  M2/
    COMPLETION_REPORT.md
    logs/
```

Write `reports/M{number}/COMPLETION_REPORT.md` when implementation and required
verification are complete. For incomplete or blocked work, use
`reports/M{number}/STATUS_REPORT.md` and state the current status explicitly.
Keep verification logs in `reports/M{number}/logs/` and reference the relevant
files from the report using relative links. Preserve existing verification
evidence and log contents when reorganizing reports. Label reconstructed results
and anything that cannot be independently verified; never invent missing results.

Keep the root `/reports/` rule in `.gitignore` and verify report files are ignored
with `git check-ignore`. Reports and logs are local only: never stage, commit, or
push them. Check for already tracked reports before changing their tracking status
and report any findings first.

Provide a concise completion report containing:

- Milestone objectives and acceptance criteria
- Implemented functionality
- Files created or modified
- Tests added or updated
- Verification results (PASS, FAIL, or NOT RUN, with reasons and log references)
- Security considerations
- Known limitations
- Unresolved issues and blockers
- Specification deviations
- Readiness assessment for the next milestone

### Step 7 — Stop

Do not proceed to the next milestone without explicit approval.

## 9. Testing Standards

Follow `docs/TESTING.md`.

- Test cryptographic and data-integrity behavior thoroughly.
- Use synthetic journal data.
- Do not use real personal journal entries as test fixtures.
- Mock Google APIs for repeatable automated tests.
- Test offline operation and browser restarts.
- Test failure paths, not only successful operations.
- Test revision ancestry and conflict detection.
- Test backup restoration and permanent deletion.
- Use browser-level tests for critical user journeys.
- Do not weaken tests merely to make them pass.
- Do not remove failing tests without explaining and resolving the underlying issue.

## 10. Code Quality Standards

- Use strict TypeScript types.
- Avoid `any` unless justified.
- Validate external data at runtime.
- Prefer small, focused modules.
- Keep React components focused on presentation and interaction.
- Keep business logic in domain services.
- Use descriptive names.
- Handle errors explicitly.
- Avoid unnecessary comments that repeat the code.
- Document security-sensitive or non-obvious decisions.
- Do not introduce placeholder implementations that appear production-ready.
- Do not leave critical TODOs undocumented.

## 11. Dependency Management

- Use pnpm.
- Prefer established, maintained dependencies.
- Avoid adding packages for functionality already available through browser APIs.
- Review dependencies used for cryptography, authentication, and storage.
- Do not install packages without a clear purpose.
- Do not introduce a custom backend or additional database without approval.
- Keep dependency changes focused on the current milestone.

## 12. Git and Repository Safety

- Do not commit secrets, credentials, tokens, or private journal content.
- Do not overwrite unrelated user changes.
- Do not delete existing files without understanding their purpose.
- Do not perform destructive Git operations without explicit approval.
- Do not create commits or push changes unless requested.
- Respect the existing repository structure.
- Keep changes scoped to the active task.

## 13. Out-of-Scope Features

Do not implement these features for MVP unless explicitly requested:

- AI journal analysis or prompts
- Rich-text editing
- Image or audio attachments
- Social or collaborative journaling
- Mood tracking
- Payment functionality
- Native mobile applications
- Multiple cloud storage providers
- Email-based passphrase recovery
- Automatic merging of conflicting journal content
- Custom backend infrastructure

## 14. Definition of Done

A task is complete only when:

- Its approved scope is implemented.
- Relevant acceptance criteria are satisfied.
- Required tests pass.
- TypeScript checks pass.
- Linting passes.
- The production build succeeds when applicable.
- Security and data-integrity requirements are preserved.
- Relevant documentation is updated.
- Known limitations are reported.
- No unrelated milestone work was introduced.

If any required condition is not satisfied, report the task as **incomplete** or **blocked**, not complete.

## 15. Final Instruction

**Prioritize correctness, privacy, and maintainability over speed or feature count.**

Implement the requested milestone, verify it, report the results, and stop.

Do not proceed to the next milestone without explicit approval.
