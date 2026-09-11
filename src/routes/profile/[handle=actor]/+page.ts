import { error } from '@sveltejs/kit'
import { coves } from '$lib/api/client.svelte'
import { XrpcError } from '$lib/api/coves/xrpc'
import { isValidDID, isValidHandle } from '$lib/types/atproto'
import { ReactiveState } from '$lib/app/util/reactive.svelte'
import { feed } from '$lib/feature/feeds/feed.svelte'

export async function load({ params, url, fetch, route }) {
  const postsCursor = url.searchParams.get('postsCursor') ?? undefined
  const commentsCursor = url.searchParams.get('commentsCursor') ?? undefined

  const feedData = await feed(route.id, async (p) => {
    if (!isValidHandle(p.actor) && !isValidDID(p.actor)) {
      error(400, 'Invalid user identifier')
    }
    const actor = p.actor
    const api = coves({ func: fetch })

    const [profileData, postsData, commentsData] = await Promise.all([
      api.getProfile({ actor }).catch((e: unknown) => {
        // Scoped to this call deliberately: of the three, only getProfile
        // answers "does this account exist?". A 404 from the posts or comments
        // call is an infrastructure fault — a stale AppView, a proxy misroute —
        // and telling the viewer the account is gone would turn an outage into
        // a deleted-account story. Those propagate untouched.
        //
        // Bare i18n key, not prose: `errorMessage` in $lib/app/util/error.ts only
        // translates messages matching /^[\w-]+$/.
        if (e instanceof XrpcError && e.status === 404) {
          error(404, 'couldnt_find_person')
        }
        throw e
      }),
      api.getActorPosts({ actor, limit: p.limit, cursor: p.postsCursor }),
      api.getActorComments({ actor, limit: p.limit, cursor: p.commentsCursor }),
    ])

    return {
      profile: profileData,
      posts: postsData,
      comments: commentsData,
    }
  }).load({
    actor: params.handle,
    limit: 20,
    postsCursor,
    commentsCursor,
  })

  return {
    data: new ReactiveState(feedData),
  }
}
