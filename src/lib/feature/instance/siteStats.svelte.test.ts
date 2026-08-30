/**
 * Site stats must not be fetched or retained during a server render.
 *
 * `siteStats` is a module-level singleton with a five-minute cache. A server
 * render that populated it would publish one request's numbers to every later
 * visitor, and would add an upstream round-trip to a render that does not need
 * one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const covesSpy = vi.hoisted(() => vi.fn())

vi.mock('$app/environment', () => ({
  browser: false,
  dev: false,
  building: false,
  version: 'test',
}))

vi.mock('$lib/api/client.svelte', () => ({ coves: covesSpy }))

import { siteStats } from './siteStats.svelte'

beforeEach(() => {
  covesSpy.mockReset()
})

describe('siteStats during a server render', () => {
  it('makes no upstream call', async () => {
    await siteStats.fetch()

    expect(covesSpy).not.toHaveBeenCalled()
  })

  it('retains nothing on the shared singleton', async () => {
    await siteStats.fetch()

    expect(siteStats.data).toBeUndefined()
    expect(siteStats.error).toBeUndefined()
    // A stuck `loading` would also be shared state — every later render would
    // see a spinner it never started.
    expect(siteStats.loading).toBe(false)
  })

  it('stays inert across repeated renders', async () => {
    await siteStats.fetch()
    await siteStats.fetch()
    await siteStats.fetch()

    expect(covesSpy).not.toHaveBeenCalled()
    expect(siteStats.data).toBeUndefined()
  })
})
