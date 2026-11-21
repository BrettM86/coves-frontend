// ---------------------------------------------------------------------------
// Sidebar community order (manual drag order)
//
// The viewer can drag the sidebar Communities list into their own order. The
// order is a list of community DIDs, saved per browser and keyed by the
// signed-in account's DID, so two accounts on one browser keep their own.
//
// Storage sits behind CommunityOrderStore so a backend-synced store can
// replace the local one without touching the sidebar. Communities missing
// from the saved order keep the incoming order after the saved ones.
// ---------------------------------------------------------------------------

import { log } from '$lib/app/util/log'
import { isValidDID, type DID } from '$lib/types/atproto'

/** Where a viewer's community order is kept. */
export interface CommunityOrderStore {
  /** The saved order for `owner`, or [] when there is none or it is unreadable. */
  get(owner: DID): DID[]
  /** Replaces the saved order for `owner`. Never throws. */
  set(owner: DID, order: readonly DID[]): void
}

const STORAGE_KEY_PREFIX = 'coves.sidebar.communityOrder.'

function storageKey(owner: DID): string {
  return `${STORAGE_KEY_PREFIX}${owner}`
}

/**
 * A CommunityOrderStore over browser storage, one JSON array of DIDs per
 * owner. Blocked or full storage and corrupt values are logged and read as an
 * empty order; nothing here throws.
 */
export function localCommunityOrderStore(
  storage: () => Storage = () => localStorage,
): CommunityOrderStore {
  let warnedOnSave = false
  return {
    get(owner) {
      let raw: string | null
      try {
        raw = storage().getItem(storageKey(owner))
      } catch (error) {
        // Blocked or unavailable storage is the browser's setting, not a bug.
        log.warn('[community-order] could not read the saved order', error)
        return []
      }
      if (raw === null) return []

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (error) {
        log.warn('[community-order] saved order is not valid JSON', error)
        return []
      }
      if (!Array.isArray(parsed)) {
        log.warn('[community-order] saved order is not an array')
        return []
      }
      return parsed.filter(
        (entry): entry is DID => typeof entry === 'string' && isValidDID(entry),
      )
    },

    set(owner, order) {
      try {
        storage().setItem(storageKey(owner), JSON.stringify(order))
      } catch (error) {
        // Full or blocked storage fails every save; say so once.
        if (!warnedOnSave) {
          log.warn('[community-order] could not save the order', error)
          warnedOnSave = true
        }
      }
    },
  }
}

/**
 * Items with a saved position first, in saved order, then the rest in
 * incoming order. Saved DIDs that match no item are ignored. The input is
 * left untouched.
 */
export function applySavedOrder<T extends { did: DID }>(
  items: readonly T[],
  order: readonly DID[],
): T[] {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to one call, never held as reactive state
  const position = new Map<DID, number>()
  order.forEach((did, index) => {
    if (!position.has(did)) position.set(did, index)
  })
  const saved = items.filter((item) => position.has(item.did))
  const rest = items.filter((item) => !position.has(item.did))
  saved.sort((a, b) => (position.get(a.did) ?? 0) - (position.get(b.did) ?? 0))
  return [...saved, ...rest]
}

/**
 * Moves the entry at `from` to `to` (clamped into the list). An out-of-range
 * `from` returns an unchanged copy.
 */
export function reorderGroup(
  group: readonly DID[],
  from: number,
  to: number,
): DID[] {
  const result = [...group]
  if (from < 0 || from >= result.length) return result
  const [moved] = result.splice(from, 1)
  if (moved === undefined) return result
  const target = Math.min(Math.max(to, 0), result.length)
  result.splice(target, 0, moved)
  return result
}

/**
 * The full order as displayed (favorites, then others) with `did` taken from
 * wherever it is and put at the end of `group`. Used when starring or
 * unstarring moves a community between the groups.
 */
export function orderWithMovedToEnd(
  favorites: readonly DID[],
  others: readonly DID[],
  did: DID,
  group: 'favorites' | 'others',
): DID[] {
  const nextFavorites = favorites.filter((entry) => entry !== did)
  const nextOthers = others.filter((entry) => entry !== did)
  if (group === 'favorites') nextFavorites.push(did)
  else nextOthers.push(did)
  return [...nextFavorites, ...nextOthers]
}

/**
 * Undoes one `orderWithMovedToEnd` whose request failed. With no edits since
 * (`current` is still `afterMove`) the whole `previous` order comes back;
 * otherwise only `did` returns to its previous index, or to the unsaved tail
 * when it had none, so a reorder made while the request was in flight stays.
 */
export function undoMove(
  current: readonly DID[],
  did: DID,
  previous: readonly DID[],
  afterMove: readonly DID[],
): DID[] {
  const unchanged =
    current.length === afterMove.length &&
    current.every((entry, index) => entry === afterMove[index])
  if (unchanged) return [...previous]
  const without = current.filter((entry) => entry !== did)
  const index = previous.indexOf(did)
  if (index < 0) return without
  without.splice(Math.min(index, without.length), 0, did)
  return without
}

class CommunityOrderState {
  #order = $state.raw<DID[]>([])
  #owner: DID | undefined
  #store: CommunityOrderStore | undefined

  /** The loaded owner's saved order; [] before `load` and after `reset`. */
  get order(): DID[] {
    return this.#order
  }

  /** Reads `owner`'s saved order from `store`, replacing whatever was loaded. */
  load(
    owner: DID,
    store: CommunityOrderStore = localCommunityOrderStore(),
  ): void {
    this.#owner = owner
    this.#store = store
    this.#order = store.get(owner)
  }

  /** Shows `order` and writes it for the loaded owner; does nothing without one. */
  save(order: readonly DID[]): void {
    if (this.#owner === undefined || this.#store === undefined) return
    this.#order = [...order]
    this.#store.set(this.#owner, order)
  }

  /** Forgets the owner and their order. */
  reset(): void {
    this.#owner = undefined
    this.#store = undefined
    this.#order = []
  }
}

export const communityOrder = new CommunityOrderState()
