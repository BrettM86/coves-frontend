/**
 * Shared mocks for testing SvelteKit server code (hooks, +server endpoints,
 * load functions). Import these instead of hand-rolling per-file
 * RequestEvent/Cookies mocks so all server tests exercise the same shapes.
 *
 * Test-only module: never import from production code.
 */
import type { Cookies, RequestEvent } from '@sveltejs/kit'
import { vi } from 'vitest'

/**
 * SvelteKit's first-party redirect guard: `redirect()` throws an instance of
 * kit's `Redirect` class, and this checks for it. Re-exported so server tests
 * have one canonical import site alongside the mocks.
 */
export { isRedirect } from '@sveltejs/kit'

/**
 * A RequestEvent with relaxed params/route typing so one mock event can be
 * passed to any route's handler without per-route type plumbing.
 */
export type MockRequestEvent = RequestEvent<Record<string, string>, any>

/**
 * In-memory Cookies mock backed by a Map. All methods are vi.fn()s, so tests
 * can assert on calls (e.g. `expect(cookies.set).toHaveBeenCalledWith(...)`).
 */
export function createMockCookies(
  initialCookies: Record<string, string> = {},
): Cookies {
  const store = new Map(Object.entries(initialCookies))
  return {
    get: vi.fn((name: string) => store.get(name)),
    getAll: vi.fn(() =>
      Array.from(store.entries()).map(([name, value]) => ({ name, value })),
    ),
    set: vi.fn((name: string, value: string) => {
      store.set(name, value)
    }),
    delete: vi.fn((name: string) => {
      store.delete(name)
    }),
    serialize: vi.fn((name: string, value: string) => `${name}=${value}`),
  }
}

export interface MockEventOptions {
  /** Defaults to POST when `body` is set, GET otherwise */
  method?: string
  /**
   * JSON-serialized into the request body (with Content-Type:
   * application/json). Any JSON value works, including falsy ones —
   * presence is decided by `!== undefined`, not truthiness.
   */
  body?: unknown
  headers?: Record<string, string>
  /** Defaults to http://localhost:5173/ */
  url?: string | URL
  /** Defaults to fresh createMockCookies() */
  cookies?: Cookies
  /** Defaults to unauthenticated */
  locals?: App.Locals
  params?: Record<string, string>
  /**
   * Defaults to url.pathname — note that is NOT a real SvelteKit route id
   * shape (those look like '/c/[handle]'); pass one explicitly if code under
   * test matches on route.id.
   */
  routeId?: string
}

// The real Span type lives in @opentelemetry/api, which isn't a dependency;
// nothing under test traces, so an inert stand-in is enough.
const noopSpan = {
  end: () => {},
  setAttribute: () => noopSpan,
  setAttributes: () => noopSpan,
  recordException: () => {},
  setStatus: () => noopSpan,
} as unknown as MockRequestEvent['tracing']['root']

/**
 * Creates a complete mock RequestEvent. The literal below is compiler-checked
 * against SvelteKit's RequestEvent, so kit adding/renaming fields fails
 * `pnpm check` here — one obvious fix site — instead of N tests failing at
 * runtime on a missing field.
 */
export function createMockEvent(
  options: MockEventOptions = {},
): MockRequestEvent {
  const url =
    options.url instanceof URL
      ? options.url
      : new URL(options.url ?? 'http://localhost:5173/')
  const hasBody = options.body !== undefined
  const defaultLocals: App.Locals = { auth: { authenticated: false } }
  const event: MockRequestEvent = {
    request: new Request(url, {
      method: options.method ?? (hasBody ? 'POST' : 'GET'),
      body: hasBody ? JSON.stringify(options.body) : undefined,
      headers: {
        ...(hasBody && { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
    }),
    cookies: options.cookies ?? createMockCookies(),
    url,
    locals: options.locals ?? defaultLocals,
    params: options.params ?? {},
    platform: undefined,
    route: { id: options.routeId ?? url.pathname },
    getClientAddress: () => '127.0.0.1',
    // Loud default: resolving undefined here would let handlers crash inside
    // catch-and-redirect blocks while tests assert the redirect and pass.
    fetch: vi.fn(() =>
      Promise.reject(
        new Error(
          'createMockEvent: event.fetch called but not mocked — pass a fetch via Object.assign(event, { fetch: ... })',
        ),
      ),
    ),
    isDataRequest: false,
    isSubRequest: false,
    isRemoteRequest: false,
    setHeaders: vi.fn(),
    tracing: { enabled: false, root: noopSpan, current: noopSpan },
  }
  return event
}
