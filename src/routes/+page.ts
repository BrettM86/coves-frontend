import type { FeedPaginationParams } from '$lib/api/coves/types'
import { coves } from '$lib/api/client.svelte'
import { profile } from '$lib/app/auth.svelte'
import { t } from '$lib/app/i18n'
import { settings } from '$lib/app/settings.svelte'
import { mapListing, mapSort } from '$lib/app/sort'
import { ReactiveState, awaitIfServer } from '$lib/app/util.svelte'
import { feed } from '$lib/feature/feeds/feed.svelte'
import { ChevronDoubleUp } from '@xylightdev/svelte-hero-icons'

export async function load({ url, fetch, route }) {
  const cursor = url.searchParams.get('cursor') as string | undefined

  const sort = url.searchParams.get('sort') ?? settings.defaultSort.sort
  const timeframe = url.searchParams.get('timeframe') ?? undefined
  const listingType = url.searchParams.get('type') ?? settings.defaultSort.feed

  const mapped = mapSort(sort, timeframe)
  const listing = mapListing(listingType, profile.isAuthenticated)

  const feedData = feed(route.id, async (params) => {
    const { listing, ...rest } = params
    const isTimeline = listing === 'timeline'
    const response = isTimeline
      ? await coves({ func: fetch }).getTimeline(rest)
      : await coves({ func: fetch }).getDiscover(rest)

    return {
      feed: response.feed ?? [],
      cursor: response.cursor,
      params: { ...params, cursor: response.cursor },
    }
  }).load({
    cursor: cursor,
    sort: mapped.sort,
    timeframe: mapped.timeframe,
    listing: listing,
    limit: 20,
  })

  const filters = new ReactiveState({
    sort: mapped.sort,
    timeframe: mapped.timeframe,
    type_: listing,
  })

  return {
    feed: new ReactiveState((await awaitIfServer(feedData)).data),
    filters,
    loadFeed: async (params: FeedPaginationParams) => {
      const isTimeline = filters.value.type_ === 'timeline'
      const response = isTimeline
        ? await coves({ func: fetch }).getTimeline(params)
        : await coves({ func: fetch }).getDiscover(params)
      return { feed: response.feed ?? [], cursor: response.cursor }
    },
    contextual: {
      actions: [
        {
          // Lazy: load() can run before translations finish loading
          get name() {
            return t.get('routes.post.scrollToTop')
          },
          handle: () => window?.scrollTo({ top: 0, behavior: 'instant' }),
          icon: ChevronDoubleUp,
        },
      ],
    },
  }
}
