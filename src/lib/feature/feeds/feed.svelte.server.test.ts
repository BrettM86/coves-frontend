/**
 * The feed cache must not exist on the server.
 *
 * `feeds` is a module-level map keyed by route id, which is exactly right in
 * the browser — a client-side navigation back to `/` should reuse the posts it
 * already has. On the server that same map is shared by every visitor, so a
 * cached entry is one request's feed handed to the next. Separate file from
 * `feed.svelte.test.ts`, which mocks `browser: true` file-wide.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('$app/environment', () => ({
  browser: false,
  dev: false,
  building: false,
  version: 'test',
}))

// The real module reads localStorage at import time, which node has no notion
// of; the cache factory only needs `profile.meta.profile`.
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: { meta: { profile: undefined } },
}))

import { feed, feeds } from './feed.svelte'

type HomeInit = Parameters<typeof feed<'/'>>[1]

const init: HomeInit = async () => ({ feed: [], params: {} })

beforeEach(() => {
  feeds.clear()
})

describe('feed() during a server render', () => {
  it('retains nothing in the shared cache', () => {
    feed('/', init)
    feed('/', init)

    // Every entry left here outlives the request that created it and is
    // visible to the next visitor rendered by this process.
    expect(feeds.size).toBe(0)
  })

  it('hands each render its own Feed instance', () => {
    const first = feed('/', init)
    const second = feed('/', init)

    expect(second).not.toBe(first)
  })

  it('keeps data loaded by one render out of the next', async () => {
    const first = feed('/', (async () => ({
      feed: [{ marker: 'first-request' }],
      params: {},
    })) as unknown as HomeInit)
    await first.load({})

    const second = feed('/', init)

    expect(second.peek()).toBeUndefined()
  })
})
