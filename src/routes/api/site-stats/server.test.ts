import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSiteStats = vi.hoisted(() => vi.fn())
vi.mock('$lib/server/site-stats', () => ({
  getSiteStats,
  SITE_STATS_TTL_MS: 300_000,
}))
vi.mock('$lib/server/log', () => ({ log: { warn: vi.fn() } }))

const { GET } = await import('./+server')

const call = () =>
  GET({ locals: { requestId: 'req-1' } } as unknown as Parameters<
    typeof GET
  >[0])

beforeEach(() => {
  getSiteStats.mockReset()
})

describe('GET /api/site-stats', () => {
  it('returns the totals, cacheable for everyone for the TTL', async () => {
    const stats = { communities: 3, subscribers: 15, members: 6, posts: 8 }
    getSiteStats.mockResolvedValue(stats)

    const response = await call()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    expect(await response.json()).toEqual(stats)
  })

  it('answers 502, never cached, when the totals cannot be computed', async () => {
    getSiteStats.mockRejectedValue(new Error('upstream down'))

    const response = await call()

    expect(response.status).toBe(502)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
