import { beforeEach, describe, expect, it, vi } from 'vitest'

// The sibling feed.svelte.test.ts hard-mocks `browser: true` because it
// exercises the client-side instance cache. This file is the server half: a
// failed fetch on the server must reach stderr as one scrubbed JSON line,
// because that is the copy a log shipper keeps.
vi.mock('$app/environment', () => ({
  browser: false,
  dev: false,
  building: false,
  version: 'test',
}))

// The real module touches localStorage at import time, which node has none of.
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: { meta: { profile: undefined } },
}))

const { Feed } = await import('$lib/feature/feeds/feed.svelte')

interface Params {
  community: string
}
interface Result {
  from: string
}

/**
 * `FetchFn` declares a synchronous return while `load()` awaits it; the
 * production `feed()` factory bridges that gap with the same cast.
 */
function asFetchFn(
  fn: (params: Params) => Promise<Result>,
): (params: Params) => Result {
  return fn as unknown as (params: Params) => Result
}

const PARAMS: Params = { community: 'news.coves.social' }

/** The shape of a real upstream failure: the URL rides in the cause. */
const fetchFailure = (): TypeError =>
  new TypeError('fetch failed', {
    cause: new Error('GET http://api/x?access_token=X'),
  })

const spyOnError = () => vi.spyOn(console, 'error').mockImplementation(() => {})

describe('Feed.load failure logging on the server', () => {
  let errorSpy: ReturnType<typeof spyOnError>

  beforeEach(() => {
    errorSpy = spyOnError()
  })

  it('logs one scrubbed JSON line and still surfaces the error', async () => {
    const err = fetchFailure()
    const subject = new Feed<Params, Result>(
      asFetchFn(() => Promise.reject(err)),
    )

    await expect(subject.load(PARAMS)).rejects.toBe(err)

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const call = errorSpy.mock.calls[0] ?? []
    expect(call.length).toBe(1)

    const raw = call[0]
    expect(typeof raw).toBe('string')
    // Assert JSON shape before parsing so a plain-text line fails with a
    // readable diff rather than an opaque SyntaxError.
    expect(raw as string).toMatch(/^\{[\s\S]*\}$/)
    const line: unknown = JSON.parse(raw as string)
    expect(line).toBeTypeOf('object')

    // The credential must be gone from the RAW text: it sits two levels deep,
    // in the cause of the thrown TypeError.
    expect(raw as string).toContain('[REDACTED]')
    expect(raw as string).not.toContain('access_token=X')

    // Logging must not swallow the failure — the banner still needs it.
    expect(subject.error).toBe(err)
  })
})
