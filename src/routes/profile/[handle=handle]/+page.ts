import { error } from '@sveltejs/kit'
import { coves } from '$lib/api/client.svelte'
import { isValidDID, isValidHandle } from '$lib/types/atproto'
import { ReactiveState } from '$lib/app/util.svelte'
import { feed } from '$lib/feature/feeds/feed.svelte'

export async function load({ params, url, fetch, route }) {
  const cursor = url.searchParams.get('cursor') ?? undefined
  const sort = url.searchParams.get('sort') ?? 'new'

  const feedData = await feed(route.id, async (p) => {
    if (!isValidHandle(p.actor) && !isValidDID(p.actor)) {
      error(400, 'Invalid user identifier')
    }
    const actor = p.actor

    try {
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
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        error(404, 'couldnt_find_person')
      }
      error(500, 'Failed to load profile')
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
