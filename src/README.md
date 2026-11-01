# Module boundaries

- `app`: application composition and the private per-tab session controller.
- `components/ui`: reusable presentation components.
- `features`: onboarding/unlock/recovery forms and journal presentation; commands go through the controller.
- `core`: framework-independent cryptography, codec, journal domain, encrypted storage, Google adapters, synchronization, and export modules.
- `hooks`, `types`, `styles`: shared React hooks, shared types, and styling.

`core/crypto` and `core/gibberish-codec` contain the formats in
`docs/CRYPTOGRAPHY.md` and `docs/GIBBERISH_CODEC.md`. M2 `core/journal` orchestrates
v2 encryption, authenticated revision graphs and revocable in-memory capabilities;
`core/storage` persists only encrypted DTOs with atomic Dexie transactions. See
`docs/LOCAL_STORAGE.md` for APIs, bounds and failure semantics. M3 confirmed setup,
recovery reset and authenticated encrypted views live in `core/journal`. The app
controller privately owns capabilities, deadlines, generation guards and sealed
retry evidence. React receives presentation DTOs and transient authored/explicitly
revealed payloads, never JournalSession, setup/recovery handles or keys. See
`docs/M3_EXPERIENCE.md` for concealment, revocation and exact save/reset outcomes.
Browser Argon2id runs in a same-origin worker with unchanged parameters. Ordinary
cancellation rejects immediately and discards the result while the worker drains;
timeout/error terminates it without a weaker fallback. M4 lifecycle and portability
live in domain-owned modules: `lifecycle.ts` and `portability.ts` authenticate
snapshots/capabilities; `core/export` defines the canonical backup and literal
Markdown formats; `app/download.ts` handles explicit native handoff. The controller
privately retains export bytes and restore capabilities. React never accesses
Dexie or receives these capabilities. Database v2 migrates the same nine stores
without changing revision, wrapper or codec formats. See `docs/M4_LIFECYCLE.md`.
No Google integration, synchronization or service worker is implemented.
Other empty directories reserve later work.
Core modules must not import React. Storage and cloud adapters must never receive
plaintext journal content or unwrapped keys.
