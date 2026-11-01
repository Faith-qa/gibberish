import { mkdtemp, mkdir, rm, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { verifyOutput } from '../../build/verify-output'
import { MAX_ASSET_BYTES, MAX_RELEASE_BYTES } from '../../src/pwa/protocol'

export default async function globalSetup() {
  // Exercise actual browser bundling of M1 without adding a diagnostic UI or
  // shipping test harnesses/fixtures in the production application.
  await build({
    configFile: false,
    base: './',
    worker: { format: 'es' },
    build: {
      assetsDir: '',
      outDir: 'reports/M1/browser',
      emptyOutDir: true,
      lib: { entry: 'tests/browser/m1.ts', formats: ['es'], fileName: 'm1-harness' },
    },
  })
  await build({
    configFile: false,
    base: './',
    worker: { format: 'es' },
    build: {
      assetsDir: '',
      outDir: 'reports/M2/browser',
      emptyOutDir: true,
      lib: { entry: 'tests/browser/m2.ts', formats: ['es'], fileName: 'm2-harness' },
    },
  })
  await build({
    configFile: false,
    base: './',
    worker: { format: 'es' },
    build: { assetsDir: '', outDir: 'reports/M4/browser', emptyOutDir: true,
      lib: { entry: 'tests/browser/m4.ts', formats: ['es'], fileName: 'm4-harness' } },
  })
  // Distinct real production builds, served atomically by the M5 test fixture.
  const previousBuildId = process.env.GIBBERISH_BUILD_ID
  try {
    for (const [release, id] of [['A', '11111111-1111-4111-8111-111111111111'], ['B', '22222222-2222-4222-8222-222222222222']] as const) {
      process.env.GIBBERISH_BUILD_ID = id
      await build({ build: { outDir: `reports/M5/releases/${release}`, emptyOutDir: true } })
      await verifyOutput(`reports/M5/releases/${release}`)
    }
    process.env.GIBBERISH_BUILD_ID = '33333333-3333-4333-8333-333333333333'
    const limitOutput = resolve('reports/M5/releases/LIMIT')
    await build({ build: { outDir: limitOutput, emptyOutDir: true }, plugins: [{
      name: 'synthetic-cache-budget-fixture',
      async writeBundle() {
        let total = 0
        for (const path of await readdir(limitOutput, { recursive: true })) {
          const info = await stat(join(limitOutput, path)); if (info.isFile()) total += info.size
        }
        let remaining = MAX_RELEASE_BYTES - total; let index = 0
        if (remaining < 4) throw new Error('Synthetic cache budget fixture has no remaining room')
        while (remaining > 0) {
          const size = Math.min(MAX_ASSET_BYTES, remaining)
          if (size < 4) throw new Error('Synthetic fixture cannot form complete JS asset')
          const bytes = Buffer.alloc(size, 32); bytes.write('/*', 0); bytes.write('*/', size - 2)
          await writeFile(join(limitOutput, `assets/cache-budget-${index++}.js`), bytes)
          remaining -= size
        }
      },
    }] })
    const limit = await verifyOutput(limitOutput)
    if (limit.bytes !== MAX_RELEASE_BYTES) throw new Error('Synthetic cache budget fixture is not at the exact limit')
  } finally {
    if (previousBuildId === undefined) delete process.env.GIBBERISH_BUILD_ID
    else process.env.GIBBERISH_BUILD_ID = previousBuildId
  }
  if (process.platform !== 'darwin') return

  // Isolate Firefox app data from the real browser and macOS privacy restrictions.
  // https://github.com/microsoft/playwright/issues/42768
  const directory = await mkdtemp(join(tmpdir(), 'gibberish-firefox-'))
  const appData = join(directory, 'app')
  const localData = join(directory, 'local')
  await Promise.all([mkdir(appData), mkdir(localData)])
  process.env.MOZ_APP_DATA = appData
  process.env.MOZ_LOCAL_APP_DATA = localData

  return async () => {
    await rm(directory, { recursive: true, force: true })
  }
}
