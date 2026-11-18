// ---------------------------------------------------------------------------
// Subscribed communities (sidebar list and favorites)
//
// The sidebar lists every community the viewer subscribes to, favorites first.
// The list comes from social.coves.community.list with `subscribed: true`,
// paged to the end, and is held in one store per signed-in owner so every
// surface that shows it agrees.
//
// The list follows in-session subscription changes from ./subscription.svelte:
// an unsubscribe hides the row at once, and a community subscribed to in this
// session (handed over through `remember`) shows before the index catches up.
//
// Favorites use the same optimistic layer as subscriptions: overrides keyed by
// DID remember the server value they were pressed against, and fresh server
// data that disagrees with that snapshot supersedes them.
// ---------------------------------------------------------------------------

import { log } from '$lib/app/util/log'
import { communityAddress } from '$lib/app/util/community'
import type {
  CommunityRef,
  CommunityView,
  CommunityViewerState,
  ListCommunitiesParams,
  ListCommunitiesResponse,
} from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'
import { isSubscribed } from './subscription.svelte'

/** Page size for each social.coves.community.list request. */
export const SUBSCRIBED_PAGE_LIMIT = 100

/** Loop guard: never follow more pages than this, whatever the server says. */
const MAX_PAGES = 50

export interface SubscribedListApi {
  listCommunities(
    params: ListCommunitiesParams,
  ): Promise<ListCommunitiesResponse>
}

export interface FavoriteApi {
  subscribe(input: { community: DID; favorite: boolean }): Promise<void>
}

export interface SidebarCommunity {
  readonly did: DID
  readonly name: string
  readonly origin?: string
  readonly handle?: Handle
  readonly viewer?: CommunityViewerState
}

/**
 * Every community the viewer subscribes to, alphabetical as the server pages
 * them. Stops on a missing, empty or repeated cursor; a community that appears
 * on two pages is kept once, at its first position.
 */
export async function fetchAllSubscribedCommunities(
  api: SubscribedListApi,
): Promise<CommunityView[]> {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to one fetch, never held as reactive state
  const seen = new Set<DID>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to one fetch, never held as reactive state
  const cursors = new Set<string>()
  const result: CommunityView[] = []
  let cursor: string | undefined

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params: ListCommunitiesParams = {
      subscribed: true,
      sort: 'alphabetical',
      limit: SUBSCRIBED_PAGE_LIMIT,
    }
    if (cursor !== undefined) params.cursor = cursor
    const response = await api.listCommunities(params)

    for (const community of response.communities) {
      if (seen.has(community.did)) continue
      seen.add(community.did)
      result.push(community)
    }

    const next = response.cursor
    if (!next || cursors.has(next)) break
    cursors.add(next)
    cursor = next
  }

  return result
}

function compareByName(a: SidebarCommunity, b: SidebarCommunity): number {
  const byName = a.name.localeCompare(b.name, undefined, {
    sensitivity: 'base',
  })
  if (byName !== 0) return byName
  const byAddress = communityAddress(a).localeCompare(communityAddress(b))
  if (byAddress !== 0) return byAddress
  return a.did < b.did ? -1 : a.did > b.did ? 1 : 0
}

/**
 * Splits communities into favorites and the rest, each sorted by name
 * ignoring case. Ties break on address then DID, so the order never depends
 * on input order. The input array is left untouched.
 */
export function orderSidebarCommunities<T extends SidebarCommunity>(
  communities: readonly T[],
  isFavoriteCommunity: (community: T) => boolean,
): { favorites: T[]; others: T[] } {
  const favorites: T[] = []
  const others: T[] = []
  for (const community of communities) {
    if (isFavoriteCommunity(community)) {
      favorites.push(community)
    } else {
      others.push(community)
    }
  }
  favorites.sort(compareByName)
  others.sort(compareByName)
  return { favorites, others }
}

interface FavoriteOverride {
  /** The optimistic value. */
  favorite: boolean
  /** What the server said at press time; a different server value supersedes. */
  serverAtPress: boolean
}

interface FavoritableCommunity {
  readonly did: DID
  readonly viewer?: CommunityViewerState
}

const favoriteOverrides = new SvelteMap<DID, FavoriteOverride>()
const favoritePending = new SvelteSet<DID>()

