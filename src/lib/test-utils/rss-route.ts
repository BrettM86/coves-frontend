/**
 * Shared harness for the RSS route tests (the `rss/server.test.ts` files under `src/routes`).
 *
 * The feed routes reach the AppView through the same-origin proxy with the
 * request event's `fetch`, so a test swaps that `fetch` for
 * {@link stubProxyFetch}, which answers each proxied XRPC call by NSID and
 * records what the route sent.
 *
 * Test-only module: never import from production code.
 */
import { JSDOM } from 'jsdom'
import type { AtUri, CID, PostView } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'

export const TEST_ORIGIN = 'https://coves.test'

const PROXY_PREFIX = '/api/proxy/xrpc/'

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

export interface ProxyCall {
  /** The NSID after `/api/proxy/xrpc/`, or the whole path for anything else. */
  nsid: string
  params: URLSearchParams
  credentials: RequestCredentials | undefined
}

export type ProxyAnswer = (
  nsid: string,
  params: URLSearchParams,
) => Response | Promise<Response>

export function stubProxyFetch(answer: ProxyAnswer): {
  calls: ProxyCall[]
  fetch: typeof fetch
} {
  const calls: ProxyCall[] = []
  const fetchStub = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = input instanceof Request ? input : undefined
    const url = new URL(request ? request.url : String(input), TEST_ORIGIN)
    const nsid = url.pathname.startsWith(PROXY_PREFIX)
      ? url.pathname.slice(PROXY_PREFIX.length)
      : url.pathname
    calls.push({
      nsid,
      params: url.searchParams,
      credentials: init?.credentials ?? request?.credentials,
    })
    return answer(nsid, url.searchParams)
  }
  return { calls, fetch: fetchStub }
}

const { DOMParser } = new JSDOM('').window

/** The channel fields and item guids of an RSS document; throws if it does not parse. */
export function parseRssChannel(xml: string): {
  title: string | null | undefined
  link: string | null | undefined
  self: string | null | undefined
  guids: (string | null)[]
} {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error(`RSS did not parse: ${parseError.textContent}\n${xml}`)
  }
  return {
    title: doc.querySelector('channel > title')?.textContent,
    link: doc.querySelector('channel > link')?.textContent,
    self: doc
      .getElementsByTagNameNS('http://www.w3.org/2005/Atom', 'link')[0]
      ?.getAttribute('href'),
    guids: Array.from(
      doc.querySelectorAll('item > guid'),
      (guid) => guid.textContent,
    ),
  }
}

/** A post by alice.coves.test in the local community `gaming`. */
export function testPost(rkey: string): PostView {
  return {
    uri: `at://did:plc:alice/social.coves.community.post/${rkey}` as AtUri,
    cid: `bafy${rkey}` as CID,
    rkey,
    indexedAt: '2026-03-04T05:06:08.000Z',
    createdAt: '2026-03-04T05:06:07.000Z',
    author: {
      did: 'did:plc:alice' as DID,
      handle: 'alice.coves.test' as Handle,
      displayName: 'Alice',
    },
    community: {
      did: 'did:plc:gaming' as DID,
      handle: 'c-gaming.coves.test' as Handle,
      name: 'gaming',
      origin: 'coves.test',
    },
    record: {
      $type: 'social.coves.community.post',
      community: 'did:plc:gaming',
      author: 'did:plc:alice',
      createdAt: '2026-03-04T05:06:07.000Z',
      title: `Post ${rkey}`,
      content: 'Body',
    },
  }
}
