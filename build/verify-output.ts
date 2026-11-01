import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateInventory, validBuildId } from '../src/pwa/protocol.ts'
import type { Asset } from '../src/pwa/protocol.ts'

/** Verify the final serialized worker, not just the build tool's input objects. */
export async function verifyOutput(output = 'dist') {
  const worker = await readFile(resolve(output, 'sw.js'), 'utf8')
  const injection = worker.match(/(\[\{"byteLength"[\s\S]*?\}\])\.map\(/)?.[1]
  if (!injection) throw new Error('Final worker inventory is missing exact byte lengths')
  const raw: unknown = JSON.parse(injection)
  if (!Array.isArray(raw)) throw new Error('Invalid final inventory')
  const inventory: Asset[] = raw.map((item: Record<string, unknown>) => {
    if (Object.keys(item).sort().join() !== 'byteLength,mime,revision,sha256,url' || item.revision !== null) throw new Error('Unexpected final inventory fields')
    return { url: item.url, size: item.byteLength, mime: item.mime, sha256: item.sha256 } as Asset
  })
  validateInventory(inventory)
  for (const asset of inventory) {
    const body = await readFile(resolve(output, '.' + asset.url))
    if (body.length !== asset.size || createHash('sha256').update(body).digest('hex') !== asset.sha256) throw new Error('Final public bytes do not match worker inventory')
  }
  const ids = [...new Set(worker.match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g))]
  if (ids.length !== 1 || !validBuildId(ids[0])) throw new Error('Incoherent worker identity')
  const main = inventory.find((a) => /^\/assets\/index-.*\.js$/.test(a.url))
  if (!main || !(await readFile(resolve(output, '.' + main.url), 'utf8')).includes(ids[0])) throw new Error('Application and worker release identity differ')
  return { buildId: ids[0], assets: inventory.length, bytes: inventory.reduce((n, a) => n + a.size, 0) }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('Verified final PWA inventory:', await verifyOutput(process.argv[2]))
}
