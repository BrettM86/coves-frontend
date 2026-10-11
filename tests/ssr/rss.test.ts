/**
 * RSS feeds against the built node server, through every real hop: hooks,
 * the feed route, the same-origin proxy and the (mock) upstream.
 *
 * What only this tier can see: the response's FINAL `cache-control` after
 * `hooks.server.ts` applied its cache policy, and what the upstream actually
 * received. A feed is public and cacheable, so it must be fetched as an
 * anonymous visitor even when a signed-in reader's cookie came with the
 * request; the upstream log proves no credential went out.
 */
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import {
  RSS_AUTHOR_HANDLE,
  RSS_COMMUNITY,
  UNKNOWN_PATHS_PATH,
  XRPC_LOG_PATH,
  type XrpcRequest,
} from './mock-upstream'

const baseUrl = inject('ssrBaseUrl')
const mockUpstreamUrl = inject('mockUpstreamUrl')
const xrpcLogUrl = `${mockUpstreamUrl}${XRPC_LOG_PATH}`
const unknownPathsUrl = `${mockUpstreamUrl}${UNKNOWN_PATHS_PATH}`

const { DOMParser } = new JSDOM('').window

/** The `<link>` of every item in an RSS document; throws if it does not parse. */
function itemLinks(xml: string): (string | null)[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error(`RSS did not parse: ${parseError.textContent}\n${xml}`)
  }
  return Array.from(
    doc.querySelectorAll('item > link'),
    (link) => link.textContent,
  )
}

async function readXrpcLog(): Promise<XrpcRequest[]> {
  const res = await fetch(xrpcLogUrl)
  expect(res.status).toBe(200)
  return ((await res.json()) as { requests: XrpcRequest[] }).requests
}

beforeEach(async () => {
  const [xrpc, unknown] = await Promise.all([
    fetch(xrpcLogUrl, { method: 'DELETE' }),
    fetch(unknownPathsUrl, { method: 'DELETE' }),
  ])
  expect([xrpc.status, unknown.status]).toEqual([200, 200])
})

afterEach(async () => {
  const res = await fetch(unknownPathsUrl)
  expect(((await res.json()) as { paths: string[] }).paths).toEqual([])
})

describe('RSS feeds on the built server', () => {
  it('serves a community feed to a signed-in reader as a public, anonymous document', async () => {
    // `a` is an account the mock `/api/me` accepts, so hooks treat this
    // request as signed in and would hand its token to an ordinary render.
    const response = await fetch(`${baseUrl}/c/${RSS_COMMUNITY}/rss`, {
      headers: { Cookie: 'coves_session=a' },
    })
    const body = await response.text()

    expect({
      status: response.status,
      contentType: response.headers.get('content-type'),
      cacheControl: response.headers.get('cache-control'),
    }).toEqual({
      status: 200,
      contentType: 'application/rss+xml; charset=utf-8',
      cacheControl: 'public, max-age=300',
    })
    const links = itemLinks(body)
    expect(links.length).toBeGreaterThanOrEqual(1)
    expect(links.filter((link) => !link?.startsWith(`${baseUrl}/c/`))).toEqual(
      [],
    )

    const upstream = await readXrpcLog()
    expect(upstream.map((call) => call.path)).toContain(
      '/xrpc/social.coves.communityFeed.getCommunity',
    )
    expect(
      upstream.filter(
        (call) => call.authorization !== null || call.cookie !== null,
      ),
    ).toEqual([])
  })

  it("serves a user's comments feed", async () => {
    const response = await fetch(
      `${baseUrl}/profile/${RSS_AUTHOR_HANDLE}/rss?type=comments`,
    )
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(itemLinks(body).length).toBeGreaterThanOrEqual(1)
  })
})
