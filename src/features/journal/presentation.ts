import { envelopeToBytes } from '../../core/crypto'
import type { RevisionEnvelope } from '../../core/crypto'
import { encode } from '../../core/gibberish-codec'
import { fromBase64url } from '../../core/crypto/encoding'

export const WORDS_PER_PAGE = 256
/** The eight-word prefix contains version/algorithm and six nonce bytes only.
 * Callers supply authenticated domain DTOs; avoid decoding the entire body for
 * each timeline title. This is exactly the full representation's prefix. */
export function encryptedPreview(envelope: RevisionEnvelope): string {
  if (envelope.version !== 2 || envelope.algorithm !== 'AES-256-GCM') throw new Error('Invalid encrypted preview.')
  const bytes = new Uint8Array(8)
  bytes.set([2, 1]); bytes.set(fromBase64url(envelope.nonce, 12, 12).subarray(0, 6), 2)
  return encode(bytes).slice(5)
}
export function encryptedPresentation(envelope: RevisionEnvelope) {
  const bytes = envelopeToBytes(envelope)
  const pages = Math.ceil(bytes.length / WORDS_PER_PAGE)
  return Object.freeze({
    preview: encryptedPreview(envelope),
    pages,
    page(index: number): string {
      if (!Number.isSafeInteger(index) || index < 0 || index >= pages) throw new Error('Invalid encrypted page.')
      const encoded = encode(bytes.subarray(index * WORDS_PER_PAGE, (index + 1) * WORDS_PER_PAGE))
      return index === 0 ? encoded : encoded.slice(5)
    },
  })
}
