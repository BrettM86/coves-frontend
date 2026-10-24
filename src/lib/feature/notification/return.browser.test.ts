// @vitest-environment jsdom
import type { BeforeNavigate } from '@sveltejs/kit'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  alice,
  bob,
  createGenerationFactory,
  createNotificationFetch,
  createSessionActions,
  json,
  settle,
} from './notification-test-harness'
import type { NotificationList, NotificationListSnapshot } from './list.svelte'
import type { NotificationRow } from './rows'

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
    scroll: null,
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
const notificationLog = vi.hoisted(() => ({
  logNotificationFailure: vi.fn<(nsid: string, error: unknown) => void>(),
}))
vi.mock('$lib/feature/notification/log', () => notificationLog)

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const nextGeneration = createGenerationFactory('return-generation')

let svelte: typeof import('svelte')
let profile: (typeof import('$lib/app/state/auth.svelte'))['profile']
let createNotificationList: (typeof import('./list.svelte'))['createNotificationList']
let notificationListReturn: (typeof import('./return.svelte'))['notificationListReturn']
/** Every list a test created; each is destroyed after the test. */
const lists: NotificationList[] = []
const profiles = new Set<typeof profile>()

const notificationFetch = createNotificationFetch()
const requests = notificationFetch.requests
const { signIn } = createSessionActions(
  () => ({ profile, svelte }),
  nextGeneration,
)

const fetchSpy = vi.fn<typeof fetch>()

const listNotificationsPath =
  /\/xrpc\/social\.coves\.notification\.listNotifications(\?|$)/

/** Every GET listNotifications sent without a cursor (page one), in send order. */
const pageOneGets = () =>
  requests.filter(
    (request) =>
      request.method === 'GET' &&
      listNotificationsPath.test(request.path) &&
      !request.searchParams.has('cursor'),
  )

const rowUri = (row: NotificationRow) =>
  row.reason === 'upvote' ? row.subject.uri : row.record.uri

