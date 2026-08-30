/**
 * `coves()` on the server: where the sealed session token comes from, and
 * where it is allowed to go.
 *
 * On the client every request is routed through `/api/proxy`, which injects
 * auth from the session cookie. On the server there is no proxy — the render
 * calls the upstream directly — so the token has to come from the request that
 * is executing. Two properties matter and are pinned below: an authenticated
 * render's calls carry its token, and that token never leaves the upstream
 * origin.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { RequestEvent } from '@sveltejs/kit'

const K = vi.hoisted(() => ({
  /** The origin the server render legitimately talks to. */
  UPSTREAM: 'https://upstream.internal.example',
}))

/** Any other origin. The token must never reach one. */
const FOREIGN = 'https://third-party.example'
const TOKEN = 'sealed-abc'
const EXPLICIT_TOKEN = 'explicit-token'

vi.mock('$app/environment', () => ({
  browser: false,
  dev: false,
  building: false,
  version: 'test',
}))

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const logged = vi.hoisted(() => ({
  error: [] as unknown[][],
  warn: [] as unknown[][],
}))

vi.mock('$lib/app/util/log', () => ({
  log: {
    error: (...args: unknown[]) => {
      logged.error.push(args)
    },
    warn: (...args: unknown[]) => {
      logged.warn.push(args)
    },
  },
}))

vi.mock('$lib/app/state/instance.svelte', () => ({
  DEFAULT_INSTANCE_URL: K.UPSTREAM,
  LINKED_INSTANCE_URL: undefined,
  instance: { data: K.UPSTREAM },
}))

// Profile is mocked to a guest deliberately: the token must be sourced from
// the request event, not from client-side profile state, so these tests must
// still pass with no authenticated profile in module state.
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: {
    current: { type: 'guest', id: 'guest', instance: K.UPSTREAM },
    isAuthenticated: false,
  },
}))

interface Recorded {
  readonly url: string
  readonly init: RequestInit | undefined
}

const recorded: Recorded[] = []

const fakeFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  recorded.push({ url: String(input), init })
  return new Response(JSON.stringify({ feed: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const account = {
  did: 'did:plc:abcdefghijklmnopqrstuvwx',
  handle: 'mari.test',
  instance: K.UPSTREAM,
  sealedToken: TOKEN,
}

const authedLocals = () => ({
  authenticated: true,
  account,
  authToken: TOKEN,
})

const anonLocals = () => ({ authenticated: false })

const eventFor = (auth: unknown): RequestEvent =>
  ({ locals: { auth } }) as unknown as RequestEvent

/** The Authorization header of the nth recorded request, or null. */
function authHeaderOf(index = 0): string | null {
  const entry = recorded[index]
  if (entry === undefined) return null
  return new Headers(entry.init?.headers).get('authorization')
}

/** Builds locals whose account claims `instance`, so origin rules can be probed. */
const authedLocalsOn = (instance: string) => ({
  authenticated: true,
  account: { ...account, instance },
  authToken: TOKEN,
})

async function freshClient() {
  vi.resetModules()
  const { installRequestEventAccessor } =
    await import('$lib/app/util/request-event')
  const client = await import('./client.svelte')
  return { ...client, installRequestEventAccessor }
}

/** The `fields` bag of a `log.*` call: the last argument, when it is an object. */
function fieldsOf(call: unknown[]): Record<string, unknown> {
  const last = call.at(-1)
  return typeof last === 'object' && last !== null
    ? (last as Record<string, unknown>)
    : {}
}

/** Everything every log call carried, flattened to one searchable string. */
function allLoggedText(): string {
  return [...logged.error, ...logged.warn]
    .map((call) =>
      call
        .map((arg) => {
          try {
            return typeof arg === 'string' ? arg : JSON.stringify(arg)
          } catch {
            return String(arg)
          }
        })
        .join(' '),
    )
    .join('\n')
}

beforeEach(() => {
  logged.error.length = 0
  logged.warn.length = 0
  recorded.length = 0
  // `__VERSION__` is a Vite `define` from vite.config.ts, which the vitest
  // config does not carry; `customFetch` reads it on every request.
  vi.stubGlobal('__VERSION__', 'test')
})

describe('coves() on the server — auth header injection', () => {
  it('carries the in-flight request’s token, with caching disabled', async () => {
    const { coves, installRequestEventAccessor } = await freshClient()
    installRequestEventAccessor(() => eventFor(authedLocals()))

    await coves({ func: fakeFetch }).getDiscover({ limit: 1 })

    expect(recorded).toHaveLength(1)
    expect(authHeaderOf()).toBe(`Bearer ${TOKEN}`)
    // An authenticated response is per-user and must not be cached.
    expect(recorded[0].init?.cache).toBe('no-store')
  })

  it('sends no Authorization header for an anonymous request', async () => {
    const { coves, installRequestEventAccessor } = await freshClient()
    installRequestEventAccessor(() => eventFor(anonLocals()))

    await coves({ func: fakeFetch }).getDiscover({ limit: 1 })

    expect(recorded).toHaveLength(1)
    expect(authHeaderOf()).toBeNull()
  })

  it('sends no Authorization header when there is no request at all', async () => {
    const { coves } = await freshClient()

    await coves({ func: fakeFetch }).getDiscover({ limit: 1 })

    expect(authHeaderOf()).toBeNull()
  })

  it('lets an explicitly passed token win over the request’s', async () => {
    const { coves, installRequestEventAccessor } = await freshClient()
    installRequestEventAccessor(() => eventFor(authedLocals()))

    await coves({ func: fakeFetch, auth: EXPLICIT_TOKEN }).getDiscover({
      limit: 1,
    })

    expect(authHeaderOf()).toBe(`Bearer ${EXPLICIT_TOKEN}`)
  })

  it('never sends the request’s token to another origin', async () => {
    // The token is sealed for our upstream. A call aimed anywhere else — a
    // remote instance, an image host, anything a route param could name —
    // must go out unauthenticated rather than hand a session credential to a
    // third party.
    const { coves, installRequestEventAccessor } = await freshClient()
    installRequestEventAccessor(() => eventFor(authedLocals()))

    await coves({ func: fakeFetch, instanceURL: FOREIGN }).getDiscover({
      limit: 1,
    })

    // The request really was made, and really was aimed off-origin: without
    // this the assertion below could pass because nothing happened.
    expect(recorded).toHaveLength(1)
    expect(recorded[0].url.startsWith(FOREIGN)).toBe(true)
    expect(authHeaderOf()).toBeNull()
  })
})

describe('coves() on the server — concurrent requests', () => {
  it('gives each render only its own credentials', async () => {
    const { coves, installRequestEventAccessor } = await freshClient()

    const als = new AsyncLocalStorage<RequestEvent>()
    installRequestEventAccessor(() => als.getStore())

    const ROUNDS = 5
    const run = (auth: unknown, tag: string): Promise<string[]> =>
      als.run(eventFor(auth), async () => {
        const seen: string[] = []
        for (let round = 0; round < ROUNDS; round++) {
          const calls: Recorded[] = []
          const capture = async (
            input: RequestInfo | URL,
            init?: RequestInit,
          ): Promise<Response> => {
            calls.push({ url: String(input), init })
            return new Response('{"feed":[]}', {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          }
          // Built inside the context, as a load function would.
          await coves({ func: capture }).getDiscover({ limit: 1 })
          seen.push(
            `${tag}:${new Headers(calls[0].init?.headers).get('authorization') ?? 'none'}`,
          )
          await Promise.resolve()
        }
        return seen
      })

    const [authed, anonymous] = await Promise.all([
      run(authedLocals(), 'authed'),
      run(anonLocals(), 'anon'),
    ])

    expect(authed).toEqual(Array<string>(ROUNDS).fill(`authed:Bearer ${TOKEN}`))
    expect(anonymous).toEqual(Array<string>(ROUNDS).fill('anon:none'))
  })
})

describe('coves() on the server — origin matching fails closed', () => {
  it.each([
    {
      name: 'same host, different port',
      instance: 'http://127.0.0.1:8081',
      target: 'http://127.0.0.1:8080',
    },
    {
      name: 'same host, different scheme',
      instance: 'https://coves.social',
      target: 'http://coves.social',
    },
    {
      name: 'bare host instance (normalised to https) vs an http target',
      instance: 'coves.social',
      target: 'http://coves.social',
    },
  ])('withholds the token for $name', async ({ instance, target }) => {
    const { coves, installRequestEventAccessor } = await freshClient()
    installRequestEventAccessor(() => eventFor(authedLocalsOn(instance)))

    await coves({ func: fakeFetch, instanceURL: target }).getDiscover({
      limit: 1,
    })

    // Assert the call really was aimed where the test says before concluding
    // anything from the absent header.
    expect(recorded).toHaveLength(1)
    expect(new URL(recorded[0].url).origin).toBe(new URL(target).origin)
    expect(authHeaderOf()).toBeNull()
  })

  it('withholds the token when the account instance is not a URL at all', async () => {
    const { coves, installRequestEventAccessor } = await freshClient()
    installRequestEventAccessor(() => eventFor(authedLocalsOn('not a url')))

    await coves({ func: fakeFetch, instanceURL: K.UPSTREAM }).getDiscover({
      limit: 1,
    })

    // A malformed instance must not throw mid-render, and must not be treated
    // as matching whatever it was compared against.
    expect(recorded).toHaveLength(1)
    expect(authHeaderOf()).toBeNull()
  })
})

describe('coves() on the server — explicitly passed tokens', () => {
  it('sends an explicit token even to another origin', async () => {
    // Documented policy: injection from the request is origin-scoped, but a
    // caller passing `auth` by hand has taken responsibility for where it goes.
    const { coves, installRequestEventAccessor } = await freshClient()
    installRequestEventAccessor(() => eventFor(authedLocals()))

    await coves({
      func: fakeFetch,
      auth: EXPLICIT_TOKEN,
      instanceURL: FOREIGN,
    }).getDiscover({ limit: 1 })

    expect(new URL(recorded[0].url).origin).toBe(new URL(FOREIGN).origin)
    expect(authHeaderOf()).toBe(`Bearer ${EXPLICIT_TOKEN}`)
  })

  it('disables caching for an explicit token too', async () => {
    const { coves } = await freshClient()

    await coves({ func: fakeFetch, auth: EXPLICIT_TOKEN }).getDiscover({
      limit: 1,
    })

    expect(recorded[0].init?.cache).toBe('no-store')
  })
})

describe('client() on the server — same rules as coves()', () => {
  it('carries the in-flight request’s token, with caching disabled', async () => {
    const { client, installRequestEventAccessor } = await freshClient()
    installRequestEventAccessor(() => eventFor(authedLocals()))

    await client({ func: fakeFetch }).getSite()

    expect(recorded).toHaveLength(1)
    expect(authHeaderOf()).toBe(`Bearer ${TOKEN}`)
    expect(recorded[0].init?.cache).toBe('no-store')
  })

  it('sends no Authorization header for an anonymous request', async () => {
    const { client, installRequestEventAccessor } = await freshClient()
    installRequestEventAccessor(() => eventFor(anonLocals()))

    await client({ func: fakeFetch }).getSite()

    expect(authHeaderOf()).toBeNull()
  })

  it('never sends the request’s token to another origin', async () => {
    const { client, installRequestEventAccessor } = await freshClient()
    installRequestEventAccessor(() => eventFor(authedLocals()))

    await client({ func: fakeFetch, instanceURL: FOREIGN }).getSite()

    expect(recorded).toHaveLength(1)
    expect(new URL(recorded[0].url).origin).toBe(new URL(FOREIGN).origin)
    expect(authHeaderOf()).toBeNull()
  })
})

describe('coves() on the server — the reason a token was withheld is reported', () => {
  it('reports an unparseable account instance as an error', async () => {
    const { coves, installRequestEventAccessor } = await freshClient()
    installRequestEventAccessor(() => eventFor(authedLocalsOn('not a url')))

    await coves({ func: fakeFetch, instanceURL: K.UPSTREAM }).getDiscover({
      limit: 1,
    })

    // A config or programming fault, not a runtime condition: an account whose
    // instance cannot be parsed can never authenticate anything, and silently
    // degrading to anonymous renders is how that goes unnoticed for a release.
    expect(logged.error).toHaveLength(1)
    expect(logged.warn).toHaveLength(0)

    const [message] = logged.error[0]
    expect(String(message)).toMatch(/requestToken/i)
    expect(fieldsOf(logged.error[0])).toMatchObject({ instance: 'not a url' })
  })

  it('reports an origin mismatch as a warning, naming both origins', async () => {
    const { coves, installRequestEventAccessor } = await freshClient()
    installRequestEventAccessor(() => eventFor(authedLocals()))

    await coves({ func: fakeFetch, instanceURL: FOREIGN }).getDiscover({
      limit: 1,
    })

    // Only a warning: fetching a remote instance, an image host or anything a
    // route param can name is legitimate, and the token is correctly withheld.
    // It is still worth seeing, because it is also what a mis-set
    // PUBLIC_INTERNAL_INSTANCE looks like.
    expect(logged.warn).toHaveLength(1)
    expect(logged.error).toHaveLength(0)

    const fields = JSON.stringify(fieldsOf(logged.warn[0]))
    expect(fields).toContain(new URL(FOREIGN).origin)
    expect(fields).toContain(new URL(K.UPSTREAM).origin)
  })

  it('never writes the token into a log line', async () => {
    const { coves, installRequestEventAccessor } = await freshClient()

    installRequestEventAccessor(() => eventFor(authedLocalsOn('not a url')))
    await coves({ func: fakeFetch, instanceURL: K.UPSTREAM }).getDiscover({
      limit: 1,
    })

    installRequestEventAccessor(() => eventFor(authedLocals()))
    await coves({ func: fakeFetch, instanceURL: FOREIGN }).getDiscover({
      limit: 1,
    })

    // Both diagnostics fire while holding a live sealed token. Neither may
    // carry it: these lines go to stderr on the server and to the console in
    // the browser, and both get archived.
    expect(logged.error.length + logged.warn.length).toBeGreaterThan(0)
    expect(allLoggedText()).not.toContain(TOKEN)
  })

  it('says nothing when there is simply no session', async () => {
    const { coves, installRequestEventAccessor } = await freshClient()
    installRequestEventAccessor(() => eventFor(anonLocals()))

    await coves({ func: fakeFetch }).getDiscover({ limit: 1 })

    // An anonymous render is the normal case, not a fault. Logging it would
    // bury the two lines above under one entry per page view.
    expect(logged.error).toHaveLength(0)
    expect(logged.warn).toHaveLength(0)
  })

  it('says nothing when there is no request at all', async () => {
    const { coves } = await freshClient()

    await coves({ func: fakeFetch }).getDiscover({ limit: 1 })

    expect(logged.error).toHaveLength(0)
    expect(logged.warn).toHaveLength(0)
  })
})
