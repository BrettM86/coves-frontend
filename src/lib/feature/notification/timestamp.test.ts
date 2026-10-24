import { describe, expect, it } from 'vitest'
import {
  compareNotificationTimestamps,
  laterPageIsRead,
  pageOneWatermark,
  usableDate,
} from './timestamp'

function thrownBy(call: () => unknown): unknown {
  try {
    call()
  } catch (error) {
    return error
  }
  return undefined
}

describe('compareNotificationTimestamps', () => {
  it.each([
    ['2026-10-12T10:00:00.123456789Z', '2026-10-12T10:00:00.123456788Z'],
    ['2026-10-13T00:00:00.000000001Z', '2026-10-12T23:59:59.999999999Z'],
  ])(
    'B1 returns 1 when %s is a later instant than %s at nanosecond precision',
    (a, b) => {
      expect(compareNotificationTimestamps(a, b)).toBe(1)
    },
  )

  it.each([
    ['2026-10-12T10:00:00Z', '2026-10-12T10:00:00.000000001Z'],
    ['2026-10-12T23:59:59.999999999Z', '2026-10-13T00:00:00.000000001Z'],
  ])(
    'B1 returns -1 when %s is an earlier instant than %s at nanosecond precision',
    (a, b) => {
      expect(compareNotificationTimestamps(a, b)).toBe(-1)
    },
  )

  it.each([
    ['2026-10-12T10:00:00.5Z', '2026-10-12T12:00:00.500+02:00'],
    ['2026-10-12T10:00:00.1Z', '2026-10-12T10:00:00.100000000Z'],
  ])('B2 returns 0 when %s and %s are the same instant', (a, b) => {
    expect(compareNotificationTimestamps(a, b)).toBe(0)
  })

  it.each([
    ['not-a-time', '2026-10-12T10:00:00Z', 'not-a-time'],
    ['2026-10-12T10:00:00Z', 'not-a-time', 'not-a-time'],
    ['2026-13-01T00:00:00Z', '2026-10-12T10:00:00Z', '2026-13-01T00:00:00Z'],
  ])(
    'B3 throws an error without the input in its message for (%s, %s)',
    (a, b, unparseable) => {
      const error = thrownBy(() => compareNotificationTimestamps(a, b))
      expect(error).toBeInstanceOf(Error)
      expect(error instanceof Error ? error.message : '').not.toContain(
        unparseable,
      )
    },
  )
})

describe('pageOneWatermark', () => {
  it.each([
    [
      [
        '2026-10-12T10:00:00.123456788Z',
        '2026-10-12T10:00:00.123456789Z',
        '2026-10-12T09:59:59.999Z',
      ],
    ],
    [
      [
        '2026-10-12T09:59:59.999Z',
        '2026-10-12T10:00:00.123456789Z',
        '2026-10-12T10:00:00.123456788Z',
      ],
    ],
  ])(
    'B4 returns the largest sortAt exactly as received when the runner-up shares its millisecond (%j)',
    (sortAts) => {
      const rows = sortAts.map((sortAt) => ({ sortAt }))
      expect(pageOneWatermark(rows)).toBe('2026-10-12T10:00:00.123456789Z')
    },
  )

  it.each([
    [['not-a-time', '2026-10-12T11:00:00Z', '2026-10-12T10:00:00Z']],
    [['2026-10-12T10:00:00Z', '2026-10-12T11:00:00Z', 'not-a-time']],
  ])(
    'B5 skips an unparseable sortAt and returns the largest parseable one (%j)',
    (sortAts) => {
      const rows = sortAts.map((sortAt) => ({ sortAt }))
      expect(pageOneWatermark(rows)).toBe('2026-10-12T11:00:00Z')
    },
  )

  it.each([[['not-a-time']], [['not-a-time', '', 'yesterday']], [[]]])(
    'B6 returns undefined without throwing when no sortAt parses (%j)',
    (sortAts) => {
      const rows = sortAts.map((sortAt) => ({ sortAt }))
      expect(pageOneWatermark(rows)).toBeUndefined()
    },
  )
})

