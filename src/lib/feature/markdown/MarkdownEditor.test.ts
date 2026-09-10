/**
 * Server rendering of the markup editor.
 *
 * Two things are pinned here. The preview is replaceable: PostForm and
 * CommentForm hand in a snippet that renders the compiled rich text, so what
 * the author sees in preview is what every client will render — the built-in
 * markdown preview is only the fallback. And the toolbar covers the lexicon:
 * every button maps to a facet feature, which is why the code-block button
 * has to exist alongside the original eight.
 */
import { describe, expect, it } from 'vitest'
import { createRawSnippet } from 'svelte'
import { render } from 'svelte/server'
import MarkdownEditor from './MarkdownEditor.svelte'

const CUSTOM = 'data-custom-preview'

/** A preview replacement whose output is unmistakable in the HTML. */
const preview = createRawSnippet(() => ({
  render: () => `<div ${CUSTOM}>compiled preview</div>`,
}))

function html(props: Record<string, unknown>): string {
  return render(MarkdownEditor, { props }).body
}

describe('MarkdownEditor preview', () => {
  it('renders the preview snippet instead of the markdown preview', () => {
    const body = html({ value: '**x**', previewing: true, preview })

    expect(body).toContain(CUSTOM)
    expect(body).toContain('compiled preview')
    expect(body).not.toContain('<strong>')
  })

  it('falls back to the markdown preview when no snippet is given', () => {
    const body = html({ value: '**x**', previewing: true })

    expect(body).toContain('<strong>')
    expect(body).not.toContain(CUSTOM)
  })
})

describe('MarkdownEditor toolbar', () => {
  it('offers a code-block button alongside the original eight', () => {
    const body = html({ value: '', previewing: false })

    // Code block is the new one; the other eight are asserted so that adding
    // it cannot quietly displace them.
    for (const title of [
      'Bold',
      'Italic',
      'Link',
      'Header',
      'Strikethrough',
      'Quote',
      'Code',
      'Spoiler',
      'Code block',
    ]) {
      expect(body).toContain(`title="${title}"`)
    }
  })
})
