/**
 * The import dialog's bio previews collapse runs of blank lines to a single
 * line break for display; the imported text itself is unchanged.
 */
import { describe, expect, it } from 'vitest'
import { collapseBlankLines } from './bio-preview'

describe('collapseBlankLines', () => {
  it.each([
    [
      'Seattle / Basketball / Urbanism / SWE\n\nBuilding: coves.social\n\n@coves.team',
      'Seattle / Basketball / Urbanism / SWE\nBuilding: coves.social\n@coves.team',
    ],
    ['a\n  \n\t\nb', 'a\nb'],
    ['a\r\n\r\nb', 'a\nb'],
    ['\n\na\n\n', 'a'],
    ['a\nb', 'a\nb'],
    ['Kites and tides', 'Kites and tides'],
  ])('%j displays as %j', (input, expected) => {
    expect(collapseBlankLines(input)).toBe(expected)
  })
})
