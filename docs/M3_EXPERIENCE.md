# M3 approved experience and security contracts

Approved 2026-10-31, Decisions A–E with user clarifications. This contract refines
the PRD/security specifications; no persisted schema or crypto version changes.
M4 extends this baseline through [M4_LIFECYCLE.md](M4_LIFECYCLE.md); its explicit
database migration and lifecycle/portability APIs preserve these session rules.

## Setup and recovery

Prepare keys and wrappers only in volatile private capability state. Display the
independent recovery key, require exact full-key confirmation and explicit saved/
loss acknowledgment, then atomically initialize the same journal. Cancellation,
expiry or pagehide must never persist an unconfirmed journal. Preserve the M2
non-UI initialization API for regression compatibility; the app uses confirmed
setup exclusively. No Google requirement and no destructive reset on detection
or storage failure.

New setup/recovery passphrases: nonblank, well-formed UTF-8, at least 15 Unicode
code points and at most 1,024 UTF-8 bytes, exact confirmation. No normalization,
trimming or truncation. Legacy unlock keeps accepting existing shorter phrases.

Recovery is domain-owned: unwrap the recovery wrapper, authenticate full history,
prepare a fresh passphrase wrapper outside IDB, and CAS against the exact old
bundle/config/device/revision snapshot. Preserve JEK, journal identity, recovery
wrapper and immutable revisions. Retries retain the same prepared replacement;
reconcile exact outcomes before claiming reset success. The original M3 scope
excluded general settings and export; M4 adds only approved passphrase change and
portable backup/readable export. Key rotation and cloud reset remain excluded.

## Session state and races

Five minutes means 300,000 ms of inactivity, checked using elapsed wall/monotonic
clocks before resetting activity, commands, results and resume. Meaningful
foreground input resets activity; timers, jobs and visibility transitions do not.
Warn before expiry with an accessible real-user keep-unlocked action.

On hidden, immediately clear/conceal plaintext UI, unsealed drafts, credentials
and revealed content; retain only private authorized/setup/recovery capability
state until the original deadline. Concealed is not locked. Return only after
checking that deadline, and never restore revealed English or an unsealed draft.
Manual lock, expiry and pagehide revoke fully. Sessions/lock are per tab.

Keep capabilities out of React. Each async job captures a generation and abort
signal; stale responses cannot mint/adopt an active session or restore sensitive
UI. Already-running crypto/commits may finish: clear owned buffers/references,
discard late keys/results, and reconcile sealed plans after a new authorization.
An interrupted save/reset is not evidence that its transaction failed.

Use a same-origin KDF worker, unchanged Argon2id profile, private typed messages,
bounded serialized jobs and cancellation. Qualification must show main-thread
security transitions remain responsive; stop if safe integration is not possible.

## Presentation and persistence boundaries

React calls controller/domain commands, never Dexie/crypto key operations. Discovery
returns only presence/private journal locator or safe errors, never an entry count,
date or timeline. Only authenticate-and-project domain reads may expose metadata.
Locked/concealed screens carry no journal titles, dates, words, counts or entries.

Default title is an eight-word prefix of canonical encoded envelope bytes, labelled
Preview. Detail shows the complete reversible representation using bounded pages;
joining pages equals encode(fullEnvelopeBytes) exactly. No plaintext-derived
Gibberish, separate title/body envelope, codec mapping change or redundant storage.
Only explicit Reveal exposes existing English; editing requires Reveal first.
Hide/navigation/background/lock clear English state and real DOM values/text.
Known conflicts have readonly branch selection and explicit per-branch reveal,
without timestamp winners, merges or resolution. New-entry authoring is English.

Save via prepare/commit and retain the encrypted plan until outcome is known.
Saved locally appears only after committed/reconciled persistence. Failed saves
preserve foreground drafts while authorized; lock/hidden/exit clears them. Warn
that app/tab switching can discard unsaved writing. No plaintext drafts, secret
keys, credentials or UI snapshots in browser storage, URLs, logs or telemetry.
No fake cloud operations for local pending writes. A hard reload may lose volatile
unsaved plans; inspect committed history and never automatically resubmit.

Explain separately: a recovery key unlocks existing encrypted data, but cannot
restore data lost from browser storage. No email/Google credential bypass. This
application remains local-only. M4 adds explicit encrypted backup export and
empty-target restoration, with readable export only on acknowledgment. Offline
cold launch remains unimplemented.

## Accessibility and verification

Native labelled controls, keyboard/skip navigation, visible meaningful focus,
accessible status/errors, mobile reflow, contrast and reduced motion. Do not
announce secrets in live regions. Paste/password managers are allowed. Browser/
clipboard/keyboard/GC limits prevent absolute erasure guarantees; WCAG is a test
target, not automatic certification.

Retain M1/M2 regressions and add domain, controller, component and browser tests
for all boundaries above. Test offline operations in an already loaded app, not
an unimplemented service worker/cold launch. Record simulated vs real-device
coverage explicitly. Required commands:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
pnpm install --frozen-lockfile
pnpm audit --audit-level=high
```

Reports/logs remain local at reports/M3. Stop after M3; no commit/push or M4+ work.

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
