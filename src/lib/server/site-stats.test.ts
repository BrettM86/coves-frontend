import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$env/dynamic/private', () => ({ env: {} }))
const warn = vi.hoisted(() => vi.fn())
vi.mock('$lib/server/log', () => ({ log: { warn } }))

const { aggregateSiteStats, createSiteStatsCache, SITE_STATS_TTL_MS } =
  await import('./site-stats')

beforeEach(() => {
  warn.mockReset()
})

const community = (subscribers: number, members: number, posts: number) => ({
  subscriberCount: subscribers,
  memberCount: members,
  postCount: posts,
})

const STATS = { communities: 1, subscribers: 2, members: 3, posts: 4 }

describe('aggregateSiteStats', () => {
  it('sums every page, following cursors to the end', async () => {
    const pages = new Map<
      string | undefined,
      Awaited<ReturnType<Parameters<typeof aggregateSiteStats>[0]>>
    >([
      [
        undefined,
        { communities: [community(10, 2, 5), community(1, 1, 1)], cursor: '2' },
      ],
      ['2', { communities: [community(4, 3, 2)] }],
    ])
    const listPage = vi.fn(async (cursor: string | undefined) => {
      const page = pages.get(cursor)
      if (!page) throw new Error(`unexpected cursor ${cursor}`)
      return page
    })

    expect(await aggregateSiteStats(listPage)).toEqual({
      communities: 3,
      subscribers: 15,
      members: 6,
      posts: 8,
    })
    expect(listPage.mock.calls.map(([cursor]) => cursor)).toEqual([
      undefined,
      '2',
    ])
  })

  it('stops at an empty page even when it carries a cursor', async () => {
    const listPage = vi.fn(async () => ({ communities: [], cursor: 'again' }))

    expect(await aggregateSiteStats(listPage)).toEqual({
      communities: 0,
      subscribers: 0,
      members: 0,
      posts: 0,
    })
    expect(listPage).toHaveBeenCalledOnce()
  })

  it('bounds the walk when the cursor never runs out', async () => {
    let page = 0
    const listPage = vi.fn(async () => ({
      communities: [community(1, 1, 1)],
      cursor: String(++page),
    }))

    const stats = await aggregateSiteStats(listPage)

    expect(listPage).toHaveBeenCalledTimes(50)
    expect(stats.communities).toBe(50)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('does not warn about truncation when the list ends on the last page', async () => {
    let page = 0
    const listPage = vi.fn(async () => {
      page++
      return {
        communities: [community(1, 1, 1)],
        cursor: page < 50 ? String(page) : undefined,
      }
    })

    await aggregateSiteStats(listPage)

    expect(listPage).toHaveBeenCalledTimes(50)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('createSiteStatsCache', () => {
  it('computes once for concurrent callers', async () => {
    let finish: (stats: typeof STATS) => void = () => {}
    const load = vi.fn(
      () => new Promise<typeof STATS>((resolve) => (finish = resolve)),
    )
    const get = createSiteStatsCache(load, () => 0)

    const both = Promise.all([get(), get()])
    finish(STATS)

    expect(await both).toEqual([STATS, STATS])
    expect(load).toHaveBeenCalledOnce()
  })

  it('serves the cached value until the TTL runs out', async () => {
    let now = 0
    const load = vi.fn(async () => STATS)
    const get = createSiteStatsCache(load, () => now, 1000)

    await get()
    now = 999
    await get()
    expect(load).toHaveBeenCalledOnce()

    now = 1000
    await get()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps serving the last value when a refresh fails', async () => {
    let now = 0
    const load = vi
      .fn<() => Promise<typeof STATS>>()
      .mockResolvedValueOnce(STATS)
      .mockRejectedValueOnce(new Error('upstream down'))
    const get = createSiteStatsCache(load, () => now, 1000)

    await get()
    now = 5000

    expect(await get()).toEqual(STATS)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('waits 30 seconds before retrying a failed refresh', async () => {
    let now = 0
    const load = vi
      .fn<() => Promise<typeof STATS>>()
      .mockResolvedValueOnce(STATS)
      .mockRejectedValue(new Error('upstream down'))
    const get = createSiteStatsCache(load, () => now)

    await get()
    now = SITE_STATS_TTL_MS
    await get()
    expect(load).toHaveBeenCalledTimes(2)

    now = SITE_STATS_TTL_MS + 29_999
    expect(await get()).toEqual(STATS)
    expect(load).toHaveBeenCalledTimes(2)

    now = SITE_STATS_TTL_MS + 30_000
    await get()
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('stops serving totals six TTLs after they were computed', async () => {
    let now = 0
    const load = vi
      .fn<() => Promise<typeof STATS>>()
      .mockResolvedValueOnce(STATS)
      .mockRejectedValue(new Error('upstream down'))
    const get = createSiteStatsCache(load, () => now)

    await get()
    now = 6 * SITE_STATS_TTL_MS - 1
    expect(await get()).toEqual(STATS)

    now = 6 * SITE_STATS_TTL_MS
    await expect(get()).rejects.toThrow('upstream down')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps the 30-second backoff once the totals are too old to serve', async () => {
    let now = 0
    const load = vi
      .fn<() => Promise<typeof STATS>>()
      .mockResolvedValueOnce(STATS)
      .mockRejectedValue(new Error('upstream down'))
    const get = createSiteStatsCache(load, () => now)

    await get()
    now = 6 * SITE_STATS_TTL_MS
    await expect(get()).rejects.toThrow('upstream down')
    expect(load).toHaveBeenCalledTimes(2)

    now = 6 * SITE_STATS_TTL_MS + 29_999
    await expect(get()).rejects.toThrow('upstream down')
    await expect(get()).rejects.toThrow('upstream down')
    expect(load).toHaveBeenCalledTimes(2)
    expect(warn).not.toHaveBeenCalled()

    now = 6 * SITE_STATS_TTL_MS + 30_000
    await expect(get()).rejects.toThrow('upstream down')
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('waits 30 seconds before retrying a failure with nothing to fall back on', async () => {
    let now = 0
    const load = vi
      .fn<() => Promise<typeof STATS>>()
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockResolvedValueOnce(STATS)
    const get = createSiteStatsCache(load, () => now)

    await expect(get()).rejects.toThrow('upstream down')
    now = 29_999
    await expect(get()).rejects.toThrow('upstream down')
    expect(load).toHaveBeenCalledOnce()

    now = 30_000
    expect(await get()).toEqual(STATS)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('clears the backoff once a load succeeds', async () => {
    let now = 0
    const load = vi
      .fn<() => Promise<typeof STATS>>()
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockResolvedValueOnce(STATS)
      .mockRejectedValueOnce(new Error('down again'))
    const get = createSiteStatsCache(load, () => now)

    await expect(get()).rejects.toThrow('upstream down')
    now = 30_000
    expect(await get()).toEqual(STATS)

    now = 30_000 + SITE_STATS_TTL_MS
    expect(await get()).toEqual(STATS)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('reports a failure when there is nothing to fall back on', async () => {
    const get = createSiteStatsCache(
      async () => {
        throw new Error('upstream down')
      },
      () => 0,
    )

    await expect(get()).rejects.toThrow('upstream down')
  })
})
