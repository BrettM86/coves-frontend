import { error } from '@sveltejs/kit'
import { coves } from '$lib/api/client.svelte'
import { isHydratedPost } from '$lib/api/coves/types'
import { XrpcError } from '$lib/api/coves/xrpc'
import { isValidDID, isValidHandle } from '$lib/types/atproto'
import { log } from '$lib/app/util/log'
import { ReactiveState } from '$lib/app/util/reactive.svelte'
import { feed } from '$lib/feature/feeds/feed.svelte'
import { profileTab } from './tabs'

export async function load({ params, url, fetch, route }) {
  const tab = profileTab(url.searchParams.get('type'))
  const cursor =
    url.searchParams.get(tab === 'posts' ? 'postsCursor' : 'commentsCursor') ??
    undefined

  const feedData = await feed(route.id, async (p) => {
    if (!isValidHandle(p.actor) && !isValidDID(p.actor)) {
      error(400, 'Invalid user identifier')
    }
    const actor = p.actor
    const api = coves({ func: fetch })

    const profileRequest = api.getProfile({ actor }).catch((e: unknown) => {
      // Scoped to this call deliberately: only getProfile answers "does this
      // account exist?". A 404 from the posts or comments call is an
      // infrastructure fault — a stale AppView, a proxy misroute — and telling
      // the viewer the account is gone would turn an outage into a
      // deleted-account story. Those propagate untouched.
      //
      // Bare i18n key, not prose: `errorMessage` in $lib/app/util/error.ts only
      // translates messages matching /^[\w-]+$/.
      if (e instanceof XrpcError && e.status === 404) {
        error(404, 'couldnt_find_person')
      }
      throw e
    })

    if (p.tab === 'posts') {
      const [profile, posts] = await Promise.all([
        profileRequest,
        api.getActorPosts({ actor, limit: p.limit, cursor: p.cursor }),
      ])
      return { profile, tab: 'posts' as const, posts }
    }

    const loadComments = async () => {
      const comments = await api.getActorComments({
        actor,
        limit: p.limit,
        cursor: p.cursor,
      })
      const uris = [
        ...new Set(comments.comments.map((comment) => comment.post.uri)),
      ]
      // getPosts takes 1–25 URIs, so an empty page skips it.
      if (uris.length === 0) return { comments, commentPosts: [] }
      // Parents only add context and permalinks, so a failed lookup shows the
      // comments without them rather than failing the tab.
      const commentPosts = await api.getPosts({ uris }).then(
        ({ posts }) => posts.filter(isHydratedPost),
        (e: unknown) => {
          log.warn('[profile] comment parent posts failed to load', e)
          return []
        },
      )
      return { comments, commentPosts }
    }
    const [profile, comments] = await Promise.all([
      profileRequest,
      loadComments(),
    ])
    return { profile, tab: 'comments' as const, ...comments }
  }).load({
    actor: params.handle,
    limit: 20,
    tab,
    cursor,
  })

  return {
    data: new ReactiveState(feedData),
  }
}
