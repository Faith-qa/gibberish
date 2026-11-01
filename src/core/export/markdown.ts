import { check } from '../storage/validation'
export const MAX_READABLE_BYTES = 16 * 1024 * 1024
export interface ReadableRecord { title: string; body: string; createdAt: string; updatedAt: string; version: number; versions: number }
export const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function literal(value: string, live: () => void): Promise<string> {
  check(value.length <= MAX_READABLE_BYTES, 'EXPORT_TOO_LARGE')
  let longest = 0; let run = 0
  for (let offset = 0; offset < value.length; offset++) {
    run = value[offset] === '`' ? run + 1 : 0; longest = Math.max(longest, run)
    if (offset > 0 && offset % 65536 === 0) { await yieldTask(); live() }
  }
  const length = Math.max(3, longest + 1)
  check(value.length + length * 2 + 10 <= MAX_READABLE_BYTES, 'EXPORT_TOO_LARGE')
  const fence = '`'.repeat(length)
  return `${fence}text\n${value}\n${fence}\n`
}
export async function formatMarkdown(records: AsyncIterable<ReadableRecord>, live: () => void): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0; let count = 0
  function append(value: string) {
    live(); check(value.length + size <= MAX_READABLE_BYTES, 'EXPORT_TOO_LARGE')
    const bytes = new TextEncoder().encode(value)
    if (bytes.length + size > MAX_READABLE_BYTES) { bytes.fill(0); check(false, 'EXPORT_TOO_LARGE') }
    size += bytes.length; chunks.push(bytes)
  }
  try {
    append('# Gibberish readable journal\n\nUnencrypted export. Active current versions only; Trash and historical content excluded.\n')
    for await (const row of records) {
      live(); count++
      append(`\n## Entry ${count}${row.versions > 1 ? ` — Unresolved active version ${row.version} of ${row.versions}` : ''}\n\nCreated: ${row.createdAt}\nUpdated: ${row.updatedAt}\n\nTitle:\n`)
      append(await literal(row.title, live)); append('\nBody:\n'); append(await literal(row.body, live))
      await yieldTask(); live()
    }
    const output = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
    try { live(); return output } catch (error) { output.fill(0); throw error }
  } finally { for (const chunk of chunks) chunk.fill(0) }
}
