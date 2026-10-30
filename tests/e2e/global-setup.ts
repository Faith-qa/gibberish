import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default async function globalSetup() {
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
