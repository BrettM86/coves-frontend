// @vitest-environment jsdom
/**
 * The seat confetti must stay bounded whatever rect it is given: a slot that
 * measures zero height (not laid out yet, or collapsed) still fires a small
 * burst rather than an unbounded one.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { fireSeatBurst } from './seat-burst'

afterEach(() => {
  for (const overlay of document.querySelectorAll('[data-seat-burst]')) {
    overlay.remove()
  }
})

describe('fireSeatBurst', () => {
  it('with a zero-height rect returns promptly and draws at most 100 particles', () => {
    // The burst is synchronous, so a timeout cannot stop a runaway loop;
    // the random source ends one instead, failing the test.
    let calls = 0
    const random = (): number => {
      calls++
      if (calls > 10_000) throw new Error('fireSeatBurst did not finish')
      return 0.5
    }

    const remove = fireSeatBurst(new DOMRect(0, 100, 300, 0), random)

    const overlay = document.querySelector('[data-seat-burst]')
    expect(overlay).not.toBeNull()
    expect(overlay!.children.length).toBeLessThanOrEqual(100)
    remove()
    expect(document.querySelector('[data-seat-burst]')).toBeNull()
  }, 2000)
})
