import { mapCommunitySort } from '$lib/api/coves/sort'

export function load({ url }) {
  const sort = mapCommunitySort(url.searchParams.get('sort') ?? 'popular')
  const query = url.searchParams.get('q') ?? ''

  return { sort, query }
}
