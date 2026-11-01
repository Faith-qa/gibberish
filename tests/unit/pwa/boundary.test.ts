// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('M5 worker has no journal/key/session/storage/export imports or takeover command', () => {
  const source = readFileSync('src/pwa/sw.ts', 'utf8')
  expect(source).not.toMatch(/(?:from\s*|import\s*\()['"][^'"]*(?:core|app|features|dexie|crypto|export|session)/i)
  expect(source).not.toMatch(/\b(?:indexedDB|localStorage|sessionStorage|skipWaiting|clientsClaim|importScripts)\b/)
  expect(source).not.toMatch(/['"](?:sync|push|periodicsync)['"]/)
})
