import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Acceptance test for the service worker, driven from the outside: the module
 * is imported against a stubbed `self`/`caches`/`fetch`, and exercised only
 * through the 'install'/'activate'/'fetch' listeners it registers.
 *
 * The behaviour under test is a privacy bug: the SW used to cache every OK
 * same-origin page response and replay it offline. Page HTML and
 * `__data.json` carry the signed-in user's session (handle, avatar, DID), so
 * the replay hands the next user of a shared device the previous user's
 * session. The SW must never store or serve those responses — only the
 * precached build/static assets.
 */

const ORIGIN = 'http://localhost:5173'

/**
 * Imported through a variable specifier on purpose. `src/service-worker.ts` is
 * excluded from tsconfig (SvelteKit's default): it declares
 * `no-default-lib` + the webworker lib, so pulling it into the app's type
 * program strips the DOM lib from every other file. Vite still resolves this
 * at runtime; TypeScript leaves it alone.
 */
const SERVICE_WORKER = './service-worker'

// Hoisted so the `$service-worker` factory (which vitest lifts above the
// imports) can close over them, and the assertions can reuse the same lists.
const { BUILD, FILES, VERSION } = vi.hoisted(() => ({
  BUILD: ['/_app/immutable/app.js', '/_app/immutable/chunk.js'],
  FILES: ['/favicon.png'],
  VERSION: 'test-version',
}))

// The real virtual module only exists inside a ServiceWorkerGlobalScope.
vi.mock('$service-worker', () => ({
  build: BUILD,
  files: FILES,
  version: VERSION,
  prerendered: [],
  base: '',
}))

/**
 * The worker's cache names: the security epoch, then the deployment. `e1`
 * mirrors `SECURITY_EPOCH` in the worker; bump the two together.
 */
const EPOCH_PREFIX = 'cache-e1-'
const CURRENT_CACHE = `${EPOCH_PREFIX}${VERSION}`

/**
 * A response as the Cache returns one the worker fetched itself: same-origin,
 * so `basic`. A constructed `new Response` is `default`, which is what a page
 * script writing into the cache directly would leave behind.
 */
function fetchedResponse(body: string, init?: ResponseInit): Response {
  return Object.defineProperty(new Response(body, init), 'type', {
    value: 'basic',
  })
}

const SESSION_HTML =
  '<!doctype html><html data-session="did:plc:mari"><body>mari</body></html>'
const SESSION_DATA_JSON = '{"session":{"handle":"mari.local.coves.dev"}}'

/**
 * Cache keys are pathnames, which is how the SW looks assets up
 * (`cache.match('/favicon.png')`). Keying a whole Request the same way lets a
 * test seed an entry the way the deleted runtime cache used to, and matches
 * what the real Cache does for same-origin requests.
 */
function cacheKey(request: RequestInfo | URL): string {
  const url = request instanceof Request ? request.url : String(request)
  return new URL(url, ORIGIN).pathname
}

class MockCache {
  readonly entries = new Map<string, Response>()

  async addAll(requests: readonly string[]): Promise<void> {
    for (const request of requests) {
      this.entries.set(cacheKey(request), new Response(`asset:${request}`))
    }
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(cacheKey(request), response)
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    return this.entries.get(cacheKey(request))
  }
}

class MockCacheStorage {
  readonly caches = new Map<string, MockCache>()

  async open(name: string): Promise<MockCache> {
    const existing = this.caches.get(name)
    if (existing) return existing

    const cache = new MockCache()
    this.caches.set(name, cache)
    return cache
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()]
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name)
  }

  /** Every pathname held across every cache, sorted for stable assertions. */
  storedPaths(): string[] {
    return [...this.caches.values()]
      .flatMap((cache) => [...cache.entries.keys()])
      .sort()
  }
}

type SwListener = (event: unknown) => void

/** What the SW did with one request, as a string so failures read clearly. */
type FetchOutcome = 'declined' | 'rejected' | `served: ${string}`

