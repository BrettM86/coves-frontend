import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
//
// The loader is exercised for its error translation only: what an upstream XRPC
// failure turns into by the time it reaches SvelteKit's router. `$app/environment`
// is deliberately NOT mocked — with `browser` false, `feed()` hands back a fresh
// Feed per load, so no cached success can shadow a rejecting mock.
// ---------------------------------------------------------------------------

const mockCovesMethods = vi.hoisted(() => ({
  getProfile: vi.fn(),
  getActorPosts: vi.fn(),
  getActorComments: vi.fn(),
}))

// The factory itself is a spy so the loader's client construction is
// observable — see the fetch pass-through assertion in the happy-path test.
const mockCoves = vi.hoisted(() => vi.fn(() => mockCovesMethods))

vi.mock('$lib/api/client.svelte', () => ({
  coves: mockCoves,
}))

// `feed.svelte.ts` imports `profile` purely for its cache-clearing effect; the
// real module reads localStorage at import time, which node has no notion of.
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: { meta: { profile: undefined } },
}))

import { isHttpError } from '@sveltejs/kit'
import { XrpcError } from '$lib/api/coves/xrpc'
import { load } from './+page'

// The loader only destructures { params, url, fetch, route }; supplying those
// four is sufficient at runtime. Cast to the full LoadEvent for the type, the
// same way the repo's other load tests do.
function makeArgs(handle: string, query = ''): Parameters<typeof load>[0] {
  return {
    params: { handle },
    url: new URL(`https://coves.test/profile/${handle}${query}`),
    // A distinct spy, not globalThis.fetch: the pass-through assertion below
    // must be able to tell SvelteKit's per-request fetch from the global one.
    fetch: vi.fn(),
    route: { id: '/profile/[handle=actor]' },
  } as unknown as Parameters<typeof load>[0]
}

