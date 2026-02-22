import { coves } from '$lib/api/client.svelte'
import { settings } from '$lib/app/settings.svelte'
import { mapSort } from '$lib/app/sort'
import { communityHandleFromSlug } from '$lib/app/util.svelte'
import type { Handle } from '$lib/types/atproto'
import CommunityCard from '$lib/feature/community/CommunityCard.svelte'
import { feed } from '$lib/feature/feeds/feed.svelte'

export async function load({ params, fetch, url, route }) {
  const cursor = url.searchParams.get('cursor') as string | undefined

  const sort = url.searchParams.get('sort') ?? settings.defaultSort.sort
  const timeframe = url.searchParams.get('timeframe') ?? undefined

  const communityHandle = communityHandleFromSlug(params.handle) as Handle
  const mapped = mapSort(sort, timeframe)

  const feedData = await feed(route.id, async (p) => {
    const api = coves({ func: fetch })

    const [feedResponse, communityData] = await Promise.all([
      api.getCommunityFeed({
        community: communityHandle,
        sort: mapped.sort,
        timeframe: mapped.timeframe,
        limit: p.limit,
        cursor: p.cursor,
      }),
      api.getCommunity({ community: communityHandle }),
    ])

    return {
      feed: feedResponse.feed,
      community: communityData,
      cursor: feedResponse.cursor,
      params: { ...p, cursor: feedResponse.cursor },
    }
  }).load({
    community: params.handle,
    sort: mapped.sort,
    timeframe: mapped.timeframe,
    limit: 20,
    cursor: cursor,
  })

  return {
    ...feedData,
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
