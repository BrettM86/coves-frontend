import { error, redirect } from '@sveltejs/kit'
import { coves } from '$lib/api/client.svelte'
import { isHydratedPost, isLikedItem } from '$lib/api/coves/types'
import { XrpcError } from '$lib/api/coves/xrpc'
import { isValidDID, isValidHandle } from '$lib/types/atproto'
import { log } from '$lib/app/util/log'
import { ReactiveState } from '$lib/app/util/reactive.svelte'
import { feed } from '$lib/feature/feeds/feed.svelte'
import { likesFilter, profileTab } from './tabs'

export async function load({ params, url, fetch, route }) {
  const tab = profileTab(url.searchParams.get('type'))
  const cursor = url.searchParams.get(`${tab}Cursor`) ?? undefined
  const filter =
    tab === 'likes' ? likesFilter(url.searchParams.get('likes')) : undefined

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

    if (p.tab === 'likes') {
      // Both requests settle before either outcome is read, so the profile's
      // answer (a missing account's 404) wins over the likes rejection and
      // neither rejection is left unhandled.
      const filter = p.likesFilter ?? 'all'
      const [profile, likes] = await Promise.allSettled([
        profileRequest,
        api.getActorLikes({
          actor,
          limit: p.limit,
          cursor: p.cursor,
          // All is the unfiltered list, so it sends no filter key at all.
          ...(filter !== 'all' && { filter }),
        }),
      ])
      if (profile.status === 'rejected') throw profile.reason
      if (likes.status === 'rejected') {
        const e: unknown = likes.reason
        // Likes are private to their owner: signed out answers 401
        // AuthenticationRequired, anyone else 403 NotAllowed. A shared
        // ?type=likes link then lands on the posts tab, with every other
        // param dropped: the likes cursor means nothing to posts.
        if (
          e instanceof XrpcError &&
          ((e.status === 401 && e.errorName === 'AuthenticationRequired') ||
            (e.status === 403 && e.errorName === 'NotAllowed'))
        ) {
          redirect(307, `${url.pathname}?type=posts`)
        }
        throw e
      }
      return {
        profile: profile.value,
        tab: 'likes' as const,
        likesFilter: filter,
        likes: {
          ...likes.value,
          // A newer server may add item kinds this client cannot render.
          feed: likes.value.feed.filter(isLikedItem),
        },
      }
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
    ...(filter && { likesFilter: filter }),
  })

  return {
    data: new ReactiveState(feedData),
  }
}
