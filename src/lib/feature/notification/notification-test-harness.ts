// Test support for the notification store and page tests; no production file
// imports it. It never imports svelte, the profile or a store at runtime: the
// route tests re-import those after `vi.resetModules()`, so each test file
// passes its current instances in.
import type { ServerSession } from '$lib/app/state/auth.svelte'

type Svelte = Pick<typeof import('svelte'), 'flushSync'>
type Profile = (typeof import('$lib/app/state/auth.svelte'))['profile']

export interface Account {
  did: string
  handle: string
}

export const alice: Account = {
  did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa',
  handle: 'alice.test',
}

export const bob: Account = {
  did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb',
  handle: 'bob.test',
}

export const session = (account: Account, generation: string) =>
  ({
    authenticated: true,
    activeAccountId: account.did,
    sessionGeneration: generation,
    account: {
      id: account.did,
      did: account.did,
      handle: account.handle,
      instance: 'http://localhost:8081',
    },
  }) as ServerSession

/** The `profileData` entry the profile restores itself from on a hard load. */
export const storedProfileData = (account: Account) =>
  JSON.stringify({
    profiles: [
      {
        type: 'authenticated',
        id: account.did,
        instance: 'http://localhost:8081',
        jwt: 'authenticated',
        did: account.did,
        handle: account.handle,
      },
    ],
    profile: account.did,
  })

/**
 * Retired generations never come back, so every login uses a fresh one from
 * the file's own factory.
 */
export function createGenerationFactory(prefix: string): () => string {
  let sequence = 0
  return () => `${prefix}-${++sequence}`
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** One notification request the fetch spy saw, held until the test answers. */
export interface NotificationRequest {
  method: string
  path: string
  /** The request URL's query parameters, as sent. */
  searchParams: URLSearchParams
  /** The parsed JSON body of a POST; undefined for a GET. */
  body: unknown
  resolve(response: Response): void
  reject(error: unknown): void
}

export interface NotificationFetch<Capture extends object> {
  /** Every notification request sent since `reset()`, in send order. */
  readonly requests: (NotificationRequest & Capture)[]
  /** Every other URL fetched since `reset()`; each file asserts it stays empty. */
  readonly unexpectedUrls: string[]
  /** When set, answers each notification request as it is sent; otherwise it is held. */
  answer: ((request: NotificationRequest & Capture) => void) | undefined
  /** The fetch implementation to install behind the file's fetch spy. */
  handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  /** Empties `requests` and `unexpectedUrls` in place and clears `answer`. */
  reset(): void
}

/**
 * A deferred fetch: each `social.coves.notification` request is recorded and
 * held until the test resolves or rejects it; `/api/auth/logout` answers 200.
 * `onSend` adds per-file fields captured at the moment a request is sent.
 */
export function createNotificationFetch<Capture extends object = object>(
  onSend?: () => Capture,
): NotificationFetch<Capture> {
  const requests: (NotificationRequest & Capture)[] = []
  const unexpectedUrls: string[] = []
  const notificationFetch: NotificationFetch<Capture> = {
    requests,
    unexpectedUrls,
    answer: undefined,
    handle(input, init) {
      const url = input instanceof Request ? input.url : String(input)
      if (url === '/api/auth/logout') return Promise.resolve(json(200, {}))
      if (!url.includes('social.coves.notification')) {
        unexpectedUrls.push(url)
        return Promise.resolve(json(404, { error: 'UnexpectedFetch' }))
      }
      const response = Promise.withResolvers<Response>()
      const parsedUrl = new URL(url, 'http://localhost')
      const request: NotificationRequest & Capture = {
        method: init?.method ?? 'GET',
        path: parsedUrl.pathname,
        searchParams: parsedUrl.searchParams,
        body:
          typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        ...(onSend ? onSend() : ({} as Capture)),
        resolve: response.resolve,
        reject: response.reject,
      }
      requests.push(request)
      notificationFetch.answer?.(request)
      return response.promise
    },
    reset() {
      requests.length = 0
      unexpectedUrls.length = 0
      notificationFetch.answer = undefined
    },
  }
  return notificationFetch
}

/** Lets fetch, XRPC parsing and the store continuation run, then flushes. */
export async function settle(svelte: Svelte) {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  svelte.flushSync()
}

// Captured at module load, before any test fakes `setTimeout`.
const realSetTimeout = globalThis.setTimeout

/**
 * `settle()` for a test that fakes the timer functions: yields to real
 * macrotasks so fetch and XRPC parsing finish, runs fake timers already due
 * without moving the fake clock, then flushes. `advanceTimersByTimeAsync` is
 * the file's `(ms) => vi.advanceTimersByTimeAsync(ms)`.
 */
export async function settleWithFakeTimers(
  svelte: Svelte,
  advanceTimersByTimeAsync: (ms: number) => Promise<unknown>,
) {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => realSetTimeout(r, 0))
    await advanceTimersByTimeAsync(0)
  }
  svelte.flushSync()
}

