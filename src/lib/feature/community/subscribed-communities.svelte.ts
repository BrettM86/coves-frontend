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
import { XrpcError } from '$lib/api/coves'
import { communityAddress } from '$lib/app/util/community'
import type {
  CommunityRef,
  CommunityView,
  CommunityViewerState,
  ListCommunitiesParams,
  ListCommunitiesResponse,
  SubscribeCommunityOutput,
} from '$lib/api/coves/types'
import type { DID } from '$lib/types/atproto'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'
import {
  isSubscribed,
  isSubscriptionPending,
  type SubscribableCommunity,
} from './subscription.svelte'

/** Page size for each social.coves.community.list request. */
export const SUBSCRIBED_PAGE_LIMIT = 100

/** Loop guard: never follow more pages than this, whatever the server says. */
const MAX_PAGES = 50

/** What the sidebar needs of a subscribed community; any community view qualifies. */
export type ListedCommunity = CommunityRef & {
  readonly viewer?: CommunityViewerState
}

export interface SubscribedListApi {
  listCommunities(
    params: ListCommunitiesParams,
  ): Promise<ListCommunitiesResponse>
}

export interface FavoriteApi {
  /** Resolves to the stored subscription when the backend reports it. */
  subscribe(input: {
    community: DID
    favorite: boolean
  }): Promise<Partial<SubscribeCommunityOutput> | void>
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
    if (!next) return result
    if (cursors.has(next)) {
      log.warn('[subscribed-communities] server repeated a cursor', undefined, {
        pages: page + 1,
        count: result.length,
      })
      return result
    }
    cursors.add(next)
    cursor = next
  }

  log.warn('[subscribed-communities] stopped at the page limit', undefined, {
    pages: MAX_PAGES,
    count: result.length,
  })

  return result
}

