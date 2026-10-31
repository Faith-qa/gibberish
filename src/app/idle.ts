export const IDLE_MS = 300_000
export interface Clock { wall(): number; monotonic(): number }
export const browserClock: Clock = { wall: () => Date.now(), monotonic: () => performance.now() }

/** Volatile per-tab deadline. Activity is never accepted before checking expiry. */
export class IdleDeadline {
  readonly #clock: Clock
  #wall = 0
  #monotonic = 0
  #observedWall = 0
  #active = false
  constructor(clock: Clock = browserClock) { this.#clock = clock }
  start(): void { this.#active = true; this.#wall = this.#observedWall = this.#clock.wall(); this.#monotonic = this.#clock.monotonic() }
  stop(): void { this.#active = false }
  remaining(): number {
    if (!this.#active) return IDLE_MS
    const wall = this.#clock.wall()
    if (wall < this.#observedWall) return 0
    this.#observedWall = wall
    return Math.max(0, IDLE_MS - Math.max(wall - this.#wall, this.#clock.monotonic() - this.#monotonic))
  }
  expired(): boolean { return this.#active && this.remaining() === 0 }
  activity(): boolean { if (this.expired()) return false; if (this.#active) this.start(); return true }
}