function serverFavorite(community: FavoritableCommunity): boolean {
  return community.viewer?.favorite === true
}

/** Whether the viewer favorited this community, with any in-session change applied. */
export function isFavorite(community: FavoritableCommunity): boolean {
  const server = serverFavorite(community)
  const override = favoriteOverrides.get(community.did)
  if (override === undefined || override.serverAtPress !== server) return server
  return override.favorite
}

/** Whether a favorite change is in flight for this community. */
export function isFavoritePending(community: FavoritableCommunity): boolean {
  return favoritePending.has(community.did)
}

export type ToggleFavoriteOutcome =
  | { kind: 'ok'; favorite: boolean }
  | { kind: 'pending' }
  | { kind: 'error'; error: unknown }

/**
 * Flips the favorite optimistically, sends it through subscribe, and rolls
 * back on failure. A second press while one is in flight is ignored
 * (`pending`).
 */
export async function toggleFavorite(
  community: FavoritableCommunity,
  api: FavoriteApi,
): Promise<ToggleFavoriteOutcome> {
  const { did } = community
  if (favoritePending.has(did)) return { kind: 'pending' }

  const was = isFavorite(community)
  const next = !was
  const previous = favoriteOverrides.get(did)
  favoritePending.add(did)
  favoriteOverrides.set(did, {
    favorite: next,
    serverAtPress: serverFavorite(community),
  })

  try {
    await api.subscribe({ community: did, favorite: next })
    return { kind: 'ok', favorite: next }
  } catch (error) {
    log.error('[subscribed-communities] favorite toggle failed', error, {
      did,
      was,
    })
    if (previous === undefined) {
      favoriteOverrides.delete(did)
    } else {
      favoriteOverrides.set(did, previous)
    }
    return { kind: 'error', error }
  } finally {
    favoritePending.delete(did)
  }
}

/** What the sidebar needs of a subscribed community; any community view qualifies. */
export type ListedCommunity = CommunityRef & {
  readonly viewer?: CommunityViewerState
}

export type SubscribedCommunitiesStatus =
  'idle' | 'loading' | 'loaded' | 'error'

class SubscribedCommunitiesStore {
  status = $state<SubscribedCommunitiesStatus>('idle')
  owner = $state<DID | undefined>(undefined)
  #server = $state.raw<ListedCommunity[]>([])
  #remembered = new SvelteMap<DID, ListedCommunity>()
  #generation = 0

  /**
   * The server list plus communities subscribed to in this session, with
   * in-session unsubscribes hidden. A server entry wins over a remembered one
   * for the same DID.
   */
  get communities(): ListedCommunity[] {
    const serverDids = new Set(this.#server.map((c) => c.did))
    const merged = [...this.#server]
    for (const community of this.#remembered.values()) {
      if (!serverDids.has(community.did)) merged.push(community)
    }
    return merged.filter((community) => isSubscribed(community))
  }

  /**
   * Loads every subscribed community for `owner`. Switching owner drops the
   * previous owner's list first; a load superseded by a later one never
   * commits.
   */
  async load(api: SubscribedListApi, owner: DID): Promise<void> {
    this.#generation += 1
    const generation = this.#generation
    if (this.owner !== owner) {
      this.#server = []
      this.#remembered.clear()
      this.owner = owner
    }
    this.status = 'loading'

    try {
      const communities = await fetchAllSubscribedCommunities(api)
      if (generation !== this.#generation) return
      this.#server = communities
      this.status = 'loaded'
    } catch (error) {
      if (generation !== this.#generation) return
      log.error('[subscribed-communities] load failed', error, { owner })
      this.status = 'error'
    }
  }

  /** Keeps a community subscribed to in this session until the server lists it. */
  remember(community: ListedCommunity): void {
    this.#remembered.set(community.did, community)
  }

  /** Back to idle with no owner and an empty list. */
  reset(): void {
    this.#generation += 1
    this.#server = []
    this.#remembered.clear()
    this.owner = undefined
    this.status = 'idle'
  }
}

export const subscribedCommunities = new SubscribedCommunitiesStore()

/** Test seam: forget favorite overrides, in-flight markers and the store. */
export function resetSubscribedCommunitiesState(): void {
  favoriteOverrides.clear()
  favoritePending.clear()
  subscribedCommunities.reset()
}
