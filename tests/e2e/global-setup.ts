import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'

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
