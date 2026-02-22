import { describe, expect, it } from 'vitest'
import { mapListing, mapSort } from './sort'

describe('mapSort', () => {
  describe('valid sort values', () => {
    it('maps "hot" to { sort: "hot" }', () => {
      expect(mapSort('hot')).toEqual({ sort: 'hot' })
    })

    it('maps "new" to { sort: "new" }', () => {
      expect(mapSort('new')).toEqual({ sort: 'new' })
    })

    it('maps "top" to { sort: "top", timeframe: "all" } (default timeframe)', () => {
      expect(mapSort('top')).toEqual({ sort: 'top', timeframe: 'all' })
    })
  })

  describe('top sort with timeframes', () => {
    it('maps "top" with timeframe "day"', () => {
      expect(mapSort('top', 'day')).toEqual({ sort: 'top', timeframe: 'day' })
    })

    it('maps "top" with timeframe "week"', () => {
      expect(mapSort('top', 'week')).toEqual({ sort: 'top', timeframe: 'week' })
    })

    it('maps "top" with timeframe "month"', () => {
      expect(mapSort('top', 'month')).toEqual({
        sort: 'top',
        timeframe: 'month',
      })
    })

    it('maps "top" with timeframe "all"', () => {
      expect(mapSort('top', 'all')).toEqual({ sort: 'top', timeframe: 'all' })
    })

    it('falls back to timeframe "all" for invalid timeframe', () => {
      expect(mapSort('top', 'invalid')).toEqual({
        sort: 'top',
        timeframe: 'all',
      })
    })
  })

  describe('non-top sorts exclude timeframe property', () => {
    it('mapSort("hot", "day") returns { sort: "hot" } without timeframe', () => {
      const result = mapSort('hot', 'day')
      expect(result).toEqual({ sort: 'hot' })
      expect(result).not.toHaveProperty('timeframe')
    })

    it('mapSort("new", "week") returns { sort: "new" } without timeframe', () => {
      const result = mapSort('new', 'week')
      expect(result).toEqual({ sort: 'new' })
      expect(result).not.toHaveProperty('timeframe')
    })
  })

  describe('top sort with empty string timeframe', () => {
    it('mapSort("top", "") falls back to timeframe "all"', () => {
      expect(mapSort('top', '')).toEqual({ sort: 'top', timeframe: 'all' })
    })
  })

  describe('fallback for invalid sort values', () => {
    it('maps "invalid" to { sort: "hot" }', () => {
      expect(mapSort('invalid')).toEqual({ sort: 'hot' })
    })

    it('maps empty string to { sort: "hot" }', () => {
      expect(mapSort('')).toEqual({ sort: 'hot' })
    })
  })
})

describe('mapListing', () => {
  describe('discover listing', () => {
    it('returns "discover" when authenticated', () => {
      expect(mapListing('discover', true)).toBe('discover')
    })

    it('returns "discover" when not authenticated', () => {
      expect(mapListing('discover', false)).toBe('discover')
    })
  })

  describe('timeline listing', () => {
    it('returns "timeline" when authenticated', () => {
      expect(mapListing('timeline', true)).toBe('timeline')
    })

    it('returns "discover" when not authenticated (timeline requires auth)', () => {
      expect(mapListing('timeline', false)).toBe('discover')
    })
  })

  describe('fallback for invalid listing values', () => {
    it('maps "invalid" to "discover" when authenticated', () => {
      expect(mapListing('invalid', true)).toBe('discover')
    })

    it('maps "invalid" to "discover" when not authenticated', () => {
      expect(mapListing('invalid', false)).toBe('discover')
    })

    it('maps empty string to "discover" when authenticated', () => {
      expect(mapListing('', true)).toBe('discover')
    })

    it('maps empty string to "discover" when not authenticated', () => {
      expect(mapListing('', false)).toBe('discover')
    })
  })
})
