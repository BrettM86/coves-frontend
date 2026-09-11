// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({
  profile: {
    current: { instance: 'https://upstream.internal.example' },
    isAuthenticated: true,
  },
}))
vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: false,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$lib/app/state/instance.svelte', () => ({
  DEFAULT_INSTANCE_URL: 'https://upstream.internal.example',
}))
vi.mock('$lib/app/state/auth.svelte', () => ({ profile: boundary.profile }))
const svelteClientEntry = async (subpath: string): Promise<unknown> => {
  const { createRequire } = await import('node:module')
  return import(
    /* @vite-ignore */ createRequire(import.meta.url)
      .resolve('svelte/package.json')
      .replace('package.json', subpath)
  )
}
vi.mock('svelte', () => svelteClientEntry('src/index-client.js'))

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

// Integration harness: real installed Kit router and production protected load;
// only API transport, persisted profile, and the rendering shell are fixtures.
// No navigation/invalidation implementation is mocked.
it('renders a client-only initial destination when its authenticated load receives 401', async () => {
  vi.stubGlobal('__VERSION__', 'test')
  vi.stubGlobal('__SVELTEKIT_PAYLOAD__', {})
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    },
  )
  history.replaceState({}, '', '/profile/blocks/users')
  const transport = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({ error: 'ExpiredToken', message: 'Session expired' }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
  )
  vi.stubGlobal('fetch', transport)
  const { createRequire } = await import('node:module')
  const kitClientPath = createRequire(import.meta.url)
    .resolve('@sveltejs/kit/package.json')
    .replace('package.json', 'src/runtime/client/client.js')
  vi.doMock(createRequire(kitClientPath).resolve('esm-env'), () => ({
    BROWSER: true,
    DEV: false,
    BUILDING: false,
  }))
  const { start } = await import(/* @vite-ignore */ kitClientPath)
  const { asClassComponent } = await import('svelte/legacy')
  const Root = (await import('./fixtures/RouterRoot.svelte')).default
  const { load } =
    await import('../../routes/profile/(local_user)/blocks/users/+page')
  const target = document.createElement('div')
  document.body.append(target)
  await start(
    {
      root: asClassComponent(Root),
      nodes: [
        async () => ({ component: Root }),
        async () => ({ component: Root }),
        async () => ({ component: Root, universal: { load } }),
      ],
      server_loads: [],
      dictionary: { '/profile/blocks/users': [2, []] },
      matchers: {},
      hooks: {
        handleError: ({ error }: { error: Error }) => ({
          message: error.message,
        }),
        reroute: () => undefined,
        transport: {},
      },
      decoders: {},
      encoders: {},
      hash: false,
    },
    target,
  )
  expect(transport).toHaveBeenCalledOnce()
  expect(
    target.querySelector('[data-route="/profile/blocks/users"]'),
    'the initial client-only navigation must mount, even when the protected load fails',
  ).not.toBeNull()
})
