// @vitest-environment node
import { expect, it } from 'vitest'
import { formatMarkdown, MAX_READABLE_BYTES } from '../../src/core/export/markdown'
const row = { title: 'Synthetic title', body: 'Synthetic body', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', version: 1, versions: 1 }
it('preserves literal Unicode, fences and markup without executing or normalizing text', async () => {
  async function* records() { yield { ...row, body: '<script>literal</script>\n`````\n🌱 e\u0301\r\n' } }
  const bytes = await formatMarkdown(records(), () => {})
  expect(new TextDecoder().decode(bytes)).toContain('``````text\n<script>literal</script>\n`````\n🌱 e\u0301\r\n')
})
it('checks actual final UTF-8 size incrementally and refuses the whole oversized artifact', async () => {
  async function* records() { yield { ...row, body: '🌱'.repeat(MAX_READABLE_BYTES / 4) } }
  await expect(formatMarkdown(records(), () => {})).rejects.toMatchObject({ code: 'EXPORT_TOO_LARGE' })
})
it('cancels during large formatting work rather than returning a late artifact', async () => {
  const abort = new AbortController()
  async function* records() { yield { ...row, body: 'x'.repeat(262144) } }
  setTimeout(() => abort.abort(), 0)
  await expect(formatMarkdown(records(), () => { if (abort.signal.aborted) throw new DOMException('Synthetic cancellation', 'AbortError') })).rejects.toMatchObject({ name: 'AbortError' })
})
