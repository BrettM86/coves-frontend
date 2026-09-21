import { describe, expect, it } from 'vitest'
import { formatBlueskyTime, formatBlueskyTimestamp } from './bluesky-time'
import {
  mockDefaultTimezone,
  NativeDateTimeFormat,
} from './bluesky-time.fixture'

const now = Date.parse('2026-09-20T12:00:00.000Z')
const day = 86_400

function timestampSecondsAgo(seconds: number): string {
  return new Date(now - seconds * 1000).toISOString()
}

describe('formatBlueskyTime', () => {
  it.each([-day, -1, 0, 1, 4, 4.999])(
    'formats age %s seconds as now',
    (seconds) => {
      expect(
        formatBlueskyTime(timestampSecondsAgo(seconds), now, 'en-US'),
      ).toBe('now')
    },
  )

  it.each([
    [5, '5s'],
    [5.999, '5s'],
    [59, '59s'],
    [59.999, '59s'],
    [60, '1m'],
    [119.999, '1m'],
    [59 * 60, '59m'],
    [3599.999, '59m'],
    [3600, '1h'],
    [7199.999, '1h'],
    [23 * 3600, '23h'],
    [day - 0.001, '23h'],
    [day, '1d'],
    [2 * day - 0.001, '1d'],
    [29 * day, '29d'],
    [30 * day - 0.001, '29d'],
    [30 * day, '1mo'],
    [60 * day - 0.001, '1mo'],
    [330 * day, '11mo'],
    [360 * day - 0.001, '11mo'],
  ])('formats age %s seconds as %s', (seconds, expected) => {
    expect(formatBlueskyTime(timestampSecondsAgo(seconds), now, 'en-US')).toBe(
      expected,
    )
  })

  describe.each([
    'en-US',
    'en-GB',
    'de-DE',
    'ja-JP',
    'ar-EG',
    'th-TH-u-ca-buddhist',
  ])('calendar dates in %s', (language) => {
    it.each([360 * day, 360 * day + 1, 365 * day, 730 * day])(
      'uses the locale calendar format at age %s seconds',
      (seconds) => {
        const value = timestampSecondsAgo(seconds)
        expect(formatBlueskyTime(value, now, language)).toBe(
          new Intl.DateTimeFormat(language).format(new Date(value)),
        )
      },
    )
  })
})

describe.each(['America/Los_Angeles', 'Asia/Tokyo'])(
  'formatBlueskyTimestamp with default timezone %s',
  (timeZone) => {
    it.each(['2026-09-20T00:05:00Z', '2026-09-20T23:55:00Z'])(
      'uses UTC for both SSR and initial hydration at %s',
      (value) => {
        mockDefaultTimezone(timeZone)
        for (const language of ['en-US', 'en-GB', 'ja-JP']) {
          expect(formatBlueskyTimestamp(value, null, language)).toEqual({
            text: new NativeDateTimeFormat(language, {
              timeZone: 'UTC',
            }).format(new Date(value)),
            label: new NativeDateTimeFormat(language, {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'UTC',
            }).format(new Date(value)),
          })
        }
      },
    )

    it('uses the browser-local full label after mount, including a different calendar day', () => {
      mockDefaultTimezone(timeZone)
      const value =
        timeZone === 'Asia/Tokyo'
          ? '2026-09-20T23:55:00Z'
          : '2026-09-20T00:05:00Z'
      const mountedNow = Date.parse(value) + 60_000
      expect(formatBlueskyTimestamp(value, mountedNow, 'en-US')).toEqual({
        text: '1m',
        label: new NativeDateTimeFormat('en-US', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone,
        }).format(new Date(value)),
      })
    })

    it.each([
      -1,
      0,
      4.999,
      5,
      59.999,
      60,
      3599.999,
      3600,
      day - 0.001,
      day,
      30 * day - 0.001,
      30 * day,
      360 * day - 0.001,
      360 * day,
    ])(
      'preserves the existing mounted text threshold at age %s seconds',
      (seconds) => {
        mockDefaultTimezone(timeZone)
        const value = timestampSecondsAgo(seconds)
        expect(formatBlueskyTimestamp(value, now, 'en-US').text).toBe(
          formatBlueskyTime(value, now, 'en-US'),
        )
      },
    )
  },
)
