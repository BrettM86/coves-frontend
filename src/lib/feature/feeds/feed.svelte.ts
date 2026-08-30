import { browser } from '$app/environment'
import type {
  AtUri,
  CommunityView as CovesCommunityView,
  CommunityViewDetailed,
  FeedPaginationParams,
  FeedViewPost,
  GetActorCommentsResponse,
  GetActorPostsResponse,
  GetCommentsParams,
  PostView as CovesPostView,
  ProfileViewDetailed,
  ThreadViewComment,
} from '$lib/api/coves/types'
import type { CommunitySortType } from '$lib/api/coves/sort'
import { profile } from '$lib/app/state/auth.svelte'
import { recursiveEqual } from '$lib/app/util/array'
import { log } from '$lib/app/util/log'
import { SvelteMap } from 'svelte/reactivity'

type FetchFn<P, R> = (params: P) => R

export class Feed<Params, Response> {
  #data = $state<Response>()
  #fetch: FetchFn<Params, Response>
  #lastParams?: Params
  /**
   * Monotonic load counter. Loads overlap routinely on a cached instance —
   * rapid client-side navigations, and sort changes that `goto` +
   * `invalidateAll` — and their fetches can settle out of order. Only the
   * newest load may commit to `#data`/`error`; a superseded fetch still
   * settles its own caller's promise, but must never write state that by then
   * describes a later load.
   */
  #generation = 0
  error = $state<unknown>()

  constructor(fetch: FetchFn<Params, Response>) {
    this.#fetch = fetch
  }

  /**
   * Replaces the fetcher on a cached instance. Each load() run builds a fresh
   * init closure (over that run's `fetch`, and potentially that run's route
   * params); keeping the newest one means a cached feed can never refetch
   * using a previous navigation's captured values.
   */
  setFetch(fetch: FetchFn<Params, Response>): void {
    this.#fetch = fetch
  }

  async load(params: Params) {
    if (!recursiveEqual(params, this.#lastParams)) {
      this.#data = undefined
      this.error = undefined
    }
    this.#lastParams = params

    const generation = ++this.#generation

    if (this.#data == null) {
      try {
        const result = await this.#fetch(params)
        // A newer load started while this fetch was in flight: hand the result
        // back to this caller (it is coherent with the params *it* asked for)
        // but leave the cache to the newer load, which now owns `#lastParams`.
        if (generation !== this.#generation) return result
        this.#data = result
        this.error = undefined
      } catch (err) {
        log.error('[Feed] fetch failed', err)
        // Superseded failures still reject their own caller, but must not
        // raise an error banner over whatever the newer load rendered.
        if (generation === this.#generation) this.error = err
        throw err
      }
    }

    return this.#data
  }

  peek() {
    return this.#data
  }

  update(value: Response) {
    this.#data = value
  }
}

export interface FeedTypes {
  '/': [
    FeedPaginationParams & { listing?: 'discover' | 'timeline' },
    {
      feed: FeedViewPost[]
      cursor?: string
      params: FeedPaginationParams & {
        listing?: 'discover' | 'timeline'
        cursor?: string
      }
    },
  ]
  '/c/[handle=handle]': [
    FeedPaginationParams & { community: string },
    {
      feed: FeedViewPost[]
      community: CommunityViewDetailed
      cursor?: string
      params: FeedPaginationParams & { community: string; cursor?: string }
    },
  ]
  '/profile/[handle=actor]': [
    { actor: string; limit?: number; cursor?: string },
    {
      profile: ProfileViewDetailed
      posts: GetActorPostsResponse
      comments: GetActorCommentsResponse
    },
  ]
  '/c/[handle=handle]/post/[rkey]': [
    {
      postUri: string
      comments: GetCommentsParams
      preload?: CovesPostView
      /** Preload is the just-created post — skip the comments fetch entirely. */
      freshPost?: boolean
      /** Poll briefly when the post isn't indexed yet (fresh-create redirect). */
      retryUnavailable?: boolean
      thread: {
        showContext?: boolean
        singleThread?: boolean
        focus?: string
      }
    },
    // Discriminated on `unavailable`: present ('notFound' | 'blocked') ⇒ the post
    // could not be hydrated and there is no `post`; absent ⇒ `post` is present.
    // This makes the illegal { post, unavailable } state unrepresentable and lets
    // consumers read `value.post` for free in the happy branch.
    (
      | { post: CovesPostView; unavailable?: never }
      | { post?: never; unavailable: 'notFound' | 'blocked' }
    ) & {
      comments: Promise<ThreadViewComment[]>
      params: {
        postUri: string
        comments: GetCommentsParams
        thread: {
          showContext?: boolean
          singleThread?: boolean
          focus?: string
        }
      }
    },
  ]
  '/c/[handle=handle]/post/[rkey]/comment/[crkey]': [
    {
      postUri: string
      comments: GetCommentsParams
    },
    // Unlike the post page there is no unavailable branch: the comment
    // permalink loader 404s when the post or comment cannot be hydrated, so a
    // cached value always carries a post and the focused comment's subtree.
    {
      post: CovesPostView
      comments: Promise<ThreadViewComment[]>
      focused: { uri: AtUri; rkey: string; parentUri?: AtUri }
      params: { postUri: string; comments: GetCommentsParams }
    },
  ]
  '/explore/communities': [
    {
      sort?: CommunitySortType
      query?: string
      limit?: number
      cursor?: string
    },
    {
      communities: CovesCommunityView[]
      cursor?: string
    },
  ]
}

export const feeds = new SvelteMap<keyof FeedTypes, Feed<unknown, unknown>>()

export function feed<Type extends keyof FeedTypes>(
  id: Type,
  init: (params: FeedTypes[Type][0]) => Promise<FeedTypes[Type][1]>,
): Feed<FeedTypes[Type][0], FeedTypes[Type][1]> {
  type P = FeedTypes[Type][0]
  type R = FeedTypes[Type][1]

  const existing = feeds.get(id)
  // The map erases per-route type info; the cast is safe because each route ID
  // is only ever written with its matching Feed<P, R>.
  if (browser && existing) {
    const cached = existing as Feed<P, R>
    cached.setFetch(init as unknown as FetchFn<P, R>)
    return cached
  }

  const feedData = new Feed<P, R>(init as unknown as FetchFn<P, R>)
  // Browser only: `feeds` is keyed by route id and shared by every visitor a
  // server process renders, so an entry cached here would hand one request's
  // posts to the next. Each server render gets its own Feed and drops it.
  if (browser) feeds.set(id, feedData as Feed<unknown, unknown>)

  return feedData
}

// feed hooks
$effect.root(() => {
  $effect(() => {
    if (profile.meta.profile) feeds.clear()
  })
})
