import { describe, expect, it } from 'vitest'
import type { AtUri, CID, ModerationView, PostView } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import { isSensitivePost } from './content-labels'

function post(labels: unknown, moderation?: ModerationView): PostView {
  return {
    uri: 'at://did:plc:author/social.coves.community.postv2/one' as AtUri,
    cid: 'bafyreiexample' as CID,
    rkey: 'one',
    indexedAt: '2026-09-01T00:00:00Z',
    createdAt: '2026-09-01T00:00:00Z',
    author: {
      did: 'did:plc:author' as DID,
      handle: 'author.example' as Handle,
    },
    community: { did: 'did:plc:community' as DID, name: 'Community' },
    record: {
      $type: 'social.coves.community.post',
      community: 'did:plc:community',
      author: 'did:plc:author',
      createdAt: '2026-09-01T00:00:00Z',
      title: 'Post title',
      labels,
    },
    moderation,
  }
}

const selfNsfw = {
  $type: 'com.atproto.label.defs#selfLabels',
  values: [{ val: 'nsfw' }],
}

describe('isSensitivePost', () => {
  it('is true for an author self-label of nsfw', () => {
    expect(isSensitivePost(post(selfNsfw))).toBe(true)
  })

  it('is true for a moderator nsfw content label on an unlabelled record', () => {
    const moderation: ModerationView = {
      state: 'clear',
      contentLabels: [
        {
          value: 'nsfw',
          sources: [
            {
              authorityDid: 'did:plc:instance' as DID,
              scope: { kind: 'instance' },
            },
          ],
        },
      ],
    }

    expect(isSensitivePost(post(undefined, moderation))).toBe(true)
  })

  it('is true for an nsfw content label whose sources were truncated away', () => {
    const moderation: ModerationView = {
      state: 'clear',
      contentLabels: [{ value: 'nsfw', sourcesTruncated: true }],
    }

    expect(isSensitivePost(post(undefined, moderation))).toBe(true)
  })

  it('is false for a content label other than nsfw', () => {
    const moderation: ModerationView = {
      state: 'clear',
      contentLabels: [{ value: 'spoiler' }],
    }

    expect(isSensitivePost(post(undefined, moderation))).toBe(false)
  })

  it('is false with neither a self-label nor a content label', () => {
    expect(isSensitivePost(post(undefined))).toBe(false)
  })

  it.each([
    ['an object', { value: 'nsfw' }],
    ['a string', 'nsfw'],
  ])(
    'is false, without throwing, when contentLabels is %s',
    (_case, labels) => {
      // Moderation data arrives from the backend unchecked.
      const moderation = {
        state: 'clear',
        contentLabels: labels,
      } as unknown as ModerationView

      expect(isSensitivePost(post(undefined, moderation))).toBe(false)
    },
  )

  it('skips non-object content labels and still reads an nsfw one after them', () => {
    const moderation = {
      state: 'clear',
      contentLabels: [null, 'nsfw', { value: 'nsfw' }],
    } as unknown as ModerationView

    expect(isSensitivePost(post(undefined, moderation))).toBe(true)
  })

  it('is false for a negated nsfw self-label', () => {
    const negated = {
      $type: 'com.atproto.label.defs#selfLabels',
      values: [{ val: 'nsfw', neg: true }],
    }

    expect(isSensitivePost(post(negated))).toBe(false)
  })
})
