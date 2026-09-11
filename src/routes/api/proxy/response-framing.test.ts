import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMockCookies } from '$lib/test-utils/request-event'

vi.mock('$env/dynamic/private', () => ({ env: {} }))
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.social' },
}))

const { GET, POST } = await import('./[...path]/+server')

/**
 * These exercise the REAL exported handler rather than a test-local copy, so a
 * defect in the response path cannot pass by being duplicated into the test.
 *
 * `fetch` transparently decompresses a gzipped upstream response but leaves the
 * received `content-encoding` and `content-length` headers in place. Those now
 * describe the compressed bytes while `response.body` carries the decompressed
 * ones, so forwarding either header corrupts the response — `content-length`
 * truncates the body to its gzipped size, which reaches the client as a JSON
 * parse failure with a 200 status.
 */

const UPSTREAM_JSON = JSON.stringify({
  did: 'did:plc:tqa2ago3uxir2kdn44zdslxs',
  handle: 'linux.lemmy-ml.tdpl.io',
  name: 'linux',
  description: 'x'.repeat(1200),
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * The upstream hop goes through the platform `fetch`, so the stub is installed
 * on the global. The event's own `fetch` is present but throws: kit's
 * per-request fetch replays the inbound cookie and authorization headers for a
 * same-host upstream, so the handler must never reach for it.
 */
function createEvent(upstream: Response) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream))
  return {
    params: { path: 'xrpc/social.coves.community.get' },
    request: new Request(
      'http://localhost/api/proxy/xrpc/social.coves.community.get?community=linux.lemmy-ml.tdpl.io',
      { method: 'GET', headers: { origin: 'http://localhost' } },
    ),
    url: new URL(
      'http://localhost/api/proxy/xrpc/social.coves.community.get?community=linux.lemmy-ml.tdpl.io',
    ),
    cookies: createMockCookies(),
    locals: { auth: { authenticated: false } },
    getClientAddress: () => '127.0.0.1',
    fetch: vi.fn(() => {
      throw new Error('event.fetch must not be used for the upstream hop')
    }),
  } as unknown as Parameters<typeof GET>[0]
}

/**
 * Mimics what `fetch` hands back for a gzipped upstream response: a fully
 * decompressed body alongside the compressed-size headers.
 */
function decompressedUpstream(): Response {
  return new Response(UPSTREAM_JSON, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      // Deliberately shorter than the body, as a real gzipped length would be.
      'Content-Length': String(Math.floor(UPSTREAM_JSON.length / 2)),
    },
  })
}

describe('proxy response framing', () => {
  it('forwards a decompressed body without the compressed content-length', async () => {
    const response = await GET(createEvent(decompressedUpstream()))

    expect(response.headers.get('content-length')).toBeNull()
    expect(response.headers.get('content-encoding')).toBeNull()

    const body = await response.text()
    expect(body).toBe(UPSTREAM_JSON)
    // The symptom the truncation produced: a 200 whose body is unparseable.
    expect(() => JSON.parse(body)).not.toThrow()
  })

  it('preserves the upstream status and content-type', async () => {
    const response = await GET(createEvent(decompressedUpstream()))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
  })

  it('does not truncate an uncompressed response either', async () => {
    const upstream = new Response(UPSTREAM_JSON, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(UPSTREAM_JSON.length),
      },
    })

    const response = await GET(createEvent(upstream))
    expect(await response.text()).toBe(UPSTREAM_JSON)
  })
})

/**
 * Asserts a console spy received exactly one call with exactly one string
 * argument — the structured log line — and returns it raw and parsed.
 * Local to this file on purpose: test helpers are not shared across suites.
 */
function singleJsonLine(calls: unknown[][]): {
  raw: string
  line: Record<string, unknown>
} {
  expect(calls).toHaveLength(1)
  expect(calls[0]).toHaveLength(1)
  const raw = calls[0][0]
  expect(typeof raw).toBe('string')
  expect(raw).toMatch(/^\{[\s\S]*\}$/)
  return {
    raw: raw as string,
    line: JSON.parse(raw as string) as Record<string, unknown>,
  }
}

function spyOnError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

function spyOnWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {})
}

const PROXY_URL =
  'http://localhost/api/proxy/xrpc/social.coves.community.get?community=linux.lemmy-ml.tdpl.io'

/**
 * An authenticated event whose upstream fetch rejects, carrying a request id
 * minted by hooks.server.ts as a real request would.
 */
function createFailingEvent(error: Error) {
  // The upstream hop uses the platform fetch (see createEvent above), so the
  // failure is installed on the global; the event's own fetch must never run.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
  return {
    params: { path: 'xrpc/social.coves.community.get' },
    request: new Request(PROXY_URL, {
      method: 'GET',
      headers: { origin: 'http://localhost' },
    }),
    url: new URL(PROXY_URL),
    cookies: createMockCookies({ coves_session: 'sealed-token-value' }),
    locals: {
      auth: { authenticated: false },
      requestId: 'req-proxy-1',
    },
    getClientAddress: () => '127.0.0.1',
    fetch: vi.fn(() => {
      throw new Error('event.fetch must not be used for the upstream hop')
    }),
  } as unknown as Parameters<typeof GET>[0]
}

describe('proxy error logging', () => {
  // Spies are created and restored per test rather than inline, so a failing
  // assertion cannot skip its restore and leak calls into the next test.
  let errorSpy: ReturnType<typeof spyOnError>
  let warnSpy: ReturnType<typeof spyOnWarn>

  beforeEach(() => {
    errorSpy = spyOnError()
    warnSpy = spyOnWarn()
  })

  afterEach(() => {
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('returns the full request id from locals in the 502 body', async () => {
    const response = await GET(
      createFailingEvent(
        new Error('ECONNREFUSED to http://backend/xrpc?access_token=SECRETTOK'),
      ),
    )

    expect(response.status).toBe(502)
    const body = (await response.json()) as { requestId?: unknown }
    // The full id, not an 8-char slice — it must correlate with the hooks log.
    expect(body.requestId).toBe('req-proxy-1')
  })

  it('logs one scrubbed JSON line carrying the request context', async () => {
    await GET(
      createFailingEvent(
        new Error('ECONNREFUSED to http://backend/xrpc?access_token=SECRETTOK'),
      ),
    )

    const { raw, line } = singleJsonLine(errorSpy.mock.calls)
    expect(line.level).toBe('error')
    expect(line.requestId).toBe('req-proxy-1')
    expect(line.method).toBe('GET')
    expect(line.path).toContain('xrpc/social.coves.community.get')
    const err = line.err as Record<string, unknown>
    expect(typeof err.message).toBe('string')
    expect(err.message).toContain('[REDACTED]')
    expect(raw).not.toContain('SECRETTOK')
  })

  it('logs a blocked cross-origin request as one JSON warn line', async () => {
    const event = {
      params: { path: 'xrpc/social.coves.community.create' },
      request: new Request(PROXY_URL, {
        method: 'POST',
        headers: { origin: 'https://evil.example.com' },
      }),
      url: new URL(PROXY_URL),
      cookies: createMockCookies(),
      locals: { auth: { authenticated: false }, requestId: 'req-proxy-2' },
      fetch: vi.fn(),
    } as unknown as Parameters<typeof POST>[0]

    const response = await POST(event)

    expect(response.status).toBe(403)
    const { line } = singleJsonLine(warnSpy.mock.calls)
    expect(line.level).toBe('warn')
    expect(line.msg).toContain('Cross-origin')
    // A blocked request is still a request: it must be correlatable.
    expect(line.requestId).toBe('req-proxy-2')
  })
})