function compareByName(a: ListedCommunity, b: ListedCommunity): number {
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
export function orderSidebarCommunities<T extends ListedCommunity>(
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

const favoriteOverrides = new SvelteMap<DID, FavoriteOverride>()
const favoritePending = new SvelteSet<DID>()
/**
 * Communities unsubscribed from in this session. Unsubscribing drops the
 * favorite on the server, so a stale cached `favorite: true` must not star
 * the row again after a resubscribe.
 */
const favoriteDropped = new SvelteSet<DID>()
/** Bumped when favorite state is wiped, so an older request cannot write into it. */
let favoriteEpoch = 0

/** Forgets every in-session favorite change; called when the viewer changes. */
function clearFavoriteState(): void {
  favoriteEpoch += 1
  favoriteOverrides.clear()
  favoritePending.clear()
  favoriteDropped.clear()
}

/** Records an unsubscribe, which drops the favorite server-side. */
export function forgetFavorite(community: SubscribableCommunity): void {
  favoriteOverrides.delete(community.did)
  favoriteDropped.add(community.did)
}

function serverFavorite(community: SubscribableCommunity): boolean {
  return community.viewer?.favorite === true
}

/** Whether the viewer favorited this community, with any in-session change applied. */
export function isFavorite(community: SubscribableCommunity): boolean {
  const server = serverFavorite(community)
  const override = favoriteOverrides.get(community.did)
  if (override !== undefined && override.serverAtPress === server) {
    return override.favorite
  }
  if (favoriteDropped.has(community.did)) return false
  return server
}

/** Whether a favorite change is in flight for this community. */
export function isFavoritePending(community: SubscribableCommunity): boolean {
  return favoritePending.has(community.did)
}

export type ToggleFavoriteOutcome =
  | { kind: 'ok'; favorite: boolean }
  | { kind: 'pending' }
  /** Another write changed or removed the subscription; the star reverted. */
  | { kind: 'conflict' }
  | { kind: 'error'; error: unknown }

function isSubscriptionConflict(error: unknown): boolean {
  return (
    error instanceof XrpcError &&
    error.status === 409 &&
    error.errorName === 'SubscriptionConflict'
  )
}

/**
 * Flips the favorite optimistically, sends it through subscribe, and rolls
 * back on failure. A second press while one is in flight is ignored
 * (`pending`), and so is a press while a subscribe or unsubscribe for the same
 * community is in flight: the favorite goes through subscribe too, and landing
 * after an unsubscribe would quietly subscribe the viewer again.
 */
export async function toggleFavorite(
  community: SubscribableCommunity,
  api: FavoriteApi,
): Promise<ToggleFavoriteOutcome> {
  const { did } = community
  if (favoritePending.has(did) || isSubscriptionPending(community)) {
    return { kind: 'pending' }
  }

  const was = isFavorite(community)
  const next = !was
  const previous = favoriteOverrides.get(did)
  const epoch = favoriteEpoch
  favoritePending.add(did)
  favoriteOverrides.set(did, {
    favorite: next,
    serverAtPress: serverFavorite(community),
  })

  try {
    const response = await api.subscribe({ community: did, favorite: next })
    // The backend echoes the stored value; older ones send nothing to check.
    const stored =
      typeof response?.favorite === 'boolean' ? response.favorite : next
    if (stored !== next && epoch === favoriteEpoch) {
      favoriteOverrides.set(did, {
        favorite: stored,
        serverAtPress: serverFavorite(community),
      })
    }
    return { kind: 'ok', favorite: stored }
  } catch (error) {
    const conflict = isSubscriptionConflict(error)
    if (!conflict) {
      log.error('[subscribed-communities] favorite toggle failed', error, {
        did,
        was,
      })
    }
    if (epoch === favoriteEpoch) {
      if (conflict) {
        // The stored subscription moved on without us: drop every in-session
        // guess about it so the refetched list is shown as it is.
        favoriteOverrides.delete(did)
        favoriteDropped.delete(did)
        subscribedCommunities.forget(did)
      } else if (previous === undefined) {
        favoriteOverrides.delete(did)
      } else {
        favoriteOverrides.set(did, previous)
      }
    }
    return conflict ? { kind: 'conflict' } : { kind: 'error', error }
  } finally {
    if (epoch === favoriteEpoch) favoritePending.delete(did)
  }
}

export type SubscribedCommunitiesStatus =
  'idle' | 'loading' | 'loaded' | 'error'

class SubscribedCommunitiesStore {
  #status = $state<SubscribedCommunitiesStatus>('idle')
  #owner = $state<DID | undefined>(undefined)
  #server = $state.raw<ListedCommunity[]>([])
  #remembered = new SvelteMap<DID, ListedCommunity>()
  #generation = 0

  get status(): SubscribedCommunitiesStatus {
    return this.#status
  }

  /** The viewer the list belongs to; changes only through `load` and `reset`. */
  get owner(): DID | undefined {
    return this.#owner
  }

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
    if (this.#owner !== owner) {
      this.#server = []
      // Subscribes pressed before the first load belong to this viewer.
      if (this.#owner !== undefined) this.#remembered.clear()
      clearFavoriteState()
      this.#owner = owner
    }
    this.#status = 'loading'

    try {
      const communities = await fetchAllSubscribedCommunities(api)
      if (generation !== this.#generation) return
      this.#server = communities
      this.#status = 'loaded'
    } catch (error) {
      if (generation !== this.#generation) return
      log.error('[subscribed-communities] load failed', error, { owner })
      this.#status = 'error'
    }
  }

  /**
   * Shows a community subscribed to in this session while the index catches
   * up. It stays until the viewer changes; a server entry for the same DID wins.
   */
  remember(community: ListedCommunity): void {
    this.#remembered.set(community.did, community)
  }

  /** Stops showing a remembered community; the server list decides again. */
  forget(did: DID): void {
    this.#remembered.delete(did)
  }

  /** Back to idle with no owner and an empty list. */
  reset(): void {
    this.#generation += 1
    this.#server = []
    this.#remembered.clear()
    clearFavoriteState()
    this.#owner = undefined
    this.#status = 'idle'
  }
}

export const subscribedCommunities = new SubscribedCommunitiesStore()

/** Test seam: forget favorite overrides, in-flight markers and the store. */
export function resetSubscribedCommunitiesState(): void {
  subscribedCommunities.reset()
}
