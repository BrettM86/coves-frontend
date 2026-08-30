/**
 * The placeholder forms that appear in the REAL dictionaries but are not
 * covered by `interpolate.test.ts`.
 *
 * Every template below is copied verbatim from a json file in this directory
 * (the source file:key is named above each one), and every expectation was
 * captured by running `@sveltekit-i18n/parser-default` 1.1.1 — the library
 * being replaced — not derived from reading its source.
 *
 * This is a behaviour-preserving migration across 446 call sites, so these
 * pin what the old library DOES — with one agreed exception. `undefined:` was
 * unreachable in parser-default and is now honoured, because the old result
 * was a dangling half-sentence in 10 locales. Both affected expectations are
 * marked DELIBERATE DIVERGENCE inline.
 */
import { describe, expect, it } from 'vitest'
import { interpolate } from './interpolate'

// fr.json:routes.frontpage.endFeed — the well-formed representative of the
// `undefined:`-plus-nested-`default:` shape used by 10 dictionaries.
const FR_END_FEED =
  'Vous avez atteint la fin de {{community_name; undefined:the feed.; default:{{community_name}}.}}'

// fi.json:routes.frontpage.endFeed — same shape, but the nested placeholder
// sits inside longer default text rather than being the whole default.
const FI_END_FEED =
  'Olet saavuttanut {{community_name; undefined:syötteen lopun.; default:yhteisön {{community_name}} lopun.}}'

// ru.json:routes.frontpage.endFeed — missing its closing `}}`. Three
// dictionaries ship a template like this; see the RED report.
const RU_END_FEED_MALFORMED =
  'Вы достигли конца {{community_name; undefined:ленты.; default:{{community_name}}.'

describe('interpolate — forms present in the real dictionaries', () => {
  describe('`undefined:` as a variant option key', () => {
    it('resolves the nested default when the param is present', () => {
      expect(interpolate(FR_END_FEED, { community_name: 'cats' }, 'en')).toBe(
        'Vous avez atteint la fin de cats.',
      )
    })

    it('takes the undefined: branch when the param is missing', () => {
      // DELIBERATE DIVERGENCE from parser-default 1.1.1, which returned the
      // `default:` branch here ("...la fin de ") because it tested for
      // undefined before ever reading the option list — making `undefined:`
      // unreachable and leaving a dangling prefix in 10 locales.
      expect(interpolate(FR_END_FEED, {}, 'en')).toBe(
        'Vous avez atteint la fin de the feed.',
      )
    })

    it('also takes the undefined: branch for the literal string "undefined"', () => {
      expect(
        interpolate(FR_END_FEED, { community_name: 'undefined' }, 'en'),
      ).toBe('Vous avez atteint la fin de the feed.')
    })

    it('treats null as a value, not as absent', () => {
      expect(interpolate(FR_END_FEED, { community_name: null }, 'en')).toBe(
        'Vous avez atteint la fin de null.',
      )
    })
  })

  describe('a nested placeholder inside a default: option', () => {
    it('re-parses the default text, substituting into it', () => {
      // The library re-runs the whole parse over its own output until no
      // placeholders remain, which is what makes the nested form work.
      expect(interpolate(FI_END_FEED, { community_name: 'kissat' }, 'en')).toBe(
        'Olet saavuttanut yhteisön kissat lopun.',
      )
    })

    it('takes the undefined: branch rather than a half-empty nested default', () => {
      // DELIBERATE DIVERGENCE from parser-default 1.1.1, which rendered the
      // default with an empty nested placeholder ("yhteisön  lopun.", note the
      // double space); honouring `undefined:` gives the translated wording.
      expect(interpolate(FI_END_FEED, {}, 'en')).toBe(
        'Olet saavuttanut syötteen lopun.',
      )
    })
  })

  describe('`default` as a plain param name', () => {
    it('substitutes params.default like any other param', () => {
      // en.json:nav.commands.search, and 13 other en keys, use this name.
      expect(
        interpolate('Search for **{{default}}**', { default: 'cats' }, 'en'),
      ).toBe('Search for **cats**')
      expect(interpolate('Score: {{default}}', { default: 42 }, 'en')).toBe(
        'Score: 42',
      )
    })

    it('renders empty when params.default is itself missing', () => {
      expect(interpolate('Search for **{{default}}**', {}, 'en')).toBe(
        'Search for ****',
      )
    })

    it('does not let a stray default param stand in for another placeholder', () => {
      // `default` is an ordinary param name here and nothing more. The old
      // library also treated it as the fallback value for every OTHER
      // placeholder whose param was absent; no dictionary string and no call
      // site relies on that, so it is deliberately not carried over.
      expect(
        interpolate(
          'Hello {{name}}',
          { name: 'Mari', default: 'FALLBACK' },
          'en',
        ),
      ).toBe('Hello Mari')
    })

    it('uses a declared default: option, not a stray default param', () => {
      expect(
        interpolate(
          '{{users; 1:user; default:users;}}',
          { default: 'FALLBACK' },
          'en',
        ),
      ).toBe('users')
    })
  })

  describe('option-list punctuation and malformed templates', () => {
    it('accepts a final option with no trailing semicolon', () => {
      // ar.json:routes.frontpage.footer omits the `;` after the last default.
      const arabicFooter =
        '{{users:number}} {{users; 1:مستخدم; default:مستخدمين}} {{users; 1:نشيط; default:نشيطين}}'
      expect(interpolate(arabicFooter, { users: 1 }, 'en')).toBe(
        '1 مستخدم نشيط',
      )
      expect(interpolate(arabicFooter, { users: 3 }, 'en')).toBe(
        '3 مستخدمين نشيطين',
      )
    })

    it('does not throw on an unbalanced template, and keeps the literal text', () => {
      // Deliberately not pinning the exact output: the tail is garbage either
      // way. What must hold is that malformed data degrades instead of
      // throwing, and that the translated prose around it still reaches the
      // user.
      expect(() =>
        interpolate(RU_END_FEED_MALFORMED, { community_name: 'X' }, 'en'),
      ).not.toThrow()
      expect(
        interpolate(RU_END_FEED_MALFORMED, { community_name: 'X' }, 'en'),
      ).toContain('Вы достигли конца')
    })
  })
})
