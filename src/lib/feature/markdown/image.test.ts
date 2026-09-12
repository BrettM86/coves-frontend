import { describe, it, expect } from 'vitest'
import { render } from 'svelte/server'
import Markdown from './Markdown.svelte'

// ---------------------------------------------------------------------------
// Acceptance: an inline image in a body degrades to its alt text.
//
// External images and embeds are not meant to be live anywhere yet, and the
// current image renderer emits a <div> wrapping a <button><img> INSIDE the
// paragraph's <p> — invalid HTML that also loads a third-party URL on render.
//
// Observed from outside the component: the paragraph reads as the author's
// sentence with the alt text in place of the image, carries no media element
// and no block-level wrapper, and — for an image token in paragraph content —
// the image URL reaches the output nowhere: not as a src, not as a proxied or
// escaped variant, not in an attribute.
//
// Outside paragraph content the URL can still surface as inert text, because
// MdTree prints the raw source of a block token its map does not cover. That
// is pre-existing behaviour of the tree, not of the image renderer; what holds
// everywhere is that no media sink and no URL-bearing attribute is emitted.
// Pinned by 'keeps a heading image out of every media sink in inline mode'.
// ---------------------------------------------------------------------------

const IMAGE_HOST = 'example.com'
const SOURCE = `Look ![a cat](https://${IMAGE_HOST}/cat.png) here`

/** Svelte's SSR hydration markers (<!--[-->, <!--]-->) are not content. */
const stripComments = (html: string): string =>
  html.replace(/<!--[\s\S]*?-->/g, '')

/** Visible text of an HTML fragment, whitespace collapsed. */
const textOf = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Inner HTML of every top-level `<tag>` element in `html`, counting nesting of
 * that same tag so an outer element is not closed by an inner one's end tag.
 */
const elementsOf = (html: string, tag: string): string[] => {
  const boundary = new RegExp(`<${tag}(?=[\\s/>])[^>]*>|</${tag}\\s*>`, 'gi')
  const contents: string[] = []
  let depth = 0
  let openEnd = 0
  for (const match of html.matchAll(boundary)) {
    const token = match[0]
    const at = match.index ?? 0
    if (token.startsWith('</')) {
      depth -= 1
      if (depth === 0) contents.push(html.slice(openEnd, at))
    } else if (!token.endsWith('/>')) {
      if (depth === 0) openEnd = at + token.length
      depth += 1
    }
  }
  return contents
}

/** Tags that would make the image, or any other remote media, load. */
const MEDIA_TAGS = ['img', 'iframe', 'video', 'source', 'embed', 'object']

const RENDERED = stripComments(
  render(Markdown, { props: { source: SOURCE } }).body,
)

describe('Markdown - inline image', () => {
  it('renders the alt text in the paragraph with no media element', () => {
    const paragraphs = elementsOf(RENDERED, 'p')
    expect(paragraphs, `no <p> in:\n${RENDERED}`).toHaveLength(1)
    const paragraph = paragraphs[0] ?? ''

    expect(textOf(paragraph)).toBe('Look a cat here')

    for (const tag of MEDIA_TAGS) {
      expect(RENDERED, `<${tag}> in:\n${RENDERED}`).not.toContain(`<${tag}`)
    }
    // A block-level wrapper inside a <p> is the invalid nesting this replaces.
    expect(paragraph, `<div> inside the <p>:\n${paragraph}`).not.toContain(
      '<div',
    )
  })

  it('leaks the image URL nowhere in the output', () => {
    expect(RENDERED).not.toContain(IMAGE_HOST)
  })
})

// ---------------------------------------------------------------------------
// The same degradation everywhere an image token can reach a renderer map.
//
// Each case below renders a source whose ONLY non-text content is an image, so
// "no media tag, no URL, no URL-bearing attribute" can be asserted over the
// whole body: in these renders there is nothing else that could legitimately
// carry a src or an href.
// ---------------------------------------------------------------------------

/**
 * The escaped forms Svelte's SSR emits, reversed. Ampersand goes last so a
 * double-escaped `&amp;amp;` decodes to the author's literal `&amp;` rather
 * than collapsing all the way to `&`.
 */
const decodeEntities = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

/** What a reader sees: tags removed, then entities resolved. */
const visibleTextOf = (html: string): string => decodeEntities(textOf(html))

