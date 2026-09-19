import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockEvent } from '$lib/test-utils/request-event'
import { handleFetch } from './hooks.server'

const publicEnvironment = vi.hoisted(() => ({
  PUBLIC_INSTANCE_URL: 'http://localhost:5173',
  PUBLIC_INTERNAL_INSTANCE: 'http://localhost:4000',
}))

vi.mock('$env/dynamic/public', () => ({ env: publicEnvironment }))
vi.mock('$env/dynamic/private', () => ({
  env: {
    ORIGIN: 'http://localhost:5173',
    ADDRESS_HEADER: 'X-Real-IP',
  },
}))
vi.mock('$app/environment', () => ({
  browser: false,
  building: false,
  dev: false,
}))
vi.mock('$app/server', () => ({
  getRequestEvent: () => {
    throw new Error('No request event in scope')
  },
}))

describe('handleFetch client address', () => {
  beforeEach(() => {
    publicEnvironment.PUBLIC_INTERNAL_INSTANCE = 'http://localhost:4000'
  })

  it.each(['192.0.2.41', '2001:db8::42'])(
    'replaces forged claims with %s while preserving the POST request',
    async (clientAddress) => {
      const event = createMockEvent()
      event.getClientAddress = vi.fn(() => clientAddress)
      const body = new Uint8Array([0, 255, 128, 13, 10, 65, 0])
      const request = new Request(
        'http://localhost:4000/xrpc/social.coves.post.create?tag=a%2Fb&tag=c',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            Authorization: 'Bearer test-credential',
            Cookie: 'coves_session=test-session',
            'X-Real-IP': '198.51.100.10',
            'X-Forwarded-For': '198.51.100.11, 198.51.100.12',
            Forwarded: 'for=198.51.100.13;proto=https',
          },
          body,
          cache: 'no-store',
          credentials: 'include',
        },
      )
      const originalHeaders = [...request.headers.entries()]
      const transport = vi.fn<typeof fetch>(async (input) => {
        if (!(input instanceof Request)) {
          throw new Error('Expected a Request at the receiving transport')
        }
        expect(input.url).toBe(request.url)
        expect(input.method).toBe('POST')
        expect(input.cache).toBe('no-store')
        expect(input.credentials).toBe('include')
        expect(input.headers.get('authorization')).toBe(
          'Bearer test-credential',
        )
        expect(input.headers.get('cookie')).toBe('coves_session=test-session')
        expect(input.headers.get('content-type')).toBe(
          'application/octet-stream',
        )
        // Consume at the receiving transport: inspecting the original body's
        // metadata would miss a reconstruction that dropped or rewrote bytes.
        expect(new Uint8Array(await input.arrayBuffer())).toEqual(body)
        expect.soft(input.headers.get('x-real-ip')).toBe(clientAddress)
        expect.soft(input.headers.get('x-forwarded-for')).toBe(clientAddress)
        expect.soft(input.headers.has('forwarded')).toBe(false)
        return new Response('accepted', { status: 202 })
      })

      const response = await handleFetch({ event, request, fetch: transport })

      expect(transport).toHaveBeenCalledOnce()
      expect(response.status).toBe(202)
      expect(await response.text()).toBe('accepted')
      expect([...request.headers.entries()]).toEqual(originalHeaders)
    },
  )

  it('removes every address claim and still transports when address lookup throws', async () => {
    // This suite owns its module instance; no assertion depends on the
    // helper's process-wide diagnostic latch or another suite's log calls.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const event = createMockEvent()
    event.getClientAddress = vi.fn(() => {
      throw new Error('Observed address unavailable')
    })
    const request = new Request(
      'http://localhost:4000/xrpc/social.coves.feed.getDiscover?limit=7',
      {
        headers: {
          'X-Real-IP': '198.51.100.10',
          'X-Forwarded-For': '198.51.100.11, 198.51.100.12',
          Forwarded: 'for=198.51.100.13;proto=https',
          Authorization: 'Bearer test-credential',
        },
      },
    )
    const originalHeaders = [...request.headers.entries()]
    const transport = vi.fn<typeof fetch>(async (input) => {
      if (!(input instanceof Request)) {
        throw new Error('Expected a Request at the receiving transport')
      }
      expect(input.url).toBe(request.url)
      expect(input.method).toBe('GET')
      expect(input.headers.get('authorization')).toBe('Bearer test-credential')
      expect.soft(input.headers.has('x-real-ip')).toBe(false)
      expect.soft(input.headers.has('x-forwarded-for')).toBe(false)
      expect.soft(input.headers.has('forwarded')).toBe(false)
      return new Response('still available')
    })

    const response = await handleFetch({ event, request, fetch: transport })

    expect(transport).toHaveBeenCalledOnce()
    expect(await response.text()).toBe('still available')
    expect([...request.headers.entries()]).toEqual(originalHeaders)
    expect.soft(event.getClientAddress).toHaveBeenCalled()
  })

  it('propagates caller cancellation to the receiving transport', async () => {
    const event = createMockEvent()
    const controller = new AbortController()
    const cancellation = new Error('Caller cancelled the request')
    const request = new Request(
      'http://localhost:4000/xrpc/social.coves.feed.getDiscover',
      { signal: controller.signal },
    )
    const transport = vi.fn<typeof fetch>(async (input) => {
      if (!(input instanceof Request)) {
        throw new Error('Expected a Request at the receiving transport')
      }
      expect(input.signal.aborted).toBe(false)
      // Abort after dispatch, so a copied initial boolean cannot pass.
      controller.abort(cancellation)
      expect(input.signal.aborted).toBe(true)
      input.signal.throwIfAborted()
      throw new Error('Transport did not observe caller cancellation')
    })

    try {
      await expect(
        handleFetch({ event, request, fetch: transport }),
      ).rejects.toBe(cancellation)
      expect(transport).toHaveBeenCalledOnce()
    } finally {
      controller.abort()
    }
  })

  it.each([
    {
      name: 'external origin',
      internalInstance: 'http://localhost:4000',
      target: 'http://localhost:4001/xrpc/example',
    },
    {
      name: 'same page origin',
      internalInstance: 'http://localhost:5173',
      target: 'http://localhost:5173/xrpc/example',
    },
    {
      name: 'missing internal configuration',
      internalInstance: '',
      target: 'http://localhost:4000/xrpc/example',
    },
  ])(
    'does not look up or rewrite addresses for $name',
    async ({ internalInstance, target }) => {
      publicEnvironment.PUBLIC_INTERNAL_INSTANCE = internalInstance
      const event = createMockEvent()
      event.getClientAddress = vi.fn(() => '192.0.2.41')
      const request = new Request(target, {
        headers: {
          'X-Real-IP': '198.51.100.10',
          'X-Forwarded-For': '198.51.100.11',
          Forwarded: 'for=198.51.100.12',
        },
      })
      const originalHeaders = [...request.headers.entries()]
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('ok'))

      await handleFetch({ event, request, fetch: transport })

      expect(transport).toHaveBeenCalledOnce()
      expect(transport.mock.calls[0]?.[0]).toBe(request)
      expect([...request.headers.entries()]).toEqual(originalHeaders)
      expect(event.getClientAddress).not.toHaveBeenCalled()
    },
  )
})
