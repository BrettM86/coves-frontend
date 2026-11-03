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
