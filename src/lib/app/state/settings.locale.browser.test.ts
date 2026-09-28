// @vitest-environment jsdom
/**
 * The settings module owns one side effect on the locale: applying the
 * reader's chosen language. It must react to that choice only — not to every
 * other setting — and must not override the root layout's pick when no
 * language was chosen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: false,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))

const localeSet = vi.hoisted(() => vi.fn<(value: string) => void>())
vi.mock('./i18n', () => ({
  locale: { set: localeSet, get: () => 'en', subscribe: () => () => {} },
}))

async function svelteClientEntry(subpath: string): Promise<unknown> {
  const { createRequire } = await import('node:module')
  const require_ = createRequire(import.meta.url)
  return await import(
    /* @vite-ignore */
    require_.resolve('svelte/package.json').replace('package.json', subpath)
  )
}

vi.mock('svelte', () => svelteClientEntry('src/index-client.js'))

/** The module's effects run on Svelte's own scheduler; let it drain. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function freshSettings() {
  vi.resetModules()
  localStorage.clear()
  const { settings } = await import('./settings.svelte')
  await settle()
  // Proof the effects are live, so the assertions below are not vacuous: the
  // persist effect has already written the defaults.
  expect(localStorage.getItem('settings')).not.toBeNull()
  return { settings }
}

beforeEach(() => {
  localeSet.mockReset()
})

describe('settings → locale', () => {
  it('leaves the locale to the root layout when no language was chosen', async () => {
    await freshSettings()

    expect(localeSet).not.toHaveBeenCalled()
  })

  it('does not touch the locale when an unrelated setting changes', async () => {
    const { settings } = await freshSettings()

    settings.view = settings.view === 'cozy' ? 'compact' : 'cozy'
    settings.infiniteScroll = !settings.infiniteScroll
    await settle()

    expect(JSON.parse(localStorage.getItem('settings') ?? '{}').view).toBe(
      settings.view,
    )
    expect(localeSet).not.toHaveBeenCalled()
  })

  it('applies a chosen language, and the browser’s once it is cleared', async () => {
    const { settings } = await freshSettings()

    settings.language = 'fr'
    await settle()
    expect(localeSet).toHaveBeenLastCalledWith('fr')

    settings.language = null
    await settle()
    expect(localeSet).toHaveBeenLastCalledWith(navigator.language)
    expect(localeSet).toHaveBeenCalledTimes(2)
  })
})
