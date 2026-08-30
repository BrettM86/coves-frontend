/**
 * The root universal load, on the browser path.
 *
 * Its job is to pick the locale the client should hydrate with. That choice
 * has to agree with what the server already rendered, or the first paint
 * flips language: the server's answer arrives as `data.lang` from
 * `+layout.server.ts`, so it must outrank the browser's own `navigator`
 * preference and yield only to an explicit user setting.
 *
 * Order pinned here: `settings.language ?? data.lang ?? navigator.language`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  language: undefined as string | undefined,
  loadCalls: [] as string[],
}))

vi.mock('$app/environment', () => ({
  browser: true,
  dev: false,
  building: false,
  version: 'test',
}))

vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_SSR_ENABLED: 'true' },
}))

vi.mock('$lib/app/state/settings.svelte', () => ({
  settings: {
    get language(): string | undefined {
      return state.language
    },
  },
}))

vi.mock('$lib/app/state/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/app/state/i18n')>()
  return {
    ...actual,
    // Recorded, not performed: this test is about which locale is chosen.
    loadTranslations: async (locale: string): Promise<void> => {
      state.loadCalls.push(locale)
    },
  }
})

const { load, ssr } = await import('./+layout')

/**
 * The current `load` declares no parameters; the contract under test is that
 * it receives the parent server load's data. Cast rather than `any` so the
 * shape being passed is still checked.
 */
type LayoutLoad = (event: { data: { lang?: string } }) => Promise<unknown>
const callLoad = (data: { lang?: string } = {}): Promise<unknown> =>
  (load as unknown as LayoutLoad)({ data })

beforeEach(() => {
  state.language = undefined
  state.loadCalls.length = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('root universal load — locale resolution order', () => {
  it('prefers the user setting over everything else', async () => {
    vi.stubGlobal('navigator', { language: 'ja' })
    state.language = 'fr'

    await callLoad({ lang: 'de' })

    expect(state.loadCalls).toEqual(['fr'])
  })

  it('prefers the server-rendered language over the browser preference', async () => {
    // Without this the client hydrates in `navigator`'s language while the
    // server rendered in the one it negotiated, and the page changes language
    // under the reader.
    vi.stubGlobal('navigator', { language: 'fr' })
    state.language = undefined

    await callLoad({ lang: 'de' })

    expect(state.loadCalls).toEqual(['de'])
  })

  it('falls back to the browser preference, through the alias map', async () => {
    vi.stubGlobal('navigator', { language: 'en-US' })
    state.language = undefined

    await callLoad({})

    expect(state.loadCalls).toEqual(['en'])
  })

  it('resolves a regional server language through the alias map too', async () => {
    vi.stubGlobal('navigator', { language: 'ja' })
    state.language = undefined

    await callLoad({ lang: 'zh-CN' })

    expect(state.loadCalls).toEqual(['zh-Hans'])
  })
})

describe('root universal load — ssr flag', () => {
  it('mirrors PUBLIC_SSR_ENABLED', () => {
    expect(ssr).toBe(true)
  })
})