/** Resolves with whatever the promise rejected with; fails if it resolves. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    (value) => {
      throw new Error(
        `expected load to reject, but it resolved with ${JSON.stringify(value)}`,
      )
    },
    (err: unknown) => err,
  )
}

const profileFixture = {
  did: 'did:plc:alice',
  handle: 'alice.coves.social',
}
const postsFixture = { posts: [] }
const commentsFixture = { comments: [] }

describe('profile loader', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // `Feed.load` console.errors every rejection before rethrowing it.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    mockCoves.mockClear()
    mockCovesMethods.getProfile.mockReset().mockResolvedValue(profileFixture)
    mockCovesMethods.getActorPosts.mockReset().mockResolvedValue(postsFixture)
    mockCovesMethods.getActorComments
      .mockReset()
      .mockResolvedValue(commentsFixture)
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  // Every other test here asserts a rejection, so a loader that threw
  // unconditionally would fail exactly one of them. This is the one.
  it('returns the profile, posts and comments for a valid actor', async () => {
    const args = makeArgs('alice.coves.social', '?cursor=page2')
    const result = await load(args)

    expect(result.data.value).toEqual({
      profile: profileFixture,
      posts: postsFixture,
      comments: commentsFixture,
    })
    // SvelteKit's per-request fetch must reach the client factory — it
    // carries SSR cookie/credential forwarding, and no other assertion
    // notices if the loader silently drops it for the global fetch.
    expect(mockCoves).toHaveBeenCalledWith({ func: args.fetch })
    expect(mockCovesMethods.getProfile).toHaveBeenCalledWith({
      actor: 'alice.coves.social',
    })
    expect(mockCovesMethods.getActorPosts).toHaveBeenCalledWith({
      actor: 'alice.coves.social',
      limit: 20,
      cursor: 'page2',
    })
    expect(mockCovesMethods.getActorComments).toHaveBeenCalledWith({
      actor: 'alice.coves.social',
      limit: 20,
      cursor: 'page2',
    })
  })

  // B1 — an upstream 404 must reach the router as a 404 whose message is the
  // i18n key `couldnt_find_person`. The key shape is load-bearing: `errorMessage`
  // in src/lib/app/util/error.ts only translates messages matching /^[\w-]+$/, so a
  // prose message would silently ship untranslated to every locale.
  //
  // Parameterised over the 404 shapes the client can actually produce, because
  // the status is what decides routing — never the wording of `message`. The
  // last row is what `XrpcClient#parseError` synthesises when a 404 response
  // body is not the XRPC error JSON (e.g. a proxy-level miss).
  //
  // Scoped to `getProfile`: only that call answers "does this account exist?".
  it.each([
    ['ProfileNotFound', 'user not found'],
    ['NotFound', 'Profile not found'],
    ['UnknownError', 'XRPC request failed with status 404'],
  ])(
    'turns an upstream 404 (%s: "%s") into a 404 keyed couldnt_find_person',
    async (errorName, message) => {
      mockCovesMethods.getProfile.mockRejectedValue(
        new XrpcError(404, errorName, message),
      )

      const thrown = await rejection(load(makeArgs('ghost.coves.social')))

      expect(isHttpError(thrown)).toBe(true)
      expect(thrown).toMatchObject({
        status: 404,
        body: { message: 'couldnt_find_person' },
      })
    },
  )

  // B2 — a non-404 upstream failure is not the loader's to reinterpret: the
  // original XrpcError must reach the caller with its own status and error name
  // intact, rather than every failure being flattened into one server error.
  it.each([
    [500, 'InternalServerError', 'boom'],
    [401, 'AuthenticationRequired', 'Invalid token'],
    [502, 'UpstreamFailure', 'PDS unreachable'],
  ])(
    'propagates the original XrpcError for a %i upstream failure',
    async (status, errorName, message) => {
      const upstream = new XrpcError(status, errorName, message)
      mockCovesMethods.getProfile.mockRejectedValue(upstream)

      const thrown = await rejection(load(makeArgs('alice.coves.social')))

      expect(thrown).toBe(upstream)
      expect(isHttpError(thrown)).toBe(false)
    },
  )

  // A failure that never reached XRPC — a DNS miss, an aborted request, a
  // programming error inside the init closure — is likewise not the loader's to
  // reinterpret. Without this, an `instanceof XrpcError` check could be widened
  // to catch everything and no test would notice.
  it('propagates a rejection that is not an XrpcError at all', async () => {
    const upstream = new TypeError('fetch failed')
    mockCovesMethods.getProfile.mockRejectedValue(upstream)

    const thrown = await rejection(load(makeArgs('alice.coves.social')))

    expect(thrown).toBe(upstream)
    expect(isHttpError(thrown)).toBe(false)
  })

  // B3 — not characterization: this is the only test that kills a blanket
  // `error(500, 'Failed to load profile')` fallback, because the 400 it expects
  // is an HttpError rather than an XrpcError and so takes a different path out
  // of the catch. Deleting it reopens that hole.
  it('rejects an actor that is neither a handle nor a DID with a 400', async () => {
    const thrown = await rejection(load(makeArgs('not-an-identifier')))

    expect(thrown).toMatchObject({
      status: 400,
      body: { message: 'Invalid user identifier' },
    })
    expect(mockCovesMethods.getProfile).not.toHaveBeenCalled()
  })

  // B4 — the three upstream calls share one `Promise.all`, so any of them can
  // be the rejecter, but only `getProfile` speaks to whether the account
  // exists. A stale AppView or a proxy misroute 404ing the posts or comments
  // call is an infrastructure fault; rendering "that user doesn't exist" for it
  // tells the viewer a deleted-account story about a service outage.
  it.each([
    ['getActorPosts', mockCovesMethods.getActorPosts] as const,
    ['getActorComments', mockCovesMethods.getActorComments] as const,
  ])(
    'propagates a 404 from %s rather than calling the actor missing',
    async (_name, method) => {
      const upstream = new XrpcError(
        404,
        'UnknownError',
        'XRPC request failed with status 404',
      )
      method.mockRejectedValue(upstream)

      const thrown = await rejection(load(makeArgs('alice.coves.social')))

      expect(thrown).toBe(upstream)
      expect(isHttpError(thrown)).toBe(false)
    },
  )
})
