import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import ts from 'typescript'

type Codec = typeof import('../../src/core/gibberish-codec')

test('standalone codec is reversible and rejects malformed data in the browser', async ({ page }) => {
  // Serve the actual pure module from memory for tests; no harness enters dist/.
  const source = await readFile(new URL('../../src/core/gibberish-codec/index.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  await page.route('**/__codec_harness.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `${compiled}\nglobalThis.__gibberishCodec = { encode, decode, GibberishCodecError, CODEC_VERSION };`,
  }))
  await page.goto('/')
  await page.addScriptTag({ type: 'module', url: '/__codec_harness.js' })
  await page.waitForFunction(() => '__gibberishCodec' in globalThis)
  const result = await page.evaluate(() => {
    const codec = (globalThis as unknown as { __gibberishCodec: Codec }).__gibberishCodec
    const bytes = Uint8Array.from({ length: 4096 }, (_, i) => i & 255)
    const text = codec.encode(bytes)
    const decoded = codec.decode(text)
    const errors: string[] = []
    for (const malformed of ['gib2:baba', 'gib1:BABA', 'gib1:baba ', 'gib1:<script>']) {
      try {
        codec.decode(malformed)
        errors.push('accepted invalid data')
      } catch (error) {
        errors.push(error instanceof codec.GibberishCodecError ? error.code : 'unexpected error')
      }
    }
    return {
      roundTrip: decoded.length === bytes.length && decoded.every((byte, i) => byte === bytes[i]),
      vector: codec.encode(new Uint8Array([0, 1, 15, 16, 255])),
      empty: codec.encode(codec.decode('gib1:')),
      deterministic: text === codec.encode(bytes),
      errors,
    }
  })
  expect(result).toEqual({
    roundTrip: true,
    vector: 'gib1:baba babe bamo beba momo',
    empty: 'gib1:',
    deterministic: true,
    errors: ['UNSUPPORTED_VERSION', 'INVALID_INPUT', 'INVALID_INPUT', 'INVALID_INPUT'],
  })
  await expect(page.getByRole('textbox')).toHaveCount(0)
})