describe('service worker', () => {
  let addEventListener: ReturnType<
    typeof vi.fn<(type: string, listener: SwListener) => void>
  >
  let cacheStorage: MockCacheStorage
  let fetchMock: ReturnType<typeof vi.fn<(input: Request) => Promise<Response>>>
  let skipWaiting: ReturnType<typeof vi.fn<() => void>>
  let clientsClaim: ReturnType<typeof vi.fn<() => Promise<void>>>

  beforeEach(async () => {
    vi.resetModules()
    vi.spyOn(console, 'info').mockImplementation(() => {})

    addEventListener = vi.fn<(type: string, listener: SwListener) => void>()
    cacheStorage = new MockCacheStorage()
    fetchMock = vi.fn<(input: Request) => Promise<Response>>()
    skipWaiting = vi.fn<() => void>()
    clientsClaim = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

    // Stubbing must precede the import: the module registers its listeners on
    // `self` at module-evaluation time.
    vi.stubGlobal('self', {
      addEventListener,
      location: { origin: ORIGIN },
      skipWaiting,
      clients: { claim: clientsClaim },
    })
    vi.stubGlobal('caches', cacheStorage)
    vi.stubGlobal('fetch', fetchMock)

    await import(/* @vite-ignore */ SERVICE_WORKER)
  })

  // `self`, `caches` and `fetch` are real globals in some environments; leaving
  // the stubs attached would leak this suite's fakes into every later file.
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function listenerFor(type: string): SwListener {
    const call = addEventListener.mock.calls.find(([name]) => name === type)
    if (!call)
      throw new Error(`service worker registered no '${type}' listener`)
    return call[1]
  }

  /** Dispatches a lifecycle event and awaits whatever it passed to waitUntil. */
  async function dispatchLifecycle(
    type: 'install' | 'activate',
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const pending: Promise<unknown>[] = []
    listenerFor(type)({
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
      ...extra,
    })
    await Promise.all(pending)
  }

  /**
   * Dispatches a fetch event. The SW may legitimately decline a request by
   * returning without calling respondWith — the browser then handles it — so
   * that is a first-class outcome here, not a failure.
   */
  async function dispatchFetch(
    input: string | Request,
    init?: RequestInit,
  ): Promise<FetchOutcome> {
    const request = input instanceof Request ? input : new Request(input, init)
    let responded: Promise<Response> | undefined
    const respondWith = vi.fn((promise: Promise<Response>) => {
      responded = promise
    })

    listenerFor('fetch')({ request, respondWith })

    if (!responded) return 'declined'

    try {
      return `served: ${await (await responded).text()}`
    } catch {
      return 'rejected'
    }
  }

  it('never serves a cached page or data response, online or offline', async () => {
    await dispatchLifecycle('install')
    await dispatchLifecycle('activate')

    // The network is primed with session-bearing HTML and data JSON only to
    // prove it is never consulted: these are the browser's requests to make,
    // and re-issuing them from here would change their credential and redirect
    // semantics for no gain.
    fetchMock.mockImplementation(async (request) =>
      new URL(request.url).pathname.endsWith('.json')
        ? new Response(SESSION_DATA_JSON, {
            headers: { 'content-type': 'application/json' },
          })
        : new Response(SESSION_HTML, {
            headers: { 'content-type': 'text/html' },
          }),
    )

    const online = [
      await dispatchFetch(`${ORIGIN}/`),
      await dispatchFetch(`${ORIGIN}/feed/__data.json`),
    ]

    expect(online).toEqual(['declined', 'declined'])
    expect(fetchMock).not.toHaveBeenCalled()

    // Offline: every network attempt fails.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const offline = [
      await dispatchFetch(`${ORIGIN}/`),
      await dispatchFetch(`${ORIGIN}/feed/__data.json`),
    ]

    // Declining or erroring are both acceptable; serving a body is not, because
    // the only body available offline is the previous user's session.
    expect(offline).toEqual([
      expect.stringMatching(/^(declined|rejected)$/),
      expect.stringMatching(/^(declined|rejected)$/),
    ])

    // And nothing but the precached assets was ever written to disk.
    expect(cacheStorage.storedPaths()).toEqual([...BUILD, ...FILES].sort())
  })

  it('never writes a page or data response to the cache', async () => {
    await dispatchLifecycle('install')
    fetchMock.mockImplementation(
      async (request) =>
        new Response(
          new URL(request.url).pathname.endsWith('.json')
            ? SESSION_DATA_JSON
            : SESSION_HTML,
        ),
    )

    // Whether the SW declines these or relays the network response is its
    // business; writing them to disk is not.
    await dispatchFetch(`${ORIGIN}/`)
    await dispatchFetch(`${ORIGIN}/feed/__data.json`)

    expect(cacheStorage.storedPaths()).toEqual([...BUILD, ...FILES].sort())
  })

  it('serves a precached asset from the cache without asking the network', async () => {
    await dispatchLifecycle('install')

    const outcome = await dispatchFetch(`${ORIGIN}${BUILD[0]}`)

    expect(outcome).toBe(`served: asset:${BUILD[0]}`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('takes over from the previous worker and purges its cache first', async () => {
    // A previous deployment's cache, still holding the page copy the old
    // worker used to replay. Until this worker claims the open clients, those
    // pages keep talking to it.
    const stale = await cacheStorage.open('cache-old')
    await stale.put(`${ORIGIN}/`, new Response(SESSION_HTML))

    // Recorded at call time so the ordering is checked, not just the end
    // state: claiming clients before the purge would hand them the stale cache.
    let cachesWhenClaimed: string[] = []
    clientsClaim.mockImplementation(async () => {
      cachesWhenClaimed = await cacheStorage.keys()
    })

    await dispatchLifecycle('install')

    expect(skipWaiting).toHaveBeenCalled()

    await dispatchLifecycle('activate')

    expect(clientsClaim).toHaveBeenCalled()
    expect(cachesWhenClaimed).toEqual([CURRENT_CACHE])
    expect(cacheStorage.storedPaths()).toEqual([...BUILD, ...FILES].sort())
  })

  it('reuses unchanged build files from the previous deployment', async () => {
    // A returning visitor: the last deployment's worker already stored one of
    // these content-hashed files, and the new deployment still ships it. The
    // other is new in this deployment.
    const old = await cacheStorage.open(`${EPOCH_PREFIX}old`)
    await old.put(`${ORIGIN}${BUILD[0]}`, fetchedResponse('kept'))
    const addAll = vi.spyOn(MockCache.prototype, 'addAll')

    await dispatchLifecycle('install')
    await dispatchLifecycle('activate')

    // Only what the old cache could not supply goes to the network.
    expect(addAll).toHaveBeenCalledWith([BUILD[1], ...FILES])
    expect(await dispatchFetch(`${ORIGIN}${BUILD[0]}`)).toBe('served: kept')
    expect(await dispatchFetch(`${ORIGIN}${BUILD[1]}`)).toBe(
      `served: asset:${BUILD[1]}`,
    )
    expect(cacheStorage.storedPaths()).toEqual([...BUILD, ...FILES].sort())
  })

  it('reuses nothing cached under a different security epoch', async () => {
    // Bumping the epoch is how a deploy that fixes an XSS evicts whatever the
    // XSS may have written into the cache, so neither an older epoch's cache
    // nor one named before epochs existed may supply anything.
    const olderEpoch = await cacheStorage.open(`cache-e0-old`)
    await olderEpoch.put(`${ORIGIN}${BUILD[0]}`, fetchedResponse('poisoned'))
    const preEpoch = await cacheStorage.open('cache-old')
    await preEpoch.put(`${ORIGIN}${BUILD[1]}`, fetchedResponse('poisoned'))
    const addAll = vi.spyOn(MockCache.prototype, 'addAll')

    await dispatchLifecycle('install')

    expect(addAll).toHaveBeenCalledWith([...BUILD, ...FILES])
  })

  it('reuses only successful responses the worker fetched itself', async () => {
    const old = await cacheStorage.open(`${EPOCH_PREFIX}old`)
    await old.put(
      `${ORIGIN}${BUILD[0]}`,
      fetchedResponse('not found', { status: 404 }),
    )
    // Written by a page script, not fetched: `default`, not `basic`.
    await old.put(`${ORIGIN}${BUILD[1]}`, new Response('constructed'))
    const addAll = vi.spyOn(MockCache.prototype, 'addAll')

    await dispatchLifecycle('install')

    expect(addAll).toHaveBeenCalledWith([...BUILD, ...FILES])
  })

  it('downloads everything when the old caches cannot be listed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const old = await cacheStorage.open(`${EPOCH_PREFIX}old`)
    await old.put(`${ORIGIN}${BUILD[0]}`, fetchedResponse('kept'))
    vi.spyOn(cacheStorage, 'keys').mockRejectedValueOnce(
      new DOMException('blocked', 'SecurityError'),
    )
    const addAll = vi.spyOn(MockCache.prototype, 'addAll')

    await dispatchLifecycle('install')

    expect(addAll).toHaveBeenCalledWith([...BUILD, ...FILES])
    expect(warn).toHaveBeenCalled()
  })

  it('downloads an asset whose old copy cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const old = await cacheStorage.open(`${EPOCH_PREFIX}old`)
    await old.put(`${ORIGIN}${BUILD[0]}`, fetchedResponse('kept'))
    vi.spyOn(old, 'match').mockRejectedValue(new TypeError('read failed'))
    const addAll = vi.spyOn(MockCache.prototype, 'addAll')

    await dispatchLifecycle('install')

    expect(addAll).toHaveBeenCalledWith([...BUILD, ...FILES])
    expect(warn).toHaveBeenCalled()
  })

  it('reports an old copy it could not carry over', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const old = await cacheStorage.open(`${EPOCH_PREFIX}old`)
    await old.put(`${ORIGIN}${BUILD[0]}`, fetchedResponse('kept'))
    vi.spyOn(MockCache.prototype, 'put').mockRejectedValueOnce(
      new DOMException('quota', 'QuotaExceededError'),
    )
    const addAll = vi.spyOn(MockCache.prototype, 'addAll')

    await dispatchLifecycle('install')

    expect(addAll).toHaveBeenCalledWith([...BUILD, ...FILES])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[sw]'),
      BUILD[0],
      expect.any(DOMException),
    )
  })

  it('carries nothing but content-hashed build files across deployments', async () => {
    // `static/` files keep their names when their bytes change, and the old
    // runtime cache may still hold a session-bearing page.
    const old = await cacheStorage.open('cache-old')
    await old.put(`${ORIGIN}${FILES[0]}`, new Response('stale static'))
    await old.put(`${ORIGIN}/`, new Response(SESSION_HTML))

    await dispatchLifecycle('install')
    await dispatchLifecycle('activate')

    expect(await dispatchFetch(`${ORIGIN}${FILES[0]}`)).toBe(
      `served: asset:${FILES[0]}`,
    )
    expect(cacheStorage.storedPaths()).toEqual([...BUILD, ...FILES].sort())
  })

  it('sends navigations straight to the network where static routing exists', async () => {
    const addRoutes = vi.fn(async (_rules: readonly object[]) => {})

    await dispatchLifecycle('install', { addRoutes })

    expect(addRoutes).toHaveBeenCalledOnce()
    expect(addRoutes.mock.calls[0][0]).toContainEqual({
      condition: { requestMode: 'navigate' },
      source: 'network',
    })
    // The precache is unaffected.
    expect(cacheStorage.storedPaths()).toEqual([...BUILD, ...FILES].sort())
  })

  it('still installs when the browser rejects the routes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const addRoutes = vi.fn(async () => {
      throw new TypeError('unsupported condition')
    })

    await dispatchLifecycle('install', { addRoutes })

    expect(cacheStorage.storedPaths()).toEqual([...BUILD, ...FILES].sort())
    expect(warn).toHaveBeenCalled()
  })

  it('still precaches when building the static routes throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'URLPattern',
      class {
        constructor() {
          throw new TypeError('unsupported pattern')
        }
      },
    )
    const addRoutes = vi.fn(async (_rules: readonly object[]) => {})

    await dispatchLifecycle('install', { addRoutes })

    expect(cacheStorage.storedPaths()).toEqual([...BUILD, ...FILES].sort())
    expect(warn).toHaveBeenCalled()
  })

  it('falls back to the network when the cache layer is unavailable', async () => {
    await dispatchLifecycle('install')
    // Private browsing and some enterprise policies reject caches.open
    // outright. respondWith has already committed us to answering, so an
    // unhandled rejection here is a broken page, not a degraded one.
    vi.spyOn(cacheStorage, 'open').mockRejectedValue(
      new DOMException('blocked', 'SecurityError'),
    )
    fetchMock.mockResolvedValue(new Response('net'))

    expect(await dispatchFetch(`${ORIGIN}${BUILD[0]}`)).toBe('served: net')
  })

  it('reports a failed precache rather than failing silently', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new TypeError('Failed to fetch /_app/immutable/app.js')
    vi.spyOn(MockCache.prototype, 'addAll').mockRejectedValue(failure)

    // The install must still fail — a worker whose precache is half-filled
    // must not go on to activate — but it must say why.
    await expect(dispatchLifecycle('install')).rejects.toThrow(failure)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('declines a cross-origin request for an asset path', async () => {
    await dispatchLifecycle('install')

    // Same pathname as a precached asset, different host: re-issuing it from
    // here would run it under this script's policy, not the page's.
    expect(await dispatchFetch(`https://cdn.example${BUILD[0]}`)).toBe(
      'declined',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('declines a non-GET request', async () => {
    await dispatchLifecycle('install')

    expect(
      await dispatchFetch(`${ORIGIN}${BUILD[0]}`, { method: 'POST' }),
    ).toBe('declined')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to the network for an asset the precache is missing', async () => {
    // No install: the precache was evicted, or never finished.
    fetchMock.mockResolvedValue(new Response('net'))

    expect(await dispatchFetch(`${ORIGIN}${BUILD[0]}`)).toBe('served: net')
    // A miss must not be repaired by writing the response back — that is the
    // runtime cache this fix removed.
    expect(cacheStorage.storedPaths()).toEqual([])
  })
})
