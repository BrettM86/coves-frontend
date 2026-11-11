/** The automatic offer stays off the sign-in, account and settings pages. */
import { describe, expect, it } from 'vitest'
import { shouldOfferOnPath } from './offer-route'

describe('shouldOfferOnPath', () => {
  it.each([
    ['/login', false],
    ['/accounts', false],
    ['/accounts/login', false],
    ['/profile/settings', false],
    ['/', true],
    ['/c/foo', true],
    ['/profile/alice', true],
  ])('%s → %s', (pathname, expected) => {
    expect(shouldOfferOnPath(pathname)).toBe(expected)
  })
})
