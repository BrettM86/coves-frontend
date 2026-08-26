import { describe, expect, it } from 'vitest'
import { formatRelativeDate } from './RelativeDate.svelte'

const NOW = new Date('2026-01-01T12:00:00Z')
const at = (iso: string) => new Date(iso)
const opts: Intl.RelativeTimeFormatOptions = {
  numeric: 'always',
  style: 'long',
}

describe('formatRelativeDate', () => {
  it('renders a past date as elapsed time', () => {
    expect(
      formatRelativeDate(at('2026-01-01T09:00:00Z'), opts, 'en', NOW),
    ).toBe('3 hours ago')
  })

  it('renders a future date as time remaining, not "Now"', () => {
    // Regression guard: before the layering refactor this returned "Now".
    expect(
      formatRelativeDate(at('2026-01-01T15:00:00Z'), opts, 'en', NOW),
    ).toBe('in 3 hours')
  })

  it('treats a future date within clock-skew tolerance as "Now"', () => {
    // A server clock a few seconds ahead of the client is ordinary skew.
    const skewed = new Date(NOW.getTime() + 15_000)
    expect(formatRelativeDate(skewed, opts, 'en', NOW)).toBe('Now')
  })

  it('returns "Now" inside the sub-second window', () => {
    expect(
      formatRelativeDate(new Date(NOW.getTime() - 500), opts, 'en', NOW),
    ).toBe('Now')
  })

  it('formats in the given locale and falls back to English', () => {
    const date = at('2026-01-01T09:00:00Z')
    expect(formatRelativeDate(date, opts, 'fr', NOW)).toBe('il y a 3 heures')
    expect(formatRelativeDate(date, opts, undefined, NOW)).toBe('3 hours ago')
  })

  it('renders an absolute date/time when absolute is set', () => {
    const out = formatRelativeDate(
      at('2026-01-01T09:00:00Z'),
      opts,
      'en',
      NOW,
      true,
    )
    expect(out).not.toContain('ago')
    expect(out).toMatch(/2026|26/)
  })

  it('returns "Invalid Date" rather than throwing', () => {
    expect(formatRelativeDate(new Date('nope'), opts, 'en', NOW)).toBe(
      'Invalid Date',
    )
  })
})
