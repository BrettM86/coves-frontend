/**
 * The drag-to-import gesture: when a press becomes a drag, when a release
 * drops the Bluesky card into the Coves slot, and how the move animates.
 */
import { describe, expect, it } from 'vitest'
import {
  dropDecision,
  isDragGesture,
  mergeProgress,
  movePlan,
  seatPauseMs,
} from './drag'

describe('isDragGesture', () => {
  it.each([
    [0, 0, false],
    [3, 4, false],
    [6, 0, true],
    [0, -6, true],
    [5, 5, true],
  ])('movement (%i, %i) is a drag: %s', (dx, dy, expected) => {
    expect(isDragGesture(dx, dy)).toBe(expected)
  })
})

describe('dropDecision', () => {
  it.each([
    [{ progress: 0.49, overTarget: false }, 'return'],
    [{ progress: 0.5, overTarget: false }, 'drop'],
    [{ progress: 0.2, overTarget: true }, 'drop'],
    [{ progress: -0.3, overTarget: false }, 'return'],
  ] as const)('%o -> %s', (input, expected) => {
    expect(dropDecision(input)).toBe(expected)
  })
})

describe('movePlan', () => {
  it('with reduced motion is a crossfade of at most 200 ms with no field delays', () => {
    const plan = movePlan(true)
    expect(plan.kind).toBe('crossfade')
    expect(plan.durationMs).toBeGreaterThan(0)
    expect(plan.durationMs).toBeLessThanOrEqual(200)
    expect(plan.fieldDelaysMs).toEqual([])
  })

  it('without reduced motion is a 400-600 ms morph whose fields fill in one after another', () => {
    const plan = movePlan(false)
    expect(plan.kind).toBe('morph')
    expect(plan.durationMs).toBeGreaterThanOrEqual(400)
    expect(plan.durationMs).toBeLessThanOrEqual(600)
    expect(plan.fieldDelaysMs.length).toBeGreaterThanOrEqual(2)
    for (let index = 1; index < plan.fieldDelaysMs.length; index++) {
      expect(plan.fieldDelaysMs[index]).toBeGreaterThan(
        plan.fieldDelaysMs[index - 1] ?? Infinity,
      )
    }
    for (const delay of plan.fieldDelaysMs) {
      expect(delay).toBeLessThan(plan.durationMs)
    }
  })

  it('without reduced motion every field finishes filling in before the morph ends', () => {
    const plan = movePlan(false)
    expect(plan.kind).toBe('morph')
    expect(plan.fieldRevealMs).toBeGreaterThan(0)
    expect(plan.durationMs).toBeLessThanOrEqual(600)
    for (const delay of plan.fieldDelaysMs) {
      expect(delay + plan.fieldRevealMs).toBeLessThanOrEqual(plan.durationMs)
    }
  })
})

describe('mergeProgress', () => {
  it.each([
    [0, 0],
    [0.25, 0.15625],
    [0.5, 0.5],
    [1, 1],
    [1.4, 1],
    [-0.3, 0],
  ])(
    'travel fraction %d blends %d of the way to Coves styling',
    (fraction, expected) => {
      expect(mergeProgress(fraction)).toBeCloseTo(expected, 10)
    },
  )
})

describe('seatPauseMs', () => {
  it('without reduced motion the card sits 2.5-3 s as a Coves header', () => {
    const pause = seatPauseMs(false)
    expect(pause).toBeGreaterThanOrEqual(2500)
    expect(pause).toBeLessThanOrEqual(3000)
  })

  it('with reduced motion the seated pause is short but present', () => {
    const pause = seatPauseMs(true)
    expect(pause).toBeGreaterThan(0)
    expect(pause).toBeLessThanOrEqual(800)
  })
})
