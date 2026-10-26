import { describe, expect, it, vi } from 'vitest'
import { actionNames, leafWithText, renderPost } from './Post.feed-card.render'
import { linkPost } from './Post.feed-card.fixture'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

// Guards: the detail page and compact rows keep their existing layout while
// the cozy feed card changes.
describe('Post layout guards', () => {
  it('detail view keeps its header, action order, full body and link card', () => {
    const article = renderPost(linkPost(), { view: 'cozy', expandBody: true })

    const header = article.querySelector('header')
    expect(header?.querySelector('img')?.getAttribute('width')).toBe('32')
    const communityLink = header?.querySelector('a[href^="/c/"]')
    expect(communityLink).not.toBeNull()
    if (!communityLink) return
    expect(leafWithText(communityLink, '!cats@coves.social')).toHaveLength(1)
    expect(leafWithText(communityLink, '!cats')).toHaveLength(0)

    expect(actionNames(article)).toEqual([
      'Upvote',
      'Comments',
      'Downvote',
      'Share',
    ])
    expect(article.querySelector('.line-clamp-5')).toBeNull()
    expect(
      article.querySelector('[data-testid="external-link-bar"]'),
    ).toBeNull()
    expect(article.querySelector('a.post-link')?.getAttribute('href')).toBe(
      'https://www.thegamer.com/tim-sweeney/',
    )
  })

  it('compact view keeps its link anchor and action order', () => {
    const article = renderPost(linkPost(), { view: 'compact' })

    expect(
      article.querySelector('a.post-link-compact')?.getAttribute('href'),
    ).toBe('https://www.thegamer.com/tim-sweeney/')
    expect(actionNames(article)).toEqual([
      'Upvote',
      'Comments',
      'Downvote',
      'Share',
    ])
    expect(
      article.querySelector('[data-testid="external-link-bar"]'),
    ).toBeNull()
  })
})
