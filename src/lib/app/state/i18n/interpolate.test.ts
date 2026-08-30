/**
 * Pins the placeholder semantics of `@sveltekit-i18n/parser-default` 1.1.1,
 * the library `interpolate` replaces. 446 `$t(` call sites depend on these,
 * so every expectation below was captured by running the real parser rather
 * than read off its (minified) source.
 */
import { describe, expect, it } from 'vitest'
import { interpolate } from './interpolate'

describe('interpolate', () => {
  describe('{{name}} — plain substitution', () => {
    it('substitutes the param, stringified', () => {
      expect(interpolate('{{name}}', { name: 'Mari' }, 'en')).toBe('Mari')
      // Falsy values still render: `0` must not collapse to the empty string.
      expect(interpolate('{{name}}', { name: 0 }, 'en')).toBe('0')
    })

    it('renders an empty string when the param is missing', () => {
      expect(interpolate('{{name}}', {}, 'en')).toBe('')
      expect(interpolate('{{name}}', undefined, 'en')).toBe('')
      // Paired with surrounding text so this cannot pass by returning ''.
      expect(interpolate('Hi {{name}}!', {}, 'en')).toBe('Hi !')
    })
  })

  describe('{{x:number}} — locale-formatted number', () => {
    it('formats with Intl maximumFractionDigits 2, in the given locale', () => {
      expect(interpolate('{{votes:number}}', { votes: 1234.567 }, 'en')).toBe(
        '1,234.57',
      )
      expect(interpolate('{{votes:number}}', { votes: 1234.567 }, 'de')).toBe(
        '1.234,57',
      )
    })

    it('coerces a numeric string', () => {
      expect(interpolate('{{votes:number}}', { votes: '1234.567' }, 'en')).toBe(
        '1,234.57',
      )
    })

    it('renders a non-numeric value as zero, but a missing param as empty', () => {
      // Not symmetric, and deliberately so: the parser returns the default
      // ('') before the modifier ever runs when the param is absent, but
      // coerces a present-and-unparseable value through `+value || +default`.
      expect(interpolate('{{votes:number}}', { votes: 'abc' }, 'en')).toBe('0')
      expect(interpolate('{{votes:number}}', {}, 'en')).toBe('')
    })

    it('renders an empty string when the locale is empty', () => {
      // Intl cannot be constructed without a locale, so the modifier yields
      // nothing — but the literal text around it survives.
      expect(interpolate('{{votes:number}}', { votes: 1234.567 }, '')).toBe('')
      expect(interpolate('x {{votes:number}} y', { votes: 1234.567 }, '')).toBe(
        'x  y',
      )
    })
  })

  describe('{{count; 1:one; default:many;}} — variant by value', () => {
    // Every param name here is 3+ characters, matching the dictionaries. The
    // parser being replaced mis-handles shorter names (see the note in the
    // RED report); no dictionary uses one, so that quirk is not pinned.
    it('picks the variant whose key matches the param value', () => {
      const template = '{{users; 1:user; default:users;}}'
      expect(interpolate(template, { users: 1 }, 'en')).toBe('user')
      expect(interpolate(template, { users: 3 }, 'en')).toBe('users')
    })

    it('renders the declared default when the param is missing', () => {
      const template = '{{count; 1:one; default:many;}}'
      expect(interpolate(template, {}, 'en')).toBe('many')
      // Contrast: a matching value must still win over the default.
      expect(interpolate(template, { count: 1 }, 'en')).toBe('one')
    })

    it('renders an empty string when nothing matches and no default is declared', () => {
      expect(interpolate('{{users; 1:user;}}', { users: 2 }, 'en')).toBe('')
      expect(interpolate('a{{users; 1:user;}}b', { users: 2 }, 'en')).toBe('ab')
    })
  })

  describe('surrounding text and multiple placeholders', () => {
    it('preserves literal text and leaves placeholder-free templates alone', () => {
      expect(
        interpolate('Hello {{name}}, welcome', { name: 'Mari' }, 'en'),
      ).toBe('Hello Mari, welcome')
      expect(interpolate('no placeholders', { a: 1 }, 'en')).toBe(
        'no placeholders',
      )
    })

    it('resolves every placeholder in one template', () => {
      expect(
        interpolate('{{first}} {{second}}', { first: 'x', second: 'y' }, 'en'),
      ).toBe('x y')
    })

    it('resolves the real routes.frontpage.footer template', () => {
      // Verbatim from en.json — the one string in the dictionaries that uses a
      // number modifier and a variant list on the same param.
      const footer = '{{users:number}} active {{users; 1:user; default:users;}}'
      expect(interpolate(footer, { users: 1 }, 'en')).toBe('1 active user')
      expect(interpolate(footer, { users: 1234.567 }, 'en')).toBe(
        '1,234.57 active users',
      )
      expect(interpolate(footer, { users: 1234.567 }, 'de')).toBe(
        '1.234,57 active users',
      )
    })
  })
})
