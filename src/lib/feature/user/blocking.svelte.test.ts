import { beforeEach, describe, expect, it, vi } from 'vitest'
import { profile } from '$lib/app/state/auth.svelte'
import type { AtUri } from '$lib/api/coves/types'
import { feeds } from '$lib/feature/feeds/feed.svelte'
import type { DID } from '$lib/types/atproto'
import {
  isUserBlocked,
  isUserBlockPending,
  reconcileUserBlockState,
  resetUserBlockingState,
  setUserBlocked,
  toggleUserBlock,
  type UserBlockingApi,
} from './blocking.svelte'

vi.mock('$lib/feature/feeds/feed.svelte', () => ({ feeds: new Map() }))

const USER_A = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' as DID
const USER_B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' as DID

function deferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function api(overrides: Partial<UserBlockingApi> = {}): UserBlockingApi {
  return {
    blockUser: vi.fn(async () => undefined),
    unblockUser: vi.fn(async () => undefined),
    ...overrides,
  }
}

beforeEach(() => {
  resetUserBlockingState()
  feeds.clear()
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('user blocking state', () => {
  it('blocks by DID and invalidates cached feeds', async () => {
    const client = api()
    const user = { did: USER_A }
    feeds.set('/', {} as never)

    await expect(setUserBlocked(user, true, client)).resolves.toEqual({
      kind: 'ok',
      blocked: true,
    })

    expect(client.blockUser).toHaveBeenCalledWith({ subject: USER_A })
    expect(client.unblockUser).not.toHaveBeenCalled()
    expect(isUserBlocked(user)).toBe(true)
    expect(feeds.size).toBe(0)
  })

  it('does not reverse an explicit block on repeat', async () => {
    const client = api()
    const user = { did: USER_A }

    await setUserBlocked(user, true, client)
    await setUserBlocked(user, true, client)

    expect(client.blockUser).toHaveBeenCalledTimes(1)
    expect(client.unblockUser).not.toHaveBeenCalled()
  })

  it('toggles an existing server block to unblocked', async () => {
    const client = api()
    const user = {
      did: USER_A,
      viewer: {
        blocking: 'at://did:plc:viewer/social.coves.actor.block/1' as AtUri,
      },
    }

    await expect(toggleUserBlock(user, client)).resolves.toEqual({
      kind: 'ok',
      blocked: false,
    })
    expect(client.unblockUser).toHaveBeenCalledWith({ subject: USER_A })
    expect(isUserBlocked(user)).toBe(false)
  })

  it('suppresses duplicate requests while pending', async () => {
    const gate = deferred()
    const client = api({ blockUser: vi.fn(() => gate.promise) })
    const user = { did: USER_A }

    const first = setUserBlocked(user, true, client)
    expect(isUserBlockPending(user)).toBe(true)
    await expect(setUserBlocked(user, true, client)).resolves.toEqual({
      kind: 'pending',
    })
    expect(client.blockUser).toHaveBeenCalledTimes(1)

    gate.resolve()
    await first
    expect(isUserBlockPending(user)).toBe(false)
  })

  it('does not reset state while a request is still running', async () => {
    const gate = deferred()
    const client = api({ blockUser: vi.fn(() => gate.promise) })
    const user = { did: USER_A }

    const run = setUserBlocked(user, true, client)

    expect(() => resetUserBlockingState()).toThrow(
      'Cannot reset user blocking state while requests run',
    )
    expect(isUserBlocked(user)).toBe(true)
    expect(isUserBlockPending(user)).toBe(true)

    gate.resolve()
    await run
    resetUserBlockingState()
    expect(isUserBlocked(user)).toBe(false)
  })

  it('rolls back after an API failure', async () => {
    const error = new Error('offline')
    const client = api({
      blockUser: vi.fn(async () => {
        throw error
      }),
    })

    await expect(
      setUserBlocked({ did: USER_A }, true, client),
    ).resolves.toEqual({ kind: 'error', error })
    expect(isUserBlocked({ did: USER_A })).toBe(false)
    expect(isUserBlockPending({ did: USER_A })).toBe(false)
  })

  it('retires an optimistic value after the server catches up', async () => {
    await setUserBlocked({ did: USER_A }, true, api())

    reconcileUserBlockState({
      did: USER_A,
      viewer: {
        blocking: 'at://did:plc:viewer/social.coves.actor.block/1' as AtUri,
      },
    })

    expect(isUserBlocked({ did: USER_A })).toBe(false)
  })

  it('isolates state by user DID and active profile', async () => {
    const originalProfile = profile.meta.profile
    await setUserBlocked({ did: USER_A }, true, api())

    expect(isUserBlocked({ did: USER_A })).toBe(true)
    expect(isUserBlocked({ did: USER_B })).toBe(false)

    try {
      profile.meta.profile = `${originalProfile}-switched`
      expect(isUserBlocked({ did: USER_A })).toBe(false)
    } finally {
      profile.meta.profile = originalProfile
    }
  })
})
