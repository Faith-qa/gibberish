# Static deployment contract

M5 supports a dedicated, stable **HTTPS origin at root `/`**. Loopback HTTP is
only a local secure-context test exception. No actual production host is selected
or qualified by the repository's local tests. GitHub source hosting is not proof
of a suitable GitHub Pages subpath or response-header configuration.

## Publish complete builds

1. Run `pnpm install --frozen-lockfile` and `pnpm build`. The second command checks
   final serialized service-worker inventory bytes and shared release identity.
2. Publish the complete `dist/` as one release. Upload all immutable hashed assets
   before making the new HTML, manifest and worker visible together. Do not edit
   built HTML/JS/manifest bytes or inject hosting analytics after hashing them.
3. Retain previously published hashed asset URLs on the same origin for clients
   still running an earlier release. Keep those historical files out of the fresh
   build directory/inventory; retain them on the hosting side after inventory
   generation. Never overwrite one hashed URL with different content.
4. Use a new build identity for every production build. The default is a random
   UUIDv4 generated once per build. `GIBBERISH_BUILD_ID` is optional public build
   metadata for controlled CI/testing, not a secret; never reuse it for changed
   bytes. No environment variables are required for local journaling.
5. Do not bypass natural worker waiting. Do not remotely reload clients, clear
   site data, force takeover or downgrade a database to roll back code. A later
   schema upgrade requires compatible roll-forward code. Preserve encrypted data.

Origin, scheme, port and browser/profile/container changes select different local
storage. Plan journal transfer using encrypted backups and empty-target restore;
do not tell users to delete the original before checking the restored copy.

## Required response behavior

| Resource | Content type | Cache and security requirements |
|---|---|---|
| `/`, `/index.html` | `text/html` | Revalidate (`Cache-Control: no-cache`); document CSP; nosniff; no-referrer |
| `/sw.js` | `text/javascript` | `Cache-Control: no-cache`; worker CSP; nosniff; no-referrer; no expanded Service-Worker-Allowed scope |
| `/manifest.webmanifest` | `application/manifest+json` | Revalidate; nosniff |
| `/assets/*.js` | `text/javascript` | Immutable hashed URLs; `public, max-age=31536000, immutable`; appropriate script/worker CSP and nosniff |
| `/assets/*.css` | `text/css` | Immutable hashed URLs; nosniff |
| Required local `.wasm` (if emitted) | `application/wasm` | Exact inventoried bytes; immutable hashed URL; nosniff |
| Approved PNG/SVG icons | `image/png`, `image/svg+xml` | Public exact bytes; stable filenames revalidate |
| Missing/unknown asset or route | 404 | Never rewrite an absent JS/CSS/WASM URL to HTML |

Keep CSP aligned with `src/pwa/protocol.ts`. The document and dedicated KDF worker
need the existing `wasm-unsafe-eval` allowance, same-origin `worker-src`/connections
and existing style policy. The service worker needs only its own static-fetch
policy: `default-src 'none'; script-src 'self'; connect-src 'self'; object-src
'none'; base-uri 'none'`. Serve this as its **HTTP response header**; a page meta
policy alone does not establish the worker's policy. Do not add unsafe-eval,
inline registration, broad origins, external imports or a Blob worker exception.

The manifest, icons and worker are all same-origin. No per-user HTML, session
cookies, credential-dependent response, arbitrary JSON, journal export or backup
belongs in a public build. The worker rebuilds cached response headers from a
fixed public set instead of persisting arbitrary network metadata.

## Qualification procedure

`pnpm preview` and the two-release browser fixture exercise local MIME, headers,
404s, atomic release switching, retained old assets and root scope. Preview is
not a production server and loopback is not an actual-host HTTPS qualification.
Before production release, inspect the deployed HTTPS certificate/origin and
response headers; inspect a complete production precache; test native cold launch,
update waiting, existing data across updates and an interrupted publication on
that actual host. Check that edge/CDN transforms do not change inventoried bytes.

Do not substitute a host-specific automatic PWA update script or clear-site-data
header. If a host cannot honor the contract, report the deployment blocker;
do not weaken validation or claim offline readiness from installation alone.

Subpath hosting requires an approved coordinated change to Vite base, manifest
ID/start/scope, worker path/scope, icons and allowed routes. Do not upload this
root build unchanged to a project subpath.
