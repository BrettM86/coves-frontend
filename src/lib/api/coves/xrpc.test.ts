import { describe, it, expect, vi } from 'vitest'
import { XrpcClient, XrpcError } from './xrpc'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockFetch(
  body: unknown,
  init: {
    status?: number
    headers?: Record<string, string>
  } = {},
): typeof fetch {
  const { status = 200, headers = {} } = init
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    }),
  ) as unknown as typeof fetch
}

const BASE_URL = 'https://api.coves.social'

// ---------------------------------------------------------------------------
// XrpcError
// ---------------------------------------------------------------------------

describe('XrpcError', () => {
  it('has correct name, status, errorName, and message properties', () => {
    const err = new XrpcError(400, 'InvalidRequest', 'bad input')

    expect(err.name).toBe('XrpcError')
    expect(err.status).toBe(400)
    expect(err.errorName).toBe('InvalidRequest')
    expect(err.message).toBe('bad input')
  })

  it('is instanceof Error', () => {
    const err = new XrpcError(500, 'InternalError', 'boom')

    expect(err).toBeInstanceOf(Error)
  })
})

// ---------------------------------------------------------------------------
// XrpcClient.query()
// ---------------------------------------------------------------------------

describe('XrpcClient.query()', () => {
  let client: XrpcClient

  it('calls GET on correct URL with NSID', async () => {
    const mockFetch = createMockFetch({ ok: true })
    client = new XrpcClient({ fetchFn: mockFetch, baseUrl: BASE_URL })

    await client.query('social.coves.feed.getDiscover')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const calledUrl = (mockFetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string
    expect(calledUrl).toBe(`${BASE_URL}/xrpc/social.coves.feed.getDiscover`)
  })

  it('serializes params as query string', async () => {
    const mockFetch = createMockFetch({ items: [] })
    client = new XrpcClient({ fetchFn: mockFetch, baseUrl: BASE_URL })

    await client.query('social.coves.feed.getDiscover', {
      limit: 10,
      sort: 'hot',
    })

    const calledUrl = (mockFetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string
    const url = new URL(calledUrl)
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.get('sort')).toBe('hot')
  })

  it('skips undefined and null params', async () => {
    const mockFetch = createMockFetch({ items: [] })
    client = new XrpcClient({ fetchFn: mockFetch, baseUrl: BASE_URL })

    await client.query('social.coves.feed.getDiscover', {
      limit: 10,
      cursor: undefined,
      sort: null,
    })

    const calledUrl = (mockFetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string
    const url = new URL(calledUrl)
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.has('cursor')).toBe(false)
    expect(url.searchParams.has('sort')).toBe(false)
  })

  it('returns parsed JSON response', async () => {
    const expected = { feed: [{ id: 1 }], cursor: 'abc' }
    const mockFetch = createMockFetch(expected)
    client = new XrpcClient({ fetchFn: mockFetch, baseUrl: BASE_URL })

    const result = await client.query('social.coves.feed.getDiscover')

    expect(result).toEqual(expected)
  })

  it('throws XrpcError with status, errorName, message on non-ok response', async () => {
    const errorBody = {
      error: 'InvalidRequest',
      message: 'Missing required param',
    }
    const mockFetch = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(errorBody), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ) as unknown as typeof fetch
    client = new XrpcClient({ fetchFn: mockFetch, baseUrl: BASE_URL })

    try {
      await client.query('social.coves.feed.getDiscover')
      expect.fail('Expected XrpcError to be thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(XrpcError)
      const err = e as XrpcError
      expect(err.status).toBe(400)
      expect(err.errorName).toBe('InvalidRequest')
      expect(err.message).toBe('Missing required param')
    }
  })

  it('throws XrpcError with generic message when error body is not valid JSON', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(new Response('not json', { status: 502 })),
      ) as unknown as typeof fetch
    client = new XrpcClient({ fetchFn: mockFetch, baseUrl: BASE_URL })

    try {
      await client.query('social.coves.feed.getDiscover')
      expect.fail('Expected XrpcError to be thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(XrpcError)
      const err = e as XrpcError
      expect(err.status).toBe(502)
      expect(err.errorName).toBe('UnknownError')
      expect(err.message).toBe('XRPC request failed with status 502')
    }
  })

  it('throws XrpcError with ParseError when success response is not valid JSON', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(new Response('not json', { status: 200 })),
      ) as unknown as typeof fetch
    client = new XrpcClient({ fetchFn: mockFetch, baseUrl: BASE_URL })

    try {
      await client.query('social.coves.feed.getDiscover')
      expect.fail('Expected XrpcError to be thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(XrpcError)
      const err = e as XrpcError
      expect(err.status).toBe(200)
      expect(err.errorName).toBe('ParseError')
      expect(err.message).toBe('Failed to parse response as JSON')
    }
  })

  it('propagates fetch errors as-is (not wrapped in XrpcError)', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new TypeError('Failed to fetch'),
      ) as unknown as typeof fetch
    client = new XrpcClient({ fetchFn: mockFetch, baseUrl: BASE_URL })

    await expect(client.query('social.coves.feed.getDiscover')).rejects.toThrow(
      TypeError,
    )
  })

  it('falls back to UnknownError when error body JSON lacks error/message fields', async () => {
    const mockFetch = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ foo: 'bar' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ) as unknown as typeof fetch
    client = new XrpcClient({ fetchFn: mockFetch, baseUrl: BASE_URL })

    try {
      await client.query('social.coves.feed.getDiscover')
      expect.fail('Expected XrpcError to be thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(XrpcError)
      const err = e as XrpcError
      expect(err.status).toBe(400)
      expect(err.errorName).toBe('UnknownError')
      expect(err.message).toBe('XRPC request failed with status 400')
    }
  })
})

