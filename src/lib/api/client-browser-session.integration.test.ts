// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { XrpcError } from './coves/xrpc'

const navigation = vi.hoisted(() => ({
  invalidateAll: vi.fn<() => Promise<void>>(),
  afterNavigate: vi.fn<(callback: () => void) => void>(),
}))

vi.mock('$app/environment', () => ({
  browser: true,
  dev: false,
  building: false,
  version: 'test',
}))
vi.mock('$app/navigation', () => navigation)
vi.mock('$app/state', () => import('./fixtures/RecoverySignals.svelte'))
vi.mock('svelte', async () => {
  const { createRequire } = await import('node:module')
  return import(
    /* @vite-ignore */ createRequire(import.meta.url)
      .resolve('svelte/package.json')
      .replace('package.json', 'src/index-client.js')
  )
})
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$lib/app/state/instance.svelte', () => ({
  DEFAULT_INSTANCE_URL: 'https://upstream.internal.example',
}))
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: {
    current: {
      type: 'authenticated',
      instance: 'https://upstream.internal.example',
    },
    isAuthenticated: true,
    syncFromServer: vi.fn(),
  },
}))

it('refreshes browser session state on a proxy 401 while preserving the XRPC error before invalidation finishes', async () => {
  vi.stubGlobal('__VERSION__', 'test')
  const svelte = await import('svelte')
  const Root = (await import('./fixtures/RecoveryInstaller.svelte')).default
  const target = document.createElement('div')
  document.body.append(target)
  const mounted = svelte.mount(Root, { target })
  svelte.flushSync()
  navigation.afterNavigate.mock.calls.forEach(([callback]) => callback())
  svelte.flushSync()
  const { coves } = await import('./client.svelte')
  let finishInvalidation = () => {}
  const invalidation = new Promise<void>((resolve) => {
    finishInvalidation = resolve
  })
  navigation.invalidateAll.mockReturnValue(invalidation)
  const transport = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        error: 'ExpiredToken',
        message: 'The session has expired',
      }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    ),
  )

  try {
    // Invalidation may rerun loads that also receive 401. The original call
    // must finish while that refresh is still pending.
    const failure = await coves({ func: transport })
      .getDiscover({ limit: 1 })
      .catch((error: unknown) => error)

    expect(transport).toHaveBeenCalledWith(
      '/api/proxy/xrpc/social.coves.feed.getDiscover?limit=1',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    )
    expect(failure).toBeInstanceOf(XrpcError)
    expect(failure).toMatchObject({
      status: 401,
      errorName: 'ExpiredToken',
      message: 'The session has expired',
    })
    expect(navigation.invalidateAll).toHaveBeenCalledTimes(1)
  } finally {
    finishInvalidation()
    await svelte.unmount(mounted)
    target.remove()
    vi.unstubAllGlobals()
  }
})
