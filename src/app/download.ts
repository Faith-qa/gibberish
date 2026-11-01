export type ExportKind = 'backup' | 'readable'
/** Native, explicit disclosure handoff. A requested download is not durable file verification. */
export function handoffDownload(bytes: Uint8Array<ArrayBuffer>, kind: ExportKind): () => void {
  const blob = new Blob([bytes], { type: kind === 'backup' ? 'application/json' : 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url
  link.download = kind === 'backup' ? 'gibberish-backup.json' : 'gibberish-readable.md'
  link.hidden = true; document.body.append(link)
  let disposed = false
  const dispose = () => { if (!disposed) { disposed = true; URL.revokeObjectURL(url); clearTimeout(timer) } }
  // Bounded URL lifetime, not a delivery receipt. Security transitions revoke sooner.
  const timer = setTimeout(dispose, 10_000)
  try { link.click() } catch (error) { dispose(); throw error }
  finally { link.remove() }
  return dispose
}