const renderBody = (props: {
  source: string
  inline?: boolean
  noLinks?: boolean
}): string => stripComments(render(Markdown, { props }).body)

/** The single <p> of a render, failing loudly when there is none. */
const paragraphOf = (html: string): string => {
  const paragraphs = elementsOf(html, 'p')
  expect(paragraphs, `no <p> in:\n${html}`).toHaveLength(1)
  return paragraphs[0] ?? ''
}

/** No element that could load the image, and no src to load it from. */
const expectNoMedia = (html: string): void => {
  for (const tag of MEDIA_TAGS) {
    expect(html, `<${tag}> in:\n${html}`).not.toContain(`<${tag}`)
  }
  expect(html, `src attribute in:\n${html}`).not.toContain('src=')
}

/** No media element, and no attribute that could carry the destination. */
const expectNoMediaOrUrl = (html: string): void => {
  expectNoMedia(html)
  expect(html, `href attribute in:\n${html}`).not.toContain('href=')
}

/** The single <a> of a render, failing loudly when there is none. */
const anchorOf = (html: string): string => {
  const anchors = elementsOf(html, 'a')
  expect(anchors, `no <a> in:\n${html}`).toHaveLength(1)
  return anchors[0] ?? ''
}

// Inline mode (post titles) and its linkless variant (titles already inside an
// <a>) use their own renderer maps. An image token must degrade there too, and
// must not fall back to printing the author's `![alt](url)` source — that would
// put the URL back on screen.
describe('Markdown - inline image in inline mode', () => {
  it('degrades to the alt text with inline renderers', () => {
    const body = renderBody({ source: SOURCE, inline: true })
    const paragraph = paragraphOf(body)

    expect(visibleTextOf(paragraph)).toBe('Look a cat here')
    expectNoMediaOrUrl(body)
    expect(body).not.toContain(IMAGE_HOST)
  })

  it('degrades to the alt text with linkless inline renderers', () => {
    const body = renderBody({ source: SOURCE, inline: true, noLinks: true })
    const paragraph = paragraphOf(body)

    expect(visibleTextOf(paragraph)).toBe('Look a cat here')
    expectNoMediaOrUrl(body)
    expect(body).not.toContain(IMAGE_HOST)
  })
})

// Destinations that used to pick a media branch of their own: a YouTube watch
// URL became an <iframe> embed and a .mp4 became a video embed, both from
// image syntax. The destination decides nothing now — every image token is its
// alt text.
describe('Markdown - image with a media destination', () => {
  const cases: readonly { readonly label: string; readonly source: string }[] =
    [
      { label: 'youtube', source: '![v](https://www.youtube.com/watch?v=abc)' },
      { label: 'mp4', source: '![v](https://example.com/a.mp4)' },
    ]

  for (const { label, source } of cases) {
    it(`renders the alt text and no embed for a ${label} destination`, () => {
      const body = renderBody({ source })

      expect(visibleTextOf(paragraphOf(body))).toBe('v')
      expectNoMediaOrUrl(body)
      expect(body).not.toContain('youtube.com')
      expect(body).not.toContain('example.com')
    })
  }
})

// Alt text is a string on the image token, not a rendered subtree: marked
// hands over `*a* &amp; <b>` verbatim (its child tokens are an em, a text and
// an html token, which must NOT be rendered). So the alt shows as the author
// typed it, with no emphasis applied and no raw HTML element smuggled through.
describe('Markdown - image alt text containing markup', () => {
  const body = renderBody({ source: '![*a* &amp; <b>](https://e.test/x.png)' })

  it('shows the alt text literally, with no markup applied', () => {
    expect(visibleTextOf(paragraphOf(body))).toBe('*a* &amp; <b>')
  })

  it('escapes the alt text instead of emitting elements', () => {
    expect(body, `<em> in:\n${body}`).not.toContain('<em')
    expect(body, `<b> element in:\n${body}`).not.toContain('<b>')
    // Svelte's SSR escape covers `<` and `&`; a lone `>` outside a tag is
    // inert and stays literal, so the open bracket is what is asserted here.
    expect(body).toContain('&lt;b')
    expect(body).toContain('&amp;amp;')
  })
})

