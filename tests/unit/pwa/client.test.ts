// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PwaClient } from '../../../src/pwa/client'
import { HEALTH_TIMEOUT, profile } from '../../../src/pwa/protocol'
import type { PublicReply, PublicRequest } from '../../../src/pwa/protocol'
const id = '11111111-1111-4111-8111-111111111111'
const expected = profile(id)
class Port {
  onmessage: ((e: { data: unknown }) => void) | null = null
  onmessageerror: (() => void) | null = null
  close() {}
}
let windowEvents: EventTarget
let events: EventTarget
let worker: { scriptURL: string; state: string; postMessage: ReturnType<typeof vi.fn> }
let registration: { scope: string; active: typeof worker | null; installing: typeof worker | null; waiting: typeof worker | null; update: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn> }
let sw: { controller: typeof worker | null; register: ReturnType<typeof vi.fn>; addEventListener: typeof events.addEventListener }
let answer: 'ready' | 'missing' | 'timeout' | 'invalid' | 'wrong-build' | 'wrong-correlation'
beforeEach(() => {
  answer = 'ready'; events = new EventTarget(); windowEvents = new EventTarget()
  worker = { scriptURL: 'https://example.invalid/sw.js', state: 'activated', postMessage: vi.fn((request: PublicRequest, ports: { respond: (data: unknown) => void }[]) => {
    if (answer === 'timeout') return
    const reply: PublicReply = { ...request, profile: answer === 'wrong-build' ? profile('22222222-2222-4222-8222-222222222222') : expected,
      ready: answer !== 'missing', milliseconds: 3, bytes: 500, assetCount: 2 }
    if (answer === 'wrong-correlation') reply.requestId = '33333333-3333-4333-8333-333333333333'
    ports[0]!.respond(answer === 'invalid' ? { ...reply, unlocked: true } : reply)
  }) }
  registration = { scope: 'https://example.invalid/', active: worker, installing: null, waiting: null, update: vi.fn(async () => {}), addEventListener: vi.fn() }
  sw = { controller: worker, register: vi.fn(async () => registration), addEventListener: events.addEventListener.bind(events) }
  vi.stubGlobal('navigator', { serviceWorker: sw })
  vi.stubGlobal('location', new URL('https://example.invalid/'))
  vi.stubGlobal('window', windowEvents)
  vi.stubGlobal('MessageChannel', class {
    port1 = new Port()
    port2 = { close() {}, respond: (data: unknown) => this.port1.onmessage?.({ data }) }
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })

it('requires exact controlled profile and complete verification rather than registration alone', async () => {
  answer = 'missing'; const client = new PwaClient(expected)
  await client.start(); expect(client.snapshot().readiness).toBe('unverified'); expect(await client.compatible()).toBe(true)
  answer = 'ready'; expect(await client.verify()).toBe(true); expect(client.snapshot()).toMatchObject({ readiness: 'verified', verificationMs: 3 })
  expect(sw.register).toHaveBeenCalledWith('/sw.js', { scope: '/', type: 'classic', updateViaCache: 'none' })
  expect(Object.keys(worker.postMessage.mock.calls[0]![0])).toEqual(['type', 'protocol', 'requestId'])
})
it('marks uncontrolled downloaded assets separately without claiming offline ready or claiming the page', async () => {
  sw.controller = null; const client = new PwaClient(expected); await client.start()
  expect(client.snapshot().readiness).toBe('downloaded'); expect(await client.verify()).toBe(false)
})
it.each(['invalid', 'wrong-build', 'wrong-correlation'] as const)('fails closed on genuine %s response without reloading', async (mode) => {
  answer = mode; const client = new PwaClient(expected)
  expect(await client.compatible()).toBe(false); expect(client.snapshot().compatible).toBe(false)
})
it('health timeout stays unverified while compatible online journaling is not denied', async () => {
  vi.useFakeTimers(); answer = 'timeout'; const client = new PwaClient(expected)
  const opening = client.compatible(); await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT)
  expect(await opening).toBe(true); expect(client.snapshot()).toMatchObject({ compatible: true, readiness: 'unverified' })
})
it('registration failure does not report incompatibility and can be retried explicitly', async () => {
  sw.controller = null; sw.register.mockRejectedValueOnce(new Error('Synthetic installation unavailable'))
  const client = new PwaClient(expected); await client.start()
  expect(client.snapshot()).toMatchObject({ compatible: true, readiness: 'unverified' })
  expect(await client.compatible()).toBe(true); await client.checkForUpdate()
  expect(sw.register).toHaveBeenCalledTimes(2); expect(client.snapshot().readiness).toBe('downloaded')
})
it('waiting update is advisory while controller replacement is terminal for current authorization', async () => {
  registration.waiting = { ...worker }; const client = new PwaClient(expected); await client.start()
  expect(client.snapshot()).toMatchObject({ waiting: true, compatible: true })
  events.dispatchEvent(new Event('controllerchange'))
  expect(client.snapshot()).toMatchObject({ compatible: false, readiness: 'unverified' })
  expect(await client.compatible()).toBe(false)
})
it('rejects a foreign worker URL and never asks it to handle a job', async () => {
  worker.scriptURL = 'https://example.invalid/unrelated.js'
  const client = new PwaClient(expected); expect(await client.compatible()).toBe(false); expect(worker.postMessage).not.toHaveBeenCalled()
})

it('clears an earlier readiness result before awaiting a new update/repair check', async () => {
  const client = new PwaClient(expected); await client.start(); expect(client.snapshot().readiness).toBe('verified')
  let finish: () => void = () => {}
  registration.update.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
  const checking = client.checkForUpdate()
  expect(client.snapshot().readiness).toBe('unverified')
  finish(); await checking; expect(client.snapshot().readiness).toBe('verified')
})
it('ignores late health replies after controller replacement instead of reviving readiness', async () => {
  let request: PublicRequest | undefined; let reply: ((data: unknown) => void) | undefined
  worker.postMessage.mockImplementationOnce((r: PublicRequest, ports: { respond: (data: unknown) => void }[]) => { request = r; reply = ports[0]!.respond })
  const client = new PwaClient(expected); const checking = client.verify()
  events.dispatchEvent(new Event('controllerchange'))
  reply!({ ...request, profile: expected, ready: true, milliseconds: 1, assetCount: 12, bytes: 1500000 })
  expect(await checking).toBe(false)
  expect(client.snapshot()).toMatchObject({ readiness: 'unverified', compatible: false })
})
