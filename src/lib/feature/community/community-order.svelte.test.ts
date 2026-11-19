import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DID } from '$lib/types/atproto'
import {
  applySavedOrder,
  communityOrder,
  localCommunityOrderStore,
  orderWithMovedToEnd,
  undoMove,
  reorderGroup,
  type CommunityOrderStore,
} from './community-order.svelte'

function did(n: string): DID {
  return `did:plc:${n.padEnd(24, 'x')}` as DID
}

const A = did('a')
const B = did('b')
const C = did('c')
const D = did('d')
const OWNER = did('owner')
const OTHER = did('other')

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  }
}

function memoryStore(): CommunityOrderStore & {
  saved: Map<DID, DID[]>
} {
  const saved = new Map<DID, DID[]>()
  return {
    saved,
    get: (owner) => saved.get(owner) ?? [],
    set: (owner, order) => void saved.set(owner, [...order]),
  }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  communityOrder.reset()
})

describe('applySavedOrder', () => {
  const items = [A, B, C, D].map((d) => ({ did: d }))

  it('keeps the incoming order when nothing is saved', () => {
    expect(applySavedOrder(items, []).map((c) => c.did)).toEqual([A, B, C, D])
  })

  it('puts saved communities first, in saved order', () => {
    expect(applySavedOrder(items, [C, A]).map((c) => c.did)).toEqual([
      C,
      A,
      B,
      D,
    ])
  })

  it('leaves communities without a saved position in incoming order after the saved ones', () => {
    expect(applySavedOrder(items, [D]).map((c) => c.did)).toEqual([D, A, B, C])
  })

  it('ignores saved DIDs that are not in the list', () => {
    expect(applySavedOrder(items, [did('gone'), B]).map((c) => c.did)).toEqual([
      B,
      A,
      C,
      D,
    ])
  })

  it('does not modify the input', () => {
    const input = [...items]
    applySavedOrder(input, [D, C, B, A])
    expect(input.map((c) => c.did)).toEqual([A, B, C, D])
  })
})

describe('reorderGroup', () => {
  it('moves an item down', () => {
    expect(reorderGroup([A, B, C, D], 0, 2)).toEqual([B, C, A, D])
  })

  it('moves an item up', () => {
    expect(reorderGroup([A, B, C, D], 3, 1)).toEqual([A, D, B, C])
  })

  it('clamps the target into the list', () => {
    expect(reorderGroup([A, B, C], 1, 10)).toEqual([A, C, B])
    expect(reorderGroup([A, B, C], 1, -4)).toEqual([B, A, C])
  })

  it('returns the same order for an out-of-range source', () => {
    expect(reorderGroup([A, B], 5, 0)).toEqual([A, B])
  })
})

describe('orderWithMovedToEnd', () => {
  it('starring puts the community at the end of the favorites', () => {
    expect(orderWithMovedToEnd([A, B], [C, D], C, 'favorites')).toEqual([
      A,
      B,
      C,
      D,
    ])
  })

  it('unstarring puts the community at the end of the others', () => {
    expect(orderWithMovedToEnd([A, B], [C, D], A, 'others')).toEqual([
      B,
      C,
      D,
      A,
    ])
  })
})

describe('undoMove', () => {
  it('restores the previous order when nothing changed since the move', () => {
    const previous: DID[] = []
    const moved = orderWithMovedToEnd([A], [B, C], C, 'favorites')
    expect(undoMove(moved, C, previous, moved)).toEqual([])
  })

  it('puts only the moved community back when other edits followed', () => {
    const previous = [A, B, C, D]
    const moved = orderWithMovedToEnd([A], [B, C, D], C, 'favorites')
    // A later reorder swapped B and D.
    const current = [A, C, D, B]
    expect(undoMove(current, C, previous, moved)).toEqual([A, D, C, B])
  })

  it('drops the community back to the unsaved tail when it had no saved position', () => {
    const moved = orderWithMovedToEnd([A], [B, C, D], C, 'favorites')
    // A later reorder swapped B and D.
    const current = [A, C, D, B]
    expect(undoMove(current, C, [], moved)).toEqual([A, D, B])
  })
})

describe('localCommunityOrderStore', () => {
  it('round-trips an order per owner', () => {
    const storage = memoryStorage()
    const store = localCommunityOrderStore(() => storage)
    store.set(OWNER, [B, A])
    store.set(OTHER, [C])
    expect(store.get(OWNER)).toEqual([B, A])
    expect(store.get(OTHER)).toEqual([C])
  })

  it('returns an empty order when nothing is stored', () => {
    expect(localCommunityOrderStore(() => memoryStorage()).get(OWNER)).toEqual(
      [],
    )
  })

  it('returns an empty order for corrupt or wrongly shaped data', () => {
    const storage = memoryStorage()
    const store = localCommunityOrderStore(() => storage)
    store.set(OWNER, [A])
    const key = storage.key(0)
    if (key === null) throw new Error('nothing stored')
    storage.setItem(key, '{not json')
    expect(store.get(OWNER)).toEqual([])
    storage.setItem(key, JSON.stringify({ order: [A] }))
    expect(store.get(OWNER)).toEqual([])
    storage.setItem(key, JSON.stringify([A, 42, null]))
    expect(store.get(OWNER)).toEqual([A])
  })

  it('survives storage that throws', () => {
    const store = localCommunityOrderStore(() => {
      throw new Error('blocked')
    })
    expect(store.get(OWNER)).toEqual([])
    expect(() => store.set(OWNER, [A])).not.toThrow()
  })
})

describe('communityOrder', () => {
  it('loads the saved order for the owner', () => {
    const store = memoryStore()
    store.saved.set(OWNER, [B, A])
    communityOrder.load(OWNER, store)
    expect(communityOrder.order).toEqual([B, A])
  })

  it('saves through the store for the loaded owner', () => {
    const store = memoryStore()
    communityOrder.load(OWNER, store)
    communityOrder.save([C, A])
    expect(communityOrder.order).toEqual([C, A])
    expect(store.saved.get(OWNER)).toEqual([C, A])
  })

  it('switches to the next owner’s order', () => {
    const store = memoryStore()
    store.saved.set(OWNER, [A])
    store.saved.set(OTHER, [B])
    communityOrder.load(OWNER, store)
    communityOrder.load(OTHER, store)
    expect(communityOrder.order).toEqual([B])
  })

  it('does not save without an owner', () => {
    const store = memoryStore()
    communityOrder.load(OWNER, store)
    communityOrder.reset()
    communityOrder.save([A])
    expect(communityOrder.order).toEqual([])
    expect(store.saved.get(OWNER)).toBeUndefined()
  })
})
