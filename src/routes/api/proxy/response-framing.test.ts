import { describe, it, expect, vi } from 'vitest'

vi.mock('$env/dynamic/private', () => ({ env: {} }))
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.social' },
}))

const { GET } = await import('./[...path]/+server')

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

function createEvent(upstream: Response) {
  return {
    params: { path: 'xrpc/social.coves.community.get' },
    request: new Request(
      'http://localhost/api/proxy/xrpc/social.coves.community.get?community=linux.lemmy-ml.tdpl.io',
      { method: 'GET', headers: { origin: 'http://localhost' } },
    ),
    url: new URL(
      'http://localhost/api/proxy/xrpc/social.coves.community.get?community=linux.lemmy-ml.tdpl.io',
    ),
    locals: { auth: { authenticated: false } },
    fetch: vi.fn().mockResolvedValue(upstream),
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
