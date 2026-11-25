/**
 * The profile loader in the browser, where `feed()` caches one Feed per route
 * and reuses it across navigations. Switching the Likes filter must refetch
 * rather than hand back the previous filter's cached page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('$app/environment', () => ({
  browser: true,
  dev: false,
  building: false,
}))

const mockCovesMethods = vi.hoisted(() => ({
  getProfile: vi.fn(),
  getActorPosts: vi.fn(),
  getActorComments: vi.fn(),
  getActorLikes: vi.fn(),
  getPosts: vi.fn(),
}))

vi.mock('$lib/api/client.svelte', () => ({
  coves: () => mockCovesMethods,
}))

// `feed.svelte.ts` imports `profile` purely for its cache-clearing effect; the
// real module reads localStorage at import time, which node has no notion of.
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: { meta: { profile: undefined } },
}))

import { feeds } from '$lib/feature/feeds/feed.svelte'
import { load } from './+page'

function makeArgs(handle: string, query: string): Parameters<typeof load>[0] {
  return {
    params: { handle },
    url: new URL(`https://coves.test/profile/${handle}${query}`),
    fetch: vi.fn(),
    route: { id: '/profile/[handle=actor]' },
  } as unknown as Parameters<typeof load>[0]
}

const profileFixture = { did: 'did:plc:alice', handle: 'alice.coves.social' }

const allPage = {
  feed: [
    {
      $type: 'social.coves.actor.getLikes#likedPost',
      post: { uri: 'at://did:plc:bob/social.coves.community.post/p1' },
    },
  ],
  cursor: 'a2',
}
const commentsPage = {
  feed: [
    {
      $type: 'social.coves.actor.getLikes#likedComment',
      comment: { uri: 'at://did:plc:dave/social.coves.community.comment/c1' },
      post: { uri: 'at://did:plc:carol/social.coves.community.post/p2' },
    },
  ],
  cursor: 'k2',
}

describe('profile loader likes filter in the browser', () => {
  beforeEach(() => {
    feeds.clear()
    mockCovesMethods.getProfile.mockReset().mockResolvedValue(profileFixture)
    mockCovesMethods.getActorLikes
      .mockReset()
      .mockResolvedValueOnce(allPage)
      .mockResolvedValueOnce(commentsPage)
  })

  it('refetches when the filter switches on the cached profile feed', async () => {
    await load(makeArgs('alice.coves.social', '?type=likes'))
    const result = await load(
      makeArgs('alice.coves.social', '?type=likes&likes=comments'),
    )

    expect(mockCovesMethods.getActorLikes).toHaveBeenCalledTimes(2)
    expect(mockCovesMethods.getActorLikes).toHaveBeenNthCalledWith(2, {
      actor: 'alice.coves.social',
      limit: 20,
      filter: 'comments',
    })
    expect(result.data.value).toEqual({
      profile: profileFixture,
      tab: 'likes',
      likesFilter: 'comments',
      likes: commentsPage,
    })
  })
})
