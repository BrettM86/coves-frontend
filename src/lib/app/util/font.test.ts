import { describe, expect, it } from 'vitest'
import { defaultFont, FONT_CLASSES, fontClass, isFontSetting } from './font'

describe('defaultFont', () => {
  it('falls back to Inter when unset or unrecognised', () => {
    expect(defaultFont(undefined)).toBe('inter')
    expect(defaultFont('')).toBe('inter')
    expect(defaultFont('comic-sans')).toBe('inter')
  })

  it('honours the other configured choices', () => {
    expect(defaultFont('system')).toBe('system')
    expect(defaultFont('browser')).toBe('browser')
    expect(defaultFont('inter')).toBe('inter')
  })
})

describe('isFontSetting', () => {
  it('accepts every setting and nothing else', () => {
    expect(isFontSetting('inter')).toBe(true)
    expect(isFontSetting('system')).toBe(true)
    expect(isFontSetting('browser')).toBe(true)
    expect(isFontSetting('comic-sans')).toBe(false)
    expect(isFontSetting(undefined)).toBe(false)
    expect(isFontSetting(1)).toBe(false)
  })
})

describe('fontClass', () => {
  it('maps every setting to one of the classes the layout swaps between', () => {
    expect(fontClass('inter')).toBe('font-inter')
    expect(fontClass('system')).toBe('font-system')
    expect(fontClass('browser')).toBe('font-sans')
    for (const font of ['inter', 'system', 'browser'] as const) {
      expect(FONT_CLASSES).toContain(fontClass(font))
    }
  })
})
