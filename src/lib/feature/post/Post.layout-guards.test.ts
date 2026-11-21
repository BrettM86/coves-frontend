import { describe, expect, it, vi } from 'vitest'
import { actionNames, leafWithText, renderPost } from './Post.feed-card.render'
import { linkPost } from './Post.feed-card.fixture'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

// Guards: the detail page shares the feed card's header, link card and action
// bar, with the full body in place of the preview bubble; compact rows keep
// their own layout and share the action bar.
describe('Post layout guards', () => {
  it('detail view uses the feed header, link card and action bar with the full body', () => {
    const article = renderPost(linkPost(), { view: 'cozy', expandBody: true })

    const header = article.querySelector('header')
    const communityLink = header?.querySelector('a[href^="/c/"]')
    expect(communityLink).not.toBeNull()
    if (!communityLink) return
    // The feed header styles the name apart from its instance.
    expect(leafWithText(communityLink, '!cats')).toHaveLength(1)
    expect(article.querySelector('h1')).not.toBeNull()

    expect(actionNames(article)).toEqual([
      'Upvote',
      'Downvote',
      'Comments',
      'Share',
    ])
    expect(article.querySelector('.line-clamp-5')).toBeNull()
    expect(
      article.querySelector('[data-testid="external-link-bar"]'),
    ).toBeNull()
    // The post page shows the feed's compact link card, thumbnail included.
    expect(article.querySelector('a.post-link')).toBeNull()
    const card = article.querySelector('[data-testid="link-card"]')
    expect(card?.getAttribute('href')).toBe(
      'https://www.thegamer.com/tim-sweeney/',
    )
    expect(card?.querySelector('img[src*="thumb.jpg"]')).not.toBeNull()
  })

  it('compact view keeps its link anchor, with the feed action order', () => {
    const article = renderPost(linkPost(), { view: 'compact' })

    expect(
      article.querySelector('a.post-link-compact')?.getAttribute('href'),
    ).toBe('https://www.thegamer.com/tim-sweeney/')
    expect(actionNames(article)).toEqual([
      'Upvote',
      'Downvote',
      'Comments',
      'Share',
    ])
    expect(
      article.querySelector('[data-testid="external-link-bar"]'),
    ).toBeNull()
  })
})
