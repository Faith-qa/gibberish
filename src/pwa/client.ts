import { HEALTH_TIMEOUT, profile, sameProfile, validReply } from './protocol'
import type { BuildProfile, PublicReply, PublicRequest } from './protocol'
declare const __GIBBERISH_BUILD_ID__: string
export const APP_PROFILE = profile(typeof __GIBBERISH_BUILD_ID__ === 'string' ? __GIBBERISH_BUILD_ID__ : 'development')
export interface PwaState {
  readiness: 'unsupported' | 'preparing' | 'downloaded' | 'verified' | 'unverified'
  waiting: boolean; installed: boolean; installable: boolean; compatible: boolean
  verificationMs: number | null
}
interface InstallPrompt extends Event { prompt(): Promise<void> }
type Answer = { kind: 'timeout' } | { kind: 'invalid' } | { kind: 'reply'; reply: PublicReply }

/** Public asset lifecycle only; never receives application/session state. */
export class PwaClient {
  readonly #profile: BuildProfile
  readonly #listeners = new Set<() => void>()
  #state: PwaState = { readiness: 'preparing', waiting: false, installed: false, installable: false, compatible: true, verificationMs: null }
  #registration: ServiceWorkerRegistration | undefined
  #prompt: InstallPrompt | undefined
  #epoch = 0
  #check: Promise<boolean> | undefined
  #updating: Promise<void> | undefined
  #started = false
  constructor(expected: BuildProfile = APP_PROFILE) {
    this.#profile = expected
    if (!('serviceWorker' in navigator)) this.#set({ readiness: 'unsupported' })
    else navigator.serviceWorker.addEventListener('controllerchange', () => {
      // No takeover is requested by this application. Every unexpected change
      // ends the current tab's authorization, even if a later profile matches.
      this.#epoch++; this.#set({ compatible: false, readiness: 'unverified' })
    })
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault(); this.#prompt = event as InstallPrompt; this.#set({ installable: true })
    })
    window.addEventListener('appinstalled', () => { this.#prompt = undefined; this.#set({ installed: true, installable: false }) })
  }
  snapshot = (): PwaState => this.#state
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener) } }
  #set(patch: Partial<PwaState>): void { this.#state = Object.freeze({ ...this.#state, ...patch }); for (const listener of this.#listeners) listener() }
  async #ask(worker: ServiceWorker, type: PublicRequest['type']): Promise<Answer> {
    const request: PublicRequest = { type, protocol: 1, requestId: crypto.randomUUID() }
    return await new Promise<Answer>((resolve) => {
      const channel = new MessageChannel()
      const finish = (answer: Answer) => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(answer) }
      const timer = setTimeout(() => finish({ kind: 'timeout' }), HEALTH_TIMEOUT)
      channel.port1.onmessage = (event: MessageEvent<unknown>) => finish(validReply(event.data, request) ? { kind: 'reply', reply: event.data } : { kind: 'invalid' })
      channel.port1.onmessageerror = () => finish({ kind: 'invalid' })
      try { worker.postMessage(request, [channel.port2]) } catch { finish({ kind: 'timeout' }) }
    })
  }
  async compatible(): Promise<boolean> {
    if (!this.#state.compatible) return false
    if (!('serviceWorker' in navigator)) return true
    const controller = navigator.serviceWorker.controller
    if (!controller) return true
    const epoch = this.#epoch
    if (controller.scriptURL !== location.origin + '/sw.js') { this.#set({ compatible: false, readiness: 'unverified' }); return false }
    const answer = await this.#ask(controller, 'PROFILE')
    if (epoch !== this.#epoch || controller !== navigator.serviceWorker.controller || !this.#state.compatible) return false
    if (answer.kind === 'invalid' || (answer.kind === 'reply' && !sameProfile(answer.reply.profile, this.#profile))) {
      this.#set({ compatible: false, readiness: 'unverified' }); return false
    }
    // An unavailable handshake is not evidence of a version mismatch. Keep
    // compatible online IDB access, with readiness explicitly unverified.
    if (answer.kind === 'timeout') this.#set({ readiness: 'unverified' })
    return true
  }
  async start(): Promise<void> {
    if (this.#started || !('serviceWorker' in navigator)) return
    this.#started = true
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', type: 'classic', updateViaCache: 'none' })
      if (registration.scope !== location.origin + '/') { this.#set({ compatible: false, readiness: 'unverified' }); return }
      this.#registration = registration
      const observe = () => {
        this.#set({ waiting: Boolean(registration.waiting) })
        const installing = registration.installing
        if (installing) installing.addEventListener('statechange', () => {
          if (installing.state === 'redundant') this.#set({ readiness: 'unverified' })
          if (installing.state === 'installed' || installing.state === 'activated') void this.verify()
          this.#set({ waiting: Boolean(registration.waiting) })
        })
      }
      registration.addEventListener('updatefound', observe); observe()
      await this.verify()
    } catch { this.#set({ readiness: 'unverified' }) }
  }
  verify(repair = false): Promise<boolean> {
    if (!('serviceWorker' in navigator) || !this.#state.compatible) return Promise.resolve(false)
    if (this.#check) return this.#check
    this.#set({ readiness: 'unverified' })
    this.#check = this.#verify(repair).finally(() => { this.#check = undefined })
    return this.#check
  }
  async #verify(repair = false): Promise<boolean> {
    if (!this.#state.compatible || !('serviceWorker' in navigator)) return false
    const controller = navigator.serviceWorker.controller
    const worker = controller ?? this.#registration?.active ?? this.#registration?.waiting
    if (!worker || worker.state !== 'activated') { this.#set({ readiness: 'unverified', waiting: Boolean(this.#registration?.waiting) }); return false }
    const epoch = this.#epoch
    if (worker.scriptURL !== location.origin + '/sw.js') { this.#set({ compatible: false, readiness: 'unverified' }); return false }
    const answer = await this.#ask(worker, repair ? 'REPAIR' : 'VERIFY')
    if (epoch !== this.#epoch || controller !== navigator.serviceWorker.controller || !this.#state.compatible) return false
    if (answer.kind !== 'reply') {
      this.#set({ readiness: 'unverified', ...(controller && answer.kind === 'invalid' ? { compatible: false } : {}) }); return false
    }
    if (!sameProfile(answer.reply.profile, this.#profile)) {
      this.#set({ readiness: 'unverified', ...(controller ? { compatible: false } : {}) }); return false
    }
    const ready = answer.reply.ready && worker.state === 'activated'
    this.#set({ readiness: ready ? controller ? 'verified' : 'downloaded' : 'unverified', verificationMs: answer.reply.milliseconds, waiting: Boolean(this.#registration?.waiting) })
    return ready && Boolean(controller)
  }
  checkForUpdate(): Promise<void> {
    if (!('serviceWorker' in navigator) || !this.#state.compatible) return Promise.resolve()
    this.#updating ??= this.#update().finally(() => { this.#updating = undefined })
    return this.#updating
  }
  async #update(): Promise<void> {
    this.#set({ readiness: 'unverified' })
    if (!this.#registration?.active && !this.#registration?.installing && !this.#registration?.waiting) { this.#started = false; await this.start(); return }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // Native update() is not abortable. Stop awaiting it at the public check
      // deadline; a later complete worker can still enter natural waiting.
      await Promise.race([this.#registration?.update(), new Promise<void>((resolve) => { timer = setTimeout(resolve, HEALTH_TIMEOUT) })])
    } catch { /* Offline update checks never change journal state. */ }
    finally { clearTimeout(timer) }
    await this.verify(true)
  }
  async install(): Promise<void> {
    const prompt = this.#prompt; this.#prompt = undefined; this.#set({ installable: false })
    if (prompt) try { await prompt.prompt() } catch { /* Browser menu guidance remains available. */ }
  }
}
