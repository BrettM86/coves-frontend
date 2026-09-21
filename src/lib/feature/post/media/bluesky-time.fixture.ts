import { vi } from 'vitest'

export const NativeDateTimeFormat = Intl.DateTimeFormat

// Simulate the host's default timezone without changing process-global TZ.
// Explicit timeZone options still take precedence and formatting uses real ICU.
export function mockDefaultTimezone(timeZone: string): void {
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ) {
    return new NativeDateTimeFormat(locales, {
      ...options,
      timeZone: options?.timeZone ?? timeZone,
    })
  })
}
