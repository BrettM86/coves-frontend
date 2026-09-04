import { beforeEach, describe, expect, it, vi } from 'vitest'
import { profile } from '$lib/app/state/auth.svelte'
import { feeds } from '$lib/feature/feeds/feed.svelte'
import type { DID } from '$lib/types/atproto'
import {
  isCommunityBlocked,
  isCommunityBlockPending,
  reconcileCommunityBlockState,
  resetCommunityBlockingState,
  setCommunityBlocked,
  toggleCommunityBlock,
  type CommunityBlockingApi,
} from './blocking.svelte'

vi.mock('$lib/feature/feeds/feed.svelte', () => ({ feeds: new Map() }))

const DID_A = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' as DID
const DID_B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' as DID

function deferred(): {
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
} {
  // Promise executors run synchronously, so both callbacks are assigned before
  // this helper returns them to a test.
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function api(
  overrides: Partial<CommunityBlockingApi> = {},
): CommunityBlockingApi {
  return {
    blockCommunity: vi.fn(async () => undefined),
    unblockCommunity: vi.fn(async () => undefined),
    ...overrides,
  }
}

beforeEach(() => {
  resetCommunityBlockingState()
  feeds.clear()
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('isCommunityBlocked', () => {
  it('reads the server value before the viewer takes an action', () => {
    expect(isCommunityBlocked({ did: DID_A })).toBe(false)
    expect(isCommunityBlocked({ did: DID_A, viewer: { blocked: true } })).toBe(
      true,
    )
  })
})

describe('toggleCommunityBlock', () => {
  it('sets an explicit block state without reversing it on repeat', async () => {
    const client = api()
    const community = { did: DID_A, viewer: { blocked: false } }

    await expect(setCommunityBlocked(community, true, client)).resolves.toEqual(
      { kind: 'ok', blocked: true },
    )
    await expect(setCommunityBlocked(community, true, client)).resolves.toEqual(
      { kind: 'ok', blocked: true },
    )

    expect(client.blockCommunity).toHaveBeenCalledTimes(1)
    expect(client.unblockCommunity).not.toHaveBeenCalled()
  })

  it('blocks optimistically and keeps the value on success', async () => {
    const gate = deferred()
    const client = api({ blockCommunity: vi.fn(() => gate.promise) })
    const community = { did: DID_A, viewer: { blocked: false } }
    feeds.set('/', {} as never)
    feeds.set('/c/[handle=handle]', {} as never)

    const run = toggleCommunityBlock(community, client)
    expect(isCommunityBlocked(community)).toBe(true)
    expect(isCommunityBlockPending(community)).toBe(true)
    expect(feeds.has('/')).toBe(true)

    gate.resolve()
    await expect(run).resolves.toEqual({ kind: 'ok', blocked: true })
    expect(client.blockCommunity).toHaveBeenCalledWith({ community: DID_A })
    expect(client.unblockCommunity).not.toHaveBeenCalled()
    expect(isCommunityBlocked(community)).toBe(true)
    expect(isCommunityBlockPending(community)).toBe(false)
    expect(feeds.has('/')).toBe(false)
    expect(feeds.has('/c/[handle=handle]')).toBe(true)
  })

  it('unblocks when the server reports an existing block', async () => {
    const client = api()
    const community = { did: DID_A, viewer: { blocked: true } }
    feeds.set('/', {} as never)

    await expect(toggleCommunityBlock(community, client)).resolves.toEqual({
      kind: 'ok',
      blocked: false,
    })
    expect(client.unblockCommunity).toHaveBeenCalledWith({ community: DID_A })
    expect(client.blockCommunity).not.toHaveBeenCalled()
    expect(isCommunityBlocked(community)).toBe(false)
    expect(feeds.has('/')).toBe(false)
  })

  it('shares optimistic state between objects with the same DID', async () => {
    const header = { did: DID_A, viewer: { blocked: false } }
    const sidebar = { did: DID_A, viewer: { blocked: false } }

    await toggleCommunityBlock(header, api())

    expect(isCommunityBlocked(sidebar)).toBe(true)
  })

  it('isolates block state and pending state by DID', async () => {
    const gate = deferred()
    const client = api({ blockCommunity: vi.fn(() => gate.promise) })
    const first = { did: DID_A }
    const second = { did: DID_B }

    const firstRun = toggleCommunityBlock(first, client)

    expect(isCommunityBlocked(first)).toBe(true)
    expect(isCommunityBlockPending(first)).toBe(true)
    expect(isCommunityBlocked(second)).toBe(false)
    expect(isCommunityBlockPending(second)).toBe(false)

    gate.resolve()
    await firstRun
  })

  it('rolls back to server truth when the request fails', async () => {
    const error = new Error('network unavailable')
    const community = { did: DID_A, viewer: { blocked: false } }
    feeds.set('/', {} as never)

    const outcome = await toggleCommunityBlock(
      community,
      api({
        blockCommunity: async () => {
          throw error
        },
      }),
    )

    expect(outcome).toEqual({ kind: 'error', error })
    expect(isCommunityBlocked(community)).toBe(false)
    expect(isCommunityBlockPending(community)).toBe(false)
    expect(feeds.has('/')).toBe(true)
    expect(console.error).toHaveBeenCalledOnce()
  })

  it('restores an earlier override when a later toggle fails', async () => {
    const community = { did: DID_A, viewer: { blocked: false } }
    await toggleCommunityBlock(community, api())

    await toggleCommunityBlock(
      community,
      api({
        unblockCommunity: async () => {
          throw new Error('try again')
        },
      }),
    )

    expect(isCommunityBlocked(community)).toBe(true)
  })

  it('ignores a second press for the same DID while pending', async () => {
    const gate = deferred()
    const client = api({ blockCommunity: vi.fn(() => gate.promise) })
    const community = { did: DID_A }

    const first = toggleCommunityBlock(community, client)
    await expect(toggleCommunityBlock(community, client)).resolves.toEqual({
      kind: 'pending',
    })
    expect(client.blockCommunity).toHaveBeenCalledTimes(1)

    gate.resolve()
    await first
  })

  it('allows different communities to be toggled concurrently', async () => {
    const firstGate = deferred()
    const secondGate = deferred()
    const client = api({
      blockCommunity: vi
        .fn()
        .mockImplementationOnce(() => firstGate.promise)
        .mockImplementationOnce(() => secondGate.promise),
    })

    const first = toggleCommunityBlock({ did: DID_A }, client)
    const second = toggleCommunityBlock({ did: DID_B }, client)

    expect(client.blockCommunity).toHaveBeenCalledTimes(2)
    expect(isCommunityBlockPending({ did: DID_A })).toBe(true)
    expect(isCommunityBlockPending({ did: DID_B })).toBe(true)

    firstGate.resolve()
    secondGate.resolve()
    await Promise.all([first, second])
  })

  it('uses a changed server value instead of a stale override', async () => {
    await toggleCommunityBlock(
      { did: DID_A, viewer: { blocked: false } },
      api(),
    )

    expect(isCommunityBlocked({ did: DID_A, viewer: { blocked: true } })).toBe(
      true,
    )
  })

  it('retires an override after the server catches up', async () => {
    await toggleCommunityBlock(
      { did: DID_A, viewer: { blocked: false } },
      api(),
    )

    reconcileCommunityBlockState({
      did: DID_A,
      viewer: { blocked: true },
    })

    expect(isCommunityBlocked({ did: DID_A, viewer: { blocked: false } })).toBe(
      false,
    )
  })

  it('does not expose one profile’s optimistic state to another', async () => {
    const originalProfile = profile.meta.profile
    await toggleCommunityBlock(
      { did: DID_A, viewer: { blocked: false } },
      api(),
    )
    expect(isCommunityBlocked({ did: DID_A })).toBe(true)

    try {
      profile.meta.profile = `${originalProfile}-switched`

      expect(isCommunityBlocked({ did: DID_A })).toBe(false)
    } finally {
      profile.meta.profile = originalProfile
    }
  })

  it('isolates concurrent requests when the active profile changes', async () => {
    const originalProfile = profile.meta.profile
    const firstGate = deferred()
    const secondGate = deferred()
    const first = toggleCommunityBlock(
      { did: DID_A },
      api({ blockCommunity: () => firstGate.promise }),
    )

    try {
      profile.meta.profile = `${originalProfile}-switched`
      const second = toggleCommunityBlock(
        { did: DID_A },
        api({ blockCommunity: () => secondGate.promise }),
      )
      expect(isCommunityBlockPending({ did: DID_A })).toBe(true)

      firstGate.resolve()
      await first
      expect(isCommunityBlockPending({ did: DID_A })).toBe(true)

      secondGate.resolve()
      await second
      expect(isCommunityBlockPending({ did: DID_A })).toBe(false)
    } finally {
      firstGate.resolve()
      secondGate.resolve()
      await first
      profile.meta.profile = originalProfile
    }
  })

  it('does not reset state while a request is still running', async () => {
    const gate = deferred()
    const community = { did: DID_A, viewer: { blocked: false } }
    const run = toggleCommunityBlock(
      community,
      api({ blockCommunity: () => gate.promise }),
    )
    expect(isCommunityBlockPending(community)).toBe(true)

    expect(() => resetCommunityBlockingState()).toThrow(
      'Cannot reset community blocking state while requests run',
    )

    expect(isCommunityBlocked(community)).toBe(true)
    expect(isCommunityBlockPending(community)).toBe(true)
    gate.resolve()
    await run

    resetCommunityBlockingState()
    expect(isCommunityBlocked(community)).toBe(false)
  })
})
