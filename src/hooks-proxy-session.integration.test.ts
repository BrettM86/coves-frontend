import { afterEach, expect, it, vi } from 'vitest'
import {
  createMockCookies,
  createMockEvent,
} from '$lib/test-utils/request-event'

vi.mock('$app/environment', () => ({
  dev: false,
  browser: false,
  building: false,
  version: 'test',
}))
vi.mock('$app/server', () => ({
  getRequestEvent: () => undefined,
}))
vi.mock('$env/dynamic/public', () => ({
  env: {
    PUBLIC_INSTANCE_URL: 'https://frontend.example.test',
    PUBLIC_INTERNAL_INSTANCE: 'https://upstream.example.test',
  },
}))
vi.mock('$env/dynamic/private', () => ({
  env: {
    ORIGIN: 'https://frontend.example.test',
    ADDRESS_HEADER: 'x-real-ip',
  },
}))

const { handle } = await import('./hooks.server')
const { POST } = await import('./routes/api/proxy/[...path]/+server')

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('proxies a cookie-authenticated write in one upstream hop even when /api/me is rate limited', async () => {
  const token = 'sealed-session-test-token'
  const path = 'xrpc/social.coves.community.subscribe'
  const payload = { community: 'did:plc:testcommunity' }
  const event = {
    ...createMockEvent({
      method: 'POST',
      url: `https://frontend.example.test/api/proxy/${path}`,
      routeId: '/api/proxy/[...path]',
      cookies: createMockCookies({ coves_session: token }),
      body: payload,
      headers: {
        origin: 'https://frontend.example.test',
        cookie: `coves_session=${token}; unrelated=private`,
        authorization: 'Bearer forged-client-token',
      },
    }),
    params: { path },
  }
  const upstreamFetch = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/me') {
      return Response.json({ error: 'RateLimitExceeded' }, { status: 429 })
    }
    return Response.json(
      { subscribed: true },
      { headers: { 'cache-control': 'public, max-age=300', etag: '"shared"' } },
    )
  })
  vi.stubGlobal('fetch', upstreamFetch)
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

  const response = await handle({
    event,
    resolve: async () => POST(event),
  })

  expect(upstreamFetch).toHaveBeenCalledTimes(1)
  expect(warnSpy).not.toHaveBeenCalled()
  const proxyCall = upstreamFetch.mock.calls.find(([input]) =>
    String(input).endsWith(`/${path}`),
  )
  expect(proxyCall).toBeDefined()
  const [destination, options] = proxyCall ?? []
  expect(destination).toBe(`https://upstream.example.test/${path}`)
  expect(options?.method).toBe('POST')
  const headers = new Headers(options?.headers)
  expect(headers.get('authorization')).toBe(`Bearer ${token}`)
  expect(headers.has('cookie')).toBe(false)
  expect(options?.body).toBeInstanceOf(Blob)
  if (options?.body instanceof Blob) {
    expect(JSON.parse(await options.body.text())).toEqual(payload)
  }
  expect(event.locals.auth).toEqual({ authenticated: false })
  expect(event.cookies.delete).not.toHaveBeenCalled()
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.has('etag')).toBe(false)
  expect(await response.json()).toEqual({ subscribed: true })
})
