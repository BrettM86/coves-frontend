import { describe, expect, it } from 'vitest'
import { parseTags, textToTag } from './tags'

describe('parseTags', () => {
  it('returns no tags and no title for undefined input', () => {
    expect(parseTags(undefined)).toEqual({ tags: [], title: undefined })
  })

  it('returns no tags and no title for an empty string', () => {
    expect(parseTags('')).toEqual({ tags: [], title: undefined })
  })

  it('extracts a leading known tag and trims the remaining title', () => {
    const { tags, title } = parseTags('[OC] Title')

    expect(title).toBe('Title')
    expect(tags).toEqual([
      { content: 'OC', color: '#03A8F240', type: 'custom' },
    ])
  })

  it('extracts multiple comma-separated tags from a single leading group', () => {
    const { tags, title } = parseTags('[OC, NSFL] Title')

    expect(title).toBe('Title')
    expect(tags).toEqual([
      { content: 'OC', color: '#03A8F240', type: 'custom' },
      { content: 'NSFL', color: '#ff000040', type: 'custom' },
    ])
  })

  it('extracts a trailing tag group', () => {
    const { tags, title } = parseTags('Title [CW]')

    expect(title).toBe('Title')
    expect(tags).toEqual([
      { content: 'CW', color: '#ff000040', type: 'custom' },
    ])
  })

  it('extracts both leading and trailing tag groups', () => {
    const { tags, title } = parseTags('[OC] Title [CW]')

    expect(title).toBe('Title')
    expect(tags).toEqual([
      { content: 'OC', color: '#03A8F240', type: 'custom' },
      { content: 'CW', color: '#ff000040', type: 'custom' },
    ])
  })

  it('treats unknown tags as custom tags with no color', () => {
    const { tags, title } = parseTags('[Spoiler] x')

    expect(title).toBe('x')
    expect(tags).toEqual([{ content: 'Spoiler', type: 'custom' }])
  })

  it('does not parse single-character tags', () => {
    // Quirk of the regex: `\[.[^\]]+\]` requires at least two characters
    // between the brackets, so `[a]` is left in the title.
    expect(parseTags('[a] x')).toEqual({ tags: [], title: '[a] x' })
  })

  it('leaves a title with no tag groups untouched', () => {
    expect(parseTags('Just a title')).toEqual({
      tags: [],
      title: 'Just a title',
    })
  })

  it('returns an undefined title when the tags consume the whole string', () => {
    const { tags, title } = parseTags('[NSFL]')

    expect(title).toBeUndefined()
    expect(tags).toEqual([
      { content: 'NSFL', color: '#ff000040', type: 'custom' },
    ])
  })

  it('returns copies of known tags rather than the shared map entries', () => {
    const { tags } = parseTags('[OC] Title')

    expect(tags[0]).toEqual(textToTag.get('OC'))
    expect(tags[0]).not.toBe(textToTag.get('OC'))
  })
})
