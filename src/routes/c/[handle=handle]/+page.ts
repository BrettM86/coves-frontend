import type { FeedPaginationParams } from '$lib/api/coves/types'
import { coves } from '$lib/api/client.svelte'
import { XrpcError } from '$lib/api/coves/xrpc'
import { settings } from '$lib/app/state/settings.svelte'
import { error } from '@sveltejs/kit'
import { resolveFeedSort } from '$lib/api/coves/sort'
import type { Handle } from '$lib/types/atproto'
import CommunityCard from '$lib/feature/community/CommunityCard.svelte'
import { feed } from '$lib/feature/feeds/feed.svelte'

export async function load({ params, fetch, url, route }) {
  const cursor = url.searchParams.get('cursor') as string | undefined

  // Sent verbatim: the AppView resolves a DID, a bare handle, or a "c-"
  // prefixed handle, so the slug needs no rewriting here.
  const communityHandle = params.handle as Handle
  const mapped = resolveFeedSort(url, settings.defaultSort)

  let feedData
  try {
    feedData = await feed(route.id, async (p) => {
      const api = coves({ func: fetch })

      // Every community shares the route ID `/c/[handle=handle]`, so the cache
      // can hand this closure back on a later navigation to a *different*
      // community or sort. Read the identity of the request from `p` only —
      // anything captured from the enclosing load() run would be stale.
      // The route's `handle` matcher guarantees the slug is handle-shaped.
      const community = p.community as Handle

      const [feedResponse, communityData] = await Promise.all([
        api.getCommunityFeed({
          community,
          sort: p.sort,
          timeframe: p.timeframe,
          limit: p.limit,
          cursor: p.cursor,
        }),
        api.getCommunity({ community }),
      ])

      return {
        feed: feedResponse.feed ?? [],
        community: communityData,
        cursor: feedResponse.cursor,
        params: { ...p, cursor: feedResponse.cursor },
      }
    }).load({
      community: communityHandle,
      sort: mapped.sort,
      timeframe: mapped.timeframe,
      limit: 20,
      cursor: cursor,
    })
  } catch (e) {
    if (e instanceof XrpcError && e.status === 404) {
      error(404, 'Community not found')
    }
    throw e
  }

  return {
    ...feedData,
    loadFeed: async (params: FeedPaginationParams) => {
      const response = await coves({ func: fetch }).getCommunityFeed({
        ...params,
        community: communityHandle,
      })
      return { feed: response.feed ?? [], cursor: response.cursor }
    },
    slots: {
      sidebar: {
        component: CommunityCard,
        props: {
          community: feedData?.community,
        },
      },
    },
  }
}
