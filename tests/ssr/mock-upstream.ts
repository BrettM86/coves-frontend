/**
 * A stand-in for the Go backend, for the SSR acceptance tier.
 *
 * The built SvelteKit server talks to `PUBLIC_INTERNAL_INSTANCE` for these
 * requests in the acceptance suite:
 *   - `GET /api/me`            (hooks.server.ts, only when a session cookie is present)
 *   - `GET /xrpc/social.coves.feed.getDiscover` (the `/` page load)
 *   - `GET /xrpc/social.coves.community.list` (`/explore/communities`)
 * Anything else is a 404 and is recorded so a future page change surfaces as a
 * named gap rather than an opaque 500.
 *
 * Beyond answering, it RECORDS: every `/xrpc/*` call with the `Authorization`
 * header it arrived with, so a test can check what credentials a render
 * actually put on the wire rather than only what it rendered. Both records are
 * readable over the control plane, since the tests run in a different process.
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * The accounts this upstream knows, keyed by the `coves_session` cookie value
 * that authenticates as each. Two of them, so a test can tell "each request
 * sees ITS OWN account" apart from "every request sees the only account there
 * is". Any other cookie value gets a 401.
 */
export const MOCK_ACCOUNTS = {
  a: { did: 'did:plc:abcdefghijklmnopqrstuvwx', handle: 'mari.test' },
  b: { did: 'did:plc:zyxwvutsrqponmlkjihgfedc', handle: 'alex.test' },
} as const

export type MockAccountKey = keyof typeof MOCK_ACCOUNTS

/** Control-plane path the tests read the XRPC request log from. */
export const XRPC_LOG_PATH = '/__test/xrpc-requests'

/** Control-plane path listing paths the mock did not recognise. */
export const UNKNOWN_PATHS_PATH = '/__test/unknown-paths'

/** Visible content proving the CORS-free XRPC payload reached SSR rendering. */
export const SSR_POST_MARKER = 'SSR feed post from CORS-free upstream'
export const SSR_COMMUNITY_MARKER = 'SSR community from CORS-free upstream'

/** One inbound XRPC call, as the upstream saw it. */
export interface XrpcRequest {
  readonly path: string
  /** The inbound `Authorization` header verbatim, or null if there was none. */
  readonly authorization: string | null
}

export interface MockUpstream {
  /** Origin the built server should be pointed at, e.g. `http://127.0.0.1:51234`. */
  readonly url: string
  /** Distinct `METHOD /path` strings the mock did not recognise. */
  readonly unknownPaths: readonly string[]
  close(): Promise<void>
}

// Deliberately no Access-Control-Allow-Origin: the real internal AppView does
// not emit one on XRPC responses, and SSR must still be able to consume them.
const BASE_HEADERS = {
  'content-type': 'application/json',
} as const

export async function startMockUpstream(): Promise<MockUpstream> {
  const unknownPaths: string[] = []

  const xrpcRequests: XrpcRequest[] = []

  const server = http.createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://upstream.invalid').pathname

    // Control plane. Not part of the backend's surface, so it is checked
    // before anything else and never counts as an unknown path.
    if (path === XRPC_LOG_PATH) {
      if (req.method === 'DELETE') {
        xrpcRequests.length = 0
        res.writeHead(200, BASE_HEADERS)
        res.end(JSON.stringify({ ok: true }))
        return
      }
      res.writeHead(200, BASE_HEADERS)
      res.end(JSON.stringify({ requests: xrpcRequests }))
      return
    }

    if (path === UNKNOWN_PATHS_PATH) {
      if (req.method === 'DELETE') {
        unknownPaths.length = 0
        res.writeHead(200, BASE_HEADERS)
        res.end(JSON.stringify({ ok: true }))
        return
      }
      res.writeHead(200, BASE_HEADERS)
      res.end(JSON.stringify({ paths: [...new Set(unknownPaths)] }))
      return
    }

    if (path.startsWith('/xrpc/')) {
      // Recorded before the route check so an unmocked XRPC path still shows
      // up here rather than vanishing into the 404 branch.
      xrpcRequests.push({
        path,
        authorization: req.headers.authorization ?? null,
      })
    }

    if (path === '/api/me') {
      const key = /coves_session=([^;]*)/.exec(req.headers.cookie ?? '')?.[1]
      const identity =
        key !== undefined && key in MOCK_ACCOUNTS
          ? MOCK_ACCOUNTS[key as MockAccountKey]
          : undefined
      if (identity === undefined) {
        res.writeHead(401, BASE_HEADERS)
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }
      res.writeHead(200, BASE_HEADERS)
      res.end(JSON.stringify(identity))
      return
    }

    if (
      path === '/xrpc/social.coves.feed.getDiscover' ||
      path === '/xrpc/social.coves.feed.getTimeline'
    ) {
      const audience =
        req.headers.authorization === 'Bearer a'
          ? 'a'
          : req.headers.authorization === 'Bearer b'
            ? 'b'
            : 'anonymous'
      res.writeHead(200, BASE_HEADERS)
      res.end(
        JSON.stringify({
          feed: [
            {
              post: {
                uri: 'at://did:plc:abcdefghijklmnopqrstuvwx/social.coves.community.post/ssrfeed',
                cid: 'bafyreigh2akiscaildc',
                rkey: 'ssrfeed',
                indexedAt: '2026-08-31T00:00:00.000Z',
                createdAt: '2026-08-31T00:00:00.000Z',
                author: {
                  did: 'did:plc:feedauthorabcdefghijkl',
                  handle: 'feed-author.test',
                },
                community: {
                  did: 'did:plc:communityabcdefghijkl',
                  handle: 'general.coves.social',
                  name: 'general',
                  origin: 'coves.social',
                },
                record: {
                  $type: 'social.coves.community.post',
                  community: 'did:plc:communityabcdefghijkl',
                  author: 'did:plc:feedauthorabcdefghijkl',
                  createdAt: '2026-08-31T00:00:00.000Z',
                  title: `${SSR_POST_MARKER} [${audience}]`,
                  content: 'Rendered during the initial server request.',
                },
                stats: {
                  upvotes: 1,
                  downvotes: 0,
                  score: 1,
                  commentCount: 0,
                },
                viewer: { saved: false },
              },
            },
          ],
        }),
      )
      return
    }

    if (path === '/xrpc/social.coves.community.list') {
      res.writeHead(200, BASE_HEADERS)
      res.end(
        JSON.stringify({
          communities: [
            {
              did: 'did:plc:communityabcdefghijkl',
              name: 'general',
              handle: 'general.coves.social',
              displayName: SSR_COMMUNITY_MARKER,
              origin: 'coves.social',
              subscriberCount: 12,
              memberCount: 12,
              postCount: 1,
              visibility: 'public',
            },
          ],
        }),
      )
      return
    }

    unknownPaths.push(`${req.method ?? 'GET'} ${path}`)
    res.writeHead(404, BASE_HEADERS)
    res.end(JSON.stringify({ error: 'NotFound', message: `no route ${path}` }))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    get unknownPaths() {
      return [...new Set(unknownPaths)]
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  }
}
