import { describe, expect, it } from 'vitest'
import { mapListing, mapSort } from './sort'

describe('mapSort', () => {
  describe('hot sort mappings', () => {
    it.each(['Hot', 'Active', 'Scaled'])('maps "%s" to hot', (input) => {
      expect(mapSort(input)).toEqual({ sort: 'hot' })
    })
  })

  describe('new sort mappings', () => {
    it('maps "New" to new', () => {
      expect(mapSort('New')).toEqual({ sort: 'new' })
    })

    it('maps "Old" to new (fallback)', () => {
      expect(mapSort('Old')).toEqual({ sort: 'new' })
    })
  })

  describe('top sort mappings', () => {
    it('maps "TopAll" to top with timeframe all', () => {
      expect(mapSort('TopAll')).toEqual({ sort: 'top', timeframe: 'all' })
    })

    it('maps "TopDay" to top with timeframe day', () => {
      expect(mapSort('TopDay')).toEqual({ sort: 'top', timeframe: 'day' })
    })

    it('maps "TopWeek" to top with timeframe week', () => {
      expect(mapSort('TopWeek')).toEqual({ sort: 'top', timeframe: 'week' })
    })

    it('maps "TopMonth" to top with timeframe month', () => {
      expect(mapSort('TopMonth')).toEqual({ sort: 'top', timeframe: 'month' })
    })

    it('maps "TopThreeMonths" to top with timeframe all', () => {
      expect(mapSort('TopThreeMonths')).toEqual({
        sort: 'top',
        timeframe: 'all',
      })
    })

    it('maps "TopSixMonths" to top with timeframe all', () => {
      expect(mapSort('TopSixMonths')).toEqual({
        sort: 'top',
        timeframe: 'all',
      })
    })

    it('maps "TopNineMonths" to top with timeframe all', () => {
      expect(mapSort('TopNineMonths')).toEqual({
        sort: 'top',
        timeframe: 'all',
      })
    })

    it.each(['TopHour', 'TopSixHour', 'TopTwelveHour'])(
      'maps "%s" to top with timeframe day',
      (input) => {
        expect(mapSort(input)).toEqual({ sort: 'top', timeframe: 'day' })
      },
    )
  })

  describe('fallback mappings', () => {
    it('maps "Controversial" to hot (fallback)', () => {
      expect(mapSort('Controversial')).toEqual({ sort: 'hot' })
    })

    it.each(['MostComments', 'NewComments'])(
      'maps "%s" to hot (fallback)',
      (input) => {
        expect(mapSort(input)).toEqual({ sort: 'hot' })
      },
    )
  })

  describe('default case', () => {
    it('maps unknown sort string to hot', () => {
      expect(mapSort('UnknownSort')).toEqual({ sort: 'hot' })
    })

    it('maps empty string to hot', () => {
      expect(mapSort('')).toEqual({ sort: 'hot' })
    })

    it('maps lowercase "hot" to hot (default, not case-matched)', () => {
      expect(mapSort('hot')).toEqual({ sort: 'hot' })
    })
  })
})

describe('mapListing', () => {
  describe('Subscribed listing', () => {
    it('returns "timeline" when authenticated', () => {
      expect(mapListing('Subscribed', true)).toBe('timeline')
    })

    it('returns "discover" when not authenticated', () => {
      expect(mapListing('Subscribed', false)).toBe('discover')
    })
  })

  describe('public listings', () => {
    it('maps "All" to discover', () => {
      expect(mapListing('All', true)).toBe('discover')
      expect(mapListing('All', false)).toBe('discover')
    })

    it('maps "Local" to discover', () => {
      expect(mapListing('Local', true)).toBe('discover')
      expect(mapListing('Local', false)).toBe('discover')
    })

    it('maps "ModeratorView" to discover', () => {
      expect(mapListing('ModeratorView', true)).toBe('discover')
      expect(mapListing('ModeratorView', false)).toBe('discover')
    })
  })

  describe('default case', () => {
    it('maps unknown listing string to discover', () => {
      expect(mapListing('UnknownListing', true)).toBe('discover')
      expect(mapListing('UnknownListing', false)).toBe('discover')
    })

    it('maps empty string to discover', () => {
      expect(mapListing('', true)).toBe('discover')
      expect(mapListing('', false)).toBe('discover')
    })
  })
})
