/** Versioned presentation of encrypted bytes; this codec is not encryption. */
export const CODEC_VERSION = 1 as const

export type GibberishCodecErrorCode = 'INVALID_INPUT' | 'UNSUPPORTED_VERSION'

export class GibberishCodecError extends Error {
  readonly code: GibberishCodecErrorCode

  constructor(code: GibberishCodecErrorCode) {
    super(code === 'UNSUPPORTED_VERSION'
      ? 'Unsupported Gibberish codec version.'
      : 'Invalid Gibberish codec input.')
    this.name = 'GibberishCodecError'
    this.code = code
  }
}

// Each nibble selects one of sixteen consonant-vowel syllables, in this order.
const syllables = ['ba', 'be', 'bi', 'bo', 'da', 'de', 'di', 'do',
  'ka', 'ke', 'ki', 'ko', 'ma', 'me', 'mi', 'mo'] as const
const words = Array.from({ length: 256 }, (_, byte) =>
  `${syllables[byte >>> 4]}${syllables[byte & 15]}`)
const byteByWord = new Map(words.map((word, byte) => [word, byte]))
const prefix = `gib${CODEC_VERSION}:`

/** Callers supply encrypted bytes, never an English journal string. */
export function encode(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) throw new GibberishCodecError('INVALID_INPUT')

  return prefix + Array.from(bytes, (byte) => words[byte]).join(' ')
}

/** Accept only the canonical format; never silently normalize malformed data. */
export function decode(input: unknown): Uint8Array<ArrayBuffer> {
  if (typeof input !== 'string') throw new GibberishCodecError('INVALID_INPUT')

  const header = /^gib([0-9]+):/.exec(input)
  if (!header) throw new GibberishCodecError('INVALID_INPUT')
  if (header[0] !== prefix) throw new GibberishCodecError('UNSUPPORTED_VERSION')
  if (input === prefix) return new Uint8Array(0)

  // One four-letter word per byte, separated by exactly one ASCII space.
  const bodyLength = input.length - prefix.length
  if ((bodyLength + 1) % 5 !== 0) throw new GibberishCodecError('INVALID_INPUT')

  const bytes = new Uint8Array((bodyLength + 1) / 5)
  for (let i = 0; i < bytes.length; i++) {
    const offset = prefix.length + i * 5
    if (i > 0 && input[offset - 1] !== ' ') throw new GibberishCodecError('INVALID_INPUT')
    const byte = byteByWord.get(input.slice(offset, offset + 4))
    if (byte === undefined) throw new GibberishCodecError('INVALID_INPUT')
    bytes[i] = byte
  }
  return bytes
}
