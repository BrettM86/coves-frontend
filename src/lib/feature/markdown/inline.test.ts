import { describe, it, expect } from 'vitest'
import { render } from 'svelte/server'
import Markdown from './Markdown.svelte'

// ---------------------------------------------------------------------------
// Inline rendering must never swallow content.
//
// MdTree renders `{#if Renderer}` with no `{:else}`, so any token type missing
// from the renderer map drops that token AND its whole subtree. The inline maps
// (inlineRenderers / linklessInlineRenderers) omit heading, list and blockquote.
// PostMeta.svelte renders post titles with <Markdown inline noLinks>, so a post
// titled "# 1 pick" renders as nothing at all in the feed.
//
// Whatever the eventual fix (an {:else} passthrough, or adding the missing
// renderers), the contract is the same: inline rendering shows the author's
// text. Dropping it silently is never acceptable.
// ---------------------------------------------------------------------------

/** Visible text of an SSR render, with markup and Svelte's comment markers gone. */
const visibleText = (html: string): string =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** The exact configuration PostMeta.svelte uses for post titles. */
const renderTitle = (source: string): string =>
  visibleText(
    render(Markdown, { props: { source, inline: true, noLinks: true } }).body,
  )

/** Inline rendering without the linkless variant, e.g. inline body text. */
const renderInline = (source: string): string =>
  visibleText(render(Markdown, { props: { source, inline: true } }).body)

interface TitleCase {
  readonly label: string
  readonly source: string
  readonly expected: string
}

// Real-world shapes: a title that begins with "#" is common (issue numbers,
// rankings, tags), and a "-" or ">" opener is an easy typo away.
const TITLE_CASES: readonly TitleCase[] = [
  { label: 'atx heading', source: '# 1 pick', expected: '1 pick' },
  { label: 'level-two heading', source: '## h2 title', expected: 'h2 title' },
  { label: 'bullet list', source: '- item', expected: 'item' },
  { label: 'ordered list', source: '1. num', expected: 'num' },
  { label: 'blockquote', source: '> quoted', expected: 'quoted' },
  {
    label: 'plain text (control)',
    source: 'plain title',
    expected: 'plain title',
  },
]

describe('Markdown inline noLinks - post titles', () => {
  it.each(TITLE_CASES)(
    'renders the text of a $label title',
    ({ source, expected }) => {
      expect(renderTitle(source)).toContain(expected)
    },
  )

  it('never renders a non-empty title as empty', () => {
    const blanked = TITLE_CASES.filter(
      ({ source }) => renderTitle(source) === '',
    ).map(({ label, source }) => `${label}: ${JSON.stringify(source)}`)

    expect(blanked).toEqual([])
  })
})

describe('Markdown inline - block openers in inline mode', () => {
  it.each(TITLE_CASES)(
    'renders the text of a $label source',
    ({ source, expected }) => {
      expect(renderInline(source)).toContain(expected)
    },
  )
})
