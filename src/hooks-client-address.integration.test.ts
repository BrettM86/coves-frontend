import { AsyncLocalStorage } from 'node:async_hooks'
import { once } from 'node:events'
import {
  createServer,
  type IncomingHttpHeaders,
  type ServerResponse,
} from 'node:http'
import type { RequestEvent } from '@sveltejs/kit'
import { expect, it, vi } from 'vitest'
import { XrpcClient } from '$lib/api/coves/xrpc'
import { upstreamInstanceUrl } from '$lib/server/instance'
import { createMockEvent } from '$lib/test-utils/request-event'
import { handleFetch } from './hooks.server'

const publicEnvironment = vi.hoisted(() => ({
  PUBLIC_INSTANCE_URL: 'http://localhost:5173',
  PUBLIC_INTERNAL_INSTANCE: '',
}))

vi.mock('$env/dynamic/public', () => ({ env: publicEnvironment }))
vi.mock('$env/dynamic/private', () => ({
  env: {
    ORIGIN: 'http://localhost:5173',
    ADDRESS_HEADER: 'X-Real-IP',
    ALLOW_HTTP_INTERNAL_INSTANCE: 'true',
  },
}))
vi.mock('$app/environment', () => ({
  browser: false,
  building: false,
  dev: false,
}))
vi.mock('$app/server', () => ({
  getRequestEvent: () => {
    const event = requestContext.getStore()
    if (!event) throw new Error('No request event in scope')
    return event
  },
}))

const requestContext = new AsyncLocalStorage<RequestEvent>()

it('preserves each anonymous SSR caller address across overlapping internal XRPC requests', async () => {
  const callers = [
    { id: 'anonymous-ipv4', address: '192.0.2.41' },
    { id: 'anonymous-ipv6', address: '2001:db8::42' },
  ]
  const capturedRequests = new Map<
    string,
    {
      method: string | undefined
      pathname: string
      headers: IncomingHttpHeaders
    }
  >()
  const pendingResponses: { id: string; response: ServerResponse }[] = []
  const backend = createServer((request, response) => {
    const url = new URL(
      request.url ?? '/',
      publicEnvironment.PUBLIC_INTERNAL_INSTANCE,
    )
    const id = url.searchParams.get('id') ?? ''
    capturedRequests.set(id, {
      method: request.method,
      pathname: url.pathname,
      headers: request.headers,
    })
    pendingResponses.push({ id, response })

    // Server-side barrier: neither request can finish before both arrive.
    // The transport abort deadline bounds the wait if either caller fails.
    if (pendingResponses.length === callers.length) {
      for (const pending of pendingResponses) {
        pending.response.writeHead(200, { 'Content-Type': 'application/json' })
        pending.response.end(JSON.stringify({ id: pending.id }))
      }
    }
  })
  const abortController = new AbortController()
  const signal = AbortSignal.any([
    abortController.signal,
    AbortSignal.timeout(5_000),
  ])
  const operations: Promise<{ id: string }>[] = []

  try {
    const listening = once(backend, 'listening', { signal })
    backend.listen(0, '127.0.0.1')
    await listening
    const address = backend.address()
    if (!address || typeof address === 'string') {
      throw new Error('Loopback backend did not bind a TCP port')
    }
    publicEnvironment.PUBLIC_INTERNAL_INSTANCE = `http://127.0.0.1:${address.port}`

    for (const caller of callers) {
      const event = createMockEvent({
        url: publicEnvironment.PUBLIC_INSTANCE_URL,
      })
      event.getClientAddress = () => caller.address
      // Model only Kit's per-event dispatch; both production transports and
      // global fetch remain real, including the response URL and headers.
      event.fetch = async (input, options) =>
        handleFetch({
          event,
          request: new Request(input, { ...options, signal }),
          fetch: globalThis.fetch,
        })
      expect(event.locals.auth.authenticated).toBe(false)
      expect(event.cookies.getAll()).toEqual([])

      operations.push(
        requestContext.run(event, () => {
          const client = new XrpcClient({
            baseUrl: upstreamInstanceUrl(),
            fetchFn: event.fetch,
          })
          return client.query<{ id: string }, { id: string }>(
            'social.coves.feed.getFeed',
            { id: caller.id },
          )
        }),
      )
    }

    expect(await Promise.all(operations)).toEqual(
      callers.map(({ id }) => ({ id })),
    )
    expect(pendingResponses).toHaveLength(callers.length)
    expect([...capturedRequests.keys()].sort()).toEqual(
      callers.map(({ id }) => id).sort(),
    )
    for (const caller of callers) {
      const captured = capturedRequests.get(caller.id)
      expect(captured?.method).toBe('GET')
      expect(captured?.pathname).toBe('/xrpc/social.coves.feed.getFeed')
      expect(captured?.headers.host).toBe(`127.0.0.1:${address.port}`)
      expect(captured?.headers.cookie).toBeUndefined()
      expect(captured?.headers.authorization).toBeUndefined()
      expect.soft(captured?.headers, caller.id).toMatchObject({
        'x-real-ip': caller.address,
        'x-forwarded-for': caller.address,
      })
    }
  } finally {
    abortController.abort()
    const closed = new Promise<void>((resolve, reject) => {
      if (!backend.listening) return resolve()
      backend.close((error) => (error ? reject(error) : resolve()))
    })
    backend.closeAllConnections()
    await Promise.allSettled(operations)
    await closed
    publicEnvironment.PUBLIC_INTERNAL_INSTANCE = ''
    requestContext.disable()
  }
}, 10_000)

