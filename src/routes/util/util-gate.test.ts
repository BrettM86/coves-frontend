import { describe, it, expect, vi } from 'vitest'
import { isHttpError } from '@sveltejs/kit'

/**
 * The /util/* debug pages must 404 outside dev. The gate lives in two
 * places: this +layout.ts load (client-side when SSR is off) and a
 * hooks.server.ts check (real HTTP 404 at the server edge). This pins the
 * load-function half so a refactor can't silently drop it.
 */
async function importGateWith(dev: boolean) {
  vi.resetModules()
  vi.doMock('$app/environment', () => ({
    dev,
    browser: false,
    building: false,
  }))
  return await import('./+layout')
}

describe('/util dev gate', () => {
  it('throws a 404 outside dev', async () => {
    const { load } = await importGateWith(false)
    try {
      // @ts-expect-error — the load event is unused by the guard
      load({})
      expect.unreachable('load should have thrown')
    } catch (err) {
      expect(isHttpError(err)).toBe(true)
      if (isHttpError(err)) {
        expect(err.status).toBe(404)
      }
    }
  })

  it('loads without error in dev', async () => {
    const { load } = await importGateWith(true)
    // @ts-expect-error — the load event is unused by the guard
    expect(() => load({})).not.toThrow()
  })
})
