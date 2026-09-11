/** Acceptance seam: real browser profile + shared transports + typed XRPC errors. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DID, Handle, InstanceURL } from '$lib/types/atproto'
import type { AtUri, CID } from './coves/types'

vi.mock('$app/environment', () => ({
  browser: true,
  dev: false,
  building: false,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$lib/app/state/instance/env', () => ({
  DEFAULT_INSTANCE_URL: 'http://localhost:8081',
  LINKED_INSTANCE_URL: undefined,
}))
vi.mock('$lib/app/state/instance.svelte', () => ({
  DEFAULT_INSTANCE_URL: 'http://localhost:8081',
  instance: { data: 'http://localhost:8081' },
}))

const storage = new Map<string, string>()
const session = (sessionGeneration: string) => ({
  authenticated: true as const,
  activeAccountId: 'did:plc:abcdefghijklmnopqrstuvwx',
  sessionGeneration,
  account: {
    id: 'did:plc:abcdefghijklmnopqrstuvwx',
    did: 'did:plc:abcdefghijklmnopqrstuvwx' as DID,
    handle: 'alice.test' as Handle,
    instance: 'http://localhost:8081' as InstanceURL,
  },
})
const unauthorized = () =>
  new Response(
    JSON.stringify({
      error: 'AuthRequired',
      message: 'Your session has expired',
    }),
    { status: 401 },
  )

function deferredResponse() {
  let resolve: (response: Response) => void = () => {
    throw new Error('Promise executor did not run')
  }
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetModules()
  storage.clear()
  vi.stubGlobal('__VERSION__', 'test')
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value)
    },
    removeItem: (key: string) => {
      storage.delete(key)
    },
  })
})

async function setup() {
  const { profile } = await import('$lib/app/state/auth.svelte')
  const transports = await import('./client.svelte')
  const { XrpcError } = await import('./coves/xrpc')
  profile.syncFromServer(session('first-session'))
  return { profile, ...transports, XrpcError }
}

// A write exercises the real procedure path, including parsing the original body.
const vote = {
  subject: {
    uri: 'at://did:plc:abcdefghijklmnopqrstuvwx/social.coves.community.post/abc' as AtUri,
    cid: 'bafyreibbtest' as CID,
  },
  direction: 'up' as const,
}

describe('dead session recovery at the shared browser transport', () => {
  it('expires immediately and still gives the write caller its typed error for rollback', async () => {
    const { profile, coves, XrpcError } = await setup()
    const fetch = vi.fn(async () => unauthorized())
    const failure = await coves({ func: fetch })
      .createVote(vote)
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(XrpcError)
    expect(failure).toMatchObject({
      status: 401,
      errorName: 'AuthRequired',
      message: 'Your session has expired',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(profile.isAuthenticated).toBe(false)
    expect(profile).toMatchObject({ sessionExpired: true })
  })

  it('concurrent 401s leave one stable expired state and never replay writes', async () => {
    const { profile, coves } = await setup()
    const first = deferredResponse()
    const second = deferredResponse()
    const fetch = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const api = coves({ func: fetch })
    const failures = Promise.allSettled([
      api.createVote(vote),
      api.createVote(vote),
    ])
    first.resolve(unauthorized())
    await first.promise
    await Promise.resolve()
    const expiredProfile = profile.current
    const expiredAfterFirst = !profile.isAuthenticated
    second.resolve(unauthorized())
    expect(
      (await failures).every((result) => result.status === 'rejected'),
    ).toBe(true)
    expect(expiredAfterFirst).toBe(true)
    expect(profile.current).toBe(expiredProfile)
    expect(profile).toMatchObject({ sessionExpired: true })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([403, 500, 503])(
    'status %i preserves authentication',
    async (status) => {
      const { profile, coves } = await setup()
      await expect(
        coves({
          func: async () => new Response('{"error":"Forbidden"}', { status }),
        }).createVote(vote),
      ).rejects.toMatchObject({ status })
      expect(profile.isAuthenticated).toBe(true)
    },
  )

  it('a network failure preserves authentication and the original error', async () => {
    const { profile, coves } = await setup()
    const failure = new TypeError('Network unavailable')
    await expect(
      coves({
        func: async () => {
          throw failure
        },
      }).createVote(vote),
    ).rejects.toBe(failure)
    expect(profile.isAuthenticated).toBe(true)
  })

  it('an anonymous 401 does not invent an expired session', async () => {
    const { profile, coves } = await setup()
    profile.syncFromServer(undefined)
    await expect(
      coves({ func: async () => unauthorized() }).createVote(vote),
    ).rejects.toMatchObject({ status: 401 })
    expect(profile).toMatchObject({ sessionExpired: false })
  })

  it('an old request cannot expire a newer login for the same DID', async () => {
    const { profile, coves } = await setup()
    const pending = deferredResponse()
    const result = coves({ func: () => pending.promise })
      .createVote(vote)
      .catch((error: unknown) => error)
    profile.syncFromServer(session('second-session'))
    pending.resolve(unauthorized())
    expect(await result).toMatchObject({ status: 401 })
    expect(profile.isAuthenticated).toBe(true)
    expect(profile).toMatchObject({ sessionExpired: false })
  })

  it('the legacy upload transport expires the session while preserving its HTTP error', async () => {
    const { profile, client } = await setup()
    const fetch = vi.fn(async () => unauthorized())
    await expect(
      client({ func: fetch }).uploadImage({
        image: new File(['image'], 'draft.png', { type: 'image/png' }),
      }),
    ).rejects.toMatchObject({ status: 401 })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(profile.isAuthenticated).toBe(false)
    expect(profile).toMatchObject({ sessionExpired: true })
  })

  it('stale authenticated root data cannot resurrect an expired session', async () => {
    const { profile, coves } = await setup()
    await expect(
      coves({ func: async () => unauthorized() }).createVote(vote),
    ).rejects.toMatchObject({ status: 401 })
    profile.syncFromServer(session('first-session'))
    expect(profile.isAuthenticated).toBe(false)
    expect(profile).toMatchObject({ sessionExpired: true })
    profile.syncFromServer(session('second-session'))
    expect(profile.isAuthenticated).toBe(true)
    expect(profile).toMatchObject({ sessionExpired: false })
  })

  it('a requested verdict that re-authenticates the same generation restores the session', async () => {
    // The backend answered one write with 401 during an outage while the
    // cookie was still good. The revalidation SessionRecovery asks for is the
    // server's verdict, and it outranks the 401.
    const { profile, coves } = await setup()
    await expect(
      coves({ func: async () => unauthorized() }).createVote(vote),
    ).rejects.toMatchObject({ status: 401 })
    expect(profile.isAuthenticated).toBe(false)
    expect(profile).toMatchObject({ sessionExpired: true })
    profile.beginSessionRevalidation()
    profile.syncFromServer(session('first-session'))
    expect(profile.isAuthenticated).toBe(true)
    expect(profile).toMatchObject({
      sessionExpired: false,
      sessionExpirationConfirmed: false,
    })
  })

  it('a verdict confirming expiration retires the generation for good', async () => {
    const { profile, coves } = await setup()
    await expect(
      coves({ func: async () => unauthorized() }).createVote(vote),
    ).rejects.toMatchObject({ status: 401 })
    expect(profile).toMatchObject({ sessionExpirationConfirmed: false })
    profile.beginSessionRevalidation()
    profile.syncFromServer(undefined, {
      sessionGeneration: 'first-session',
      sessionExpired: true,
    })
    expect(profile).toMatchObject({
      sessionExpired: true,
      sessionExpirationConfirmed: true,
    })
    // Even a requested verdict cannot revive a generation the server declared dead.
    profile.beginSessionRevalidation()
    profile.syncFromServer(session('first-session'))
    expect(profile.isAuthenticated).toBe(false)
    expect(profile).toMatchObject({ sessionExpired: true })
  })

  it('an outage answer while expiration is suspected keeps waiting for a verdict', async () => {
    const { profile, coves } = await setup()
    await expect(
      coves({ func: async () => unauthorized() }).createVote(vote),
    ).rejects.toMatchObject({ status: 401 })
    profile.beginSessionRevalidation()
    profile.syncFromServer(undefined, {
      sessionGeneration: 'first-session',
      sessionExpired: false,
    })
    expect(profile.isAuthenticated).toBe(false)
    expect(profile).toMatchObject({
      sessionExpired: true,
      sessionExpirationConfirmed: false,
    })
    // Once the backend recovers, the next verdict still counts.
    profile.beginSessionRevalidation()
    profile.syncFromServer(session('first-session'))
    expect(profile.isAuthenticated).toBe(true)
  })

  it('a requested verdict with no cookie at all confirms the expiration', async () => {
    // The cookie expired in the browser (or another tab removed it) between
    // the authenticated root data and the recovery check: the server sees no
    // cookie, so it reports neither a generation nor an expiration. That is
    // still the verdict on the suspected generation, not stale data.
    const { profile, coves } = await setup()
    await expect(
      coves({ func: async () => unauthorized() }).createVote(vote),
    ).rejects.toMatchObject({ status: 401 })
    profile.beginSessionRevalidation()
    profile.syncFromServer(undefined, {
      sessionGeneration: undefined,
      sessionExpired: false,
    })
    expect(profile.isAuthenticated).toBe(false)
    expect(profile).toMatchObject({
      sessionExpired: true,
      sessionExpirationConfirmed: true,
    })
    // The generation is retired: the data that authenticated it cannot revive it.
    profile.beginSessionRevalidation()
    profile.syncFromServer(session('first-session'))
    expect(profile.isAuthenticated).toBe(false)
    expect(profile).toMatchObject({ sessionExpired: true })
    // A later login is adopted as usual.
    profile.syncFromServer(session('second-session'))
    expect(profile.isAuthenticated).toBe(true)
    expect(profile).toMatchObject({ sessionExpired: false })
  })

  it('unrequested anonymous data with no generation stays stale while expiration is suspected', async () => {
    const { profile, coves } = await setup()
    await expect(
      coves({ func: async () => unauthorized() }).createVote(vote),
    ).rejects.toMatchObject({ status: 401 })
    profile.syncFromServer(undefined, {
      sessionGeneration: undefined,
      sessionExpired: false,
    })
    expect(profile).toMatchObject({
      sessionExpired: true,
      sessionExpirationConfirmed: false,
    })
  })

  it('a delayed old authenticated root load cannot replace a newer same-DID session', async () => {
    const { profile, coves } = await setup()
    profile.syncFromServer(session('second-session'))
    profile.syncFromServer(session('first-session'))
    await expect(
      coves({ func: async () => unauthorized() }).createVote(vote),
    ).rejects.toMatchObject({ status: 401 })
    profile.syncFromServer(session('second-session'))
    expect(profile.isAuthenticated).toBe(false)
  })

  it('a delayed expired guest result cannot clear a newer login', async () => {
    const { profile } = await setup()
    profile.syncFromServer(session('second-session'))
    profile.syncFromServer(undefined, {
      sessionGeneration: 'first-session',
      sessionExpired: true,
    })
    expect(profile.isAuthenticated).toBe(true)
    expect(profile).toMatchObject({ sessionExpired: false })
  })

  it('initial anonymous root data arriving late cannot clear a newer login', async () => {
    const { profile } = await setup()
    profile.syncFromServer(undefined, {
      sessionGeneration: undefined,
      sessionExpired: false,
    })
    expect(profile.isAuthenticated).toBe(true)
  })
})
