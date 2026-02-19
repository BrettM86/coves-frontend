import { coves } from '$lib/api/client.svelte'
import { mapSort } from '$lib/app/sort'
import { feed } from '$lib/feature/feeds/feed.svelte.js'

export async function load({ fetch, parent }) {
  const { query, sort } = await parent()

  const feedInstance = feed('/explore/communities', async (params) =>
    params.query
      ? await coves({ func: fetch }).searchCommunities({
          query: params.query,
          limit: 40,
          offset: params.offset,
        })
      : await coves({ func: fetch }).listCommunities({
          limit: 40,
          sort: params.sort ? mapSort(params.sort).sort : undefined,
          offset: params.offset,
        }),
  )

  const feedData = await feedInstance.load({
    query,
    sort,
  })

  return {
    communities: feedData?.communities ?? [],
    error: feedInstance.error,
    sort: sort,
    query: query,
  }
}
