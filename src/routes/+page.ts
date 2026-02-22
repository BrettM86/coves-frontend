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
    const isTimeline = params.listing === 'timeline'
    const response = isTimeline
      ? await coves({ func: fetch }).getTimeline({
          sort: params.sort,
          timeframe: params.timeframe,
          limit: params.limit,
          cursor: params.cursor,
        })
      : await coves({ func: fetch }).getDiscover({
          sort: params.sort,
          timeframe: params.timeframe,
          limit: params.limit,
          cursor: params.cursor,
        })

    return {
      feed: response.feed,
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

  return {
    feed: new ReactiveState((await awaitIfServer(feedData)).data),
    filters: new ReactiveState({
      sort: mapped.sort,
      timeframe: mapped.timeframe,
      type_: listing,
    }),
    contextual: {
      actions: [
        {
          name: t.get('routes.post.scrollToTop'),
          handle: () => window?.scrollTo({ top: 0, behavior: 'instant' }),
          icon: ChevronDoubleUp,
        },
      ],
    },
  }
}
