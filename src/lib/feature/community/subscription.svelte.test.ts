import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DID } from '$lib/types/atproto'
import {
  isSubscribed,
  isSubscriptionPending,
  resetSubscriptionState,
  toggleSubscription,
  type SubscriptionApi,
} from './subscription.svelte'

const DID_A = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' as DID

function deferred() {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function api(overrides: Partial<SubscriptionApi> = {}): SubscriptionApi {
  return {
    subscribe: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
    ...overrides,
  }
}

beforeEach(() => {
  resetSubscriptionState()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('isSubscribed', () => {
  it('reads the server value when nothing was pressed', () => {
    expect(isSubscribed({ did: DID_A })).toBe(false)
    expect(isSubscribed({ did: DID_A, viewer: { subscribed: true } })).toBe(
      true,
    )
  })
})

describe('toggleSubscription', () => {
  it('subscribes optimistically and keeps the value on success', async () => {
    const a = api()
    const community = { did: DID_A, viewer: { subscribed: false } }
    const gate = deferred()
    a.subscribe = vi.fn(() => gate.promise)

    const run = toggleSubscription(community, a)
    expect(isSubscribed(community)).toBe(true)
    expect(isSubscriptionPending(community)).toBe(true)

    gate.resolve()
    await expect(run).resolves.toEqual({ kind: 'ok', subscribed: true })
    expect(a.subscribe).toHaveBeenCalledWith({ community: DID_A })
    expect(isSubscribed(community)).toBe(true)
    expect(isSubscriptionPending(community)).toBe(false)
  })

  it('unsubscribes when currently subscribed', async () => {
    const a = api()
    const community = { did: DID_A, viewer: { subscribed: true } }
    await toggleSubscription(community, a)
    expect(a.unsubscribe).toHaveBeenCalledWith({ community: DID_A })
    expect(isSubscribed(community)).toBe(false)
  })

  it('every object for the same DID agrees, whoever owns it', async () => {
    const row = { did: DID_A, viewer: { subscribed: false } }
    const cardInModal = { did: DID_A, viewer: { subscribed: false } }
    await toggleSubscription(cardInModal, api())
    expect(isSubscribed(row)).toBe(true)
  })

  it('rolls back to the server value on failure', async () => {
    const community = { did: DID_A, viewer: { subscribed: false } }
    const outcome = await toggleSubscription(
      community,
      api({
        subscribe: async () => {
          throw new Error('nope')
        },
      }),
    )
    expect(outcome.kind).toBe('error')
    expect(isSubscribed(community)).toBe(false)
    expect(isSubscriptionPending(community)).toBe(false)
  })

  it('rolls back to the previous override, not the server, on a second failure', async () => {
    const community = { did: DID_A, viewer: { subscribed: false } }
    await toggleSubscription(community, api()) // now optimistically true
    await toggleSubscription(
      community,
      api({
        unsubscribe: async () => {
          throw new Error('nope')
        },
      }),
    )
    expect(isSubscribed(community)).toBe(true)
  })

  it('ignores a press while one is in flight', async () => {
    const a = api()
    const gate = deferred()
    a.subscribe = vi.fn(() => gate.promise)
    const community = { did: DID_A }

    const first = toggleSubscription(community, a)
    const second = await toggleSubscription(community, a)
    expect(second).toEqual({ kind: 'pending' })
    expect(a.subscribe).toHaveBeenCalledTimes(1)

    gate.resolve()
    await first
  })

  it('lets fresh server data supersede a stale override', async () => {
    const community = { did: DID_A, viewer: { subscribed: false } }
    await toggleSubscription(community, api()) // override: true (pressed against false)

    // Reloaded from the server, which now agrees — override is redundant.
    expect(isSubscribed({ did: DID_A, viewer: { subscribed: true } })).toBe(
      true,
    )
    // Server later says unsubscribed (e.g. done from another device): server wins.
    // (Pressed against `false`, so a server `false` is NOT newer — the override
    // still applies; only a server value that differs from the snapshot does.)
    expect(isSubscribed({ did: DID_A, viewer: { subscribed: false } })).toBe(
      true,
    )
  })
})
