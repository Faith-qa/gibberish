import { describe, expect, it, vi } from 'vitest'
import { CODEC_VERSION, decode, encode, GibberishCodecError } from '../../../src/core/gibberish-codec'

describe('Gibberish codec v1', () => {
  it.each([
    [[], 'gib1:'],
    [[0], 'gib1:baba'],
    [[0, 1, 15, 16, 255], 'gib1:baba babe bamo beba momo'],
    [[171, 205, 239], 'gib1:kiko mame mimo'],
  ])('matches fixed synthetic vector %j', (values, text) => {
    const bytes = new Uint8Array(values)
    expect(encode(bytes)).toBe(text)
    expect(decode(text)).toEqual(bytes)
  })

  it('has a distinct, pronounceable four-letter word for every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
    const text = encode(bytes)
    const tokens = text.slice('gib1:'.length).split(' ')
    expect(new Set(tokens).size).toBe(256)
    expect(tokens.every((word) => /^(?:[bdkm][aeio]){2}$/.test(word))).toBe(true)
    expect(decode(text)).toEqual(bytes)
    for (const byte of bytes) expect(decode(encode(new Uint8Array([byte])))).toEqual(new Uint8Array([byte]))
  })

  it('is deterministic, preserves view offsets, and does not mutate caller bytes', () => {
    const backing = new Uint8Array([17, 0, 255, 99])
    const copy = backing.slice()
    const view = backing.subarray(1, 3)
    expect(encode(view)).toBe('gib1:baba momo')
    expect(encode(view)).toBe(encode(view))
    expect(decode(encode(view))).toEqual(new Uint8Array([0, 255]))
    expect(backing).toEqual(copy)
    const decoded = decode(encode(view))
    decoded[0] = 42
    expect(backing).toEqual(copy)
  })

  it('round trips a large deterministic binary input', () => {
    const bytes = Uint8Array.from({ length: 256 * 1024 }, (_, i) => (i * 73 + (i >>> 8)) & 255)
    const text = encode(bytes)
    expect(text.length).toBe(5 * bytes.length + 4)
    expect(decode(text)).toEqual(bytes)
  })

  it.each([
    undefined, null, 123, {}, new Uint8Array([0]), '', 'baba', 'gib1',
    'GIB1:baba', ' gib1:baba', 'gib1: baba', 'gib1:baba ',
    'gib1:baba  momo', 'gib1:baba\tmomo', 'gib1:baba\nmomo',
    'gib1:BABA', 'gib1:babu', 'gib1:bab', 'gib1:babab', 'gib1:baba-momo',
    'gib1:baba\u00a0momo', 'gib1:<script>', 'gib1:constructor',
  ])('rejects malformed input %j with a safe error', (input) => {
    expect(() => decode(input)).toThrow(GibberishCodecError)
    try {
      decode(input)
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_INPUT', message: 'Invalid Gibberish codec input.' })
    }
  })

  it.each(['gib0:', 'gib2:baba', 'gib01:baba', 'gib999999999999999999999999:baba'])('rejects unsupported version %s', (text) => {
    expect(CODEC_VERSION).toBe(1)
    expect(() => decode(text)).toThrow('Unsupported Gibberish codec version.')
    try {
      decode(text)
    } catch (error) {
      expect(error).toMatchObject({ code: 'UNSUPPORTED_VERSION' })
    }
  })

  it('rejects a plaintext string or other non-byte encoder input at runtime', () => {
    for (const input of ['Synthetic English input', [0, 1], new Uint16Array([0]), null]) {
      // @ts-expect-error Deliberately simulate untyped callers crossing the module boundary.
      expect(() => encode(input)).toThrow('Invalid Gibberish codec input.')
    }
  })

  it('has no logging, persistent storage, or network side effects on success or failure', () => {
    const spies = [
      vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'), vi.spyOn(console, 'debug'),
      vi.spyOn(Storage.prototype, 'setItem'),
    ]
    const fetchSpy = vi.fn(() => { throw new Error('Unexpected network access') })
    const databaseSpy = vi.fn(() => { throw new Error('Unexpected database access') })
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('indexedDB', { open: databaseSpy })
    try {
      expect(decode(encode(new Uint8Array([0, 255])))).toEqual(new Uint8Array([0, 255]))
      expect(() => decode('gib1:untrusted-input')).toThrow(GibberishCodecError)
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(databaseSpy).not.toHaveBeenCalled()
    } finally {
      spies.forEach((spy) => spy.mockRestore())
      vi.unstubAllGlobals()
    }
  })
})
