import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import type { AtUri, CommunityRef } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import PostMeta from './PostMeta.svelte'

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

function renderFeedHeader(): HTMLElement {
  const html = render(PostMeta, {
    props: {
      feed: true,
      uri: 'at://did:plc:mayalin/social.coves.community.post/3lrkey' as AtUri,
      title: 'Cat facts',
      community,
      user: author,
      published: new Date('2026-10-01T00:00:00Z'),
    },
  }).body
  const header = new JSDOM(html).window.document.querySelector('header')
  if (!header) throw new Error('PostMeta rendered no header')
  return header
}

/** Innermost elements under `root` whose whole text is exactly `text`. */
function leafWithText(root: Element, text: string): Element[] {
  return [...root.querySelectorAll('*')].filter(
    (element) =>
      element.textContent?.trim() === text &&
      ![...element.children].some(
        (child) => child.textContent?.trim() === text,
      ),
  )
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

  it('renders the community avatar at 24px', () => {
    const header = renderFeedHeader()
    const avatar = header.querySelector('img')
    expect(avatar?.getAttribute('width')).toBe('24')
  })
})