it.each([
  { origin: 'same-origin', status: 302, method: 'GET' },
  { origin: 'cross-origin', status: 307, method: 'POST' },
])(
  'rejects a $origin $status redirect without sending a request to its destination',
  async ({ origin, status, method }) => {
    const clientAddress = '192.0.2.43'
    const initialRequests: {
      url: string | undefined
      method: string | undefined
      headers: IncomingHttpHeaders
    }[] = []
    let destinationRequests = 0
    let destinationUrl = ''
    const respondAtDestination = (response: ServerResponse) => {
      destinationRequests++
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.end('redirect was followed')
    }
    const backend = createServer((request, response) => {
      if (request.url === '/destination') {
        respondAtDestination(response)
        return
      }
      initialRequests.push({
        url: request.url,
        method: request.method,
        headers: request.headers,
      })
      response.writeHead(status, { Location: destinationUrl })
      response.end()
    })
    const destination =
      origin === 'cross-origin'
        ? createServer((_request, response) => respondAtDestination(response))
        : backend
    const servers = [...new Set([backend, destination])]
    const abortController = new AbortController()
    const signal = AbortSignal.any([
      abortController.signal,
      AbortSignal.timeout(5_000),
    ])
    let operation: Promise<Response> | undefined

    try {
      for (const server of servers) {
        const listening = once(server, 'listening', { signal })
        server.listen(0, '127.0.0.1')
        await listening
      }
      const backendAddress = backend.address()
      const destinationAddress = destination.address()
      if (
        !backendAddress ||
        typeof backendAddress === 'string' ||
        !destinationAddress ||
        typeof destinationAddress === 'string'
      ) {
        throw new Error('Loopback servers did not bind TCP ports')
      }
      publicEnvironment.PUBLIC_INTERNAL_INSTANCE = `http://127.0.0.1:${backendAddress.port}`
      destinationUrl = `http://127.0.0.1:${destinationAddress.port}/destination`
      const event = createMockEvent({
        url: publicEnvironment.PUBLIC_INSTANCE_URL,
      })
      event.getClientAddress = () => clientAddress
      const request = new Request(
        `${publicEnvironment.PUBLIC_INTERNAL_INSTANCE}/xrpc/example?redirect=${status}`,
        {
          method,
          body: method === 'POST' ? 'redirect-body' : undefined,
          signal,
        },
      )

      operation = Promise.resolve(
        handleFetch({ event, request, fetch: globalThis.fetch }),
      )
      const [outcome] = await Promise.allSettled([operation])
      if (outcome.status === 'fulfilled') {
        await outcome.value.arrayBuffer()
      }

      // A deadline rejection is not proof of redirect refusal. Both servers
      // answer immediately, and settlement requires no sleep or polling.
      expect(signal.aborted).toBe(false)
      expect(initialRequests).toHaveLength(1)
      expect(initialRequests[0]).toMatchObject({
        url: `/xrpc/example?redirect=${status}`,
        method,
        headers: {
          host: `127.0.0.1:${backendAddress.port}`,
          'x-real-ip': clientAddress,
          'x-forwarded-for': clientAddress,
        },
      })
      expect
        .soft(outcome.status, 'hook must reject the redirect')
        .toBe('rejected')
      expect
        .soft(destinationRequests, 'destination must receive no requests')
        .toBe(0)
    } finally {
      abortController.abort()
      const closures = servers.map((server) => {
        const closed = new Promise<void>((resolve, reject) => {
          if (!server.listening) return resolve()
          server.close((error) => (error ? reject(error) : resolve()))
        })
        server.closeAllConnections()
        return closed
      })
      await Promise.allSettled(operation ? [operation] : [])
      await Promise.all(closures)
      publicEnvironment.PUBLIC_INTERNAL_INSTANCE = ''
    }
  },
  10_000,
)
