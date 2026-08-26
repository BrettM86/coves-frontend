import { describe, it, expect } from 'vitest'
import { findClosestNumber, moveItem, recursiveEqual } from './array'

describe('findClosestNumber', () => {
  it('rounds up to nearest value at or above target', () => {
    expect(findClosestNumber([8, 16, 32, 64, 128], 76)).toBe(128)
  })

  it('returns exact match when present', () => {
    expect(findClosestNumber([8, 16, 32, 64, 128], 64)).toBe(64)
  })

  it('returns smallest value above target', () => {
    expect(findClosestNumber([128, 256, 512, 1024], 200)).toBe(256)
  })
})

describe('moveItem', () => {
  it('moves an item forward and backward without mutating the input', () => {
    const source = ['a', 'b', 'c']
    expect(moveItem(source, 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveItem(source, 2, 0)).toEqual(['c', 'a', 'b'])
    expect(source).toEqual(['a', 'b', 'c'])
  })

  // auth.svelte.ts reorders the account list through this; an out-of-range
  // index must throw rather than silently corrupt the list.
  it.each([
    [-1, 0],
    [0, 3],
    [3, 0],
  ])('throws on an out-of-range index (%i -> %i)', (from, to) => {
    expect(() => moveItem(['a', 'b', 'c'], from, to)).toThrow('Invalid index')
  })
})

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
