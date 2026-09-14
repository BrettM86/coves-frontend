import type { FeedPaginationParams } from '$lib/api/coves/types'
import { coves } from '$lib/api/client.svelte'
import { profile } from '$lib/app/state/auth.svelte'
import { t } from '$lib/app/state/i18n'
import { settings } from '$lib/app/state/settings.svelte'
import { mapListing, resolveFeedSort } from '$lib/api/coves/sort'
import { ReactiveState } from '$lib/app/util/reactive.svelte'
import { awaitIfServer } from '$lib/app/util/ssr'
import { feed } from '$lib/feature/feeds/feed.svelte'
import { ChevronsUp } from '$lib/ui/kit/icon'
export async function load({ url, fetch, route }) {
  const cursor = url.searchParams.get('cursor') as string | undefined

  const listingType = url.searchParams.get('type') ?? settings.defaultSort.feed

  const mapped = resolveFeedSort(url, settings.defaultSort)
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
      virtualList: { itemHeights: [] },
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
          icon: ChevronsUp,
        },
      ],
    },
  }
}
