import { describe, expect, it, vi } from 'vitest'
import {
  isValidTimeframe,
  mapListing,
  mapSort,
  normalizeCommentSort,
  normalizeListing,
  normalizeSort,
  normalizeTimeframe,
  resolveFeedSort,
  TIMEFRAME_OPTIONS,
  toLemmyCommentSort,
} from './sort'

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
    it('maps "top" with timeframe "hour"', () => {
      expect(mapSort('top', 'hour')).toEqual({ sort: 'top', timeframe: 'hour' })
    })

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

    it('maps "top" with timeframe "year"', () => {
      expect(mapSort('top', 'year')).toEqual({ sort: 'top', timeframe: 'year' })
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

describe('resolveFeedSort', () => {
  const feedUrl = (query = ''): URL => new URL(`https://coves.test/${query}`)
  const defaults = { sort: 'top', timeframe: 'week' }

  describe('URL params win', () => {
    it('uses the URL sort and timeframe over the saved defaults', () => {
      expect(
        resolveFeedSort(feedUrl('?sort=top&timeframe=day'), defaults),
      ).toEqual({ sort: 'top', timeframe: 'day' })
    })

    it('uses the URL timeframe even when the sort came from settings', () => {
      expect(resolveFeedSort(feedUrl('?timeframe=month'), defaults)).toEqual({
        sort: 'top',
        timeframe: 'month',
      })
    })

    it('does not inherit the saved timeframe for an explicit URL sort', () => {
      // A shared link means the same thing to everyone who opens it.
      expect(resolveFeedSort(feedUrl('?sort=top'), defaults)).toEqual({
        sort: 'top',
        timeframe: 'all',
      })
    })
  })

  describe('settings defaults', () => {
    it('applies the saved timeframe when the sort also came from settings', () => {
      expect(resolveFeedSort(feedUrl(), defaults)).toEqual({
        sort: 'top',
        timeframe: 'week',
      })
    })

    it('ignores the saved timeframe for non-top saved sorts', () => {
      const result = resolveFeedSort(feedUrl(), {
        sort: 'hot',
        timeframe: 'week',
      })
      expect(result).toEqual({ sort: 'hot' })
      expect(result).not.toHaveProperty('timeframe')
    })

    it('falls back to "all" for an invalid saved timeframe', () => {
      expect(
        resolveFeedSort(feedUrl(), { sort: 'top', timeframe: 'TopWeek' }),
      ).toEqual({ sort: 'top', timeframe: 'all' })
    })
  })

  describe('legacy URL sorts', () => {
    it('salvages a Lemmy-era bookmark to the nearest Coves sort', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      expect(resolveFeedSort(feedUrl('?sort=TopWeek'), defaults)).toEqual({
        sort: 'top',
        timeframe: 'all',
      })
      expect(resolveFeedSort(feedUrl('?sort=Hot'), defaults)).toEqual({
        sort: 'hot',
      })
      expect(warn).toHaveBeenCalled()

      warn.mockRestore()
    })

    it('falls back to "hot" for sorts with no Coves equivalent', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      expect(resolveFeedSort(feedUrl('?sort=Controversial'), defaults)).toEqual(
        { sort: 'hot' },
      )

      warn.mockRestore()
    })

    it('treats an empty ?sort= as an explicit sort, not a missing one', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Present-but-empty means the saved 'top'/'week' pair is not inherited.
      expect(resolveFeedSort(feedUrl('?sort='), defaults)).toEqual({
        sort: 'hot',
      })

      warn.mockRestore()
    })
  })

  it('keeps other query params out of the result', () => {
    expect(
      resolveFeedSort(feedUrl('?cursor=abc&type=timeline'), defaults),
    ).toEqual({ sort: 'top', timeframe: 'week' })
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

describe('normalizeCommentSort', () => {
  it('passes through valid lowercase values', () => {
    expect(normalizeCommentSort('hot')).toBe('hot')
    expect(normalizeCommentSort('top')).toBe('top')
    expect(normalizeCommentSort('new')).toBe('new')
  })

  it('migrates legacy capitalized values', () => {
    expect(normalizeCommentSort('Hot')).toBe('hot')
    expect(normalizeCommentSort('Top')).toBe('top')
    expect(normalizeCommentSort('New')).toBe('new')
  })

  it('migrates legacy TopAll-style values to "top"', () => {
    expect(normalizeCommentSort('TopAll')).toBe('top')
    expect(normalizeCommentSort('TopWeek')).toBe('top')
  })

  it('falls back to "hot" for unsupported legacy values', () => {
    expect(normalizeCommentSort('Old')).toBe('hot')
    expect(normalizeCommentSort('Controversial')).toBe('hot')
    expect(normalizeCommentSort('')).toBe('hot')
  })
})

describe('normalizeListing', () => {
  it('passes through valid listing types regardless of auth state', () => {
    expect(normalizeListing('discover')).toBe('discover')
    expect(normalizeListing('timeline')).toBe('timeline')
  })

  it('migrates legacy Lemmy listing types persisted by the old selector', () => {
    expect(normalizeListing('All')).toBe('discover')
    expect(normalizeListing('Local')).toBe('discover')
    expect(normalizeListing('ModeratorView')).toBe('discover')
  })

  it('maps the legacy subscribed feed to the timeline', () => {
    expect(normalizeListing('Subscribed')).toBe('timeline')
    expect(normalizeListing('subscribed')).toBe('timeline')
  })

  it('coerces non-string values instead of throwing', () => {
    expect(normalizeListing(undefined)).toBe('discover')
    expect(normalizeListing(null)).toBe('discover')
    expect(normalizeListing(42)).toBe('discover')
    expect(normalizeListing({ sort: 'timeline' })).toBe('discover')
  })

  it('accepts capitalized Coves values', () => {
    expect(normalizeListing('Timeline')).toBe('timeline')
  })

  it('falls back to "discover" for unrecognized values', () => {
    expect(normalizeListing('bogus')).toBe('discover')
    expect(normalizeListing('')).toBe('discover')
  })
})

describe('normalizeSort', () => {
  it('passes through valid lowercase values', () => {
    expect(normalizeSort('hot')).toBe('hot')
    expect(normalizeSort('top')).toBe('top')
    expect(normalizeSort('new')).toBe('new')
  })

  it('migrates legacy capitalized feed sorts persisted by the old selector', () => {
    expect(normalizeSort('New')).toBe('new')
    expect(normalizeSort('TopWeek')).toBe('top')
  })

  it('falls back to "hot" for sorts the Coves API does not support', () => {
    expect(normalizeSort('Active')).toBe('hot')
    expect(normalizeSort('MostComments')).toBe('hot')
    expect(normalizeSort('')).toBe('hot')
  })

  it('coerces non-string values instead of throwing', () => {
    // Corrupted localStorage and hand-edited imports reach these during boot.
    expect(normalizeSort(undefined)).toBe('hot')
    expect(normalizeSort(null)).toBe('hot')
    expect(normalizeSort(42)).toBe('hot')
    expect(normalizeSort(['top'])).toBe('hot')
  })
})

describe('normalizeTimeframe', () => {
  it('passes through valid timeframes', () => {
    expect(normalizeTimeframe('hour')).toBe('hour')
    expect(normalizeTimeframe('year')).toBe('year')
    expect(normalizeTimeframe('week')).toBe('week')
  })

  it('falls back to "all" for unsupported values', () => {
    expect(normalizeTimeframe('9months')).toBe('all')
    expect(normalizeTimeframe('')).toBe('all')
  })

  it('coerces non-string values instead of throwing', () => {
    expect(normalizeTimeframe(undefined)).toBe('all')
    expect(normalizeTimeframe(null)).toBe('all')
    expect(normalizeTimeframe(7)).toBe('all')
  })
})

describe('TIMEFRAME_OPTIONS', () => {
  it('is the single source of truth for timeframe validation', () => {
    for (const option of TIMEFRAME_OPTIONS) {
      expect(isValidTimeframe(option.value)).toBe(true)
      expect(normalizeTimeframe(option.value)).toBe(option.value)
    }
  })

  it('gives every timeframe a label key', () => {
    for (const option of TIMEFRAME_OPTIONS) {
      expect(option.labelKey).toMatch(/^filter\.sort\.top\.time\./)
    }
  })
})

describe('toLemmyCommentSort', () => {
  it('maps Coves values to capitalized Lemmy values', () => {
    expect(toLemmyCommentSort('hot')).toBe('Hot')
    expect(toLemmyCommentSort('top')).toBe('Top')
    expect(toLemmyCommentSort('new')).toBe('New')
  })

  it('handles already-capitalized legacy values', () => {
    expect(toLemmyCommentSort('Hot')).toBe('Hot')
    expect(toLemmyCommentSort('TopAll')).toBe('Top')
  })

  it('falls back to "Hot" for unknown values', () => {
    expect(toLemmyCommentSort('bogus')).toBe('Hot')
  })
})
