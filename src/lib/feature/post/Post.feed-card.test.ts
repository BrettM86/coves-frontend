import { describe, expect, it, vi } from 'vitest'
import { actionNames, leafWithText, renderPost } from './Post.feed-card.render'
import { linkPost } from './Post.feed-card.fixture'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

/** A feed card: cozy view without expandBody. */
const feedCard = (post = linkPost()) => renderPost(post, { view: 'cozy' })

const linkBar = (article: Element) =>
  article.querySelector('[data-testid="external-link-bar"]')

const bodyInset = (article: Element) => article.querySelector('.line-clamp-5')

/** The framed thumbnail: the thumb image inside a link to the post's uri, outside the link bar. */
function framedThumbnail(article: Element): Element | undefined {
  return [...article.querySelectorAll('img')].find(
    (image) =>
      (image.getAttribute('src') ?? '').includes(
        'https://cdn.example.com/thumb.jpg',
      ) &&
      image.closest('a')?.getAttribute('href') ===
        'https://www.thegamer.com/tim-sweeney/' &&
      !image.closest('[data-testid="external-link-bar"]'),
  )
}

const follows = (first: Node, second: Node) =>
  Boolean(first.compareDocumentPosition(second) & 4) // DOCUMENT_POSITION_FOLLOWING

describe('Post feed card composition', () => {
  it('orders title, framed thumbnail, body preview, then the link bar', () => {
    const article = feedCard()
    const title = article.querySelector('h3')
    const thumbnail = framedThumbnail(article)
    const body = bodyInset(article)
    const bar = linkBar(article)

    expect(title?.textContent?.trim()).toBe('nap time')
    expect(thumbnail).toBeDefined()
    expect(body).not.toBeNull()
    expect(bar).not.toBeNull()
    if (!title || !thumbnail || !body || !bar) return

    expect(follows(title, thumbnail)).toBe(true)
    expect(follows(thumbnail, body)).toBe(true)
    expect(follows(body, bar)).toBe(true)
  })

  it('renders the link bar and no thumbnail when the embed has no thumb', () => {
    const article = feedCard(linkPost({ thumb: null }))

    expect(linkBar(article)).not.toBeNull()
    const thumbnails = [...article.querySelectorAll('a img')].filter(
      (image) =>
        image.closest('a')?.getAttribute('href') ===
          'https://www.thegamer.com/tim-sweeney/' &&
        !image.closest('[data-testid="external-link-bar"]'),
    )
    expect(thumbnails).toHaveLength(0)
  })

  it('keeps the title exactly once when it equals the embed title', () => {
    const article = feedCard(linkPost({ embedTitle: 'nap time' }))

    const headings = [...article.querySelectorAll('h3')]
    expect(headings).toHaveLength(1)
    expect(leafWithText(headings[0], 'nap time')).toHaveLength(1)
  })

  it('renders an inert link bar for an unsafe external uri', () => {
    const article = feedCard(linkPost({ uri: 'javascript:alert(1)' }))
    const bar = linkBar(article)

    expect(bar).not.toBeNull()
    if (!bar) return
    expect(bar.closest('a')).toBeNull()
    expect(bar.querySelector('a')).toBeNull()
    expect(bar.querySelector('svg.lucide-globe')).not.toBeNull()
    expect(bar.textContent?.trim()).toBe('javascript:alert(1)')
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
})

describe('Post feed card acceptance', () => {
  it('renders feed header, inset body, link bar and feed action bar together', () => {
    const article = feedCard()

    const communityLink = article.querySelector('header a[href^="/c/"]')
    expect(communityLink).not.toBeNull()
    if (!communityLink) return
    expect(leafWithText(communityLink, '!cats')).toHaveLength(1)

    expect(bodyInset(article)).not.toBeNull()
    expect(linkBar(article)).not.toBeNull()
    expect(actionNames(article)).toEqual([
      'Share',
      'Comments',
      'Upvote',
      'Downvote',
    ])
  })
})
