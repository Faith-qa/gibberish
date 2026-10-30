# Module boundaries

- `app`: application composition, future providers and routing.
- `components/ui`: reusable presentation components.
- `features`: feature UI and interaction orchestration.
- `core`: framework-independent cryptography, codec, journal domain, encrypted storage, Google adapters, synchronization, and export modules.
- `hooks`, `types`, `styles`: shared React hooks, shared types, and styling.

`core/crypto` and `core/gibberish-codec` contain the M1 implementations described in `docs/CRYPTOGRAPHY.md` and `docs/GIBBERISH_CODEC.md`. They are not connected to journal UI or persistence. Other empty directories reserve the architecture in `docs/ARCHITECTURE.md`; they contain no implementations or public interfaces yet. Add domain contracts in their owning module when its milestone begins. Core modules must not import React. Storage and cloud adapters must never receive plaintext journal content.
