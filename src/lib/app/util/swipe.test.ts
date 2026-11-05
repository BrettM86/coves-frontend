import { describe, expect, it } from 'vitest'
import { classifySwipe, type SwipeDirection } from './swipe'

// A swipe needs its dominant axis at least 1.5x the other, and either 50px of
// travel or a flick of 30px at 0.5px/ms or faster.
describe('classifySwipe', () => {
  it.each<{
    name: string
    dx: number
    dy: number
    ms: number
    expected: SwipeDirection | null
  }>([
    // Recognised swipes.
    { name: '80px left', dx: -80, dy: 0, ms: 200, expected: 'left' },
    { name: '80px right', dx: 80, dy: 0, ms: 200, expected: 'right' },
    { name: '120px down', dx: 0, dy: 120, ms: 300, expected: 'down' },
    { name: 'fast 40px flick up', dx: 0, dy: -40, ms: 80, expected: 'up' },
    // Guard rows: not a swipe.
    {
      name: 'slow 30px, under distance',
      dx: 30,
      dy: 0,
      ms: 200,
      expected: null,
    },
    {
      name: 'diagonal, no dominant axis',
      dx: 80,
      dy: 70,
      ms: 80,
      expected: null,
    },
    { name: '1px twitch, fast', dx: 1, dy: 0, ms: 1, expected: null },
    { name: 'slow 20px drag', dx: 0, dy: 20, ms: 600, expected: null },
    // Boundary rows.
    {
      name: 'fast 20px, under the flick distance',
      dx: 0,
      dy: 20,
      ms: 10,
      expected: null,
    },
    {
      name: 'slow 50px, at the distance',
      dx: 50,
      dy: 0,
      ms: 1000,
      expected: 'right',
    },
    { name: 'slow 49px, just short', dx: 49, dy: 0, ms: 1000, expected: null },
  ])('$name → $expected', ({ dx, dy, ms, expected }) => {
    expect(classifySwipe({ dx, dy, ms })).toBe(expected)
  })
})
