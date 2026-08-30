/**
 * SSR request isolation, observed from outside the process.
 *
 * One Node server renders every request, and several pieces of app state that
 * look per-request in the browser are module-level singletons on the server:
 * the i18n dictionary/locale, and `profile.current`. Each test below holds the
 * server under concurrent load and checks that what a response carries matches
 * what THAT request asked for:
 *
 *   1. language — every response renders in its own `Accept-Language`
 *   2. identity — every response renders the account its own cookie names
 *   3. credentials — every upstream call carries its own request's token
 *
 * The first two read the rendered HTML; the third reads what the mock upstream
 * actually received, which is the only way to catch a render that displays the
 * right account while fetching its data as somebody else.
 *
 * Every test asserts `status === 200` and a home-page marker before any content
 * claim: an upstream failure renders Kit's error page, which contains neither a
 * login string nor a handle, and would otherwise satisfy every "must not
 * contain the other one" assertion by accident.
 */
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import {
  MOCK_ACCOUNTS,
  UNKNOWN_PATHS_PATH,
  XRPC_LOG_PATH,
  type XrpcRequest,
} from './mock-upstream'

/** `src/lib/feature/filter/FeedTabs.svelte` — rendered only by `/`, never by `+error.svelte`. */
const PAGE_MARKER = 'aria-label="Feed"'

/** `account.login` from `src/lib/app/state/i18n/{de,fr,en}.json`, as rendered by the Sidebar. */
const LOGIN = { de: 'Anmelden', fr: 'Connexion', en: 'Log in' } as const

const baseUrl = inject('ssrBaseUrl')
const mockUpstreamUrl = inject('mockUpstreamUrl')
const xrpcLogUrl = `${mockUpstreamUrl}${XRPC_LOG_PATH}`
const unknownPathsUrl = `${mockUpstreamUrl}${UNKNOWN_PATHS_PATH}`

/**
 * The three kinds of request every identity test fires: two different signed-in
 * readers and one anonymous one.
 *
 * `hooks.server.ts` treats the session cookie's value as the sealed token and
 * puts it on `locals.auth.authToken`, so the cookie value is also the Bearer
 * value that request's upstream calls should carry.
 */
const IDENTITIES = ['a', 'b', null] as const
type Identity = (typeof IDENTITIES)[number]

const headersFor = (identity: Identity): Record<string, string> =>
  identity === null ? {} : { Cookie: `coves_session=${identity}` }

const handleOf = (identity: Identity): string | null =>
  identity === null ? null : MOCK_ACCOUNTS[identity].handle

/** Every handle the upstream could possibly return. */
const ALL_HANDLES = Object.values(MOCK_ACCOUNTS).map((a) => a.handle)

/**
 * The markup a reader sees, with `<script>` blocks removed.
 *
 * Kit inlines the server `load` payload into a `<script>` — including the
 * session, handle and all. That is data the page was given, not something it
 * rendered; asserting over it would pass while the visible page still said
 * "Log in".
 */
function renderedMarkup(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
}

interface Rendered {
  readonly status: number
  readonly markup: string
}

async function getHome(headers: Record<string, string>): Promise<Rendered> {
  const res = await fetch(`${baseUrl}/`, { headers })
  return { status: res.status, markup: renderedMarkup(await res.text()) }
}

/** Which locale a response actually rendered in, by the login string it shows. */
function renderedLocale(markup: string): 'de' | 'fr' | 'en' | 'none' {
  if (markup.includes(LOGIN.de)) return 'de'
  if (markup.includes(LOGIN.fr)) return 'fr'
  if (markup.includes(LOGIN.en)) return 'en'
  return 'none'
}

