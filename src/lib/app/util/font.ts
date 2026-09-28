export type FontSetting = 'inter' | 'system' | 'browser'

export function isFontSetting(value: unknown): value is FontSetting {
  return value === 'inter' || value === 'system' || value === 'browser'
}

/** The font a visitor gets until they pick one: `PUBLIC_FONT`, else Inter. */
export function defaultFont(configured: string | undefined): FontSetting {
  return configured === 'system' || configured === 'browser'
    ? configured
    : 'inter'
}

/** The class on `<html>` that selects a font setting's family. */
export function fontClass(
  font: FontSetting,
): 'font-inter' | 'font-system' | 'font-sans' {
  return font === 'inter'
    ? 'font-inter'
    : font === 'system'
      ? 'font-system'
      : 'font-sans'
}

export const FONT_CLASSES = ['font-inter', 'font-sans', 'font-system'] as const
