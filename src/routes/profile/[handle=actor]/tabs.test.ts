import { describe, expect, it } from 'vitest'
import type { CommentView, PostView } from '$lib/api/coves/types'
import { profileCommentHref, profileTab } from './tabs'

describe('profileTab', () => {
  it.each([
    ['comments', 'comments'],
    ['posts', 'posts'],
    ['all', 'posts'],
    [null, 'posts'],
    ['bogus', 'posts'],
  ] as const)('maps %j to %s', (type, tab) => {
    expect(profileTab(type)).toBe(tab)
  })
})

describe('profileCommentHref', () => {
  const post = {
    uri: 'at://did:plc:alice/social.coves.community.post/p1',
    author: { did: 'did:plc:alice', handle: 'alice.coves.social' },
    community: { did: 'did:plc:sci', name: 'science' },
  } as unknown as PostView
  const comment = {
    uri: 'at://did:plc:alice/social.coves.community.comment/c1',
    author: { did: 'did:plc:alice', handle: 'alice.coves.social' },
    post: { uri: post.uri },
  } as unknown as CommentView

  it('links a comment to its permalink under the hydrated parent post', () => {
    expect(profileCommentHref(comment, post)).toBe(
      '/c/did%3Aplc%3Asci/post/alice.coves.social/p1/comment/alice.coves.social/c1',
    )
  })

  // A parent getPosts could not hydrate (deleted, blocked) has no community
  // to route through, so the comment renders without a link.
  it('gives no link when the parent post is not hydrated', () => {
    expect(profileCommentHref(comment, undefined)).toBeUndefined()
  })
})