// Hostile destinations. `preprocess()` rewrites a plain `javascript:` image
// destination before the lexer sees it, so the two forms below are the ones
// that actually reach the renderer: an angle-bracketed destination and a
// non-javascript script scheme.
describe('Markdown - image with a hostile destination', () => {
  const cases: readonly { readonly label: string; readonly source: string }[] =
    [
      { label: 'bracketed javascript:', source: '![t](<javascript:alert(1)>)' },
      { label: 'vbscript:', source: '![t](vbscript:msgbox(1))' },
    ]

  for (const { label, source } of cases) {
    it(`drops a ${label} destination and keeps the alt text`, () => {
      const body = renderBody({ source })

      expect(visibleTextOf(paragraphOf(body))).toBe('t')
      expectNoMediaOrUrl(body)
      expect(body).not.toContain('javascript:')
      expect(body).not.toContain('vbscript:')
    })
  }
})

// An empty alt is the one case with nothing to degrade to, and degrading to
// nothing is worse than it looks: the author's image becomes invisible, and
// the badge pattern `[![](icon)](target)` becomes an empty anchor — a link a
// reader can neither see nor read. So an empty alt renders a localized
// placeholder instead, the en string for `common.image`.
const PLACEHOLDER = 'image'

describe('Markdown - image with an empty alt', () => {
  // An alt of only whitespace is an empty alt: it renders nothing visible.
  const empty: readonly { readonly label: string; readonly alt: string }[] = [
    { label: 'no alt', alt: '' },
    { label: 'whitespace-only alt', alt: '   ' },
  ]

  for (const { label, alt } of empty) {
    it(`renders the placeholder for an image with ${label}`, () => {
      const body = renderBody({
        source: `![${alt}](https://${IMAGE_HOST}/a.png)`,
      })

      expect(visibleTextOf(paragraphOf(body)), body).toBe(PLACEHOLDER)
      expectNoMediaOrUrl(body)
      expect(body).not.toContain(IMAGE_HOST)
    })
  }

  it('gives the badge pattern a readable anchor instead of an empty one', () => {
    const body = renderBody({
      source: `[![](https://${IMAGE_HOST}/i.png)](https://target.test/)`,
    })

    expect(body, `no link to the target in:\n${body}`).toMatch(
      /<a\b[^>]*href="https:\/\/target\.test\/"/,
    )
    expect(visibleTextOf(anchorOf(body)), body).toBe(PLACEHOLDER)
    expectNoMedia(body)
    expect(body).not.toContain(IMAGE_HOST)
  })
})

// An image inside a link keeps the link: the anchor is the author's, the
// image is not. The alt becomes the anchor's visible text, so the destination
// stays clickable and readable while the image host goes away entirely.
describe('Markdown - image nested in a link', () => {
  const source = `[![alt](https://img.test/a.png)](https://page.test/)`

  it('renders the link with the alt text as its label', () => {
    const body = renderBody({ source })

    expect(body, `no link to the page in:\n${body}`).toMatch(
      /<a\b[^>]*href="https:\/\/page\.test\/"/,
    )
    expect(visibleTextOf(anchorOf(body)), body).toBe('alt')
    expectNoMedia(body)
    expect(body).not.toContain('img.test')
  })

  it('renders the alt text alone with linkless inline renderers', () => {
    const body = renderBody({ source, inline: true, noLinks: true })

    expect(visibleTextOf(paragraphOf(body)), body).toBe('alt')
    expect(body, `<a> in:\n${body}`).not.toContain('<a')
    expectNoMediaOrUrl(body)
    expect(body).not.toContain('img.test')
  })
})

// Inline mode is handed post titles, so a heading is a block token its map
// does not cover. MdTree falls back to printing that token's raw source as
// text, which puts the author's `![t](url)` back on screen as inert characters.
// That fallback is pre-existing and out of scope here; what this pins is that
// the URL reaches no sink — no media element, no src, no href — so the text is
// all it can ever be. Do not tighten this to "the URL is absent": it is not.
describe('Markdown - heading image in inline mode', () => {
  it('keeps a heading image out of every media sink in inline mode', () => {
    const body = renderBody({
      source: '# ![t](https://img.test/a.png)',
      inline: true,
    })

    expectNoMediaOrUrl(body)
  })
})
