/**
 * A stand-in for the Go backend, for the SSR acceptance tier.
 *
 * The built SvelteKit server talks to `PUBLIC_INTERNAL_INSTANCE` for two
 * things when rendering `/`:
 *   - `GET /api/me`            (hooks.server.ts, only when a session cookie is present)
 *   - `GET /xrpc/social.coves.feed.getDiscover` (the `/` page load)
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

/**
 * Kit's universal `fetch` enforces CORS on cross-origin server-side loads
 * (`load_data.js`: a missing `Access-Control-Allow-Origin` throws, which turns
 * the page into a 500). The test server and the mock are on different ports,
 * so every response carries the header.
 */
const BASE_HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
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
      // An empty feed is enough: the tests assert on the shell — sidebar
      // login state, the signed-in handle, feed tabs — not on post rendering.
      res.writeHead(200, BASE_HEADERS)
      res.end(JSON.stringify({ feed: [] }))
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
