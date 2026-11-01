import type { Clock } from './idle'
/** Observed clock anomalies pause destruction; no trusted time survives a closed-app gap. */
export class RetentionClock {
  readonly #clock: Clock
  #wall: number
  #mono: number
  #unsafe = false
  constructor(clock: Clock) { this.#clock = clock; this.#wall = clock.wall(); this.#mono = clock.monotonic() }
  sample(): boolean {
    const wall = this.#clock.wall(); const mono = this.#clock.monotonic()
    if (!Number.isFinite(wall) || wall < this.#wall || Math.abs((wall - this.#wall) - (mono - this.#mono)) > 60_000) this.#unsafe = true
    this.#wall = wall; this.#mono = mono; return !this.#unsafe
  }
  defer(): void { this.#unsafe = true }
  get unsafe(): boolean { return this.#unsafe }
  review(): void { this.#wall = this.#clock.wall(); this.#mono = this.#clock.monotonic(); this.#unsafe = false }
}
