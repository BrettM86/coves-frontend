// @vitest-environment jsdom
import { get } from 'svelte/store'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest'
import {
  alice,
  bob,
  controlVisibility,
  createGenerationFactory,
  createNotificationFetch,
  createSessionActions,
  json,
  session,
  settle,
  storedProfileData,
} from './notification-test-harness'
import type { NotificationList } from './list.svelte'
import type { NotificationRow } from './rows'
import type { UnreadNotificationStore } from './unread.svelte'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$lib/app/state/instance/env', () => ({
  DEFAULT_INSTANCE_URL: 'http://localhost:8081',
  LINKED_INSTANCE_URL: undefined,
}))
vi.mock('$app/navigation', () => ({
  invalidate: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
  goto: vi.fn(),
  afterNavigate: vi.fn(),
  beforeNavigate: vi.fn(),
}))
vi.mock('$app/state', () => ({
  page: {
    url: new URL('http://localhost/'),
    data: {},
    params: {},
    route: { id: null },
    status: 200,
    state: {},
  },
  navigating: { to: null },
}))
const svelteClientEntry = async (subpath: string): Promise<unknown> => {
  const { createRequire } = await import('node:module')
  const require_ = createRequire(import.meta.url)
  return await import(
    /* @vite-ignore */
    require_.resolve('svelte/package.json').replace('package.json', subpath)
  )
}
vi.mock('svelte', () => svelteClientEntry('src/index-client.js'))
vi.mock('svelte/reactivity', () =>
  svelteClientEntry('src/reactivity/index-client.js'),
)
// Observed, not exercised: log.test.ts owns what the helper writes.
const notificationLog = vi.hoisted(() => ({
  logNotificationFailure: vi.fn<(nsid: string, error: unknown) => void>(),
}))
vi.mock('$lib/feature/notification/log', () => notificationLog)

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const nextGeneration = createGenerationFactory('list-generation')

let svelte: typeof import('svelte')
let profile: (typeof import('$lib/app/state/auth.svelte'))['profile']
let createNotificationList: (typeof import('./list.svelte'))['createNotificationList']
let list: NotificationList | undefined
/** Every profile instance imported in this file; each one's effect is disposed. */
const profiles = new Set<typeof profile>()

const notificationFetch = createNotificationFetch()
const requests = notificationFetch.requests
const { signIn, expireAndReviveSameGeneration } = createSessionActions(
  () => ({ profile, svelte }),
  nextGeneration,
)

const fetchSpy = vi.fn<typeof fetch>()

const listNotificationsNsid = 'social.coves.notification.listNotifications'
const listNotificationsPath =
  /\/xrpc\/social\.coves\.notification\.listNotifications(\?|$)/

/** Imports svelte, the profile and the list factory from the current module registry. */
async function importInstances() {
  svelte = await import('svelte')
  profile = (await import('$lib/app/state/auth.svelte')).profile
  profiles.add(profile)
  createNotificationList = (await import('./list.svelte'))
    .createNotificationList
}

function createList(): NotificationList {
  const created = createNotificationList()
  list = created
  svelte.flushSync()
  return created
}

/** Every GET listNotifications the fetch spy has seen, in send order. */
const listGets = () =>
  requests.filter(
    (request) =>
      request.method === 'GET' && listNotificationsPath.test(request.path),
  )

/** The literal URI that names a row: the reply's record, the upvote's subject. */
const rowUri = (row: NotificationRow) =>
  row.reason === 'upvote' ? row.subject.uri : row.record.uri

// ---------------------------------------------------------------------------
// Wire fixtures: plain JSON rows as the server sends them.
// ---------------------------------------------------------------------------

const replyRow = {
  reason: 'postReply',
  sortAt: '2026-10-12T09:15:30.123456789Z',
  isRead: false,
  rootPost: {
    uri: 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/social.coves.community.post/3kpostreply1',
    cid: 'bafyreibrootreply1cid',
    title: 'Tomato blight',
    community: { did: 'did:plc:gardening', name: 'gardening' },
  },
  record: {
    uri: 'at://did:plc:replier1/social.coves.community.comment/3kcommentreply1',
    cid: 'bafyreibrecordreply1cid',
    excerpt: 'Try copper spray',
    createdAt: '2026-10-12T09:15:29.000Z',
  },
  author: {
    did: 'did:plc:replier1',
    handle: 'replier1.local.coves.dev',
    displayName: 'Replier One',
  },
}

const upvoteRow = {
  reason: 'upvote',
  sortAt: '2026-10-12T08:00:00.000000001Z',
  isRead: true,
  rootPost: {
    uri: 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/social.coves.community.post/3kpostupvote1',
    cid: 'bafyreibrootupvote1cid',
    title: 'Seed swap',
  },
  subject: {
    uri: 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/social.coves.community.post/3kpostupvote1',
    cid: 'bafyreibrootupvote1cid',
    preview: 'Seed swap',
  },
  upvoteCount: 7,
  recentUpvoters: [{ did: 'did:plc:voter1', handle: 'voter1.local.coves.dev' }],
}

/** A reason this client does not know: the list must skip it. */
const invalidRow = {
  reason: 'follow',
  sortAt: '2026-10-12T08:30:00.000Z',
  isRead: false,
  rootPost: {
    uri: 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/social.coves.community.post/3kpostinvalid1',
    cid: 'bafyreibrootinvalid1cid',
  },
}

/** A reply row whose record has no uri: the list must skip it. */
const invalidReplyRow = {
  ...replyRow,
  record: { cid: 'bafyreibrecordbroken1cid', excerpt: 'Broken' },
}

beforeEach(async () => {
  localStorage.clear()
  vi.stubGlobal('__VERSION__', 'test')
  fetchSpy.mockReset().mockImplementation(notificationFetch.handle)
  vi.stubGlobal('fetch', fetchSpy)
  notificationLog.logNotificationFailure.mockReset()
  notificationFetch.reset()
  list = undefined
  await importInstances()
  profile.syncFromServer(undefined)
  svelte.flushSync()
})

afterEach(() => {
  list?.destroy()
  svelte.flushSync()
  expect(notificationFetch.unexpectedUrls).toEqual([])
})

afterAll(() => {
  for (const instance of profiles) instance.mainEffect()
})

// ---------------------------------------------------------------------------
// Page one on a fresh entry
// ---------------------------------------------------------------------------

describe('notification list page one on a fresh entry', () => {
  it('sends one GET without limit or cursor, is loading until it resolves, then shows the valid rows in server order with the raw cursor and seenAt', async () => {
    signIn(alice)
    const notifications = createList()
    await settle(svelte)

    const gets = listGets()
    expect(gets, 'exactly one GET listNotifications').toHaveLength(1)
    expect(requests, 'no other notification request').toHaveLength(1)
    expect(gets[0].searchParams.has('limit'), 'no limit in the query').toBe(
      false,
    )
    expect(gets[0].searchParams.has('cursor'), 'no cursor in the query').toBe(
      false,
    )
    expect(notifications.status).toBe('loading')

    gets[0].resolve(
      json(200, {
        notifications: [replyRow, invalidRow, upvoteRow],
        cursor: 'cursor-page-two-9f3k',
        seenAt: '2026-10-12T09:15:30.123456789Z',
      }),
    )
    await settle(svelte)

    expect(notifications.status).toBe('ready')
    expect(notifications.rows.map(rowUri)).toEqual([
      'at://did:plc:replier1/social.coves.community.comment/3kcommentreply1',
      'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/social.coves.community.post/3kpostupvote1',
    ])
    expect(notifications.cursor).toBe('cursor-page-two-9f3k')
    expect(notifications.seenAt).toBe('2026-10-12T09:15:30.123456789Z')
    expect(listGets(), 'no further GET').toHaveLength(1)
  })

  it.each([
    { page: 'no notifications', notifications: [] },
    {
      page: 'only invalid rows',
      notifications: [invalidRow, invalidReplyRow],
    },
  ])(
    'is empty with no rows when page one has $page',
    async ({ notifications: wireRows }) => {
      signIn(alice)
      notificationFetch.answer = (request) =>
        request.resolve(
          json(200, {
            notifications: wireRows,
            seenAt: '2026-10-12T09:15:30.123456789Z',
          }),
        )
      const notifications = createList()
      await settle(svelte)

      expect(notifications.status).toBe('empty')
      expect(notifications.rows).toEqual([])
    },
  )

  it.each([
    {
      failure: 'a 500',
      answer: (request: { resolve(response: Response): void }) =>
        request.resolve(json(500, { error: 'InternalServerError' })),
    },
    {
      failure: 'a network rejection',
      answer: (request: { reject(error: unknown): void }) =>
        request.reject(new TypeError('Failed to fetch')),
    },
  ])(
    'is in error and logs the failure when page one fails with $failure',
    async ({ answer }) => {
      signIn(alice)
      notificationFetch.answer = answer
      const notifications = createList()
      await settle(svelte)

      expect(notifications.status).toBe('error')
      expect(notifications.rows).toEqual([])
      expect(
        notificationLog.logNotificationFailure.mock.calls.map(([nsid]) => nsid),
      ).toEqual([listNotificationsNsid])
    },
  )

  it('is in error and logs one non-XRPC failure when page one answers 200 with a null body', async () => {
    const { XrpcError } = await import('$lib/api/coves')
    signIn(alice)
    notificationFetch.answer = (request) => request.resolve(json(200, null))
    const notifications = createList()
    await settle(svelte)

    expect(notifications.status).toBe('error')
    expect(notifications.rows).toEqual([])
    const calls = notificationLog.logNotificationFailure.mock.calls
    expect(calls.map(([nsid]) => nsid)).toEqual([listNotificationsNsid])
    expect(calls[0][1]).not.toBeInstanceOf(XrpcError)
  })

  it('takes a cursor or seenAt that is not a string as undefined', async () => {
    signIn(alice)
    notificationFetch.answer = (request) =>
      request.resolve(
        json(200, {
          notifications: [replyRow],
          cursor: 42,
          seenAt: { at: '2026-10-12T09:15:30.123456789Z' },
        }),
      )
    const notifications = createList()
    await settle(svelte)

    expect(notifications.status).toBe('ready')
    expect(notifications.rows.map(rowUri)).toEqual([
      'at://did:plc:replier1/social.coves.community.comment/3kcommentreply1',
    ])
    expect(notifications.cursor).toBeUndefined()
    expect(notifications.seenAt).toBeUndefined()
  })

  it('keeps only the first of two rows with the same identity, in position', async () => {
    signIn(alice)
    notificationFetch.answer = (request) =>
      request.resolve(
        json(200, {
          notifications: [
            upvoteRow,
            replyRow,
            {
              ...upvoteRow,
              sortAt: '2026-10-12T07:00:00.000Z',
              upvoteCount: 3,
            },
          ],
        }),
      )
    const notifications = createList()
    await settle(svelte)

    expect(
      notifications.rows.map((row) => [rowUri(row), row.upvoteCount]),
    ).toEqual([
      [
        'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/social.coves.community.post/3kpostupvote1',
        7,
      ],
      [
        'at://did:plc:replier1/social.coves.community.comment/3kcommentreply1',
        undefined,
      ],
    ])
  })
})

// ---------------------------------------------------------------------------
// Created without a usable session
// ---------------------------------------------------------------------------

