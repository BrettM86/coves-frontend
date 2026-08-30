/**
 * Param values are data, never templates.
 *
 * Translation templates are ours and may recurse — a variant's text is itself
 * interpolated, which is how `default:{{community_name}}.` works. Param VALUES
 * are not ours: they carry community names, handles, post titles and search
 * queries. Feeding a value back through the parser would let a string that
 * merely contains `{{ … }}` reach into the param bag it was rendered with, or
 * expand without bound.
 *
 * These pass against the current implementation — they characterise a property
 * it already has rather than driving new behaviour. Their job is to fail loudly
 * if a later change to `resolve()` starts re-parsing values. Both were shown to
 * bite by inverting that line and watching them fail (see the RED report).
 */
import { describe, expect, it } from 'vitest'
import { interpolate } from './interpolate'

describe('interpolate — param values are never re-parsed as templates', () => {
  it('leaves placeholder syntax in a value as literal text', () => {
    // Self-referential: a re-parsing implementation recurses without bound
    // here rather than merely returning the wrong string.
    expect(interpolate('Hi {{name}}', { name: '{{name}}' }, 'en')).toBe(
      'Hi {{name}}',
    )
  })

  it('does not let a value reach another param through its own placeholder', () => {
    // The value names a param that IS in the bag. Re-parsing would render
    // "Hi LEAKED" — a value deciding which data it gets to read.
    expect(
      interpolate(
        'Hi {{name}}',
        { name: '{{secret}}', secret: 'LEAKED' },
        'en',
      ),
    ).toBe('Hi {{secret}}')
  })

  it('holds for a value substituted into a variant, where the template does recurse', () => {
    // `default:{{community_name}}.` is re-parsed by design; the value that
    // lands in it must not be.
    expect(
      interpolate(
        '{{community_name; undefined:the feed.; default:{{community_name}}.}}',
        { community_name: '{{secret}}', secret: 'LEAKED' },
        'en',
      ),
    ).toBe('{{secret}}.')
  })
})
