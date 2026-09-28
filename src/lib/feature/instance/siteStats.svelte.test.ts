/**
 * Site stats must not be fetched or retained during a server render.
 *
 * `siteStats` is a module-level singleton with a five-minute cache. A server
 * render that populated it would publish one request's numbers to every later
 * visitor, and would add a round-trip to a render that does not need one.
 * In the browser it asks this app's own `/api/site-stats` for the totals,
 * which the server computes once for everyone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ browser: false }))

vi.mock('$app/environment', () => ({
  get browser() {
    return env.browser
  },
  dev: false,
  building: false,
  version: 'test',
}))

const fetchSpy = vi.fn<typeof fetch>()

async function freshSiteStats() {
  vi.resetModules()
  return (await import('./siteStats.svelte')).siteStats
}

beforeEach(() => {
  env.browser = false
  fetchSpy.mockReset()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('siteStats during a server render', () => {
  it('makes no request', async () => {
    const siteStats = await freshSiteStats()

    await siteStats.fetch()

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('retains nothing on the shared singleton', async () => {
    const siteStats = await freshSiteStats()

    await siteStats.fetch()

    expect(siteStats.data).toBeUndefined()
    expect(siteStats.error).toBeUndefined()
    // A stuck `loading` would also be shared state — every later render would
    // see a spinner it never started.
    expect(siteStats.loading).toBe(false)
  })

  it('stays inert across repeated renders', async () => {
    const siteStats = await freshSiteStats()

    await siteStats.fetch()
    await siteStats.fetch()
    await siteStats.fetch()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(siteStats.data).toBeUndefined()
  })
})

describe('siteStats in the browser', () => {
  const STATS = { communities: 3, subscribers: 15, members: 6, posts: 8 }

  beforeEach(() => {
    env.browser = true
  })

  it('reads the server-computed totals, once per cache period', async () => {
    fetchSpy.mockResolvedValue(Response.json(STATS))
    const siteStats = await freshSiteStats()

    await siteStats.fetch()
    await siteStats.fetch()

    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(fetchSpy).toHaveBeenCalledWith('/api/site-stats')
    expect(siteStats.data).toEqual(STATS)
  })

  it('reports a failed or malformed response instead of showing it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchSpy.mockResolvedValue(Response.json({ communities: 'many' }))
    const siteStats = await freshSiteStats()

    await siteStats.fetch()

    expect(siteStats.data).toBeUndefined()
    expect(siteStats.error).toBeDefined()
    expect(siteStats.loading).toBe(false)
  })
})
