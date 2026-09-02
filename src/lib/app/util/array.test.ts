import { describe, it, expect } from 'vitest'
import { recursiveEqual } from './array'

// recursiveEqual gates the feed cache in feature/feeds/feed.svelte.ts.
describe('recursiveEqual', () => {
  it('compares nested objects structurally', () => {
    expect(recursiveEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true)
    expect(recursiveEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false)
  })

  it('treats a differing key count as unequal', () => {
    expect(recursiveEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })

  it('handles null leaves without recursing into them', () => {
    expect(recursiveEqual({ a: null }, { a: null })).toBe(true)
    expect(recursiveEqual({ a: null }, { a: {} })).toBe(false)
  })

  it('compares primitives and identical references directly', () => {
    expect(recursiveEqual(1, 1)).toBe(true)
    expect(recursiveEqual('a', 'b')).toBe(false)
    const same = { x: 1 }
    expect(recursiveEqual(same, same)).toBe(true)
  })

  // Documents the loose leaf comparison. If this ever needs to be strict,
  // Feed.load's cache-invalidation check is the caller to re-verify.
  it('does not distinguish a numeric leaf from its string form', () => {
    expect(
      recursiveEqual({ limit: 20 }, { limit: '20' as unknown as number }),
    ).toBe(true)
  })
})