function tally(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = { de: 0, fr: 0, en: 0, none: 0 }
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

/** Empties both upstream logs so a test counts only its own traffic. */
async function resetUpstreamLogs(): Promise<void> {
  const [xrpc, unknown] = await Promise.all([
    fetch(xrpcLogUrl, { method: 'DELETE' }),
    fetch(unknownPathsUrl, { method: 'DELETE' }),
  ])
  expect([xrpc.status, unknown.status]).toEqual([200, 200])
}

/** Paths the upstream did not recognise since the last reset. */
async function readUnknownPaths(): Promise<string[]> {
  const res = await fetch(unknownPathsUrl)
  expect(res.status).toBe(200)
  return ((await res.json()) as { paths: string[] }).paths
}

/**
 * Fires `perIdentity` requests as each of the three identities, all in flight
 * together and interleaved, and returns each response tagged with who asked.
 */
async function renderAll(
  perIdentity: number,
): Promise<{ identity: Identity; status: number; markup: string }[]> {
  const plan: Identity[] = []
  for (let i = 0; i < perIdentity; i++) plan.push(...IDENTITIES)
  return Promise.all(
    plan.map(async (identity) => ({
      identity,
      ...(await getHome(headersFor(identity))),
    })),
  )
}

/** Every XRPC call the upstream has seen since the last reset. */
async function readXrpcLog(): Promise<XrpcRequest[]> {
  const res = await fetch(xrpcLogUrl)
  expect(res.status).toBe(200)
  const body = (await res.json()) as { requests: XrpcRequest[] }
  return body.requests
}

beforeEach(async () => {
  await resetUpstreamLogs()
})

afterEach(async () => {
  // A page that grew a new upstream call would otherwise show up as a mystery
  // 500 or a silently missing assertion; name it instead.
  expect(await readUnknownPaths()).toEqual([])
})

describe('SSR request isolation', () => {
  it('renders each concurrent request in its own Accept-Language', async () => {
    const PAIRS = 50
    const langs: ('de' | 'fr')[] = []
    for (let i = 0; i < PAIRS; i++) langs.push('de', 'fr')

    // All 100 in flight together — the bleed only shows while requests overlap.
    const responses = await Promise.all(
      langs.map(async (lang) => ({
        lang,
        ...(await getHome({ 'Accept-Language': lang })),
      })),
    )

    expect({
      total: responses.length,
      nonOk: responses.filter((r) => r.status !== 200).length,
      missingPageMarker: responses.filter(
        (r) => !r.markup.includes(PAGE_MARKER),
      ).length,
    }).toEqual({ total: 2 * PAIRS, nonOk: 0, missingPageMarker: 0 })

    // Reads as: of the 50 `de` requests, how many rendered in each language.
    expect({
      de: tally(
        responses
          .filter((r) => r.lang === 'de')
          .map((r) => renderedLocale(r.markup)),
      ),
      fr: tally(
        responses
          .filter((r) => r.lang === 'fr')
          .map((r) => renderedLocale(r.markup)),
      ),
    }).toEqual({
      de: { de: PAIRS, fr: 0, en: 0, none: 0 },
      fr: { de: 0, fr: PAIRS, en: 0, none: 0 },
    })
  })

  it('renders each concurrent request against its own session', async () => {
    const EACH = 10
    const responses = await renderAll(EACH)

    expect({
      total: responses.length,
      nonOk: responses.filter((r) => r.status !== 200).length,
      missingPageMarker: responses.filter(
        (r) => !r.markup.includes(PAGE_MARKER),
      ).length,
    }).toEqual({
      total: EACH * IDENTITIES.length,
      nonOk: 0,
      missingPageMarker: 0,
    })

    // Two signed-in identities rather than one: with a single account, "every
    // authenticated response shows mari.test" is equally satisfied by a
    // process-wide profile that happens to hold the only account there is.
    // Each response must show its OWN handle and neither of the others.
    const rendered = responses.map((r) => ({
      asked: handleOf(r.identity),
      shown: ALL_HANDLES.filter((handle) => r.markup.includes(handle)),
      showsLogin: r.markup.includes(LOGIN.en),
    }))

    const wrongHandle = rendered.filter((r) =>
      r.asked === null
        ? r.shown.length > 0
        : r.shown.length !== 1 || r.shown[0] !== r.asked,
    )
    const wrongLoginState = rendered.filter(
      (r) => r.showsLogin !== (r.asked === null),
    )

    expect({ wrongHandle, wrongLoginState }).toEqual({
      wrongHandle: [],
      wrongLoginState: [],
    })
  })

  it('sends each render its own token upstream, and anonymous renders none', async () => {
    // Read at the far end of the wire. The two tests above prove the rendered
    // HTML is right; this proves the OUTBOUND call carries the right
    // credentials. A render that displayed the correct handle while fetching
    // the feed as somebody else would satisfy both of them and fail here.
    const EACH = 10
    const responses = await renderAll(EACH)

    expect({
      total: responses.length,
      nonOk: responses.filter((r) => r.status !== 200).length,
      missingPageMarker: responses.filter(
        (r) => !r.markup.includes(PAGE_MARKER),
      ).length,
    }).toEqual({
      total: EACH * IDENTITIES.length,
      nonOk: 0,
      missingPageMarker: 0,
    })

    const upstream = await readXrpcLog()

    // An exact partition: every call is accounted for, each token appears
    // exactly as often as the identity that owns it made requests, and no
    // other credential was ever sent. `total` pins one call per render, so a
    // count cannot be reached by one identity calling twice.
    const tokens: Record<string, number> = {}
    for (const call of upstream) {
      const key = call.authorization ?? 'none'
      tokens[key] = (tokens[key] ?? 0) + 1
    }

    expect({
      total: upstream.length,
      tokens,
      distinctPaths: [...new Set(upstream.map((r) => r.path))],
    }).toEqual({
      total: EACH * IDENTITIES.length,
      tokens: { 'Bearer a': EACH, 'Bearer b': EACH, none: EACH },
      distinctPaths: ['/xrpc/social.coves.feed.getDiscover'],
    })
  })
})
