import { describe, expect, it, vi } from 'vitest'
import { actionNames, leafWithText, renderPost } from './Post.feed-card.render'
import { IMAGE_FULL, imagePost, linkPost } from './Post.feed-card.fixture'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

/** A feed card: cozy view without expandBody. */
const feedCard = (post = linkPost()) => renderPost(post, { view: 'cozy' })

const linkCard = (article: Element) =>
  article.querySelector('[data-testid="link-card"]')

const bodyInset = (article: Element) => article.querySelector('.line-clamp-5')

const thumbnails = (root: Element) =>
  [...root.querySelectorAll('img')].filter((image) =>
    (image.getAttribute('src') ?? '').includes(
      'https://cdn.example.com/thumb.jpg',
    ),
  )

const follows = (first: Node, second: Node) =>
  Boolean(first.compareDocumentPosition(second) & 4) // DOCUMENT_POSITION_FOLLOWING

describe('Post feed card link card', () => {
  it('shows the host and no URL path', () => {
    const card = linkCard(feedCard())

    expect(card).not.toBeNull()
    if (!card) return
    expect(leafWithText(card, 'www.thegamer.com')).toHaveLength(1)
    expect(card.textContent).not.toContain('/tim-sweeney')
  })

  it('shows the external title when it differs from the post title', () => {
    const card = linkCard(feedCard())

    expect(card).not.toBeNull()
    if (!card) return
    expect(
      leafWithText(card, 'Tim Sweeney on the future of Epic'),
    ).toHaveLength(1)
  })

  it('keeps the title exactly once when it equals the external title', () => {
    const article = feedCard(linkPost({ embedTitle: 'nap time' }))
    const card = linkCard(article)

    expect(card).not.toBeNull()
    if (!card) return
    expect(card.textContent).not.toContain('nap time')
    const headings = [...article.querySelectorAll('h3')]
    expect(headings).toHaveLength(1)
    expect(leafWithText(article, 'nap time')).toHaveLength(1)
  })

  it('renders the card without an image when the embed has no thumb', () => {
    const article = feedCard(linkPost({ thumb: null }))
    const card = linkCard(article)

    expect(card).not.toBeNull()
    if (!card) return
    expect(card.getAttribute('href')).toBe(
      'https://www.thegamer.com/tim-sweeney/',
    )
    expect(leafWithText(card, 'www.thegamer.com')).toHaveLength(1)
    expect(thumbnails(article)).toHaveLength(0)
  })

  it('renders a non-interactive card for a non-http uri', () => {
    const article = feedCard(linkPost({ uri: 'javascript:alert(1)' }))
    const card = linkCard(article)

    expect(card).not.toBeNull()
    if (!card) return
    expect(card.tagName).not.toBe('A')
    expect(card.closest('a')).toBeNull()
    expect(card.querySelector('a')).toBeNull()
    expect(
      [...article.querySelectorAll('a')].filter((link) =>
        (link.getAttribute('href') ?? '').startsWith('javascript:'),
      ),
    ).toHaveLength(0)
  })

  it('shows the body in an inset preview that keeps markdown links', () => {
    const article = feedCard()
    const body = bodyInset(article)

    expect(body).not.toBeNull()
    if (!body) return
    expect(body.textContent).toContain('Sweeney spoke at length.')
    const link = body.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://example.com/interview')
    expect(link?.textContent?.trim()).toBe('the interview')
  })

  // The preview keeps a plain body's single line breaks: the paragraph text
  // still holds the '\n' characters, and the preview element declares
  // pre-line whitespace on its paragraphs with the `[&_p]:whitespace-pre-line`
  // class token so they render as line breaks.
  it.each([
    {
      name: 'three lines',
      body: 'first\nsecond\nthird',
      text: 'first\nsecond\nthird',
    },
    { name: 'two lines', body: 'alpha\nbeta', text: 'alpha\nbeta' },
  ])('keeps the single line breaks of a $name plain body', ({ body, text }) => {
    const preview = feedCard(linkPost({ body })).querySelector(
      '.feed-body-preview',
    )

    expect(preview).not.toBeNull()
    if (!preview) return
    const paragraphs = [...preview.querySelectorAll('p')]
    expect(paragraphs.map((paragraph) => paragraph.textContent)).toEqual([text])
    expect(preview.classList.contains('[&_p]:whitespace-pre-line')).toBe(true)
  })

  // line-clamp-5 counts line boxes, not the blank-line margins between
  // paragraphs, so the preview also caps its box at five line-heights.
  it('caps the body preview at five line-heights', () => {
    const preview = feedCard(
      linkPost({ body: 'one\n\ntwo\n\nthree\n\nfour\n\nfive' }),
    ).querySelector('.feed-body-preview')

    expect(preview).not.toBeNull()
    if (!preview) return
    expect(preview.classList.contains('line-clamp-5')).toBe(true)
    expect(preview.classList.contains('max-h-[5lh]!')).toBe(true)
  })

  // PostBody sets a muted text colour; the feed preview uses the main ink
  // and marks it important so it wins over PostBody's own colour classes.
  it('renders the body preview in the main ink colour', () => {
    const preview = feedCard().querySelector('.feed-body-preview')

    expect(preview).not.toBeNull()
    if (!preview) return
    expect(preview.classList.contains('text-slate-900!')).toBe(true)
    expect(preview.classList.contains('dark:text-zinc-100!')).toBe(true)
  })

  it('keeps the detail page body in its muted colour', () => {
    const article = renderPost(linkPost(), { view: 'cozy', expandBody: true })
    const body = [...article.querySelectorAll('section')].find((section) =>
      section.textContent?.includes('Sweeney spoke at length.'),
    )

    expect(body).toBeDefined()
    if (!body) return
    expect(body.classList.contains('text-slate-600')).toBe(true)
    expect(body.classList.contains('text-slate-900!')).toBe(false)
    expect(body.classList.contains('dark:text-zinc-100!')).toBe(false)
  })

  it('shows a YouTube link as the player plus one link card without a thumbnail', () => {
    const article = feedCard(
      linkPost({ uri: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
    )
    const cards = article.querySelectorAll('[data-testid="link-card"]')

    expect(article.querySelector('.iframe-container')).not.toBeNull()
    expect(cards).toHaveLength(1)
    expect(cards[0].getAttribute('href')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    )
    expect(cards[0].querySelector('img:not([width="15"])')).toBeNull()
    expect(cards[0].querySelector('.thumb')).toBeNull()
  })

  it('renders a body longer than 1000 characters through to its end', () => {
    const body = 'Long paragraph. '.repeat(100) + 'END_OF_FULL_BODY'
    const preview = bodyInset(feedCard(linkPost({ body })))

    expect(preview).not.toBeNull()
    expect(preview?.textContent).toContain('END_OF_FULL_BODY')
  })
})

describe('Post feed card images', () => {
  const mainImage = (article: Element) =>
    [...article.querySelectorAll('img')].find((image) =>
      (image.getAttribute('src') ?? '').includes(IMAGE_FULL),
    )

  /** Class tokens of the image and its ancestors up to (not including) the article. */
  function classesUpTo(image: Element, article: Element): string[] {
    const tokens: string[] = []
    for (
      let element: Element | null = image;
      element && element !== article;
      element = element.parentElement
    )
      tokens.push(...element.classList)
    return tokens
  }

  it('does not force a feed image to full width and caps it at 560px', () => {
    const article = feedCard(imagePost())
    const image = mainImage(article)

    expect(image).toBeDefined()
    if (!image) return
    expect(image.classList.contains('max-h-[560px]')).toBe(true)
    expect(image.classList.contains('max-h-[60vh]')).toBe(false)
    expect(
      classesUpTo(image, article).filter(
        (token) => token === 'w-full' || token.endsWith(':w-full'),
      ),
    ).toEqual([])
  })

  /** The image's inline style declarations, as written. */
  const inlineStyle = (image: Element): Record<string, string> =>
    Object.fromEntries(
      (image.getAttribute('style') ?? '')
        .split(';')
        .map((declaration) => declaration.split(':'))
        .filter((parts) => parts.length === 2)
        .map(([property, value]) => [property.trim(), value.trim()]),
    )

  // Before it loads, a feed image with an aspectRatio reserves its box:
  // `aspect-ratio: <width> / <height>` and `width: <N>px`, where N is
  // 560 * width / height rounded to 2 decimals with trailing zeros dropped.
  // aspectRatio is a ratio, not pixel dimensions ({4, 3} is valid), so N is
  // never clamped to aspectRatio.width, and there is no percentage: inside the
  // image's w-fit wrapper a percentage width resolves to 0 before load. The
  // `max-w-full` class keeps the image inside its column; `w-auto` is gone.
  it.each([
    { ratio: { width: 880, height: 880 }, aspect: '880 / 880', width: '560px' },
    {
      ratio: { width: 434, height: 1074 },
      aspect: '434 / 1074',
      width: '226.29px',
    },
    { ratio: { width: 4, height: 3 }, aspect: '4 / 3', width: '746.67px' },
    { ratio: { width: 1, height: 1 }, aspect: '1 / 1', width: '560px' },
  ])(
    'reserves $width at $aspect before a feed image loads',
    ({ ratio, aspect, width }) => {
      const image = mainImage(feedCard(imagePost(ratio)))

      expect(image).toBeDefined()
      if (!image) return
      expect(inlineStyle(image)).toEqual({ 'aspect-ratio': aspect, width })
      expect(image.classList.contains('max-w-full')).toBe(true)
      expect(image.classList.contains('w-auto')).toBe(false)
    },
  )

  it('reserves no width for a feed image without an aspectRatio', () => {
    const image = mainImage(feedCard(imagePost()))

    expect(image).toBeDefined()
    if (!image) return
    expect(inlineStyle(image).width).toBeUndefined()
  })

  it('keeps the detail page image at full width and 60vh', () => {
    const article = renderPost(imagePost(), { view: 'cozy', expandBody: true })
    const image = mainImage(article)

    expect(image).toBeDefined()
    if (!image) return
    expect(image.classList.contains('max-h-[60vh]')).toBe(true)
    expect(image.classList.contains('max-h-[560px]')).toBe(false)
    expect(classesUpTo(image, article)).toContain('[&>*]:w-full')
  })
})

describe('Post feed card acceptance', () => {
  it('orders header, title, body bubble, one link card, then the action footer', () => {
    const article = feedCard()
    const header = article.querySelector('header')
    const title = article.querySelector('h3')
    const body = bodyInset(article)
    const card = linkCard(article)
    const footer = article.querySelector('footer')

    expect(title?.textContent?.trim()).toBe('nap time')
    expect(header).not.toBeNull()
    expect(body).not.toBeNull()
    expect(card).not.toBeNull()
    expect(footer).not.toBeNull()
    if (!header || !title || !body || !card || !footer) return

    expect(follows(header, title)).toBe(true)
    expect(follows(title, body)).toBe(true)
    expect(follows(body, card)).toBe(true)
    expect(follows(card, footer)).toBe(true)

    // One anchor to the link, and it is the card holding host and thumbnail.
    const anchors = [...article.querySelectorAll('a')].filter(
      (link) =>
        link.getAttribute('href') === 'https://www.thegamer.com/tim-sweeney/',
    )
    expect(anchors).toEqual([card])
    expect(card.getAttribute('target')).toBe('_blank')
    expect((card.getAttribute('rel') ?? '').split(/\s+/)).toEqual(
      expect.arrayContaining(['noopener', 'noreferrer']),
    )
    expect(leafWithText(card, 'www.thegamer.com')).toHaveLength(1)
    expect(thumbnails(article)).toHaveLength(1)
    expect(card.contains(thumbnails(article)[0])).toBe(true)

    expect(
      article.querySelector('[data-testid="external-link-bar"]'),
    ).toBeNull()
  })

  it('renders feed header, inset body, link card and feed action bar together', () => {
    const article = feedCard()

    const communityLink = article.querySelector('header a[href^="/c/"]')
    expect(communityLink).not.toBeNull()
    if (!communityLink) return
    expect(leafWithText(communityLink, '!cats')).toHaveLength(1)

    expect(bodyInset(article)).not.toBeNull()
    expect(linkCard(article)).not.toBeNull()
    expect(actionNames(article)).toEqual([
      'Upvote',
      'Downvote',
      'Comments',
      'Share',
    ])
  })
})
