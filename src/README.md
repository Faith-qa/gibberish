# Module boundaries

- `app`: application composition, future providers and routing.
- `components/ui`: reusable presentation components.
- `features`: feature UI and interaction orchestration.
- `core`: framework-independent cryptography, codec, journal domain, encrypted storage, Google adapters, synchronization, and export modules.
- `hooks`, `types`, `styles`: shared React hooks, shared types, and styling.

`core/crypto` and `core/gibberish-codec` contain the formats in
`docs/CRYPTOGRAPHY.md` and `docs/GIBBERISH_CODEC.md`. M2 `core/journal` orchestrates
v2 encryption, authenticated revision graphs and revocable in-memory capabilities;
`core/storage` persists only encrypted DTOs with atomic Dexie transactions. See
`docs/LOCAL_STORAGE.md` for APIs, bounds and failure semantics. The application
shell does not instantiate the journal domain yet. Other empty directories reserve
later architecture; no sync, deletion, onboarding or journal UI is implemented.
Core modules must not import React. Storage and cloud adapters must never receive
plaintext journal content or unwrapped keys.
