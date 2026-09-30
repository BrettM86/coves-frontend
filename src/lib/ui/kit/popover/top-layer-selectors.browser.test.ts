// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

// @floating-ui/utils isTopLayer probes every positioned element with these two
// selectors. The result is false either way in jsdom, so the regression is only
// visible as nwsapi re-entering Element.prototype.matches through its native
// fallback until the stack overflows.

const originalMatches = Element.prototype.matches

function countNestedMatches(
  element: Element,
  selector: string,
): { matched: boolean; nestedCalls: number } {
  let calls = 0
  Element.prototype.matches = function (this: Element, selectors: string) {
    calls += 1
    return originalMatches.call(this, selectors)
  }
  try {
    const matched = element.matches(selector)
    // The first counted call is the outer probe itself.
    return { matched, nestedCalls: calls - 1 }
  } finally {
    Element.prototype.matches = originalMatches
  }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('top-layer selector probes in jsdom', () => {
  it('answers :modal on a plain element without re-entering matches', () => {
    const plain = document.createElement('div')
    document.body.append(plain)

    const { matched, nestedCalls } = countNestedMatches(plain, ':modal')

    expect(matched).toBe(false)
    expect(nestedCalls).toBeLessThan(10)
  }, 10_000)

  it('answers :popover-open on a popover element without re-entering matches', () => {
    const popover = document.createElement('div')
    popover.setAttribute('popover', '')
    document.body.append(popover)

    const { matched, nestedCalls } = countNestedMatches(
      popover,
      ':popover-open',
    )

    expect(matched).toBe(false)
    expect(nestedCalls).toBeLessThan(10)
  }, 10_000)
})