describe('laterPageIsRead', () => {
  it.each([
    ['2026-10-12T10:00:00.123456788Z', '2026-10-12T10:00:00.123456789Z'],
    ['2026-10-12T10:00:00.100000000Z', '2026-10-12T10:00:00.1Z'],
    ['2026-10-12T12:00:00.123456789+02:00', '2026-10-12T10:00:00.123456789Z'],
  ])(
    'B7 is true when sortAt %s is at or before seenAt %s, even with server isRead false',
    (sortAt, seenAt) => {
      expect(laterPageIsRead({ sortAt, isRead: false }, seenAt)).toBe(true)
    },
  )

  it('B8 is false when sortAt is after seenAt, even with server isRead true', () => {
    expect(
      laterPageIsRead(
        { sortAt: '2026-10-12T10:00:00.123456789Z', isRead: true },
        '2026-10-12T10:00:00.123456788Z',
      ),
    ).toBe(false)
  })

  it.each(['2026-10-12T10:00:00.123456789Z', 'not-a-time'])(
    'B9 is true for sortAt %s with server isRead false when page one had no seenAt',
    (sortAt) => {
      expect(laterPageIsRead({ sortAt, isRead: false }, undefined)).toBe(true)
    },
  )

  it.each([
    ['not-a-time', '2026-10-12T10:00:00Z'],
    ['2026-10-12T11:00:00Z', 'not-a-time'],
  ])(
    'B10 keeps server isRead true when the comparison throws (sortAt %s, seenAt %s)',
    (sortAt, seenAt) => {
      expect(laterPageIsRead({ sortAt, isRead: true }, seenAt)).toBe(true)
    },
  )

  it.each([
    ['not-a-time', '2026-10-12T11:00:00Z'],
    ['2026-10-12T10:00:00Z', 'not-a-time'],
  ])(
    'B10 keeps server isRead false when the comparison throws (sortAt %s, seenAt %s)',
    (sortAt, seenAt) => {
      expect(laterPageIsRead({ sortAt, isRead: false }, seenAt)).toBe(false)
    },
  )
})

describe('usableDate', () => {
  it.each([
    ['2026-10-12T09:00:00+00:00', Date.UTC(2026, 9, 12, 9, 0, 0, 0)],
    ['2026-10-12T11:00:00+02:00', Date.UTC(2026, 9, 12, 9, 0, 0, 0)],
    ['2026-10-12T04:30:00.250-04:30', Date.UTC(2026, 9, 12, 9, 0, 0, 250)],
  ])(
    'B11 returns the right instant for offset timestamp %s',
    (value, epoch) => {
      expect(usableDate(value)?.getTime()).toBe(epoch)
    },
  )

  it.each([
    ['2026-10-12T09:00:00.123456789Z', Date.UTC(2026, 9, 12, 9, 0, 0, 123)],
    ['2026-10-12T09:00:00.5Z', Date.UTC(2026, 9, 12, 9, 0, 0, 500)],
    ['2026-10-12T09:00:00Z', Date.UTC(2026, 9, 12, 9, 0, 0, 0)],
  ])('B12 returns %s truncated to millisecond precision', (value, epoch) => {
    expect(usableDate(value)?.getTime()).toBe(epoch)
  })

  it.each([
    ['1'],
    ['2026'],
    ['2026-10-12'],
    ['Oct 12 2026'],
    ['garbage'],
    [''],
    [1760259600000],
    [undefined],
    [null],
    [new Date(Date.UTC(2026, 9, 12, 9, 0, 0))],
  ])(
    'B13 returns undefined for a value that is not strict RFC 3339 (%j)',
    (value) => {
      expect(usableDate(value)).toBeUndefined()
    },
  )
})