/**
 * Session transitions on the real profile, read through `instances` at call
 * time so a file that re-imports its modules always drives the current ones.
 */
export function createSessionActions(
  instances: () => { profile: Profile; svelte: Svelte },
  nextGeneration: () => string,
) {
  return {
    signIn(account: Account, generation = nextGeneration()): string {
      const { profile, svelte } = instances()
      profile.syncFromServer(session(account, generation))
      svelte.flushSync()
      return generation
    },

    /**
     * Expires the active session, then the server re-authenticates it with
     * the same generation: the owner key leaves and comes back to its earlier
     * value.
     */
    expireAndReviveSameGeneration(account: Account, generation: string) {
      const { profile, svelte } = instances()
      profile.expireSession(profile.sessionGeneration)
      svelte.flushSync()
      profile.beginSessionRevalidation()
      svelte.flushSync()
      profile.syncFromServer(session(account, generation), {
        sessionGeneration: generation,
        sessionExpired: false,
      })
      svelte.flushSync()
    },
  }
}

/**
 * The accessible name a screen reader computes for `element`, for the cases
 * the notification UI uses: `aria-label` when present, else the text of the
 * descendants not hidden with `aria-hidden="true"`, else `title`.
 */
export function accessibleName(element: Element): string {
  const label = element.getAttribute('aria-label')?.trim()
  if (label) return label
  const visible = element.cloneNode(true) as Element
  for (const hidden of visible.querySelectorAll('[aria-hidden="true"]'))
    hidden.remove()
  const text = visible.textContent?.replace(/\s+/g, ' ').trim()
  if (text) return text
  return element.getAttribute('title')?.trim() ?? ''
}

/**
 * Overrides `document.visibilityState` (an event alone does not change it).
 * `set` changes the state and dispatches `visibilitychange` on `document`;
 * `restore` removes the override so the jsdom getter applies again.
 */
export function controlVisibility(initial: DocumentVisibilityState) {
  let state = initial
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
  return {
    set(next: DocumentVisibilityState) {
      state = next
      document.dispatchEvent(new Event('visibilitychange'))
    },
    restore() {
      Reflect.deleteProperty(document, 'visibilityState')
    },
  }
}

/** One IntersectionObserver the page constructed, as the stub records it. */
export interface StubbedIntersectionObserver {
  /** The `rootMargin` option it was constructed with, as passed. */
  readonly rootMargin: string | undefined
  /** The elements it observes now, in `observe` order. */
  readonly targets: readonly Element[]
  readonly disconnected: boolean
  /** Calls its callback with one entry per observed target. */
  deliver(isIntersecting: boolean): void
}

export interface IntersectionObserverStub {
  /** Every observer constructed since the stub was installed. */
  readonly observers: readonly StubbedIntersectionObserver[]
  /** The observers not disconnected that observe at least one element. */
  observing(): StubbedIntersectionObserver[]
}

/**
 * Replaces the global `IntersectionObserver` (jsdom has none) with a stub
 * that records each observer and calls back only when a test calls
 * `deliver`. `stubGlobal` is the file's `vi.stubGlobal`; remove the stub with
 * `vi.unstubAllGlobals()` in afterEach.
 */
export function installIntersectionObserverStub(
  stubGlobal: (name: string, value: unknown) => unknown,
): IntersectionObserverStub {
  const observers: StubbedIntersectionObserver[] = []

  class StubIntersectionObserver implements IntersectionObserver {
    readonly root = null
    readonly rootMargin: string
    readonly thresholds: readonly number[] = []
    readonly #state: { targets: Element[]; disconnected: boolean }

    constructor(
      callback: IntersectionObserverCallback,
      options?: IntersectionObserverInit,
    ) {
      this.rootMargin = options?.rootMargin ?? '0px'
      const state = { targets: [] as Element[], disconnected: false }
      this.#state = state
      observers.push({
        rootMargin: options?.rootMargin,
        get targets() {
          return state.targets
        },
        get disconnected() {
          return state.disconnected
        },
        deliver: (isIntersecting) =>
          callback(
            state.targets.map(
              (target) =>
                ({
                  target,
                  isIntersecting,
                  intersectionRatio: isIntersecting ? 1 : 0,
                }) as IntersectionObserverEntry,
            ),
            this,
          ),
      })
    }

    observe(target: Element): void {
      if (!this.#state.targets.includes(target))
        this.#state.targets.push(target)
    }

    unobserve(target: Element): void {
      this.#state.targets = this.#state.targets.filter(
        (observed) => observed !== target,
      )
    }

    disconnect(): void {
      this.#state.disconnected = true
      this.#state.targets = []
    }

    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }

  stubGlobal('IntersectionObserver', StubIntersectionObserver)
  return {
    observers,
    observing: () =>
      observers.filter(
        (observer) => !observer.disconnected && observer.targets.length > 0,
      ),
  }
}
