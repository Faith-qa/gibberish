import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { responseHeaders } from '../../build/pwa'
import { assetMime } from '../../src/pwa/protocol'

/** Test-only real HTTP static hosting; never bundled in the application. */
export async function pwaServer(initial: 'A' | 'LIMIT' = 'A') {
  let release: 'A' | 'B' | 'LIMIT' = initial
  const fault: { path?: string; mode?: 'status' | 'corrupt' | 'disconnect'; networkDown?: boolean } = {}
  const requests: string[] = []
  const server: Server = createServer((req, res) => {
    void (async () => {
      const u = new URL(req.url ?? '/', 'http://localhost'); requests.push(u.pathname)
      // Some automation engines do not apply context offline to worker fetches.
      // Deny actual static delivery too, so offline success cannot use the host.
      if (fault.networkDown) { res.destroy(); return }
      const path = u.pathname === '/' ? '/index.html' : u.pathname
      if (u.search || (path !== '/sw.js' && !assetMime(path))) { res.writeHead(404); res.end('Not found'); return }
      let bytes: Buffer
      try { bytes = await readFile(resolve(`reports/M5/releases/${release}`, '.' + path)) }
      catch {
        // Retain release A's old hashed files for in-flight clients after atomic publication of B.
        if (release !== 'B' || !path.startsWith('/assets/')) { res.writeHead(404); res.end('Not found'); return }
        try { bytes = await readFile(resolve('reports/M5/releases/A', '.' + path)) }
        catch { res.writeHead(404); res.end('Not found'); return }
      }
      for (const [key, value] of Object.entries(responseHeaders(path))) res.setHeader(key, value)
      if (fault.path === u.pathname) {
        if (fault.mode === 'status') { res.writeHead(503); res.end('Synthetic interrupted asset'); return }
        if (fault.mode === 'corrupt') { bytes = Buffer.alloc(bytes.length, 0x78) }
        if (fault.mode === 'disconnect') { res.setHeader('Content-Length', bytes.length); res.write(bytes.subarray(0, 10)); res.destroy(); return }
      }
      res.end(bytes)
    })().catch(() => { res.destroy() })
  })
  await new Promise<void>((ok, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', ok) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Synthetic server unavailable')
  return { url: `http://127.0.0.1:${address.port}`, requests, fault,
    publishB: () => { release = 'B' }, close: async () => { server.closeAllConnections(); await new Promise<void>((ok, reject) => server.close((error) => error ? reject(error) : ok())) } }
}
