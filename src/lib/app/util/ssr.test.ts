import { beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ browser: true }))
vi.mock('$app/environment', () => ({
  get browser() {
    return env.browser
  },
  dev: false,
  building: false,
  version: 'test',
}))

async function freshSsr() {
  vi.resetModules()
  return await import('./ssr')
}

beforeEach(() => {
  env.browser = true
})

describe('awaitIfServer', () => {
  it('awaits on the server', async () => {
    env.browser = false
    const { awaitIfServer } = await freshSsr()

    expect((await awaitIfServer(Promise.resolve(1))).data).toBe(1)
  })

  it('awaits the hydrating load, whose markup the server already rendered', async () => {
    const { awaitIfServer } = await freshSsr()

    expect((await awaitIfServer(Promise.resolve(1))).data).toBe(1)
  })

  it('streams on client-side navigations once the app has hydrated', async () => {
    const { awaitIfServer, markHydrated } = await freshSsr()
    markHydrated()
    const pending = new Promise<number>(() => {})

    expect((await awaitIfServer(pending)).data).toBe(pending)
  })

  it('streams the hydrating load when the server rendered a different request', async () => {
    const { awaitIfServer } = await freshSsr()
    const response = Promise.resolve(1)

    // Awaiting would hydrate the server's rows with this response's posts.
    expect((await awaitIfServer(response, false)).data).toBe(response)
  })

  it('keeps a streamed load that fails before the page subscribes handled', async () => {
    const { awaitIfServer } = await freshSsr()
    const failure = new Error('feed unavailable')
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)

    try {
      const { data } = await awaitIfServer(Promise.reject(failure), false)
      // The layout load is still running, so `{#await}` has not subscribed.
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(unhandled).not.toHaveBeenCalled()
      await expect(data).rejects.toBe(failure)
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('hands a failed hydrating load to {:catch} rather than throwing', async () => {
    const { awaitIfServer } = await freshSsr()
    const failure = new Error('feed unavailable')

    const { data } = await awaitIfServer(Promise.reject(failure))

    await expect(data).rejects.toBe(failure)
  })

  it('lets a failed server load throw', async () => {
    env.browser = false
    const { awaitIfServer } = await freshSsr()
    const failure = new Error('feed unavailable')

    await expect(awaitIfServer(Promise.reject(failure))).rejects.toBe(failure)
  })
})

describe('renderingServerMarkup', () => {
  it('holds until the first page has mounted', async () => {
    const { markHydrated, renderingServerMarkup } = await freshSsr()

    expect(renderingServerMarkup()).toBe(true)
    markHydrated()
    expect(renderingServerMarkup()).toBe(false)
  })
})
