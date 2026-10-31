# Gibberish Codec v1

Status: M1 codec format. The revision-bound AAD design is approved in
`DATA_MODEL.md` §7.1. The codec and encrypted-envelope round trip are implemented
without application UI integration.

## Purpose and boundary

The codec maps bytes to pronounceable fictional words and back. It supplies no
confidentiality, integrity protection, authentication, or key derivation. The
application must supply encrypted bytes, never English titles/bodies or keys.
The low-level mapper cannot determine whether arbitrary bytes are ciphertext.
It has no React, storage, Google, network, logging, or cryptographic dependencies.

The complete representation is versioned independently of encrypted-envelope
versions. Decoding a syntactically valid representation does not authenticate it;
authenticated decryption is still required before any original content is used.

## Canonical text

- Prefix: exactly `gib1:` (lowercase ASCII), immediately followed by zero or more
  four-letter words.
- Empty bytes: `gib1:`.
- Each byte maps to one four-letter word. Adjacent words have exactly one ASCII
  space. No leading or trailing spaces, punctuation, tabs, newlines, case folding,
  Unicode normalization, or whitespace repair is permitted.
- Unknown numeric versions raise `UNSUPPORTED_VERSION`. Malformed inputs raise
  `INVALID_INPUT`. Errors never include the supplied input.

Each byte is split into a high nibble and low nibble. Each nibble indexes this
ordered table; concatenate the high syllable followed by the low syllable:

| Nibble | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Syllable | ba | be | bi | bo | da | de | di | do | ka | ke | ki | ko | ma | me | mi | mo |

Examples use synthetic byte values, not a plaintext substitution:

| Input bytes (hex) | Canonical text |
|---|---|
| empty | `gib1:` |
| `00` | `gib1:baba` |
| `00 01 0f 10 ff` | `gib1:baba babe bamo beba momo` |
| `ab cd ef` | `gib1:kiko mame mimo` |

For non-empty input of length N, the representation has `5N + 4` ASCII characters
(five-character prefix, four characters per word, N−1 spaces). Storage and cloud
records must retain the encrypted envelope as their source of truth; do not
persist a redundant Gibberish copy. Render any representation as text.

## Envelope integration

The exact encrypted-envelope byte format is defined in
[CRYPTOGRAPHY.md](CRYPTOGRAPHY.md): version `0x01` (legacy) or `0x02` (operational), algorithm ID `0x01`, the
12-byte nonce, and ciphertext including its 16-byte authentication tag. The
crypto module owns validated envelope serialization; the codec still accepts
only `Uint8Array` and has no dependency on the crypto implementation. Neither
module selects title excerpts or renders content. V2 decryption needs the complete authenticated immutable metadata and expected
journal/entry scope; v1 legacy recovery needs its identity tuple. The envelope
bytes encode neither metadata nor scope. There is no journal UI
integration yet.

## Verification and limits

Tests cover fixed vectors, all 256 byte values, every single-byte round trip,
determinism, offset views, empty data, large deterministic data, malformed
framing/tokens, unknown versions, safe errors, and absence of storage/log/network
side effects. A browser test harness validates this pure mapping in the configured
Playwright engines without exposing it in the journal UI.

This is an in-memory synchronous mapper; expansion increases memory use and CPU
cost for large inputs. It accepts only complete inputs, not a streaming format.
No real-device performance guarantee is claimed. A different mapping or framing
requires a new codec version with explicit compatibility tests.

## M3 presentation contract

Use only authenticated operational encrypted-envelope bytes. Eight-word title
previews are explicitly incomplete prefixes; they cannot recover the full entry.
Detail paging assembles exactly one canonical gib1 prefix and the same ordered
words as encode(fullEnvelopeBytes); concatenation must decode byte-for-byte.
Title/body remain one encrypted payload; do not derive separate title ciphertext,
use plaintext length/seeds, or persist a redundant Gibberish copy. Locked/concealed
views display none. The codec implementation/mapping/version is unchanged.
