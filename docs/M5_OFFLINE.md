# M5 — Installation, offline startup and safe application updates

Approved Decisions A–F (Option 1) are normative for M5. This contract extends
M1–M4 without changing their cryptographic formats or operational database v2.

## Public assets and worker boundary

Use pinned Vite PWA Plugin injectManifest, explicit production-only native
registration of `/sw.js` at root `/`, classic bundled worker, HTTPS (loopback for
local tests), `updateViaCache: 'none'`. No automatic skipWaiting, clientsClaim,
reload, service-worker journal access, runtime response cache, background sync,
push, Google integration or M6 functionality.

Generate one immutable public build ID per build, shared by app and worker, and
an exact inventory of public HTML, JS, CSS, dedicated Argon2 worker and every
libsodium dependency, manifest and project icons. Each entry has a canonical URL,
SHA-256 digest, exact byte length and MIME. Allow only GET, same origin, no query,
Authorization, Range, redirect, opaque response or unexpected type. Fetch public
assets without credentials/referrers, verify bytes, and persist clean canonical
keys and reconstructed public response headers. Check cached bytes before use;
repair only the identical inventoried asset online. Never mix a new shell into an
old worker. Navigation fallback is only `/` and `/index.html` without a query.

Limits: 128 files, 2 MiB each, 8 MiB per release, at most three release caches
(24 MiB of bodies plus browser overhead). Essential dependencies outside limits
fail explicitly without omission/truncation. Sequential bounded reads avoid
unbounded memory. Install succeeds only after the full cache is verified. Failed
installation removes only its candidate and preserves active assets/IndexedDB.
Serialize only short public cache allocation/deletion critical sections with the
browser's origin-scoped Web Locks API, preventing active-worker repair and a new
install from both racing past the three-cache budget. [Web Locks](https://www.w3.org/TR/web-locks/) coordinate worker contexts; this
implementation uses only a public allocation name. No journal/session lock,
lease, IDB coordinator or force-steal is introduced. Missing lock support or an
acquisition timeout leaves offline work unverified and compatible online delivery
available. Qualify this worker API in every supported engine. Clean only this app's obsolete cache namespace after safe natural activation;
defer ambiguous cleanup, and reject another candidate if the cap cannot be met.

No journal plaintext, Gibberish views, encrypted journal DTOs, credentials, keys,
file imports, Blob downloads, backups, readable exports, arbitrary responses,
source maps, reports or test harnesses enter Cache Storage. Worker imports and
messages contain no journal, Dexie, key, export or session capability. This is a
code boundary, not a browser sandbox against compromised same-origin scripts.

## Readiness and compatibility

Installation, offline assets, a committed journal save and a backup are separate
states. Confirm offline readiness only when the actual controlling worker matches
the app build/profile and a complete size/type/digest inventory check succeeds.
Public PROFILE/VERIFY requests disclose only build inventory health. An explicit
REPAIR request may refetch only that fixed inventory, with the same bounds and
validation; it accepts no caller URL or content. Health requests time out at ten
seconds to unverified. Initial uncontrolled pages
may report files downloaded, requiring reopen for confirmation. Registration,
installation/cache failure or health timeout must not block compatible online
journaling. A genuine worker/build/protocol/schema mismatch fails closed.

Before repository open, check controlled app/worker compatibility. Keep exact
schema inspection, existing bounded v1→v2 migration and five-second DB opens.
Unknown/future stores/indexes/versions preserve bytes and require a compatible
app; no delete, recreate or downgrade. Storage versionchange/unexpected closure
synchronously invalidates the repository and revokes/gates its controller.

Check deadline first on resume, then compatibility before authenticated activity.
Whole-cache verification occurs at startup, visible resume and explicit checks,
not ordinary journal operations. Async generations reject stale status/credential
results. PWA callbacks do not extend the five-minute session. Hide conceals and
clears drafts; pagehide/manual lock/expiry revoke; no automatic English Reveal.

## Updates

Release B installs completely while A continues. B waits until existing controlled
clients drain. Accessible nonmodal guidance asks users to finish/reconcile writes,
close all Gibberish tabs/windows and reopen. Preparing one window to close requires
no dirty editor, busy/setup/recovery/import/export/change-passphrase flow, private
artifact, native handoff or uncertain encrypted plan. Use existing completion,
cancellation and exact reconciliation commands; never infer safety from isDirty
alone. Then revoke this tab, dispose artifacts and close the repository. Do not
claim other tabs are locked or saved. Do not persist an update draft.

Unexpected controller replacement/mismatch immediately revokes and gates the tab
without automatic reload. Late results cannot revive authorization. Transactions
may commit before revocation: never manufacture a receipt or automatically replay
a destructive operation. Volatile retry evidence can be lost on process death;
fresh unlock authenticates actual persisted history. Static rollback cannot undo
a database upgrade; future incompatible schemas require compatible roll-forward.
Already-open M4 code cannot gain M5 hooks remotely; M5 introduces no DB upgrade.

## Installation and deployment

Manifest: name/short name Gibberish, id/start/scope `/`, English, standalone,
theme #065f46, background #fafaf9. Local 192/512 PNG icons, distinct maskable 512
icon and Apple touch icon; keep favicon. No secret/deep-link query, screenshots,
share/file handlers or platform wrapper. Feature-detect a deferred explicit install
prompt; otherwise offer accessible Chrome/Edge/Firefox Windows/Safari Home Screen
or Dock guidance. No experimental install API or persistence permission setting.

Installed apps can have an independent storage container, notably WebKit Home
Screen/Dock apps. Transfer an existing journal by M4 encrypted backup and
empty-target restoration. Open the installed app online first, verify its assets
and restored journal before deleting any original. A recovery key is not a data
backup. Browser eviction/uninstall/clearing can remove caches and encrypted data;
no exact retention, RAM erasure, universal install or offline-first-visit guarantee.

Deploy at a stable dedicated HTTPS root. Serve correct MIME and nosniff, restrictive
CSP response headers (worker has its own policy), no-cache for sw.js, revalidation
for HTML/manifest, immutable hashed assets. Publish complete releases atomically
and retain old hashed assets for in-flight releases; never rewrite missing assets
as HTML. Local fixture verification is not actual-host qualification.

## Verification

Preserve all M1–M4 regressions. Test full/partial install, exact cache boundaries,
corrupt/missing assets, quota failure, real cold launch after page close, process
restart where supported, KDF dependencies, offline core and M4 flows, genuine two
production releases with dirty/busy/multiple A clients, unexpected controller
changes, DB versionchange/future schema, deadline/concealment/late results, keyboard
and mobile layout. Exercise all five Playwright projects under production CSP.
Record readiness/startup performance without per-operation full-cache hashing.
PWA-10 cloud processing remains M6/M7, outside M5.

Run typecheck, lint, unit tests, build, Playwright, frozen install and audit high.
Record actual counts/failures/retries and manual physical-device/native-install,
AT, eviction and actual-host checks as PASS or NOT RUN. Emulation does not qualify
native iOS, OS snapshots, download managers, complete WCAG or actual disk failure.