function createList(
  options?: Parameters<typeof createNotificationList>[0],
): NotificationList {
  const created = createNotificationList(options)
  lists.push(created)
  svelte.flushSync()
  return created
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Alice's page one: one reply on her post, a cursor and the raw seenAt. */
const alicePageOne = () =>
  json(200, {
    notifications: [
      {
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
      },
    ],
    cursor: 'cursor-page-two-9f3k',
    seenAt: '2026-10-12T09:15:30.123456789Z',
  })

const aliceSavedUris = [
  'at://did:plc:replier1/social.coves.community.comment/3kcommentreply1',
]

/** The followed row's thread. */
const threadPath = '/c/gardening/post/3kpostreply1'

/** A `beforeNavigate` navigation of `type` to `path`, as Kit delivers it. */
const navigationTo = (
  type: BeforeNavigate['type'],
  path: string,
): Pick<BeforeNavigate, 'type' | 'to'> => ({
  type,
  to: {
    url: new URL(path, 'http://localhost'),
    params: {},
    route: { id: null },
    scroll: null,
  },
})

/**
 * Alice's list shows her page one, the row is followed: the list is saved
 * through the store, destroyed, and the outbound navigation is noted.
 */
async function aliceSavedOnTheThread(): Promise<NotificationListSnapshot> {
  signIn(alice)
  notificationFetch.answer = (request) => request.resolve(alicePageOne())
  const original = createList()
  await settle(svelte)
  notificationFetch.answer = undefined
  expect(
    original.rows.map(rowUri),
    "precondition: alice's page one is shown",
  ).toEqual(aliceSavedUris)

  const snapshot = original.snapshot({ scrollY: 1200, targetPath: threadPath })
  expect(snapshot, "precondition: alice's list saves a snapshot").toBeDefined()
  if (snapshot === undefined) throw new Error('no snapshot')
  notificationListReturn.save(snapshot)
  notificationListReturn.noteNavigation(navigationTo('link', threadPath))
  original.destroy()
  svelte.flushSync()
  return snapshot
}

beforeEach(async () => {
  localStorage.clear()
  vi.stubGlobal('__VERSION__', 'test')
  fetchSpy.mockReset().mockImplementation(notificationFetch.handle)
  vi.stubGlobal('fetch', fetchSpy)
  notificationLog.logNotificationFailure.mockReset()
  notificationFetch.reset()
  svelte = await import('svelte')
  profile = (await import('$lib/app/state/auth.svelte')).profile
  profiles.add(profile)
  createNotificationList = (await import('./list.svelte'))
    .createNotificationList
  notificationListReturn = (await import('./return.svelte'))
    .notificationListReturn
  profile.syncFromServer(undefined)
  svelte.flushSync()
  notificationListReturn.start()
  notificationListReturn.take()
})

afterEach(() => {
  for (const created of lists.splice(0)) created.destroy()
  notificationListReturn.take()
  svelte.flushSync()
  expect(notificationFetch.unexpectedUrls).toEqual([])
})

afterAll(() => {
  for (const instance of profiles) instance.mainEffect()
})

// ---------------------------------------------------------------------------
// Owner transitions on the thread
// ---------------------------------------------------------------------------

describe.each([
  {
    transition: 'alice logs out, then signs in as alice again',
    act: async () => {
      await profile.remove(profile.current.id)
      svelte.flushSync()
      expect(profile.isAuthenticated, 'precondition: signed out').toBe(false)
      signIn(alice)
    },
    currentDid: alice.did,
  },
  {
    transition: 'bob is adopted',
    act: async () => {
      signIn(bob)
    },
    currentDid: bob.did,
  },
  {
    transition: 'bob is adopted, then alice is adopted again',
    act: async () => {
      signIn(bob)
      signIn(alice)
    },
    currentDid: alice.did,
  },
])(
  'notification list return when $transition on the thread',
  ({ act, currentDid }) => {
    it("drops alice's save at once: the return takes nothing, and a list created then sends the current account's page one with none of alice's saved rows", async () => {
      await aliceSavedOnTheThread()
      const pageOnesBefore = pageOneGets().length

      await act()
      notificationListReturn.noteNavigation(
        navigationTo('popstate', '/notifications'),
      )
      const taken = notificationListReturn.take()

      expect(taken, 'no save is taken on the return').toBeUndefined()
      expect(
        profile.current.type === 'authenticated' && profile.current.did,
        'precondition: the current account',
      ).toBe(currentDid)
      const notifications = createList({ restore: taken })
      await settle(svelte)
      expect(
        pageOneGets().slice(pageOnesBefore),
        'one page-one GET for the current account',
      ).toHaveLength(1)
      expect(notifications.rows).toEqual([])
    })
  },
)

// ---------------------------------------------------------------------------
// Expiry on the thread
// ---------------------------------------------------------------------------

describe('notification list return when the session expires on the thread', () => {
  it("takes alice's save on the return, and a list created with it while expired shows her saved rows and sends no notification request", async () => {
    await aliceSavedOnTheThread()
    const requestsBefore = requests.length

    profile.expireSession(profile.sessionGeneration)
    svelte.flushSync()
    expect(profile.sessionExpired, 'precondition: expired').toBe(true)
    notificationListReturn.noteNavigation(
      navigationTo('popstate', '/notifications'),
    )
    const taken = notificationListReturn.take()

    expect(taken?.owner, "alice's save is taken").toBe(alice.did)
    expect(taken?.rows.map(rowUri)).toEqual(aliceSavedUris)
    const notifications = createList({ restore: taken })
    await settle(svelte)
    expect(notifications.rows.map(rowUri)).toEqual(aliceSavedUris)
    expect(notifications.cursor).toBe('cursor-page-two-9f3k')
    expect(notifications.seenAt).toBe('2026-10-12T09:15:30.123456789Z')
    expect(
      requests.slice(requestsBefore),
      'no notification request after the expiry',
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Taking a save no return marked
// ---------------------------------------------------------------------------

describe('notification list return without a marked return', () => {
  it('takes nothing and holds no save afterwards when the save was never marked for a return', async () => {
    await aliceSavedOnTheThread()

    expect(
      notificationListReturn.take(),
      'an unmarked save is not taken',
    ).toBeUndefined()
    notificationListReturn.noteNavigation(
      navigationTo('popstate', '/notifications'),
    )
    expect(
      notificationListReturn.take(),
      'the unmarked take cleared the store',
    ).toBeUndefined()
  })
})
