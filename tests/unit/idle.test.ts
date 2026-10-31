// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { IdleDeadline } from '../../src/app/idle'

describe('fixed original inactivity deadline', () => {
  it('expires at 300000ms and never accepts activity after expiry', () => {
    let now = 0
    const deadline = new IdleDeadline({ wall: () => now, monotonic: () => now })
    deadline.start(); now = 299999
    expect(deadline.expired()).toBe(false)
    now = 300000
    expect(deadline.activity()).toBe(false)
    expect(deadline.expired()).toBe(true)
  })
  it('resets only on actual activity and checks both clocks', () => {
    let wall = 0; let monotonic = 0
    const deadline = new IdleDeadline({ wall: () => wall, monotonic: () => monotonic })
    deadline.start(); wall = monotonic = 200000
    expect(deadline.activity()).toBe(true)
    wall = 300000; monotonic = 500000
    expect(deadline.expired()).toBe(true)
  })
  it('fails closed on an observed wall-clock regression', () => {
    let wall = 100000
    const deadline = new IdleDeadline({ wall: () => wall, monotonic: () => 0 })
    deadline.start(); wall = 120000; deadline.remaining(); wall = 110000
    expect(deadline.expired()).toBe(true)
    deadline.stop()
    expect(deadline.expired()).toBe(false)
  })
})
