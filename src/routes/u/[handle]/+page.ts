import { coves } from '$lib/api/client.svelte'
import type { Handle } from '$lib/types/atproto'
import { ReactiveState } from '$lib/app/util.svelte'
import { feed } from '$lib/feature/feeds/feed.svelte'

export async function load({ params, url, fetch, route }) {
  const cursor = url.searchParams.get('cursor') ?? undefined
  const sort = url.searchParams.get('sort') ?? 'new'

  const feedData = await feed(route.id, async (p) => {
    const actor = p.actor as Handle
    const [profileData, postsData, commentsData] = await Promise.all([
      coves({ func: fetch }).getProfile({ actor }),
      coves({ func: fetch }).getActorPosts({
        actor,
        limit: p.limit,
        cursor: p.cursor,
      }),
      coves({ func: fetch }).getActorComments({
        actor,
        limit: p.limit,
        cursor: p.cursor,
      }),
    ])

    return {
      profile: profileData,
      posts: postsData,
      comments: commentsData,
    }
  }).load({
    actor: params.handle,
    limit: 20,
    cursor,
    sort,
  })

  return {
    data: new ReactiveState(feedData),
  }
}
