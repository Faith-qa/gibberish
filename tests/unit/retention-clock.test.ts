// @vitest-environment node
import { expect, it } from 'vitest'
import { RetentionClock } from '../../src/app/retention-clock'
it('accepts elapsed clocks and persists an anomaly until deliberate review', () => {
  let wall = 1000, mono = 0
  const clock = new RetentionClock({ wall: () => wall, monotonic: () => mono })
  wall += 2_592_000_000; mono += 2_592_000_000; expect(clock.sample()).toBe(true)
  wall -= 1; expect(clock.sample()).toBe(false)
  wall += 10; mono += 10; expect(clock.sample()).toBe(false)
  clock.review(); expect(clock.sample()).toBe(true)
  wall += 60_001; expect(clock.sample()).toBe(false)
})
