import { beforeEach, describe, expect, it, vi } from 'vitest'

// `feed.svelte.ts` reads `browser` and imports `profile` (whose real module
// touches localStorage at import time, which node has no notion of). The cache
// factory only hands back an existing instance when `browser` is true, which is
// the mode these tests care about.
vi.mock('$app/environment', () => ({
  browser: true,
  dev: false,
  building: false,
  version: 'test',
}))

vi.mock('$lib/app/auth.svelte', () => ({
  profile: { meta: { profile: undefined } },
}))

import { Feed, feed, feeds } from '$lib/feature/feeds/feed.svelte'

interface Params {
  community: string
}
interface Result {
  from: string
}

/**
 * `FetchFn` declares a synchronous return while `load()` awaits it; the
 * production `feed()` factory bridges that gap with the same cast, so tests
 * construct `Feed` through this helper rather than restating the cast inline.
 */
function asFetchFn(
  fn: (params: Params) => Promise<Result>,
): (params: Params) => Result {
  return fn as unknown as (params: Params) => Result
}

/** A promise whose settlement this test controls, to force an interleaving. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const PARAMS_A: Params = { community: 'news.coves.social' }
const PARAMS_B: Params = { community: 'linux.coves.social' }

describe('Feed.load concurrency', () => {
  it('discards a superseded fetch that resolves last', async () => {
    const first = deferred<Result>()
    const second = deferred<Result>()
    const fetcher = vi
      .fn<(params: Params) => Promise<Result>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const subject = new Feed<Params, Result>(asFetchFn(fetcher))

    // Both in flight; the second load supersedes the first.
    const loadA = subject.load(PARAMS_A)
    const loadB = subject.load(PARAMS_B)

    second.resolve({ from: 'B' })
    await expect(loadB).resolves.toEqual({ from: 'B' })

    // The superseded fetch lands late. It still settles its own caller...
    first.resolve({ from: 'A' })
    await expect(loadA).resolves.toEqual({ from: 'A' })

    // ...but must not have overwritten the cache, which now describes B.
    expect(subject.peek()).toEqual({ from: 'B' })

    // The regression this guards: a later load for B (back/forward, or any
    // re-run with matching params) saw a non-null `#data` holding A's result
    // and served it without refetching.
    await expect(subject.load(PARAMS_B)).resolves.toEqual({ from: 'B' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not surface an error from a superseded fetch that rejects last', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = deferred<Result>()
    const second = deferred<Result>()
    const fetcher = vi
      .fn<(params: Params) => Promise<Result>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const subject = new Feed<Params, Result>(asFetchFn(fetcher))

    const loadA = subject.load(PARAMS_A)
    const loadB = subject.load(PARAMS_B)

    second.resolve({ from: 'B' })
    await loadB

    const stale = new Error('superseded request failed')
    first.reject(stale)
    // The superseded caller is still rejected — the failure is not swallowed.
    await expect(loadA).rejects.toBe(stale)

    // But it must not raise a banner over the page B rendered successfully.
    expect(subject.error).toBeUndefined()
    expect(subject.peek()).toEqual({ from: 'B' })

    consoleError.mockRestore()
  })

  it('still records an error when the newest fetch is the one that fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom = new Error('current request failed')
    const subject = new Feed<Params, Result>(
      asFetchFn(() => Promise.reject(boom)),
    )

    await expect(subject.load(PARAMS_A)).rejects.toBe(boom)
    expect(subject.error).toBe(boom)

    consoleError.mockRestore()
  })
})

describe('feed() cache', () => {
  beforeEach(() => {
    feeds.clear()
  })

  it('reuses the cached instance for a route ID and adopts the newest fetcher', async () => {
    const firstFetcher = vi.fn(async () => ({ communities: [] }))
    const secondFetcher = vi.fn(async () => ({ communities: [] }))

    const a = feed('/explore/communities', firstFetcher)
    const b = feed('/explore/communities', secondFetcher)
    expect(b).toBe(a)

    await b.load({ sort: 'new' })

    // The first navigation's closure must not be the one that runs.
    expect(firstFetcher).not.toHaveBeenCalled()
    expect(secondFetcher).toHaveBeenCalledTimes(1)
  })
})
