import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import type { AtUri, CommunityRef } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import PostMeta from './PostMeta.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const POST_URI =
  'at://did:plc:author/social.coves.community.postv2/3lrkey' as AtUri

const community: CommunityRef = {
  did: 'did:plc:comm' as DID,
  handle: 'gardening.local.coves.dev' as Handle,
  name: 'gardening',
}

const author = {
  did: 'did:plc:author' as DID,
  handle: 'mari.local.coves.dev' as Handle,
}

/** The href of the anchor wrapping the post title. */
function titleHref(html: string): string | undefined {
  return /<h3\b[^>]*>[\s\S]*?<a\b[^>]*\bhref="([^"]*)"/.exec(html)?.[1]
}

describe('PostMeta title link', () => {
  it('addresses the post by its author, not by the repo DID', () => {
    // PostMeta holds the only author ref on the page, so it is the one place
    // that can turn the owner segment into the readable handle form.
    const html = render(PostMeta, {
      props: {
        uri: POST_URI,
        title: 'Companion planting',
        community,
        user: author,
      },
    }).body

    expect(titleHref(html)).toBe(
      '/c/gardening.local.coves.dev/post/mari.local.coves.dev/3lrkey',
    )
  })

  it('falls back to the repo DID when no author is passed', () => {
    const html = render(PostMeta, {
      props: {
        uri: POST_URI,
        title: 'Companion planting',
        community,
      },
    }).body

    expect(titleHref(html)).toBe(
      '/c/gardening.local.coves.dev/post/did%3Aplc%3Aauthor/3lrkey',
    )
  })
})
