import { JournalCryptoError } from './errors'

export function toBase64url(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)))
  }
  return btoa(chunks.join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64url(value: unknown, minBytes: number, maxBytes: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes * 4 / 3)
    || value.length % 4 === 1 || !/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new JournalCryptoError('INVALID_INPUT')
  }
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    if (bytes.length < minBytes || bytes.length > maxBytes || toBase64url(bytes) !== value) {
      throw new JournalCryptoError('INVALID_INPUT')
    }
    return bytes
  } catch {
    throw new JournalCryptoError('INVALID_INPUT')
  }
}
