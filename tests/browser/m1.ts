import * as crypto from '../../src/core/crypto'
import * as codec from '../../src/core/gibberish-codec'

// Bundled and served only by Playwright, never by the production app entry.
Object.assign(globalThis, { __m1: { crypto, codec } })
