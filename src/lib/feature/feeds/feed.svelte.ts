import { browser } from '$app/environment'
import type {
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
import { profile } from '$lib/app/auth.svelte'
import { recursiveEqual } from '$lib/app/util.svelte'
import { SvelteMap } from 'svelte/reactivity'

// TODO(coves-migration): Remove this stub once legacy routes (/f/[id], /topic/[id])
// are migrated to Coves API. It exists only to keep FeedTypes typings for unmigrated routes.
/** Placeholder for legacy Lemmy types in unmigrated routes. */
type LegacyRecord = Record<string, unknown>

type FetchFn<P, R> = (params: P) => R

export class Feed<Params, Response> {
  #data = $state<Response>()
  #fetch: FetchFn<Params, Response>
  #lastParams?: Params
  error = $state<unknown>()

  constructor(fetch: FetchFn<Params, Response>) {
    this.#fetch = fetch
  }

  async load(params: Params) {
    if (!recursiveEqual(params, this.#lastParams)) {
      this.#data = undefined
      this.error = undefined
    }
    this.#lastParams = params

    if (this.#data == null) {
      try {
        this.#data = await this.#fetch(params)
        this.error = undefined
      } catch (err) {
        console.error('[Feed] fetch failed:', err)
        this.error = err
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
  '/c/[handle]': [
    FeedPaginationParams & { community: string },
    {
      feed: FeedViewPost[]
      community: CommunityViewDetailed
      cursor?: string
      params: FeedPaginationParams & { community: string; cursor?: string }
    },
  ]
  '/profile/[handle=handle]': [
    { actor: string; limit?: number; cursor?: string; sort?: string },
    {
      profile: ProfileViewDetailed
      posts: GetActorPostsResponse
      comments: GetActorCommentsResponse
    },
  ]
  '/c/[handle]/post/[rkey]': [
    {
      postUri: string
      comments: GetCommentsParams
      preload?: CovesPostView
      thread: {
        showContext?: boolean
        singleThread?: boolean
        focus?: string
      }
    },
    {
      post: CovesPostView
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
  '/explore/communities': [
    {
      sort?: string
      query?: string
      limit?: number
      offset?: number
    },
    {
      communities: CovesCommunityView[]
    },
  ]
  // TODO(coves-migration): convert to Coves types — legacy Lemmy feed route
  '/f/[id]': [
    LegacyRecord,
    {
      posts: LegacyRecord[]
      next_page?: string
      params: LegacyRecord & { page_cursor: string }
      feed: Promise<LegacyRecord | undefined>
      client: {
        itemHeights?: (number | null)[]
        lastSeen?: number
      }
    },
  ]
  // TODO(coves-migration): convert to Coves types — legacy Lemmy topic route
  '/topic/[id]': [
    LegacyRecord,
    {
      posts: LegacyRecord[]
      next_page?: string
      params: LegacyRecord & { page_cursor: string }
      topic: Promise<LegacyRecord | undefined>
      client: {
        itemHeights?: (number | null)[]
        lastSeen?: number
      }
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
  if (browser && existing) return existing as Feed<P, R>

  const feedData = new Feed<P, R>(init as unknown as FetchFn<P, R>)
  feeds.set(id, feedData as Feed<unknown, unknown>)

  return feedData
}

// feed hooks
$effect.root(() => {
  $effect(() => {
    if (profile.meta.profile) feeds.clear()
  })
})
