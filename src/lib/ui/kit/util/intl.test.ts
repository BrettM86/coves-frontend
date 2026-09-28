import { describe, expect, it } from 'vitest'
import { numberFormat, relativeTimeFormat } from './intl'

describe('shared Intl formatters', () => {
  it('hands back one formatter per locale and options', () => {
    expect(numberFormat('en', { notation: 'compact' })).toBe(
      numberFormat('en', { notation: 'compact' }),
    )
    expect(relativeTimeFormat('de', { numeric: 'auto' })).toBe(
      relativeTimeFormat('de', { numeric: 'auto' }),
    )
  })

  it('treats the same options in a different order as the same', () => {
    expect(
      numberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }),
    ).toBe(
      numberFormat('en', { maximumFractionDigits: 1, notation: 'compact' }),
    )
  })

  it('keeps different locales, options and kinds apart', () => {
    expect(numberFormat('en')).not.toBe(numberFormat('fr'))
    expect(numberFormat('en', { notation: 'compact' })).not.toBe(
      numberFormat('en'),
    )
    expect(numberFormat('en', { notation: 'compact' }).format(1500)).toBe(
      '1.5K',
    )
    expect(relativeTimeFormat('en').format(-2, 'day')).toBe('2 days ago')
  })

  it('throws on a locale Intl rejects, and caches nothing for it', () => {
    expect(() => numberFormat('not a locale!')).toThrow(RangeError)
    expect(() => numberFormat('not a locale!')).toThrow(RangeError)
  })
})
