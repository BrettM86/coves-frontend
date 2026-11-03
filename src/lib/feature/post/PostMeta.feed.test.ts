import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import type { AtUri, CommunityRef } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import PostMeta from './PostMeta.svelte'
import { leafWithText } from './Post.feed-card.render'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const community: CommunityRef = {
  did: 'did:plc:cats' as DID,
  handle: 'c-cats.coves.social' as Handle,
  name: 'cats',
  avatar: 'https://cdn.example/cats.png',
}

const author = {
  did: 'did:plc:mayalin' as DID,
  handle: 'mayalin.coves.social' as Handle,
}

function renderFeedHeader(
  overrides: {
    showCommunity?: boolean
    user?: typeof author & { avatar?: string }
  } = {},
): HTMLElement {
  const html = render(PostMeta, {
    props: {
      feed: true,
      uri: 'at://did:plc:mayalin/social.coves.community.post/3lrkey' as AtUri,
      title: 'Cat facts',
      community,
      user: author,
      published: new Date('2026-10-01T00:00:00Z'),
      ...overrides,
    },
  }).body
  const header = new JSDOM(html).window.document.querySelector('header')
  if (!header) throw new Error('PostMeta rendered no header')
  return header
}

function commonAncestor(first: Element, second: Element): Element | null {
  let candidate: Element | null = first
  while (candidate && !candidate.contains(second))
    candidate = candidate.parentElement
  return candidate
}

describe('PostMeta feed header', () => {
  it('splits the community mention into name and origin elements', () => {
    const header = renderFeedHeader()
    const communityLink = header.querySelector('a[href^="/c/"]')
    expect(communityLink).not.toBeNull()
    if (!communityLink) return

    expect(leafWithText(communityLink, '!cats')).toHaveLength(1)
    expect(leafWithText(communityLink, '@coves.social')).toHaveLength(1)
  })

  it('shows the author handle and places the time after the community/author block', () => {
    const header = renderFeedHeader()
    const communityLink = header.querySelector('a[href^="/c/"]')
    const authorLink = [...header.querySelectorAll('a')].find(
      (link) => link.textContent?.trim() === '@mayalin.coves.social',
    )
    const time = header.querySelector('time')
    expect(authorLink).toBeDefined()
    expect(communityLink).not.toBeNull()
    expect(time).not.toBeNull()
    if (!authorLink || !communityLink || !time) return

    const block = commonAncestor(communityLink, authorLink)
    expect(block).not.toBeNull()
    if (!block) return
    expect(block.contains(time)).toBe(false)
    expect(
      Boolean(
        block.compareDocumentPosition(time) & 4, // DOCUMENT_POSITION_FOLLOWING
      ),
    ).toBe(true)
  })

  it('declares the community avatar 24px below sm and 36px from sm up', () => {
    const header = renderFeedHeader()
    const avatar = header.querySelector('img')
    expect(avatar).not.toBeNull()
    if (!avatar) return

    const classes = [...avatar.classList]
    // A fixed inline width would override the responsive classes unless
    // they are marked important.
    const important = /width:\s*\d/.test(avatar.getAttribute('style') ?? '')
    expect(classes).toContain(important ? 'size-6!' : 'size-6')
    expect(classes).toContain(important ? 'sm:size-9!' : 'sm:size-9')
  })

  it('shows the author avatar and no community link when the community is hidden', () => {
    const header = renderFeedHeader({
      showCommunity: false,
      user: { ...author, avatar: 'https://cdn.example/mayalin.png' },
    })

    expect(header.querySelector('a[href^="/c/"]')).toBeNull()
    const authorAvatar = header.querySelector(
      'img[src="https://cdn.example/mayalin.png"]',
    )
    expect(authorAvatar).not.toBeNull()
  })
})
