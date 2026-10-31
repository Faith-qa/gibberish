import { expect, test } from '@playwright/test'

test('native worker preserves non-extractable KEKs across structured clone', async ({ page, context }) => {
  await context.route('**/__native-key-worker.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `
    self.onmessage = async () => {
      const bytes = new Uint8Array(32).fill(17);
      try {
        const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['wrapKey', 'unwrapKey']);
        bytes.fill(0);
        self.postMessage({ key });
      } catch (error) { self.postMessage({ error: error.name }); }
    };
  ` }))
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const results: string[] = []
    for (let index = 0; index < 10; index++) {
      results.push(await new Promise<string>((resolve) => {
        const worker = new Worker('/__native-key-worker.js', { type: 'module' })
        const timer = setTimeout(() => { worker.terminate(); resolve('timeout') }, 3000)
        worker.onmessage = (event: MessageEvent<{ key?: CryptoKey; error?: string }>) => {
          clearTimeout(timer); worker.terminate()
          const key = event.data.key
          resolve(key instanceof CryptoKey && !key.extractable && key.usages.includes('wrapKey')
            ? 'non-extractable' : event.data.error ?? 'invalid result')
        }
        worker.onerror = () => { clearTimeout(timer); worker.terminate(); resolve('worker error') }
        worker.postMessage({})
      }))
    }
    return results
  })
  expect(result).toEqual(Array.from({ length: 10 }, () => 'non-extractable'))
})