// ---------------------------------------------------------------------------
// XrpcClient.procedure()
// ---------------------------------------------------------------------------

describe('XrpcClient.procedure()', () => {
  let client: XrpcClient

  it('sends undefined body when no input is provided', async () => {
    const mockFetch = createMockFetch({})
    client = new XrpcClient({ fetchFn: mockFetch, baseUrl: BASE_URL })

    await client.procedure('social.coves.community.subscribe')

    const calledInit = (mockFetch as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as RequestInit
    expect(calledInit.body).toBeUndefined()
  })

  it('calls POST on correct URL with NSID', async () => {
    const mockFetch = createMockFetch({ uri: 'at://did:plc:abc/post/1' })
    client = new XrpcClient({ fetchFn: mockFetch, baseUrl: BASE_URL })

    await client.procedure('social.coves.community.post.create', {
      title: 'hi',
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = (mockFetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit]
    expect(calledUrl).toBe(
      `${BASE_URL}/xrpc/social.coves.community.post.create`,
    )
    expect(calledInit.method).toBe('POST')
  })

  it('sends JSON body with Content-Type header', async () => {
    const mockFetch = createMockFetch({ uri: 'at://did:plc:abc/post/1' })
    client = new XrpcClient({ fetchFn: mockFetch, baseUrl: BASE_URL })

    const input = { title: 'Hello', content: 'World' }
    await client.procedure('social.coves.community.post.create', input)

    const calledInit = (mockFetch as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as RequestInit
    expect(calledInit.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(calledInit.body).toBe(JSON.stringify(input))
  })

  it('returns parsed JSON response', async () => {
    const expected = { uri: 'at://did:plc:abc/post/1', cid: 'bafy123' }
    const mockFetch = createMockFetch(expected)
    client = new XrpcClient({ fetchFn: mockFetch, baseUrl: BASE_URL })

    const result = await client.procedure(
      'social.coves.community.post.create',
      { title: 'hi' },
    )

    expect(result).toEqual(expected)
  })

  it('returns undefined for 204 responses', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { status: 204 }),
      ) as unknown as typeof fetch
    client = new XrpcClient({ fetchFn: mockFetch, baseUrl: BASE_URL })

    const result = await client.procedure(
      'social.coves.community.post.delete',
      { uri: 'at://x' },
    )

    expect(result).toBeUndefined()
  })

  it('returns undefined for empty body responses', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('', { status: 200 }),
      ) as unknown as typeof fetch
    client = new XrpcClient({ fetchFn: mockFetch, baseUrl: BASE_URL })

    const result = await client.procedure('social.coves.community.subscribe', {
      community: 'c',
    })

    expect(result).toBeUndefined()
  })

  it('throws XrpcError on non-ok response', async () => {
    const errorBody = { error: 'Forbidden', message: 'Not allowed' }
    const mockFetch = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(errorBody), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ) as unknown as typeof fetch
    client = new XrpcClient({ fetchFn: mockFetch, baseUrl: BASE_URL })

    try {
      await client.procedure('social.coves.community.post.create', {
        title: 'hi',
      })
      expect.fail('Expected XrpcError to be thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(XrpcError)
      const err = e as XrpcError
      expect(err.status).toBe(403)
      expect(err.errorName).toBe('Forbidden')
      expect(err.message).toBe('Not allowed')
    }
  })

  it('propagates fetch errors as-is (not wrapped in XrpcError)', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new TypeError('Failed to fetch'),
      ) as unknown as typeof fetch
    client = new XrpcClient({ fetchFn: mockFetch, baseUrl: BASE_URL })

    await expect(
      client.procedure('social.coves.community.post.create', { title: 'hi' }),
    ).rejects.toThrow(TypeError)
  })

  it('throws XrpcError with ParseError when success body is not valid JSON', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(new Response('not json at all', { status: 200 })),
      ) as unknown as typeof fetch
    client = new XrpcClient({ fetchFn: mockFetch, baseUrl: BASE_URL })

    try {
      await client.procedure('social.coves.community.post.create', {
        title: 'hi',
      })
      expect.fail('Expected XrpcError to be thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(XrpcError)
      const err = e as XrpcError
      expect(err.status).toBe(200)
      expect(err.errorName).toBe('ParseError')
      expect(err.message).toBe('Failed to parse response as JSON')
    }
  })
})
