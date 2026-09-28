import { describe, expect, it } from 'vitest'
import { LruCache } from './lru'

describe('LruCache', () => {
  it('returns what was stored', () => {
    const cache = new LruCache<string, number>(2)
    cache.set('a', 1)
    expect(cache.get('a')).toBe(1)
    expect(cache.get('missing')).toBeUndefined()
  })

  it('evicts the least recently used entry once over capacity', () => {
    const cache = new LruCache<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.get('a') // `b` is now the least recently used
    cache.set('c', 3)

    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(1)
    expect(cache.get('c')).toBe(3)
    expect(cache.size).toBe(2)
  })

  it('replaces a value without growing', () => {
    const cache = new LruCache<string, number>(2)
    cache.set('a', 1)
    cache.set('a', 2)
    expect(cache.get('a')).toBe(2)
    expect(cache.size).toBe(1)
  })

  it('rejects a capacity it could not honour', () => {
    // NaN never compares greater, so it would never evict; zero or less would
    // evict everything it was handed.
    for (const capacity of [Number.NaN, 0, -1, 1.5, Infinity]) {
      expect(() => new LruCache<string, number>(capacity)).toThrow(RangeError)
    }
    expect(new LruCache<string, number>(1).size).toBe(0)
  })

  it('keeps undefined out of its values, where it would read as a miss', () => {
    // @ts-expect-error -- `get` returns undefined for a miss
    expect(new LruCache<string, undefined>(1).size).toBe(0)
  })
})