describe.each([
  { state: 'signed out', arrange: () => {} },
  {
    state: 'the session has expired',
    arrange: () => {
      signIn(alice)
      profile.expireSession(profile.sessionGeneration)
      svelte.flushSync()
    },
  },
])('notification list created while $state', ({ arrange }) => {
  it('sends nothing and stays idle with no rows, cursor or seenAt', async () => {
    arrange()
    const notifications = createList()
    await settle(svelte)

    expect(requests).toEqual([])
    expect(notifications.status).toBe('idle')
    expect(notifications.rows).toEqual([])
    expect(notifications.cursor).toBeUndefined()
    expect(notifications.seenAt).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Owner transitions: fixtures and helpers
// ---------------------------------------------------------------------------

/** Alice's page one: a reply and an upvote, a cursor and the raw seenAt. */
const alicePageOne = () =>
  json(200, {
    notifications: [replyRow, upvoteRow],
    cursor: 'cursor-page-two-9f3k',
    seenAt: '2026-10-12T09:15:30.123456789Z',
  })

const alicePageOneUris = [
  'at://did:plc:replier1/social.coves.community.comment/3kcommentreply1',
  'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/social.coves.community.post/3kpostupvote1',
]

/** The identity of alice's reply row, from its literal fields. */
const aliceReplyIdentity =
  'postReply|at://did:plc:replier1/social.coves.community.comment/3kcommentreply1'

/** A reply that only alice's reloaded page one carries. */
const reloadReplyRow = {
  ...replyRow,
  sortAt: '2026-10-12T10:05:00.000000002Z',
  record: {
    uri: 'at://did:plc:replier1/social.coves.community.comment/3kcommentreload1',
    cid: 'bafyreibrecordreload1cid',
    excerpt: 'Neem oil works too',
    createdAt: '2026-10-12T10:04:59.000Z',
  },
}

const reloadReplyUri =
  'at://did:plc:replier1/social.coves.community.comment/3kcommentreload1'

/** Bob's page one: one reply on his own post. */
const bobPageOne = () =>
  json(200, {
    notifications: [
      {
        ...replyRow,
        sortAt: '2026-10-12T11:00:00.000000003Z',
        rootPost: {
          uri: 'at://did:plc:bbbbbbbbbbbbbbbbbbbbbbbb/social.coves.community.post/3kpostbob1',
          cid: 'bafyreibrootbob1cid',
          title: 'Compost ratios',
          community: { did: 'did:plc:gardening', name: 'gardening' },
        },
        record: {
          uri: 'at://did:plc:replier2/social.coves.community.comment/3kcommentbob1',
          cid: 'bafyreibrecordbob1cid',
          excerpt: 'Three to one',
          createdAt: '2026-10-12T10:59:59.000Z',
        },
        author: {
          did: 'did:plc:replier2',
          handle: 'replier2.local.coves.dev',
          displayName: 'Replier Two',
        },
      },
    ],
    cursor: 'cursor-bob-page-two-7h2m',
    seenAt: '2026-10-12T07:45:00.500000000-04:00',
  })

type HeldRequest = (typeof requests)[number]

const failingAnswers = {
  500: {
    response: 'a 500',
    answer: (request: HeldRequest) =>
      request.resolve(json(500, { error: 'InternalServerError' })),
  },
  network: {
    response: 'a network rejection',
    answer: (request: HeldRequest) =>
      request.reject(new TypeError('Failed to fetch')),
  },
}

const successAnswer = {
  response: "alice's page one",
  answer: (request: HeldRequest) => request.resolve(alicePageOne()),
}

const loggedNsids = () =>
  notificationLog.logNotificationFailure.mock.calls.map(([nsid]) => nsid)

/**
 * Signs alice in (under `generation`), creates the list, answers its page one
 * and reveals alice's reply.
 */
async function alicePageOneShown(
  generation = nextGeneration(),
): Promise<NotificationList> {
  signIn(alice, generation)
  notificationFetch.answer = (request) => request.resolve(alicePageOne())
  const notifications = createList()
  await settle(svelte)
  notificationFetch.answer = undefined
  notifications.reveal(aliceReplyIdentity)
  svelte.flushSync()
  expect(
    notifications.rows.map(rowUri),
    "precondition: alice's page one is shown",
  ).toEqual(alicePageOneUris)
  expect(
    notifications.isRevealed(aliceReplyIdentity),
    "precondition: alice's reply is revealed",
  ).toBe(true)
  return notifications
}

/** Signs alice in (under `generation`), creates the list and holds its page-one GET. */
async function alicePageOneInFlight(generation = nextGeneration()) {
  signIn(alice, generation)
  const notifications = createList()
  await settle(svelte)
  const gets = listGets()
  expect(gets, "precondition: alice's page-one GET is in flight").toHaveLength(
    1,
  )
  return { notifications, aliceGet: gets[0] }
}

/** Alice's page one, its cursor, its seenAt and her revealed reply are all still there. */
function expectAlicePageOneKept(notifications: NotificationList) {
  expect(notifications.rows.map(rowUri)).toEqual(alicePageOneUris)
  expect(notifications.cursor).toBe('cursor-page-two-9f3k')
  expect(notifications.seenAt).toBe('2026-10-12T09:15:30.123456789Z')
  expect(notifications.isRevealed(aliceReplyIdentity)).toBe(true)
}

/** No rows, cursor or seenAt were written. */
function expectNothingApplied(notifications: NotificationList) {
  expect(notifications.rows).toEqual([])
  expect(notifications.cursor).toBeUndefined()
  expect(notifications.seenAt).toBeUndefined()
}

// ---------------------------------------------------------------------------
// Expiry with a page shown
// ---------------------------------------------------------------------------

describe('notification list when the session expires with page one shown', () => {
  it.each([
    { after: 'nothing else', act: () => {} },
    {
      after: 'retry()',
      act: (notifications: NotificationList) => notifications.retry(),
    },
    {
      after: 'beginSessionRevalidation() alone',
      act: () => profile.beginSessionRevalidation(),
    },
  ])(
    'keeps the rows, cursor, seenAt and revealed identity, stays ready and sends nothing after $after',
    async ({ act }) => {
      const notifications = await alicePageOneShown()

      profile.expireSession(profile.sessionGeneration)
      svelte.flushSync()
      act(notifications)
      svelte.flushSync()
      await settle(svelte)

      expect(requests, 'no request after the first page one').toHaveLength(1)
      expectAlicePageOneKept(notifications)
      expect(notifications.status).toBe('ready')
    },
  )

  it.each([
    {
      pageOne: 'failed',
      before: 'error',
      answer: (request: HeldRequest) =>
        request.resolve(json(500, { error: 'InternalServerError' })),
    },
    {
      pageOne: 'was empty',
      before: 'empty',
      answer: (request: HeldRequest) =>
        request.resolve(json(200, { notifications: [] })),
    },
  ])(
    'goes idle with no rows and sends nothing when page one $pageOne',
    async ({ before, answer }) => {
      signIn(alice)
      notificationFetch.answer = answer
      const notifications = createList()
      await settle(svelte)
      notificationFetch.answer = undefined
      expect(notifications.status, `precondition: ${before}`).toBe(before)

      profile.expireSession(profile.sessionGeneration)
      svelte.flushSync()
      await settle(svelte)

      expect(notifications.status).toBe('idle')
      expect(notifications.rows).toEqual([])
      expect(requests, 'no request after the first page one').toHaveLength(1)
    },
  )
})

// ---------------------------------------------------------------------------
// Stale page one
// ---------------------------------------------------------------------------

describe('notification list discarding a page one that arrives after the list generation moved', () => {
  it.each([successAnswer, failingAnswers[500], failingAnswers.network])(
    'drops $response that arrives after the session expired: idle, nothing written, nothing logged',
    async ({ answer }) => {
      const { notifications, aliceGet } = await alicePageOneInFlight()

      profile.expireSession(profile.sessionGeneration)
      svelte.flushSync()
      answer(aliceGet)
      await settle(svelte)

      expectNothingApplied(notifications)
      expect(notifications.status).toBe('idle')
      expect(loggedNsids()).toEqual([])
      expect(listGets()).toHaveLength(1)
    },
  )

  it('drops a page one answered with a 401, which expires the session: idle, nothing written, nothing logged', async () => {
    const { notifications, aliceGet } = await alicePageOneInFlight()

    aliceGet.resolve(json(401, { error: 'AuthenticationRequired' }))
    await settle(svelte)

    expect(
      profile.sessionExpired,
      'precondition: the 401 expired the session',
    ).toBe(true)
    expectNothingApplied(notifications)
    expect(notifications.status).toBe('idle')
    expect(loggedNsids()).toEqual([])
    expect(listGets()).toHaveLength(1)
  })

  describe.each([successAnswer, failingAnswers[500]])(
    'after a same-generation revival, with $response for the stale page one',
    ({ answer }) => {
      /** Alice's GET in flight, then expiry and revival; returns both GETs. */
      async function revivedWithStaleGetInFlight() {
        const generation = nextGeneration()
        const { notifications, aliceGet } =
          await alicePageOneInFlight(generation)
        expireAndReviveSameGeneration(alice, generation)
        await settle(svelte)
        const gets = listGets()
        expect(gets, 'precondition: the owner reload is sent').toHaveLength(2)
        return { notifications, aliceGet, reloadGet: gets[1] }
      }

      const reloadPageOne = () =>
        json(200, {
          notifications: [reloadReplyRow],
          cursor: 'cursor-reload-4n8q',
          seenAt: '2026-10-12T12:05:00.000000002+02:00',
        })

      function expectOnlyReloadApplied(notifications: NotificationList) {
        expect(notifications.rows.map(rowUri)).toEqual([reloadReplyUri])
        expect(notifications.cursor).toBe('cursor-reload-4n8q')
        expect(notifications.seenAt).toBe('2026-10-12T12:05:00.000000002+02:00')
        expect(notifications.status).toBe('ready')
        expect(loggedNsids()).toEqual([])
        expect(listGets()).toHaveLength(2)
      }

      it('applies nothing when the stale response arrives first, then only the owner reload', async () => {
        const { notifications, aliceGet, reloadGet } =
          await revivedWithStaleGetInFlight()

        answer(aliceGet)
        await settle(svelte)

        expectNothingApplied(notifications)
        expect(loggedNsids()).toEqual([])

        reloadGet.resolve(reloadPageOne())
        await settle(svelte)

        expectOnlyReloadApplied(notifications)
      })

      it('keeps the owner reload when the stale response arrives after it', async () => {
        const { notifications, aliceGet, reloadGet } =
          await revivedWithStaleGetInFlight()

        reloadGet.resolve(reloadPageOne())
        await settle(svelte)
        answer(aliceGet)
        await settle(svelte)

        expectOnlyReloadApplied(notifications)
      })
    },
  )

  it.each([successAnswer, failingAnswers[500]])(
    'applies nothing from $response that arrives after destroy(), and later session transitions send nothing',
    async ({ answer }) => {
      const { notifications, aliceGet } = await alicePageOneInFlight()

      notifications.destroy()
      list = undefined
      svelte.flushSync()
      answer(aliceGet)
      await settle(svelte)

      expectNothingApplied(notifications)
      expect(loggedNsids()).toEqual([])

      profile.expireSession(profile.sessionGeneration)
      svelte.flushSync()
      signIn(alice)
      signIn(bob)
      await settle(svelte)

      expect(listGets()).toHaveLength(1)
    },
  )
})

// ---------------------------------------------------------------------------
// Owner reload
// ---------------------------------------------------------------------------

describe.each([
  {
    transition: 'alice signs in again with a new generation after expiry',
    act: () => {
      profile.expireSession(profile.sessionGeneration)
      svelte.flushSync()
      signIn(alice)
    },
  },
  {
    transition: 'the expired session is revived with the same generation',
    act: (generation: string) =>
      expireAndReviveSameGeneration(alice, generation),
  },
  {
    transition: "alice's generation changes while she stays signed in",
    act: () => {
      signIn(alice)
    },
  },
])('notification list with page one shown when $transition', ({ act }) => {
  it('sends exactly one page-one GET, keeps the shown page while it is in flight, then replaces it, takes the omitted cursor and seenAt as undefined and keeps the revealed identity', async () => {
    const generation = nextGeneration()
    const notifications = await alicePageOneShown(generation)

    act(generation)
    await settle(svelte)

    const gets = listGets()
    expect(gets, 'exactly one more page-one GET').toHaveLength(2)
    expect(requests, 'no other notification request').toHaveLength(2)
    expect(gets[1].searchParams.has('cursor'), 'no cursor in the query').toBe(
      false,
    )
    expect(gets[1].searchParams.has('limit'), 'no limit in the query').toBe(
      false,
    )
    expect(notifications.rows.map(rowUri)).toEqual(alicePageOneUris)
    expect(notifications.cursor).toBe('cursor-page-two-9f3k')
    expect(notifications.seenAt).toBe('2026-10-12T09:15:30.123456789Z')

    gets[1].resolve(json(200, { notifications: [reloadReplyRow, replyRow] }))
    await settle(svelte)

    expect(notifications.rows.map(rowUri)).toEqual([
      reloadReplyUri,
      'at://did:plc:replier1/social.coves.community.comment/3kcommentreply1',
    ])
    expect(notifications.cursor).toBeUndefined()
    expect(notifications.seenAt).toBeUndefined()
    expect(notifications.isRevealed(aliceReplyIdentity)).toBe(true)
    expect(notifications.status).toBe('ready')
    expect(listGets(), 'no further GET').toHaveLength(2)
  })
})

describe('notification list owner reload failure', () => {
  it('keeps the rows, cursor, seenAt and revealed identity, stays ready and logs the failure when the owner reload answers 500', async () => {
    const notifications = await alicePageOneShown()

    profile.expireSession(profile.sessionGeneration)
    svelte.flushSync()
    signIn(alice)
    await settle(svelte)
    const gets = listGets()
    expect(gets, 'precondition: the owner reload is sent').toHaveLength(2)

    gets[1].resolve(json(500, { error: 'InternalServerError' }))
    await settle(svelte)

    expectAlicePageOneKept(notifications)
    expect(notifications.status).toBe('ready')
    expect(loggedNsids()).toEqual([listNotificationsNsid])
  })
})

describe('notification list created before its owner is known', () => {
  it.each([
    {
      creation: 'while the session is expired, then alice signs in',
      arrange: async () => {
        signIn(alice)
        profile.expireSession(profile.sessionGeneration)
        svelte.flushSync()
        createList()
        await settle(svelte)
        expect(requests, 'nothing is sent while expired').toEqual([])

        signIn(alice)
      },
    },
    {
      creation:
        'on a hard-load restore before the session generation is known, then the sync sets it',
      arrange: async () => {
        localStorage.setItem('profileData', storedProfileData(alice))
        vi.resetModules()
        // `vi.resetModules()` keeps a mock factory's cached result, so the
        // hoisted svelte mocks would hand back the previous runtime while
        // fresh modules load a new `svelte/internal/client`. Re-register them.
        vi.doMock('svelte', () => svelteClientEntry('src/index-client.js'))
        vi.doMock('svelte/reactivity', () =>
          svelteClientEntry('src/reactivity/index-client.js'),
        )
        await importInstances()
        expect(
          profile.isAuthenticated,
          'precondition: restored signed in',
        ).toBe(true)
        expect(
          profile.sessionGeneration,
          'precondition: no generation yet',
        ).toBeUndefined()
        createList()
        await settle(svelte)
        expect(requests, 'nothing is sent before the session sync').toEqual([])

        // What the root layout's effect does once its data arrives.
        profile.syncFromServer(session(alice, nextGeneration()))
        svelte.flushSync()
      },
    },
  ])(
    'sends exactly one page-one GET and shows its rows when created $creation',
    async ({ arrange }) => {
      await arrange()
      await settle(svelte)

      const gets = listGets()
      expect(gets, 'exactly one GET listNotifications').toHaveLength(1)

      gets[0].resolve(alicePageOne())
      await settle(svelte)

      expect(list?.rows.map(rowUri)).toEqual(alicePageOneUris)
      expect(list?.cursor).toBe('cursor-page-two-9f3k')
      expect(list?.seenAt).toBe('2026-10-12T09:15:30.123456789Z')
      expect(list?.status).toBe('ready')
      expect(listGets(), 'no further GET').toHaveLength(1)
    },
  )
})

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

describe('notification list when alice logs out', () => {
  it('clears the rows, cursor, seenAt and revealed identity at once, goes idle and sends nothing', async () => {
    const notifications = await alicePageOneShown()

    await profile.remove(profile.current.id)
    svelte.flushSync()

    expect(profile.isAuthenticated, 'precondition: signed out').toBe(false)
    expect(notifications.rows).toEqual([])
    expect(notifications.cursor).toBeUndefined()
    expect(notifications.seenAt).toBeUndefined()
    expect(notifications.isRevealed(aliceReplyIdentity)).toBe(false)
    expect(notifications.status).toBe('idle')

    await settle(svelte)

    expect(listGets(), 'no GET after the first page one').toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Account change
// ---------------------------------------------------------------------------

describe('notification list when bob signs in in place of alice', () => {
  const bobUris = [
    'at://did:plc:replier2/social.coves.community.comment/3kcommentbob1',
  ]

  /** Bob's GET is the only one after alice's; it shows his page when answered. */
  async function expectBobPageOneShown(
    notifications: NotificationList,
    bobGet: HeldRequest,
  ) {
    bobGet.resolve(bobPageOne())
    await settle(svelte)

    expect(notifications.rows.map(rowUri)).toEqual(bobUris)
    expect(notifications.cursor).toBe('cursor-bob-page-two-7h2m')
    expect(notifications.seenAt).toBe('2026-10-12T07:45:00.500000000-04:00')
    expect(notifications.status).toBe('ready')
    expect(listGets(), 'no further GET').toHaveLength(2)
  }

  function expectCleared(notifications: NotificationList) {
    expectNothingApplied(notifications)
    expect(notifications.isRevealed(aliceReplyIdentity)).toBe(false)
  }

  it("clears alice's shown page and revealed identity at once, then sends one page-one GET for bob and shows his rows", async () => {
    const notifications = await alicePageOneShown()

    signIn(bob)

    expectCleared(notifications)

    await settle(svelte)
    const gets = listGets()
    expect(gets, 'exactly one page-one GET for bob').toHaveLength(2)
    expect(gets[1].searchParams.has('cursor'), 'no cursor in the query').toBe(
      false,
    )
    expect(notifications.status).toBe('loading')

    await expectBobPageOneShown(notifications, gets[1])
  })

  it("never applies alice's page one that arrives after bob's GET is sent, and shows bob's rows", async () => {
    const { notifications, aliceGet } = await alicePageOneInFlight()

    signIn(bob)

    expectCleared(notifications)

    await settle(svelte)
    const gets = listGets()
    expect(gets, 'exactly one page-one GET for bob').toHaveLength(2)

    aliceGet.resolve(alicePageOne())
    await settle(svelte)

    expectCleared(notifications)
    expect(notifications.status).toBe('loading')
    expect(loggedNsids()).toEqual([])

    await expectBobPageOneShown(notifications, gets[1])
  })

  describe("after alice's session expired with her page one shown", () => {
    /** Alice's page shown, her session expires, then bob signs in. */
    async function bobSignsInAfterAliceExpired() {
      const notifications = await alicePageOneShown()
      profile.expireSession(profile.sessionGeneration)
      svelte.flushSync()
      expectAlicePageOneKept(notifications)

      signIn(bob)

      expectCleared(notifications)

      await settle(svelte)
      const gets = listGets()
      expect(gets, 'exactly one page-one GET for bob').toHaveLength(2)
      return { notifications, bobGet: gets[1] }
    }

    it("clears alice's page and revealed identity at once, then shows bob's page one", async () => {
      const { notifications, bobGet } = await bobSignsInAfterAliceExpired()

      await expectBobPageOneShown(notifications, bobGet)
    })

    it("is in error with none of alice's rows when bob's page one answers 500", async () => {
      const { notifications, bobGet } = await bobSignsInAfterAliceExpired()

      bobGet.resolve(json(500, { error: 'InternalServerError' }))
      await settle(svelte)

      expectCleared(notifications)
      expect(notifications.status).toBe('error')
      expect(loggedNsids()).toEqual([listNotificationsNsid])
      expect(listGets(), 'no further GET').toHaveLength(2)
    })
  })

  it("clears alice's page at once when bob is adopted before his session generation is known, sends nothing until it arrives, then one page-one GET", async () => {
    const notifications = await alicePageOneShown()

    profile.syncFromServer({
      ...session(bob, nextGeneration()),
      sessionGeneration: undefined,
    })
    svelte.flushSync()

    expect(
      profile.current.type === 'authenticated' && profile.current.did,
      'precondition: bob is adopted',
    ).toBe(bob.did)
    expect(
      profile.sessionGeneration,
      'precondition: no generation yet',
    ).toBeUndefined()
    expectCleared(notifications)
    expect(notifications.status).toBe('idle')

    await settle(svelte)
    expect(listGets(), 'nothing sent without a generation').toHaveLength(1)

    signIn(bob)
    await settle(svelte)

    const gets = listGets()
    expect(gets, 'exactly one page-one GET for bob').toHaveLength(2)
    await expectBobPageOneShown(notifications, gets[1])
  })
})

// ---------------------------------------------------------------------------
// Mark seen
// ---------------------------------------------------------------------------

const updateSeenPath = /\/xrpc\/social\.coves\.notification\.updateSeen$/

/** Every POST updateSeen the fetch spy has seen, in send order. */
const updateSeenPosts = () =>
  requests.filter(
    (request) => request.method === 'POST' && updateSeenPath.test(request.path),
  )

describe('notification list marking page one seen', () => {
  let visibility: ReturnType<typeof controlVisibility>

  beforeEach(() => {
    visibility = controlVisibility('visible')
  })

  afterEach(() => {
    visibility.restore()
  })

  /** Signs alice in, creates the list and marks it mounted, as the component does. */
  async function mountedList(
    generation = nextGeneration(),
  ): Promise<NotificationList> {
    signIn(alice, generation)
    return await mountedListForSignedInAccount()
  }

  /** Creates the list for whoever is signed in and marks it mounted. */
  async function mountedListForSignedInAccount(): Promise<NotificationList> {
    const notifications = createList()
    notifications.setMounted(true)
    svelte.flushSync()
    await settle(svelte)
    expect(listGets(), 'precondition: page one requested').toHaveLength(1)
    return notifications
  }

  /** Hides the document, then shows it again. */
  async function hideThenShow() {
    visibility.set('hidden')
    await settle(svelte)
    visibility.set('visible')
    await settle(svelte)
  }

  it('sends nothing while page one arrives hidden, then one updateSeen with the newest sortAt once the document is visible', async () => {
    visibility.set('hidden')
    const notifications = await mountedList()

    // The upvote is first and older; the reply is newer; the server seenAt is
    // older than both.
    listGets()[0].resolve(
      json(200, {
        notifications: [upvoteRow, replyRow],
        seenAt: '2026-10-11T00:00:00Z',
      }),
    )
    await settle(svelte)
    expect(notifications.status, 'precondition: page one applied').toBe('ready')
    expect(updateSeenPosts(), 'nothing sent while hidden').toHaveLength(0)

    visibility.set('visible')
    await settle(svelte)

    const posts = updateSeenPosts()
    expect(posts, 'one updateSeen once visible').toHaveLength(1)
    expect(posts[0].body).toEqual({
      seenAt: '2026-10-12T09:15:30.123456789Z',
    })
  })

  it.each([
    { page: 'no notifications', notifications: [] },
    {
      page: 'only invalid rows',
      notifications: [invalidRow, invalidReplyRow],
    },
  ])(
    'sends no updateSeen when page one has $page, even after the document becomes visible again',
    async ({ notifications: wireRows }) => {
      const notifications = await mountedList()

      listGets()[0].resolve(
        json(200, {
          notifications: wireRows,
          seenAt: '2026-10-12T09:15:30.123456789Z',
        }),
      )
      await settle(svelte)
      expect(notifications.status, 'precondition: page one applied').toBe(
        'empty',
      )

      await hideThenShow()

      expect(updateSeenPosts()).toEqual([])
    },
  )

  it('sends no updateSeen when no page-one sortAt parses, and stays ready with the rows shown and nothing logged', async () => {
    const notifications = await mountedList()

    listGets()[0].resolve(
      json(200, {
        notifications: [
          { ...replyRow, sortAt: '2026-10-12 10:00:00' },
          { ...upvoteRow, sortAt: '2026-10-12t10:00:00z' },
        ],
        seenAt: '2026-10-12T09:15:30.123456789Z',
      }),
    )
    await settle(svelte)
    await hideThenShow()

    expect(updateSeenPosts()).toEqual([])
    expect(notifications.status).toBe('ready')
    expect(notifications.rows.map(rowUri)).toEqual(alicePageOneUris)
    expect(notificationLog.logNotificationFailure).not.toHaveBeenCalled()
  })

  /** Alice's page one applied while displayed, its one updateSeen sent and answered 200. */
  async function alicePageOneMarked(generation = nextGeneration()) {
    const notifications = await mountedList(generation)
    listGets()[0].resolve(alicePageOne())
    await settle(svelte)
    const posts = updateSeenPosts()
    expect(posts, 'precondition: one updateSeen for page one').toHaveLength(1)
    expect(posts[0].body).toEqual({ seenAt: '2026-10-12T09:15:30.123456789Z' })
    posts[0].resolve(json(200, {}))
    await settle(svelte)
    return notifications
  }

  it('sends no second updateSeen for a marked page one when the document is hidden and shown again', async () => {
    await alicePageOneMarked()

    await hideThenShow()

    expect(updateSeenPosts()).toHaveLength(1)
  })

  it("sends exactly one more updateSeen with the owner reload's newest sortAt when alice's expired session is revived and the reload succeeds while displayed", async () => {
    const generation = nextGeneration()
    const notifications = await alicePageOneMarked(generation)

    expireAndReviveSameGeneration(alice, generation)
    await settle(svelte)
    const gets = listGets()
    expect(gets, 'precondition: the owner reload is sent').toHaveLength(2)
    expect(updateSeenPosts(), 'nothing more before the reload').toHaveLength(1)

    gets[1].resolve(json(200, { notifications: [replyRow, reloadReplyRow] }))
    await settle(svelte)
    expect(
      notifications.rows.map(rowUri),
      'precondition: reload applied',
    ).toEqual([
      'at://did:plc:replier1/social.coves.community.comment/3kcommentreply1',
      reloadReplyUri,
    ])

    expect(updateSeenPosts().map((post) => post.body)).toEqual([
      { seenAt: '2026-10-12T09:15:30.123456789Z' },
      { seenAt: '2026-10-12T10:05:00.000000002Z' },
    ])
  })

  it.each([
    {
      transition: 'bob signs in in place of alice',
      act: () => {
        signIn(bob)
      },
      resume: () => {},
      nextPageOne: () => bobPageOne(),
      watermark: '2026-10-12T11:00:00.000000003Z',
    },
    {
      transition:
        "alice's session expires and is revived with the same generation",
      act: (generation: string) =>
        expireAndReviveSameGeneration(alice, generation),
      resume: () => {},
      nextPageOne: () =>
        json(200, { notifications: [reloadReplyRow, replyRow] }),
      watermark: '2026-10-12T10:05:00.000000002Z',
    },
    {
      transition: 'alice logs out',
      act: async () => {
        await profile.remove(profile.current.id)
        svelte.flushSync()
      },
      resume: () => {
        signIn(alice)
      },
      nextPageOne: () => alicePageOne(),
      watermark: '2026-10-12T09:15:30.123456789Z',
    },
  ])(
    'drops the pending mark of a page one applied while hidden when $transition before it is shown, and marks only the next page one',
    async ({ act, resume, nextPageOne, watermark }) => {
      visibility.set('hidden')
      const generation = nextGeneration()
      const notifications = await mountedList(generation)
      listGets()[0].resolve(alicePageOne())
      await settle(svelte)
      expect(notifications.status, 'precondition: page one applied').toBe(
        'ready',
      )

      await act(generation)
      await settle(svelte)
      visibility.set('visible')
      await settle(svelte)

      expect(
        updateSeenPosts(),
        'no updateSeen for the superseded page one',
      ).toEqual([])

      resume()
      await settle(svelte)
      const gets = listGets()
      expect(gets, 'precondition: the next page one is requested').toHaveLength(
        2,
      )
      gets[1].resolve(nextPageOne())
      await settle(svelte)

      expect(updateSeenPosts().map((post) => post.body)).toEqual([
        { seenAt: watermark },
      ])
    },
  )

  it('refreshes the unread count once after updateSeen succeeds and keeps the count until that refresh answers', async () => {
    const { unreadNotifications } = await import('./unread.svelte')
    const getUnreadCountPath =
      /\/xrpc\/social\.coves\.notification\.getUnreadCount$/
    const countGets = () =>
      requests.filter(
        (request) =>
          request.method === 'GET' && getUnreadCountPath.test(request.path),
      )
    signIn(alice)
    onTestFinished(unreadNotifications.start())
    await settle(svelte)
    expect(countGets(), 'precondition: the initial count GET').toHaveLength(1)
    countGets()[0].resolve(json(200, { count: 4 }))
    await settle(svelte)
    expect(unreadNotifications.count, 'precondition: count is 4').toBe(4)
    const refresh = vi.spyOn(unreadNotifications, 'refresh')
    onTestFinished(() => refresh.mockRestore())

    await mountedListForSignedInAccount()
    listGets()[0].resolve(alicePageOne())
    await settle(svelte)
    const posts = updateSeenPosts()
    expect(posts, 'one updateSeen').toHaveLength(1)
    expect(
      refresh,
      'no refresh before updateSeen answers',
    ).not.toHaveBeenCalled()

    posts[0].resolve(json(200, {}))
    await settle(svelte)

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(countGets(), "the refresh's count GET is sent").toHaveLength(2)
    expect(
      unreadNotifications.count,
      'not zeroed while the refresh is in flight',
    ).toBe(4)

    countGets()[1].resolve(json(200, { count: 1 }))
    await settle(svelte)

    expect(unreadNotifications.count).toBe(1)
  })

  it.each([
    { failure: 'a 500', status: 500, errorName: 'InternalServerError' },
    {
      failure: 'a 400 AccountNotIndexed',
      status: 400,
      errorName: 'AccountNotIndexed',
    },
  ])(
    'only logs the failure when updateSeen answers $failure: rows and status kept, no toast, no refresh, and no retry on the next visible',
    async ({ status, errorName }) => {
      const { XrpcError } = await import('$lib/api/coves')
      const { unreadNotifications } = await import('./unread.svelte')
      const { toasts } = await import('$lib/ui/kit/toast/toasts')
      toasts.set([])
      const refresh = vi.spyOn(unreadNotifications, 'refresh')
      onTestFinished(() => refresh.mockRestore())
      const notifications = await mountedList()
      listGets()[0].resolve(alicePageOne())
      await settle(svelte)
      const posts = updateSeenPosts()
      expect(posts, 'one updateSeen').toHaveLength(1)

      posts[0].resolve(json(status, { error: errorName, message: 'Failed' }))
      await settle(svelte)

      const calls = notificationLog.logNotificationFailure.mock.calls
      expect(calls, 'exactly one logged failure').toHaveLength(1)
      expect(calls[0][0]).toBe('social.coves.notification.updateSeen')
      expect(calls[0][1]).toBeInstanceOf(XrpcError)
      expect(calls[0][1]).toMatchObject({ status, errorName })
      expect(notifications.status).toBe('ready')
      expect(notifications.rows.map(rowUri)).toEqual(alicePageOneUris)
      expect(notifications.cursor).toBe('cursor-page-two-9f3k')
      expect(notifications.seenAt).toBe('2026-10-12T09:15:30.123456789Z')
      expect(get(toasts)).toEqual([])
      expect(refresh).not.toHaveBeenCalled()

      await hideThenShow()

      expect(
        updateSeenPosts(),
        'the failed attempt used the mark',
      ).toHaveLength(1)
    },
  )
})

// ---------------------------------------------------------------------------
// Later pages
// ---------------------------------------------------------------------------

/** Every GET listNotifications sent with `cursor`, in send order. */
const laterGets = (cursor: string) =>
  listGets().filter((request) => request.searchParams.get('cursor') === cursor)

/** Every GET listNotifications sent without a cursor (page one), in send order. */
const pageOneGets = () =>
  listGets().filter((request) => !request.searchParams.has('cursor'))

/** A reply row only a later page carries, named by `slug`. */
const laterReplyRow = (slug: string, excerpt: string, sortAt: string) => ({
  ...replyRow,
  sortAt,
  record: {
    uri: `at://did:plc:replier3/social.coves.community.comment/3k${slug}`,
    cid: `bafyreib${slug}cid`,
    excerpt,
    createdAt: '2026-10-12T07:00:00.000Z',
  },
  author: {
    did: 'did:plc:replier3',
    handle: 'replier3.local.coves.dev',
    displayName: 'Replier Three',
  },
})

/** Every argument of every `log.warn` call, as JSON with errors spelled out. */
const warnArgumentsJson = (calls: unknown[][]) =>
  JSON.stringify(calls, (_key, value: unknown) =>
    value instanceof Error
      ? { name: value.name, message: value.message, cause: String(value.cause) }
      : value,
  )

/** Spies on the current `log.warn` without writing to the console. */
async function spyOnLogWarn() {
  const { log } = await import('$lib/app/util/log')
  const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
  onTestFinished(() => warn.mockRestore())
  return warn
}

describe('notification list later page answered without a cursor', () => {
  it('appends its rows, leaves the cursor undefined and sends nothing on further loadMore() calls', async () => {
    const notifications = await alicePageOneShown()

    notifications.loadMore()
    await settle(svelte)

    const later = laterGets('cursor-page-two-9f3k')
    expect(later, 'one later-page GET with cursor c1').toHaveLength(1)

    later[0].resolve(
      json(200, {
        notifications: [
          laterReplyRow(
            'commentlastpage1',
            'Last page reply',
            '2026-10-12T07:30:00.000Z',
          ),
        ],
      }),
    )
    await settle(svelte)

    expect(notifications.rows.map(rowUri)).toEqual([
      ...alicePageOneUris,
      'at://did:plc:replier3/social.coves.community.comment/3kcommentlastpage1',
    ])
    expect(notifications.cursor).toBeUndefined()

    notifications.loadMore()
    notifications.loadMore()
    await settle(svelte)

    expect(listGets(), 'no GET after the last page').toHaveLength(2)
  })
})

describe('notification list later page whose cursor was already requested', () => {
  it.each([
    {
      chain: 'c1 answered with cursor c1',
      steps: [
        {
          requested: 'cursor-page-two-9f3k',
          answeredCursor: 'cursor-page-two-9f3k',
          slug: 'commentrepeat1',
        },
      ],
    },
    {
      chain: 'c1 answered with c2, then c2 answered with cursor c1',
      steps: [
        {
          requested: 'cursor-page-two-9f3k',
          answeredCursor: 'cursor-page-three-2x7p',
          slug: 'commentrepeat2',
        },
        {
          requested: 'cursor-page-three-2x7p',
          answeredCursor: 'cursor-page-two-9f3k',
          slug: 'commentrepeat3',
        },
      ],
    },
  ])(
    'stops paging and warns exactly once without either cursor after $chain',
    async ({ steps }) => {
      const warn = await spyOnLogWarn()
      const notifications = await alicePageOneShown()

      for (const step of steps) {
        notifications.loadMore()
        await settle(svelte)
        const later = laterGets(step.requested)
        expect(later, `one later-page GET with ${step.requested}`).toHaveLength(
          1,
        )
        later[0].resolve(
          json(200, {
            notifications: [
              laterReplyRow(
                step.slug,
                'Repeat cursor reply',
                '2026-10-12T07:30:00.000Z',
              ),
            ],
            cursor: step.answeredCursor,
          }),
        )
        await settle(svelte)
      }

      notifications.loadMore()
      notifications.loadMore()
      await settle(svelte)

      expect(listGets(), 'no GET after the repeated cursor').toHaveLength(
        1 + steps.length,
      )
      expect(warn, 'exactly one warning over the run').toHaveBeenCalledTimes(1)
      const logged = warnArgumentsJson(warn.mock.calls)
      expect(logged).not.toContain('cursor-page-two-9f3k')
      expect(logged).not.toContain('cursor-page-three-2x7p')
    },
  )
})

describe.each([
  {
    transition: 'bob signs in in place of alice',
    act: () => {
      signIn(bob)
    },
    replacementPageOne: bobPageOne,
    replacementUris: [
      'at://did:plc:replier2/social.coves.community.comment/3kcommentbob1',
    ],
    replacementCursor: 'cursor-bob-page-two-7h2m',
  },
  {
    transition: "alice's expired session is revived with the same generation",
    act: (generation: string) =>
      expireAndReviveSameGeneration(alice, generation),
    replacementPageOne: () =>
      json(200, {
        notifications: [reloadReplyRow],
        cursor: 'cursor-reload-4n8q',
        seenAt: '2026-10-12T12:05:00.000000002+02:00',
      }),
    replacementUris: [reloadReplyUri],
    replacementCursor: 'cursor-reload-4n8q',
  },
])(
  'notification list later page in flight when $transition',
  ({ act, replacementPageOne, replacementUris, replacementCursor }) => {
    it.each([
      {
        response: 'a success',
        answer: (request: HeldRequest) =>
          request.resolve(
            json(200, {
              notifications: [
                laterReplyRow(
                  'commentstale1',
                  'Stale later reply',
                  '2026-10-12T07:30:00.000Z',
                ),
              ],
              cursor: 'cursor-stale-page-three-5t1w',
            }),
          ),
      },
      failingAnswers[500],
    ])(
      'discards $response for the stale later page: replacement rows and cursor, idle, nothing logged, and the replacement cursor pages on',
      async ({ answer }) => {
        const generation = nextGeneration()
        const notifications = await alicePageOneShown(generation)

        notifications.loadMore()
        await settle(svelte)
        const staleLater = laterGets('cursor-page-two-9f3k')
        expect(staleLater, 'one later-page GET with cursor c1').toHaveLength(1)

        act(generation)
        await settle(svelte)
        const replacement = pageOneGets()
        expect(replacement, 'the replacement page one is sent').toHaveLength(2)
        replacement[1].resolve(replacementPageOne())
        await settle(svelte)

        answer(staleLater[0])
        await settle(svelte)

        expect(notifications.rows.map(rowUri)).toEqual(replacementUris)
        expect(notifications.cursor).toBe(replacementCursor)
        expect(notifications.laterPageStatus).toBe('idle')
        expect(loggedNsids()).toEqual([])

        notifications.loadMore()
        await settle(svelte)
        const next = laterGets(replacementCursor)
        expect(
          next,
          'one later-page GET with the replacement cursor',
        ).toHaveLength(1)
        next[0].resolve(
          json(200, {
            notifications: [
              laterReplyRow(
                'commentnext1',
                'Next page reply',
                '2026-10-12T07:45:00.000Z',
              ),
            ],
          }),
        )
        await settle(svelte)

        expect(notifications.rows.map(rowUri)).toEqual([
          ...replacementUris,
          'at://did:plc:replier3/social.coves.community.comment/3kcommentnext1',
        ])
      },
    )

    it('pages on and warns nothing when the replacement page one answers with the cursor requested before the change', async () => {
      const warn = await spyOnLogWarn()
      const generation = nextGeneration()
      const notifications = await alicePageOneShown(generation)

      notifications.loadMore()
      await settle(svelte)
      const staleLater = laterGets('cursor-page-two-9f3k')
      expect(staleLater, 'one later-page GET with cursor c1').toHaveLength(1)

      act(generation)
      await settle(svelte)
      const replacement = pageOneGets()
      expect(replacement, 'the replacement page one is sent').toHaveLength(2)
      const replacementBody: unknown = await replacementPageOne().json()
      replacement[1].resolve(
        json(200, {
          ...(replacementBody as object),
          cursor: 'cursor-page-two-9f3k',
        }),
      )
      await settle(svelte)
      staleLater[0].resolve(json(500, {}))
      await settle(svelte)

      expect(notifications.rows.map(rowUri)).toEqual(replacementUris)
      expect(notifications.cursor).toBe('cursor-page-two-9f3k')

      notifications.loadMore()
      await settle(svelte)

      expect(
        laterGets('cursor-page-two-9f3k'),
        'a second later-page GET with cursor c1 after the change',
      ).toHaveLength(2)
      expect(warn).not.toHaveBeenCalled()
    })
  },
)

// ---------------------------------------------------------------------------
// Page-one reload triggers
// ---------------------------------------------------------------------------

const getUnreadCountPath =
  /\/xrpc\/social\.coves\.notification\.getUnreadCount$/

/** Every GET getUnreadCount the fetch spy has seen, in send order. */
const countGets = () =>
  requests.filter(
    (request) =>
      request.method === 'GET' && getUnreadCountPath.test(request.path),
  )

/** Answers a count GET with an accepted `count`. */
const countAnswer = (count: number) => (request: HeldRequest) =>
  request.resolve(json(200, { count }))

/** Alice's reloaded page one: a new reply above her first one. */
const aliceReloadPageOne = () =>
  json(200, {
    notifications: [reloadReplyRow, replyRow],
    cursor: 'cursor-reload-4n8q',
    seenAt: '2026-10-12T10:05:00.000000002Z',
  })

const aliceReloadUris = [
  reloadReplyUri,
  'at://did:plc:replier1/social.coves.community.comment/3kcommentreply1',
]

/** The unread store instance the list follows; set by each describe that drives it. */
let unread: UnreadNotificationStore

/** Settles, answers the one count GET sent since `before`, then settles. */
async function answerCountGet(
  before: number,
  answer: (request: HeldRequest) => void,
) {
  await settle(svelte)
  const sent = countGets().slice(before)
  expect(sent, 'precondition: exactly one count GET was sent').toHaveLength(1)
  answer(sent[0])
  await settle(svelte)
}

/** One unread refresh, answered and accepted with `count`. */
async function acceptedRefresh(count: number) {
  const before = countGets().length
  unread.refresh()
  await answerCountGet(before, countAnswer(count))
  expect(unread.count, `precondition: the count is ${count}`).toBe(count)
}

/**
 * Alice signed in with the unread count accepted at `baseline`, then the
 * list created (its last observed count) and mounted while visible, with
 * its page-one GET held.
 */
async function displayedListLoading(
  baseline: number,
  generation = nextGeneration(),
): Promise<NotificationList> {
  signIn(alice, generation)
  onTestFinished(unread.start())
  await answerCountGet(0, countAnswer(baseline))
  expect(unread.count, `precondition: the count is ${baseline}`).toBe(baseline)
  const notifications = createList()
  notifications.setMounted(true)
  svelte.flushSync()
  await settle(svelte)
  expect(pageOneGets(), 'precondition: page one is in flight').toHaveLength(1)
  return notifications
}

/** `displayedListLoading` with alice's page one answered and shown. */
async function displayedListShown(baseline: number): Promise<NotificationList> {
  const notifications = await displayedListLoading(baseline)
  pageOneGets()[0].resolve(alicePageOne())
  await settle(svelte)
  expect(
    notifications.rows.map(rowUri),
    "precondition: alice's page one is shown",
  ).toEqual(alicePageOneUris)
  return notifications
}

describe('notification list page-one reload triggers', () => {
  let visibility: ReturnType<typeof controlVisibility>

  beforeEach(async () => {
    visibility = controlVisibility('visible')
    // The list's own instance: imported after the file's module registry.
    unread = (await import('./unread.svelte')).unreadNotifications
  })

  afterEach(() => {
    visibility.restore()
  })

  /** Hides the document, shows it again and answers the store's refresh. */
  async function returnToVisible(answer: (request: HeldRequest) => void) {
    visibility.set('hidden')
    await settle(svelte)
    const before = countGets().length
    visibility.set('visible')
    await answerCountGet(before, answer)
  }

  describe('when the count rises while displayed', () => {
    it('sends exactly one page-one GET when an accepted refresh raises the count from 2 to 3, and its rows and cursor replace the list', async () => {
      const notifications = await displayedListShown(2)

      await acceptedRefresh(3)

      const gets = pageOneGets()
      expect(gets, 'one page-one reload').toHaveLength(2)
      gets[1].resolve(aliceReloadPageOne())
      await settle(svelte)

      expect(notifications.rows.map(rowUri)).toEqual(aliceReloadUris)
      expect(notifications.cursor).toBe('cursor-reload-4n8q')
      expect(notifications.status).toBe('ready')
      expect(pageOneGets(), 'no further page-one GET').toHaveLength(2)
    })

    it('sends no page-one GET when the first accepted refresh reports the count the list was created at (2)', async () => {
      await displayedListShown(2)

      await acceptedRefresh(2)

      expect(pageOneGets(), 'no page-one reload').toHaveLength(1)
    })

    it('compares with the last observed count, not the highest: 3 reloads, then 1 sends nothing, then 2 reloads once', async () => {
      await displayedListShown(2)

      await acceptedRefresh(3)
      expect(pageOneGets(), 'the rise to 3 reloads').toHaveLength(2)
      pageOneGets()[1].resolve(aliceReloadPageOne())
      await settle(svelte)

      await acceptedRefresh(1)
      expect(pageOneGets(), 'the fall to 1 sends nothing').toHaveLength(2)

      await acceptedRefresh(2)
      expect(pageOneGets(), 'the rise from 1 to 2 reloads').toHaveLength(3)
    })
  })

  describe.each([
    {
      undisplayed: 'the document is hidden',
      hide: async () => {
        visibility.set('hidden')
        await settle(svelte)
      },
      // Returning to visible makes the started store refresh by itself.
      redisplay: async () => {
        visibility.set('visible')
      },
    },
    {
      undisplayed: 'the list is unmounted with the document visible',
      hide: async (notifications: NotificationList) => {
        notifications.setMounted(false)
        await settle(svelte)
      },
      redisplay: async (notifications: NotificationList) => {
        notifications.setMounted(true)
        svelte.flushSync()
        unread.refresh()
      },
    },
  ])('when $undisplayed', ({ hide, redisplay }) => {
    it('sends no page-one GET when an accepted refresh raises the count from 2 to 3, and one once displayed again and a refresh reports 3 again', async () => {
      const notifications = await displayedListShown(2)
      await hide(notifications)

      await acceptedRefresh(3)

      expect(pageOneGets(), 'no page-one GET while not displayed').toHaveLength(
        1,
      )

      const before = countGets().length
      await redisplay(notifications)
      // 3 again: the rise seen while not displayed was not observed.
      await answerCountGet(before, countAnswer(3))

      expect(pageOneGets(), 'one page-one reload once displayed').toHaveLength(
        2,
      )
    })
  })

  describe('when the document returns to visible', () => {
    it.each([
      { situation: 'the count was already 2 and it reports 2', count: 2 },
      { situation: 'it reports 3', count: 3 },
    ])(
      'runs exactly one page-one reload on the next accepted refresh when $situation, and none on a further refresh with the same count',
      async ({ count }) => {
        const notifications = await displayedListShown(2)

        await returnToVisible(countAnswer(count))

        const gets = pageOneGets()
        expect(gets, 'one page-one reload').toHaveLength(2)
        gets[1].resolve(aliceReloadPageOne())
        await settle(svelte)
        expect(
          notifications.rows.map(rowUri),
          'precondition: the reload is shown',
        ).toEqual(aliceReloadUris)

        await acceptedRefresh(count)

        expect(
          pageOneGets(),
          'the return was used by the first refresh',
        ).toHaveLength(2)
      },
    )

    it.each([
      { response: 'reports 0', answer: countAnswer(0) },
      {
        response:
          'is discarded as stale (the session expires before it answers 3)',
        answer: (request: HeldRequest) => {
          profile.expireSession(profile.sessionGeneration)
          svelte.flushSync()
          request.resolve(json(200, { count: 3 }))
        },
      },
    ])(
      'sends no page-one GET when the next refresh $response',
      async ({ answer }) => {
        await displayedListShown(2)

        await returnToVisible(answer)

        expect(pageOneGets(), 'no page-one reload').toHaveLength(1)
      },
    )

    it('sends no page-one GET when the next refresh fails with a 500, and exactly one when the following accepted refresh reports 2', async () => {
      await displayedListShown(2)

      await returnToVisible((request) =>
        request.resolve(json(500, { error: 'InternalServerError' })),
      )
      expect(pageOneGets(), 'no reload on the failed refresh').toHaveLength(1)

      await acceptedRefresh(2)

      expect(
        pageOneGets(),
        'the return still applies to the first accepted refresh',
      ).toHaveLength(2)
    })
  })

  describe.each([
    {
      inFlight: 'the initial page-one load',
      arrange: async () => {
        await displayedListLoading(2)
      },
      settleInFlight: (request: HeldRequest) => request.resolve(alicePageOne()),
    },
    {
      inFlight: 'a reload that then succeeds',
      arrange: async () => {
        await displayedListShown(2)
        await acceptedRefresh(3)
        expect(pageOneGets(), 'the first reload is sent').toHaveLength(2)
      },
      settleInFlight: (request: HeldRequest) =>
        request.resolve(aliceReloadPageOne()),
    },
    {
      inFlight: 'a reload that then fails with a 500',
      arrange: async () => {
        await displayedListShown(2)
        await acceptedRefresh(3)
        expect(pageOneGets(), 'the first reload is sent').toHaveLength(2)
      },
      settleInFlight: (request: HeldRequest) =>
        request.resolve(json(500, { error: 'InternalServerError' })),
    },
  ])('with $inFlight in flight', ({ arrange, settleInFlight }) => {
    it('sends exactly one more page-one GET for three rises, only after the one in flight settles, never two at once', async () => {
      await arrange()
      const sentBefore = pageOneGets().length
      const inFlight = pageOneGets()[sentBefore - 1]

      for (const count of [4, 5, 6]) {
        await acceptedRefresh(count)
        expect(
          pageOneGets(),
          `nothing more sent while one is in flight (after ${count})`,
        ).toHaveLength(sentBefore)
      }

      settleInFlight(inFlight)
      await settle(svelte)
      const gets = pageOneGets()
      expect(gets, 'one queued reload once it settles').toHaveLength(
        sentBefore + 1,
      )

      gets[sentBefore].resolve(aliceReloadPageOne())
      await settle(svelte)

      expect(pageOneGets(), 'no further page-one GET').toHaveLength(
        sentBefore + 1,
      )
    })
  })

  describe.each([
    {
      transition: "alice's session expires and is revived",
      act: async (generation: string) =>
        expireAndReviveSameGeneration(alice, generation),
      pageOneGetsAfter: 2,
      resume: async () => {},
      pageOneGetsAfterResume: 2,
      replacementPageOne: aliceReloadPageOne,
    },
    {
      transition: 'alice logs out, then signs back in',
      act: async () => {
        await profile.remove(profile.current.id)
        svelte.flushSync()
      },
      pageOneGetsAfter: 1,
      resume: async () => {
        signIn(alice)
      },
      // Her fresh initial load, and nothing else.
      pageOneGetsAfterResume: 2,
      replacementPageOne: alicePageOne,
    },
    {
      transition: 'bob signs in in place of alice',
      act: async () => {
        signIn(bob)
      },
      pageOneGetsAfter: 2,
      resume: async () => {},
      pageOneGetsAfterResume: 2,
      replacementPageOne: bobPageOne,
    },
  ])(
    'with a reload queued behind page one when $transition',
    ({
      act,
      pageOneGetsAfter,
      resume,
      pageOneGetsAfterResume,
      replacementPageOne,
    }) => {
      it('never sends the queued reload, only the page one the transition itself sends', async () => {
        const generation = nextGeneration()
        await displayedListLoading(2, generation)
        const [stale] = pageOneGets()
        await acceptedRefresh(3)
        expect(
          pageOneGets(),
          'precondition: the reload waits behind page one',
        ).toHaveLength(1)

        const countGetsBefore = countGets().length
        await act(generation)
        await settle(svelte)
        expect(
          pageOneGets(),
          "precondition: the transition's own page one",
        ).toHaveLength(pageOneGetsAfter)

        stale.resolve(alicePageOne())
        await settle(svelte)
        expect(
          pageOneGets(),
          'nothing sent when the stale page one settles',
        ).toHaveLength(pageOneGetsAfter)

        await resume()
        await settle(svelte)
        expect(
          pageOneGets(),
          'only the replacement page one is sent',
        ).toHaveLength(pageOneGetsAfterResume)

        // The new session's first count, above the previous session's 3.
        await answerCountGet(countGetsBefore, countAnswer(4))
        expect(
          pageOneGets(),
          "nothing sent for the new session's first count",
        ).toHaveLength(pageOneGetsAfterResume)

        pageOneGets()[1].resolve(replacementPageOne())
        await settle(svelte)

        expect(
          pageOneGets(),
          'nothing sent when the replacement settles',
        ).toHaveLength(pageOneGetsAfterResume)
      })
    },
  )

  it("sends only the owner reload when the document returns to visible while the session is expired and it is then revived, whatever the new session's first count", async () => {
    const generation = nextGeneration()
    await displayedListLoading(2, generation)
    pageOneGets()[0].resolve(alicePageOne())
    await settle(svelte)
    visibility.set('hidden')
    await settle(svelte)
    profile.expireSession(generation)
    svelte.flushSync()
    visibility.set('visible')
    await settle(svelte)
    const countGetsBefore = countGets().length

    profile.beginSessionRevalidation()
    svelte.flushSync()
    profile.syncFromServer(session(alice, generation), {
      sessionGeneration: generation,
      sessionExpired: false,
    })
    svelte.flushSync()
    await settle(svelte)
    expect(pageOneGets(), 'precondition: the owner reload').toHaveLength(2)

    await answerCountGet(countGetsBefore, countAnswer(2))
    expect(pageOneGets(), 'nothing more while it is in flight').toHaveLength(2)
    pageOneGets()[1].resolve(aliceReloadPageOne())
    await settle(svelte)

    expect(
      pageOneGets(),
      'nothing sent when the owner reload settles',
    ).toHaveLength(2)
  })

  it('sends exactly one page-one reload on the first refresh reporting unread after the document returns to visible, when the session expired, was revived and its owner reload settled while hidden', async () => {
    const generation = nextGeneration()
    await displayedListLoading(2, generation)
    pageOneGets()[0].resolve(alicePageOne())
    await settle(svelte)
    visibility.set('hidden')
    await settle(svelte)
    const countGetsBefore = countGets().length
    profile.expireSession(generation)
    svelte.flushSync()
    profile.beginSessionRevalidation()
    svelte.flushSync()
    profile.syncFromServer(session(alice, generation), {
      sessionGeneration: generation,
      sessionExpired: false,
    })
    svelte.flushSync()
    await settle(svelte)
    expect(pageOneGets(), 'precondition: the owner reload').toHaveLength(2)
    for (const request of countGets().slice(countGetsBefore)) {
      countAnswer(2)(request)
    }
    await settle(svelte)
    pageOneGets()[1].resolve(aliceReloadPageOne())
    await settle(svelte)
    expect(
      pageOneGets(),
      'precondition: nothing more sent while hidden',
    ).toHaveLength(2)

    const before = countGets().length
    visibility.set('visible')
    await answerCountGet(before, countAnswer(3))

    expect(pageOneGets(), 'one reload for the return').toHaveLength(3)
  })

  it("sends the queued reload once page one settles when the same session's profile changes meanwhile", async () => {
    const generation = nextGeneration()
    await displayedListLoading(2, generation)
    await acceptedRefresh(3)
    expect(
      pageOneGets(),
      'precondition: the reload waits behind page one',
    ).toHaveLength(1)

    signIn({ ...alice, handle: 'alice-renamed.test' }, generation)
    await settle(svelte)
    expect(
      profile.current.type === 'authenticated' && profile.current.handle,
      "precondition: alice's profile changed in place",
    ).toBe('alice-renamed.test')
    expect(pageOneGets(), 'nothing sent for the profile change').toHaveLength(1)

    pageOneGets()[0].resolve(alicePageOne())
    await settle(svelte)

    expect(
      pageOneGets(),
      'the queued reload is sent once page one settles',
    ).toHaveLength(2)
  })

  /** A later page alice's page one's cursor (c1) leads to, as it was before the reload. */
  const staleLaterPage = () =>
    json(200, {
      notifications: [
        laterReplyRow(
          'commentbeforereload1',
          'Later reply before the reload',
          '2026-10-12T07:30:00.000Z',
        ),
      ],
      cursor: 'cursor-stale-page-three-5t1w',
    })

  /**
   * Alice's page one shown with last observed count 2 and its later page
   * (cursor c1) held; then a rise to 3 starts a reload, and `loadMore()` is
   * called again after it starts, as the component's loading effect does.
   */
  async function laterPageHeldAcrossReload() {
    const notifications = await displayedListShown(2)
    notifications.loadMore()
    await settle(svelte)
    expect(
      laterGets('cursor-page-two-9f3k'),
      'precondition: one later-page GET with cursor c1',
    ).toHaveLength(1)
    await acceptedRefresh(3)
    const gets = pageOneGets()
    expect(gets, 'precondition: the reload is sent').toHaveLength(2)
    notifications.loadMore()
    await settle(svelte)
    return { notifications, reload: gets[1] }
  }

  describe('with a later page sent before a reload started', () => {
    it.each([
      {
        order: 'the reload resolves before the later page',
        answerReloadBefore: (reload: HeldRequest) =>
          reload.resolve(aliceReloadPageOne()),
        answerReloadAfter: () => {},
        urisAfterLaterPage: aliceReloadUris,
        cursorAfterLaterPage: 'cursor-reload-4n8q',
      },
      {
        order: 'the later page resolves while the reload is still in flight',
        answerReloadBefore: () => {},
        answerReloadAfter: (reload: HeldRequest) =>
          reload.resolve(aliceReloadPageOne()),
        urisAfterLaterPage: alicePageOneUris,
        cursorAfterLaterPage: 'cursor-page-two-9f3k',
      },
    ])(
      'discards its success when $order: no later-page GET re-sent, nothing appended, and the reload rows and cursor kept',
      async ({
        answerReloadBefore,
        answerReloadAfter,
        urisAfterLaterPage,
        cursorAfterLaterPage,
      }) => {
        const { notifications, reload } = await laterPageHeldAcrossReload()
        answerReloadBefore(reload)
        await settle(svelte)

        for (const request of laterGets('cursor-page-two-9f3k')) {
          request.resolve(staleLaterPage())
        }
        await settle(svelte)

        expect(
          laterGets('cursor-page-two-9f3k'),
          'no later-page GET re-sent during the reload',
        ).toHaveLength(1)
        expect(
          notifications.rows.map(rowUri),
          'nothing appended once the later page settles',
        ).toEqual(urisAfterLaterPage)
        expect(notifications.cursor).toBe(cursorAfterLaterPage)

        answerReloadAfter(reload)
        await settle(svelte)

        expect(notifications.rows.map(rowUri)).toEqual(aliceReloadUris)
        expect(notifications.cursor).toBe('cursor-reload-4n8q')
        expect(listGets(), 'no other list GET').toHaveLength(3)
      },
    )

    it.each([failingAnswers[500], failingAnswers.network])(
      'never shows the later-page error when it fails with $response, while the reload is in flight or after it succeeds, and logs nothing for it',
      async ({ answer }) => {
        const { notifications, reload } = await laterPageHeldAcrossReload()

        for (const request of laterGets('cursor-page-two-9f3k')) answer(request)
        await settle(svelte)

        expect(
          notifications.laterPageStatus,
          'no error while the reload is in flight',
        ).not.toBe('error')
        expect(loggedNsids(), 'nothing logged for the later page').toEqual([])
        expect(
          laterGets('cursor-page-two-9f3k'),
          'no later-page GET re-sent during the reload',
        ).toHaveLength(1)

        reload.resolve(aliceReloadPageOne())
        await settle(svelte)

        expect(notifications.laterPageStatus).toBe('idle')
        expect(notifications.rows.map(rowUri)).toEqual(aliceReloadUris)
        expect(notifications.cursor).toBe('cursor-reload-4n8q')
        expect(loggedNsids()).toEqual([])
      },
    )
  })

  describe('when a reload fails with page one shown', () => {
    it.each([
      {
        response: 'a 500',
        answer: (request: HeldRequest) =>
          request.resolve(
            json(500, {
              error: 'InternalServerError',
              message: 'notification shard 7q timed out',
            }),
          ),
        bodyStrings: ['notification shard 7q timed out'],
      },
      { ...failingAnswers.network, bodyStrings: [] },
    ])(
      'keeps the rows, cursor and ready status with no later-page error or toast, logs it once without URL, cursor or body, and the next rise sends page one again ($response)',
      async ({ answer, bodyStrings }) => {
        const { toasts } = await import('$lib/ui/kit/toast/toasts')
        toasts.set([])
        const { log } = await import('$lib/app/util/log')
        const warn = await spyOnLogWarn()
        const error = vi.spyOn(log, 'error').mockImplementation(() => {})
        onTestFinished(() => error.mockRestore())
        const notifications = await displayedListShown(2)

        await acceptedRefresh(3)
        const gets = pageOneGets()
        expect(gets, 'precondition: the reload is sent').toHaveLength(2)
        answer(gets[1])
        await settle(svelte)

        expect(notifications.rows.map(rowUri)).toEqual(alicePageOneUris)
        expect(notifications.cursor).toBe('cursor-page-two-9f3k')
        expect(notifications.seenAt).toBe('2026-10-12T09:15:30.123456789Z')
        expect(notifications.status).toBe('ready')
        expect(notifications.laterPageStatus).toBe('idle')
        expect(get(toasts), 'no toast').toEqual([])
        expect(loggedNsids()).toEqual([listNotificationsNsid])
        const logged = warnArgumentsJson([
          ...warn.mock.calls,
          ...error.mock.calls,
        ])
        for (const secret of [
          '/xrpc/social.coves.notification.listNotifications',
          'cursor-page-two-9f3k',
          ...bodyStrings,
        ]) {
          expect(logged, `no log argument carries ${secret}`).not.toContain(
            secret,
          )
        }

        await acceptedRefresh(4)

        expect(
          pageOneGets(),
          'the next rise sends page one again',
        ).toHaveLength(3)
      },
    )
  })

  it("sends exactly one more updateSeen, with the successful reload's watermark, when page one's mark failed and a reload then failed keeping its rows", async () => {
    const notifications = await displayedListShown(2)
    const marks = updateSeenPosts()
    expect(marks, "precondition: page one's updateSeen is sent").toHaveLength(1)
    marks[0].resolve(json(500, { error: 'InternalServerError' }))
    await settle(svelte)
    expect(loggedNsids(), "precondition: page one's mark failed").toEqual([
      'social.coves.notification.updateSeen',
    ])

    await acceptedRefresh(3)
    expect(pageOneGets(), 'precondition: the reload is sent').toHaveLength(2)
    pageOneGets()[1].resolve(json(500, { error: 'InternalServerError' }))
    await settle(svelte)
    expect(
      notifications.rows.map(rowUri),
      'precondition: the failed reload kept page one',
    ).toEqual(alicePageOneUris)

    await acceptedRefresh(4)
    const gets = pageOneGets()
    expect(gets, 'precondition: the next reload is sent').toHaveLength(3)
    gets[2].resolve(aliceReloadPageOne())
    await settle(svelte)

    const posts = updateSeenPosts()
    expect(posts.map((post) => post.body)).toEqual([
      { seenAt: '2026-10-12T09:15:30.123456789Z' },
      { seenAt: '2026-10-12T10:05:00.000000002Z' },
    ])

    // A successful mark refreshes the count; 4 again is no rise.
    const before = countGets().length
    posts[1].resolve(json(200, {}))
    await answerCountGet(before, countAnswer(4))

    expect(updateSeenPosts(), 'no further updateSeen').toHaveLength(2)
    expect(pageOneGets(), 'no further page-one GET').toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// InvalidCursor recovery
// ---------------------------------------------------------------------------

describe('notification list InvalidCursor recovery', () => {
  let visibility: ReturnType<typeof controlVisibility>

  beforeEach(async () => {
    visibility = controlVisibility('visible')
    // The list's own instance: imported after the file's module registry.
    unread = (await import('./unread.svelte')).unreadNotifications
  })

  afterEach(() => {
    visibility.restore()
  })

  /** A reply only the recovery page one carries, newer than its seenAt. */
  const recoveryReplyRow = {
    ...replyRow,
    sortAt: '2026-10-12T11:20:00.000000004Z',
    record: {
      uri: 'at://did:plc:replier1/social.coves.community.comment/3kcommentrecovery1',
      cid: 'bafyreibrecordrecovery1cid',
      excerpt: 'Fresh after the cursor expired',
      createdAt: '2026-10-12T11:19:59.000Z',
    },
  }

  const recoveryUris = [
    'at://did:plc:replier1/social.coves.community.comment/3kcommentrecovery1',
  ]

  /** The fresh page one a recovery load answers with (cursor c2). */
  const recoveryPageOne = () =>
    json(200, {
      notifications: [recoveryReplyRow],
      cursor: 'cursor-recovery-6d2v',
      seenAt: '2026-10-12T11:00:00.000000004Z',
    })

  /** The page one a second recovery load answers with. */
  const secondRecoveryPageOne = () =>
    json(200, {
      notifications: [
        {
          ...replyRow,
          sortAt: '2026-10-12T12:40:00.000000005Z',
          record: {
            uri: 'at://did:plc:replier1/social.coves.community.comment/3kcommentrecovery2',
            cid: 'bafyreibrecordrecovery2cid',
            excerpt: 'Fresh after the second expiry',
            createdAt: '2026-10-12T12:39:59.000Z',
          },
        },
      ],
      cursor: 'cursor-recovery-second-8w4c',
      seenAt: '2026-10-12T12:30:00.000000005Z',
    })

  const secondRecoveryUris = [
    'at://did:plc:replier1/social.coves.community.comment/3kcommentrecovery2',
  ]

  const invalidCursor = () =>
    json(400, { error: 'InvalidCursor', message: 'Invalid cursor' })

  /**
   * Sends the later page with `cursor` (through `loadMore()` unless `send`
   * says otherwise), answers it with InvalidCursor and settles.
   */
  async function pageIntoInvalidCursor(
    notifications: NotificationList,
    cursor: string,
    send = () => notifications.loadMore(),
  ) {
    const before = laterGets(cursor).length
    send()
    await settle(svelte)
    const sent = laterGets(cursor)
    expect(
      sent,
      `precondition: one more later-page GET with ${cursor}`,
    ).toHaveLength(before + 1)
    sent[before].resolve(invalidCursor())
    await settle(svelte)
  }

  /** The recovery page-one GET, the `total`-th page-one GET sent. */
  function recoveryGet(total: number): HeldRequest {
    const gets = pageOneGets()
    expect(gets, 'expected a recovery page-one GET').toHaveLength(total)
    return gets[total - 1]
  }

  /** A list signed in as alice showing `pageOne` (answered), not mounted. */
  async function listShowing(pageOne: () => Response) {
    signIn(alice)
    notificationFetch.answer = (request) => request.resolve(pageOne())
    const notifications = createList()
    await settle(svelte)
    notificationFetch.answer = undefined
    return notifications
  }

  /**
   * Alice's page one, InvalidCursor on c1, a successful recovery (cursor c2),
   * then InvalidCursor on c2: recovery spent and the Retry footer shown.
   */
  async function recoverySpentWithFooter(): Promise<NotificationList> {
    const notifications = await alicePageOneShown()
    await pageIntoInvalidCursor(notifications, 'cursor-page-two-9f3k')
    recoveryGet(2).resolve(recoveryPageOne())
    await settle(svelte)
    await pageIntoInvalidCursor(notifications, 'cursor-recovery-6d2v')
    expect(
      notifications.laterPageStatus,
      'precondition: the second InvalidCursor shows the Retry footer',
    ).toBe('error')
    expect(pageOneGets(), 'precondition: no second recovery').toHaveLength(2)
    return notifications
  }

  it('replaces the list once with a fresh page one whose seenAt becomes the later-page boundary, and marks it seen once while displayed', async () => {
    const notifications = await displayedListShown(2)

    await pageIntoInvalidCursor(notifications, 'cursor-page-two-9f3k')
    recoveryGet(2).resolve(recoveryPageOne())
    await settle(svelte)

    expect(notifications.rows.map(rowUri)).toEqual(recoveryUris)
    expect(notifications.cursor).toBe('cursor-recovery-6d2v')
    expect(notifications.seenAt).toBe('2026-10-12T11:00:00.000000004Z')
    expect(notifications.status).toBe('ready')
    expect(notifications.laterPageStatus).toBe('idle')
    expect(pageOneGets(), 'exactly one recovery page-one GET').toHaveLength(2)
    expect(
      updateSeenPosts().map((post) => post.body),
      'composition check (18): the displayed recovery page one is marked seen once',
    ).toEqual([
      { seenAt: '2026-10-12T09:15:30.123456789Z' },
      { seenAt: '2026-10-12T11:20:00.000000004Z' },
    ])

    notifications.loadMore()
    await settle(svelte)
    const next = laterGets('cursor-recovery-6d2v')
    expect(next, 'one later-page GET with cursor c2').toHaveLength(1)
    next[0].resolve(
      json(200, {
        notifications: [
          laterReplyRow(
            'commentbetween1',
            'Between the two boundaries',
            '2026-10-12T10:30:00.000Z',
          ),
          laterReplyRow(
            'commentafter1',
            'After the recovery boundary',
            '2026-10-12T11:10:00.000Z',
          ),
        ],
      }),
    )
    await settle(svelte)

    expect(
      notifications.rows
        .slice(1)
        .map((row) => ({ uri: rowUri(row), isRead: row.isRead })),
      "later rows are judged against the recovery page's seenAt",
    ).toEqual([
      {
        uri: 'at://did:plc:replier3/social.coves.community.comment/3kcommentbetween1',
        isRead: true,
      },
      {
        uri: 'at://did:plc:replier3/social.coves.community.comment/3kcommentafter1',
        isRead: false,
      },
    ])
  })

  it('shows the Retry footer on a second InvalidCursor after a recovery and sends no further page one without a user action', async () => {
    const notifications = await alicePageOneShown()

    await pageIntoInvalidCursor(notifications, 'cursor-page-two-9f3k')
    recoveryGet(2).resolve(recoveryPageOne())
    await settle(svelte)
    await pageIntoInvalidCursor(notifications, 'cursor-recovery-6d2v')

    expect(notifications.laterPageStatus).toBe('error')
    expect(notifications.rows.map(rowUri)).toEqual(recoveryUris)
    expect(pageOneGets(), 'no second recovery').toHaveLength(2)

    notifications.loadMore()
    notifications.loadMore()
    await settle(svelte)

    expect(pageOneGets(), 'no recovery from further loadMore()').toHaveLength(2)
    expect(laterGets('cursor-recovery-6d2v')).toHaveLength(1)
    expect(notifications.laterPageStatus).toBe('error')
  })

  it('shows the Retry footer without a recovery when a later page answers a 400 other than InvalidCursor', async () => {
    const notifications = await alicePageOneShown()

    notifications.loadMore()
    await settle(svelte)
    const sent = laterGets('cursor-page-two-9f3k')
    expect(sent, 'precondition: one later-page GET').toHaveLength(1)
    sent[0].resolve(json(400, { error: 'InvalidRequest', message: 'Bad' }))
    await settle(svelte)

    expect(notifications.laterPageStatus).toBe('error')
    expect(pageOneGets(), 'no recovery page-one GET').toHaveLength(1)
    expect(notifications.rows.map(rowUri)).toEqual(alicePageOneUris)
  })

  it('recovers exactly once when Retry re-sends the same cursor and it answers InvalidCursor again', async () => {
    const notifications = await recoverySpentWithFooter()

    await pageIntoInvalidCursor(notifications, 'cursor-recovery-6d2v', () =>
      notifications.retryLaterPage(),
    )
    recoveryGet(3).resolve(secondRecoveryPageOne())
    await settle(svelte)

    expect(notifications.rows.map(rowUri)).toEqual(secondRecoveryUris)
    expect(notifications.cursor).toBe('cursor-recovery-second-8w4c')
    expect(notifications.seenAt).toBe('2026-10-12T12:30:00.000000005Z')
    expect(notifications.laterPageStatus).toBe('idle')
    expect(pageOneGets(), 'no second recovery').toHaveLength(3)
  })

  it.each([
    {
      ...failingAnswers[500],
      shown: 'alice page one',
      pageOne: alicePageOne,
      keptUris: alicePageOneUris,
      keptSeenAt: '2026-10-12T09:15:30.123456789Z',
      keptStatus: 'ready',
    },
    {
      ...failingAnswers.network,
      shown: 'alice page one',
      pageOne: alicePageOne,
      keptUris: alicePageOneUris,
      keptSeenAt: '2026-10-12T09:15:30.123456789Z',
      keptStatus: 'ready',
    },
    {
      ...failingAnswers[500],
      shown: 'an empty page one with a cursor',
      pageOne: () =>
        json(200, {
          notifications: [],
          cursor: 'cursor-page-two-9f3k',
          seenAt: '2026-10-12T09:15:30.123456789Z',
        }),
      keptUris: [],
      keptSeenAt: '2026-10-12T09:15:30.123456789Z',
      keptStatus: 'empty',
    },
  ])(
    'keeps $shown and shows the later-page Retry footer, no page-one error, and logs once when the recovery load fails with $response; Retry reruns the recovery, which leaves recovery spent',
    async ({ answer, pageOne, keptUris, keptSeenAt, keptStatus }) => {
      const notifications = await listShowing(pageOne)
      expect(
        notifications.cursor,
        'precondition: page one shown with cursor c1',
      ).toBe('cursor-page-two-9f3k')

      await pageIntoInvalidCursor(notifications, 'cursor-page-two-9f3k')
      const recovery = recoveryGet(2)
      const loggedBefore = loggedNsids().length
      answer(recovery)
      await settle(svelte)

      expect(notifications.rows.map(rowUri)).toEqual(keptUris)
      expect(notifications.cursor).toBe('cursor-page-two-9f3k')
      expect(notifications.seenAt).toBe(keptSeenAt)
      expect(notifications.laterPageStatus).toBe('error')
      expect(
        notifications.status,
        'no page-one error alongside the footer',
      ).toBe(keptStatus)
      expect(
        loggedNsids().slice(loggedBefore),
        'the failed recovery load is logged once',
      ).toEqual([listNotificationsNsid])

      notifications.retryLaterPage()
      await settle(svelte)

      expect(
        pageOneGets(),
        'Retry reruns the recovery page-one load',
      ).toHaveLength(3)
      expect(
        laterGets('cursor-page-two-9f3k'),
        'Retry re-sends no later page',
      ).toHaveLength(1)

      pageOneGets()[2].resolve(recoveryPageOne())
      await settle(svelte)

      expect(notifications.rows.map(rowUri)).toEqual(recoveryUris)
      expect(notifications.cursor).toBe('cursor-recovery-6d2v')
      expect(notifications.seenAt).toBe('2026-10-12T11:00:00.000000004Z')
      expect(notifications.laterPageStatus).toBe('idle')

      await pageIntoInvalidCursor(notifications, 'cursor-recovery-6d2v')

      expect(
        notifications.laterPageStatus,
        'the retried recovery left recovery spent',
      ).toBe('error')
      expect(pageOneGets(), 'no further page-one GET').toHaveLength(3)
    },
  )

  describe('after an ordinary reload succeeds', () => {
    it('recovers once more on the next InvalidCursor when recovery was spent', async () => {
      const notifications = await displayedListShown(2)
      await pageIntoInvalidCursor(notifications, 'cursor-page-two-9f3k')
      recoveryGet(2).resolve(recoveryPageOne())
      await settle(svelte)

      await acceptedRefresh(3)
      expect(pageOneGets(), 'precondition: the reload is sent').toHaveLength(3)
      pageOneGets()[2].resolve(aliceReloadPageOne())
      await settle(svelte)
      expect(notifications.cursor, 'precondition: the reload is shown').toBe(
        'cursor-reload-4n8q',
      )

      await pageIntoInvalidCursor(notifications, 'cursor-reload-4n8q')
      recoveryGet(4).resolve(secondRecoveryPageOne())
      await settle(svelte)

      expect(notifications.rows.map(rowUri)).toEqual(secondRecoveryUris)
      expect(notifications.cursor).toBe('cursor-recovery-second-8w4c')
      expect(notifications.laterPageStatus).toBe('idle')
      expect(pageOneGets(), 'exactly one recovery').toHaveLength(4)
    })

    it('forgets a failed recovery: after a later recovery is spent, Retry re-sends the later-page cursor, not page one', async () => {
      const notifications = await displayedListShown(2)
      await pageIntoInvalidCursor(notifications, 'cursor-page-two-9f3k')
      recoveryGet(2).resolve(json(500, { error: 'InternalServerError' }))
      await settle(svelte)
      expect(
        notifications.laterPageStatus,
        'precondition: the failed recovery shows the footer',
      ).toBe('error')

      await acceptedRefresh(3)
      expect(pageOneGets(), 'precondition: the reload is sent').toHaveLength(3)
      pageOneGets()[2].resolve(aliceReloadPageOne())
      await settle(svelte)
      expect(
        notifications.laterPageStatus,
        'precondition: the reload clears the footer',
      ).toBe('idle')

      await pageIntoInvalidCursor(notifications, 'cursor-reload-4n8q')
      recoveryGet(4).resolve(recoveryPageOne())
      await settle(svelte)
      await pageIntoInvalidCursor(notifications, 'cursor-recovery-6d2v')
      expect(
        notifications.laterPageStatus,
        'precondition: the spent recovery shows the footer',
      ).toBe('error')

      notifications.retryLaterPage()
      await settle(svelte)

      expect(
        laterGets('cursor-recovery-6d2v'),
        'Retry re-sends the later-page cursor',
      ).toHaveLength(2)
      expect(pageOneGets(), 'Retry sends no page one').toHaveLength(4)
    })
  })

  it.each([
    {
      transition: 'bob signs in in place of alice',
      act: async () => {
        signIn(bob)
      },
      newPageOne: bobPageOne,
      newCursor: 'cursor-bob-page-two-7h2m',
    },
    {
      transition: 'alice logs out, then signs back in',
      act: async () => {
        await profile.remove(profile.current.id)
        svelte.flushSync()
        signIn(alice)
      },
      newPageOne: alicePageOne,
      newCursor: 'cursor-page-two-9f3k',
    },
  ])(
    'recovers once for the new list when $transition after recovery was spent',
    async ({ act, newPageOne, newCursor }) => {
      const notifications = await recoverySpentWithFooter()

      await act()
      await settle(svelte)
      expect(
        pageOneGets(),
        "precondition: the new owner's page one is sent",
      ).toHaveLength(3)
      pageOneGets()[2].resolve(newPageOne())
      await settle(svelte)
      expect(
        notifications.cursor,
        "precondition: the new owner's page one is shown",
      ).toBe(newCursor)

      await pageIntoInvalidCursor(notifications, newCursor)
      recoveryGet(4).resolve(secondRecoveryPageOne())
      await settle(svelte)

      expect(notifications.rows.map(rowUri)).toEqual(secondRecoveryUris)
      expect(notifications.cursor).toBe('cursor-recovery-second-8w4c')
      expect(pageOneGets(), 'exactly one recovery').toHaveLength(4)
    },
  )

  it('ignores an InvalidCursor for a later page sent before a reload started: no recovery, no footer, the reload rows kept', async () => {
    const notifications = await displayedListShown(2)
    notifications.loadMore()
    await settle(svelte)
    const stale = laterGets('cursor-page-two-9f3k')
    expect(stale, 'precondition: one later-page GET with c1').toHaveLength(1)
    await acceptedRefresh(3)
    expect(pageOneGets(), 'precondition: the reload is sent').toHaveLength(2)

    stale[0].resolve(invalidCursor())
    await settle(svelte)

    expect(pageOneGets(), 'no recovery page-one GET').toHaveLength(2)
    expect(notifications.laterPageStatus).not.toBe('error')

    pageOneGets()[1].resolve(aliceReloadPageOne())
    await settle(svelte)

    expect(notifications.rows.map(rowUri)).toEqual(aliceReloadUris)
    expect(notifications.cursor).toBe('cursor-reload-4n8q')
    expect(notifications.laterPageStatus).toBe('idle')
    expect(pageOneGets(), 'no recovery page-one GET').toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Restored from a return
// ---------------------------------------------------------------------------

describe('notification list restored from a return', () => {
  let visibility: ReturnType<typeof controlVisibility>

  beforeEach(async () => {
    visibility = controlVisibility('visible')
    // The list's own instance: imported after the file's module registry.
    unread = (await import('./unread.svelte')).unreadNotifications
  })

  afterEach(() => {
    visibility.restore()
  })

  /** Where alice was when she followed her reply row. */
  const followedPlace = {
    scrollY: 1200,
    targetPath: '/c/gardening/post/3kpostreply1',
  }

  /** Saves `original` as the followed row leaves it, then destroys it. */
  function saveAndDestroy(original: NotificationList) {
    const snapshot = original.snapshot(followedPlace)
    original.destroy()
    svelte.flushSync()
    return snapshot
  }

  /** Creates a list from `snapshot` and mounts it while visible. */
  function restoreList(
    snapshot: ReturnType<NotificationList['snapshot']>,
  ): NotificationList {
    const restored = createNotificationList({ restore: snapshot })
    list = restored
    restored.setMounted(true)
    svelte.flushSync()
    return restored
  }

  /** Saves `original`, destroys it and restores a mounted list from the save. */
  function restoredFrom(original: NotificationList): NotificationList {
    return restoreList(saveAndDestroy(original))
  }

  const invalidCursor = () =>
    json(400, { error: 'InvalidCursor', message: 'Invalid cursor' })

  describe('carrying the paging history', () => {
    it('sends the saved cursor c2 on loadMore(), and stops paging when its answer repeats c1', async () => {
      const original = await alicePageOneShown()
      original.loadMore()
      await settle(svelte)
      laterGets('cursor-page-two-9f3k')[0].resolve(
        json(200, {
          notifications: [
            laterReplyRow(
              'commentpagetwo1',
              'Page two reply',
              '2026-10-12T07:30:00.000Z',
            ),
          ],
          cursor: 'cursor-page-three-2x7p',
        }),
      )
      await settle(svelte)
      expect(
        original.cursor,
        'precondition: page two moved the cursor to c2',
      ).toBe('cursor-page-three-2x7p')

      const restored = restoredFrom(original)
      restored.loadMore()
      await settle(svelte)

      const sent = laterGets('cursor-page-three-2x7p')
      expect(sent, 'one later-page GET with the saved cursor c2').toHaveLength(
        1,
      )
      sent[0].resolve(
        json(200, {
          notifications: [
            laterReplyRow(
              'commentpagethree1',
              'Page three reply',
              '2026-10-12T07:00:00.000Z',
            ),
          ],
          cursor: 'cursor-page-two-9f3k',
        }),
      )
      await settle(svelte)

      expect(restored.cursor, 'the repeated c1 stops paging').toBeUndefined()
      restored.loadMore()
      await settle(svelte)
      expect(
        listGets().map((request) => request.searchParams.get('cursor')),
        'page one, c1 and c2 only',
      ).toEqual([null, 'cursor-page-two-9f3k', 'cursor-page-three-2x7p'])
    })

    it('sends nothing on loadMore() when the save was taken after paging stopped', async () => {
      const original = await alicePageOneShown()
      original.loadMore()
      await settle(svelte)
      laterGets('cursor-page-two-9f3k')[0].resolve(
        json(200, {
          notifications: [
            laterReplyRow(
              'commentlastpage1',
              'Last page reply',
              '2026-10-12T07:30:00.000Z',
            ),
          ],
        }),
      )
      await settle(svelte)
      expect(original.cursor, 'precondition: paging stopped').toBeUndefined()

      const restored = restoredFrom(original)
      restored.loadMore()
      await settle(svelte)

      expect(restored.rows.map(rowUri)).toEqual([
        ...alicePageOneUris,
        'at://did:plc:replier3/social.coves.community.comment/3kcommentlastpage1',
      ])
      expect(restored.cursor).toBeUndefined()
      expect(listGets(), 'page one and c1 only').toHaveLength(2)
    })
  })

  describe.each([
    { situation: 'the unread count is 3 at restore', act: async () => {} },
    {
      situation:
        'the document then goes hidden and visible and the next accepted refresh reports 3',
      act: async () => {
        visibility.set('hidden')
        await settle(svelte)
        const before = countGets().length
        visibility.set('visible')
        await answerCountGet(before, countAnswer(3))
      },
    },
  ])('when $situation', ({ act }) => {
    it("sends no page-one GET and no updateSeen, and shows alice's saved rows, cursor and seenAt", async () => {
      const original = await displayedListShown(3)
      const postsBefore = updateSeenPosts().length

      const restored = restoredFrom(original)
      await settle(svelte)
      await act()

      expect(pageOneGets(), 'no page-one GET after the save').toHaveLength(1)
      expect(
        updateSeenPosts().slice(postsBefore),
        'no updateSeen after the save',
      ).toEqual([])
      expect(restored.rows.map(rowUri)).toEqual(alicePageOneUris)
      expect(restored.cursor).toBe('cursor-page-two-9f3k')
      expect(restored.seenAt).toBe('2026-10-12T09:15:30.123456789Z')
      expect(restored.status).toBe('ready')
    })
  })

  it('runs exactly one page-one reload when an accepted refresh raises the restore-time count 3 to 4, replaces the restored rows and sends one updateSeen with its watermark', async () => {
    const original = await displayedListShown(3)
    const postsBefore = updateSeenPosts().length

    const restored = restoredFrom(original)
    await settle(svelte)
    expect(pageOneGets(), 'precondition: nothing sent at restore').toHaveLength(
      1,
    )

    await acceptedRefresh(4)

    const gets = pageOneGets()
    expect(gets, 'one page-one reload').toHaveLength(2)
    gets[1].resolve(aliceReloadPageOne())
    await settle(svelte)

    expect(restored.rows.map(rowUri)).toEqual(aliceReloadUris)
    expect(restored.cursor).toBe('cursor-reload-4n8q')
    expect(
      updateSeenPosts()
        .slice(postsBefore)
        .map((post) => post.body),
    ).toEqual([{ seenAt: '2026-10-12T10:05:00.000000002Z' }])
    expect(pageOneGets(), 'no further page-one GET').toHaveLength(2)
  })

  /** What is in flight when the row is followed, and when it settles. */
  interface PendingAtSave {
    /** The original list, displayed, with alice's page one shown. */
    original: NotificationList
    /** Runs after the original is destroyed, before the restore. */
    beforeRestore?: () => void
    /** Runs after the restore. */
    afterRestore?: () => void
    /** Row-specific checks on the restored list after the shared ones. */
    check?: (restored: NotificationList) => Promise<void>
  }

  /** Alice's page one shown with count 2, then a rise to 3 holds a reload. */
  async function reloadInFlight(): Promise<NotificationList> {
    const original = await displayedListShown(2)
    await acceptedRefresh(3)
    expect(pageOneGets(), 'precondition: the reload is in flight').toHaveLength(
      2,
    )
    return original
  }

  /** The restored list requests the saved c1 again on its first loadMore(). */
  async function requestsSavedCursorAgain(restored: NotificationList) {
    restored.loadMore()
    await settle(svelte)
    const sent = laterGets('cursor-page-two-9f3k')
    expect(sent, 'the restored list sends c1 again').toHaveLength(2)
    expect(sent[1].searchParams.get('cursor')).toBe('cursor-page-two-9f3k')
  }

  /**
   * The saved recovery was not spent by a recovery the save left behind:
   * the saved c1 is sent again and its InvalidCursor runs one silent
   * recovery page-one load, with no footer.
   */
  async function recoversOnceFromSavedCursor(restored: NotificationList) {
    restored.loadMore()
    await settle(svelte)
    const sent = laterGets('cursor-page-two-9f3k')
    expect(sent, 'the restored list sends c1 again').toHaveLength(2)
    sent[1].resolve(invalidCursor())
    await settle(svelte)
    expect(restored.laterPageStatus, 'no later-page footer').toBe('idle')
    expect(restored.rows.map(rowUri)).toEqual(alicePageOneUris)
    expect(pageOneGets(), 'one recovery page-one GET').toHaveLength(3)
  }

  describe.each([
    {
      pending:
        'a page-one reload in flight resolving after the original is destroyed and before the restore',
      pageOneGetsSent: 2,
      arrange: async (): Promise<PendingAtSave> => ({
        original: await reloadInFlight(),
        beforeRestore: () => pageOneGets()[1].resolve(aliceReloadPageOne()),
      }),
    },
    {
      pending: 'a page-one reload in flight resolving after the restore',
      pageOneGetsSent: 2,
      arrange: async (): Promise<PendingAtSave> => ({
        original: await reloadInFlight(),
        afterRestore: () => pageOneGets()[1].resolve(aliceReloadPageOne()),
      }),
    },
    {
      pending: 'a later page in flight failing with a 500 after the restore',
      pageOneGetsSent: 1,
      arrange: async (): Promise<PendingAtSave> => {
        const original = await displayedListShown(2)
        original.loadMore()
        await settle(svelte)
        expect(
          laterGets('cursor-page-two-9f3k'),
          'precondition: the later page is in flight',
        ).toHaveLength(1)
        return {
          original,
          afterRestore: () =>
            laterGets('cursor-page-two-9f3k')[0].resolve(
              json(500, { error: 'InternalServerError' }),
            ),
          check: requestsSavedCursorAgain,
        }
      },
    },
    {
      pending: 'a later page that failed with a 500 and shows its Retry footer',
      pageOneGetsSent: 1,
      arrange: async (): Promise<PendingAtSave> => {
        const original = await displayedListShown(2)
        original.loadMore()
        await settle(svelte)
        laterGets('cursor-page-two-9f3k')[0].resolve(
          json(500, { error: 'InternalServerError' }),
        )
        await settle(svelte)
        expect(
          original.laterPageStatus,
          'precondition: the later page failed with its Retry footer',
        ).toBe('error')
        return { original, check: requestsSavedCursorAgain }
      },
    },
    {
      pending: 'a reload queued behind an in-flight page-one load',
      pageOneGetsSent: 2,
      arrange: async (): Promise<PendingAtSave> => {
        const original = await reloadInFlight()
        await acceptedRefresh(4)
        expect(
          pageOneGets(),
          'precondition: the second rise is queued, not sent',
        ).toHaveLength(2)
        return {
          original,
          afterRestore: () => pageOneGets()[1].resolve(aliceReloadPageOne()),
        }
      },
    },
    {
      pending:
        'a recovery page-one load in flight after an InvalidCursor on c1',
      pageOneGetsSent: 2,
      arrange: async (): Promise<PendingAtSave> => {
        const original = await displayedListShown(2)
        original.loadMore()
        await settle(svelte)
        laterGets('cursor-page-two-9f3k')[0].resolve(invalidCursor())
        await settle(svelte)
        expect(
          pageOneGets(),
          'precondition: the recovery page one is in flight',
        ).toHaveLength(2)
        return { original, check: recoversOnceFromSavedCursor }
      },
    },
    {
      pending:
        'a recovery page-one load that failed after an InvalidCursor on c1 and shows its Retry footer',
      pageOneGetsSent: 2,
      arrange: async (): Promise<PendingAtSave> => {
        const original = await displayedListShown(2)
        original.loadMore()
        await settle(svelte)
        laterGets('cursor-page-two-9f3k')[0].resolve(invalidCursor())
        await settle(svelte)
        pageOneGets()[1].resolve(json(500, { error: 'InternalServerError' }))
        await settle(svelte)
        expect(
          original.laterPageStatus,
          'precondition: the failed recovery shows its Retry footer',
        ).toBe('error')
        return { original, check: recoversOnceFromSavedCursor }
      },
    },
  ])(
    'with $pending when the row is followed',
    ({ arrange, pageOneGetsSent }) => {
      it("keeps alice's saved rows, cursor, seenAt and no footer, runs no further page-one GET and sends no updateSeen", async () => {
        const { original, beforeRestore, afterRestore, check } = await arrange()
        const postsBefore = updateSeenPosts().length

        const snapshot = saveAndDestroy(original)
        beforeRestore?.()
        await settle(svelte)
        const restored = restoreList(snapshot)
        await settle(svelte)
        afterRestore?.()
        await settle(svelte)

        expect(restored.rows.map(rowUri)).toEqual(alicePageOneUris)
        expect(restored.cursor).toBe('cursor-page-two-9f3k')
        expect(restored.seenAt).toBe('2026-10-12T09:15:30.123456789Z')
        expect(restored.laterPageStatus).toBe('idle')
        expect(pageOneGets(), 'no page-one GET after the save').toHaveLength(
          pageOneGetsSent,
        )
        expect(
          updateSeenPosts().slice(postsBefore),
          'no updateSeen after the save',
        ).toEqual([])
        await check?.(restored)
      })
    },
  )

  it.each([
    {
      transition: 'bob is adopted and his page one fails',
      act: () => signIn(bob),
    },
    {
      transition: 'alice signs in again and her owner reload fails',
      act: () => signIn(alice),
    },
  ])(
    'reloads page one on the next visible return with unread items after a list restored while expired, then $transition',
    async ({ act }) => {
      const original = await displayedListShown(2)
      const snapshot = saveAndDestroy(original)
      profile.expireSession(profile.sessionGeneration)
      svelte.flushSync()
      expect(profile.sessionExpired, 'precondition: expired').toBe(true)
      restoreList(snapshot)
      await settle(svelte)
      const pageOnesAtRestore = pageOneGets().length

      const countsBefore = countGets().length
      act()
      await settle(svelte)
      for (const request of countGets().slice(countsBefore))
        countAnswer(2)(request)
      await settle(svelte)
      const sent = pageOneGets()
      expect(
        sent,
        'precondition: one page-one GET for the new session',
      ).toHaveLength(pageOnesAtRestore + 1)
      sent[pageOnesAtRestore].resolve(
        json(500, { error: 'InternalServerError' }),
      )
      await settle(svelte)

      visibility.set('hidden')
      await settle(svelte)
      const before = countGets().length
      visibility.set('visible')
      await answerCountGet(before, countAnswer(2))

      expect(
        pageOneGets(),
        'the visible return with unread items reloads page one',
      ).toHaveLength(pageOnesAtRestore + 2)
    },
  )
})
