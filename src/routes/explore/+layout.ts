import { mapCommunitySort } from '$lib/app/sort'

export function load({ url }) {
  const sort = mapCommunitySort(url.searchParams.get('sort') ?? 'popular')
  const query = url.searchParams.get('q') ?? ''

  return { sort, query }
}
