// @vitest-environment jsdom
import type { AfterNavigate, BeforeNavigate } from '@sveltejs/kit'
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
  accessibleName,
  alice,
  controlVisibility,
  createGenerationFactory,
  createNotificationFetch,
  createSessionActions,
  installIntersectionObserverStub,
  json,
  settle,
  type IntersectionObserverStub,
  type NotificationRequest,
} from '$lib/feature/notification/notification-test-harness'

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
/**
 * The `beforeNavigate` and `afterNavigate` callbacks of the mounted
 * components. As Kit does, each is dropped when the component that registered
 * it is destroyed, through the current svelte runtime's `onDestroy`.
 */
const navigationHooks = vi.hoisted(() => {
  const hooks = {
    before: new Set<(navigation: BeforeNavigate) => void>(),
    after: new Set<(navigation: AfterNavigate) => void>(),
    onDestroy: undefined as ((callback: () => void) => void) | undefined,
    register<Callback>(callbacks: Set<Callback>, callback: Callback) {
      callbacks.add(callback)
      hooks.onDestroy?.(() => callbacks.delete(callback))
    },
  }
  return hooks
})
vi.mock('$app/navigation', () => ({
  invalidate: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
  goto: vi.fn(),
  pushState: vi.fn(),
  replaceState: vi.fn(),
  afterNavigate: vi.fn((callback: (navigation: AfterNavigate) => void) =>
    navigationHooks.register(navigationHooks.after, callback),
  ),
  beforeNavigate: vi.fn((callback: (navigation: BeforeNavigate) => void) =>
    navigationHooks.register(navigationHooks.before, callback),
  ),
}))
/** Kit's `navigating`: the navigation in progress, as the driver sets it. */
const navigatingState = vi.hoisted(() => ({
  type: null as string | null,
  from: null as { url: URL } | null,
  to: null as { url: URL } | null,
}))
vi.mock('$app/state', () => ({
  page: {
    url: new URL('http://localhost/notifications'),
    data: {},
    params: {},
    route: { id: '/notifications' },
    status: 200,
    state: {},
  },
  navigating: navigatingState,
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
//
// Every test resets the module registry and imports svelte, the profile, the
// locale and the page afresh, so the page and the test share one instance
// set. Resetting modules does not dispose effects: the mounted route is
// unmounted after each test and every profile instance's `mainEffect` is
// disposed after the file.
// ---------------------------------------------------------------------------

const nextGeneration = createGenerationFactory('notifications-page-generation')

const listNotificationsPath =
  /\/xrpc\/social\.coves\.notification\.listNotifications(\?|$)/

let svelte: typeof import('svelte')
let profile: (typeof import('$lib/app/state/auth.svelte'))['profile']
let settings: (typeof import('$lib/app/state/settings.svelte'))['settings']
let notificationListReturn: (typeof import('$lib/feature/notification/return.svelte'))['notificationListReturn']
let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
/** Every profile instance imported in this file; each one's effect is disposed. */
const profiles = new Set<typeof profile>()

const fetchSpy = vi.fn<typeof fetch>()

const notificationFetch = createNotificationFetch()
const requests = notificationFetch.requests
const { signIn, expireAndReviveSameGeneration } = createSessionActions(
  () => ({ profile, svelte }),
  nextGeneration,
)

/**
 * Imports svelte, the profile, the settings and the locale from the current
 * module registry and pins English.
 */
async function importInstances() {
  // `vi.resetModules()` keeps a mock factory's cached result, so the hoisted
  // svelte mocks would hand back the previous runtime while the components
  // load a fresh `svelte/internal/client` (`effect_orphan`). Re-register them.
  vi.doMock('svelte', () => svelteClientEntry('src/index-client.js'))
  vi.doMock('svelte/reactivity', () =>
    svelteClientEntry('src/reactivity/index-client.js'),
  )
  svelte = await import('svelte')
  navigationHooks.onDestroy = svelte.onDestroy
  profile = (await import('$lib/app/state/auth.svelte')).profile
  profiles.add(profile)
  settings = (await import('$lib/app/state/settings.svelte')).settings
  notificationListReturn = (
    await import('$lib/feature/notification/return.svelte')
  ).notificationListReturn
  const { locale } = await import('$lib/app/state/i18n')
  locale.set('en')
}

/** Mounts a fresh instance of the route `+page.svelte` into `target`. */
async function mountPage() {
  const Page = (await import('./+page.svelte')).default
  mounted = svelte.mount(Page, { target, intro: false })
  svelte.flushSync()
}

async function unmountPage() {
  if (mounted) await svelte.unmount(mounted, { outro: false })
  mounted = undefined
  svelte.flushSync()
}

/** Every GET listNotifications the fetch spy has seen, in send order. */
const listGets = () =>
  requests.filter(
    (request) =>
      request.method === 'GET' && listNotificationsPath.test(request.path),
  )

/** Answers every notification request with `body` as it is sent. */
function answerWith(body: unknown) {
  notificationFetch.answer = (request: NotificationRequest) =>
    request.resolve(json(200, body))
}

const text = () => target.textContent ?? ''

const spinner = () => target.querySelector('svg[role="status"]')

/** The text of every heading the page shows, in page order. */
const headings = () =>
  [...target.querySelectorAll('h1, h2, h3')].map((heading) =>
    heading.textContent?.trim(),
  )

/**
 * Every notification row's link in page order, as `[href, component]`: an
 * UpvoteRow shows its upvoter avatars, a ReplyCard its author.
 */
const rowLinks = () =>
  [...target.querySelectorAll('a')]
    .filter((link) => link.querySelector('[data-part]') !== null)
    .map((link) => [
      link.getAttribute('href'),
      link.querySelector('[data-part="avatars"]')
        ? 'UpvoteRow'
        : link.querySelector('[data-part="author"]')
          ? 'ReplyCard'
          : 'unknown',
    ])

const alert = () => target.querySelector('[role="alert"]')

const retryButton = () =>
  [...target.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Retry',
  )

const emptyTitle = 'No notifications yet'
const emptyDescription = 'Replies, mentions and likes will appear here.'
const loadFailed = 'Could not load notifications.'

// ---------------------------------------------------------------------------
// Wire fixtures: plain JSON rows as the server sends them. Each row's link
// target is a literal in the expectations below.
// ---------------------------------------------------------------------------

/** A served community whose route segment is "gardening.local.coves.dev". */
const gardening = {
  did: 'did:plc:gardening',
  handle: 'c-gardening.local.coves.dev',
  name: 'gardening',
}

/** An upvote group on the viewer's post "Seed swap". */
const upvoteOnPost = {
  reason: 'upvote',
  sortAt: '2026-10-12T09:40:00.123456789Z',
  isRead: false,
  rootPost: {
    uri: 'at://did:plc:viewer7f3kq2/social.coves.community.post/3kpostup1',
    cid: 'bafyreibrootup1cid',
    title: 'Seed swap',
    community: gardening,
  },
  subject: {
    uri: 'at://did:plc:viewer7f3kq2/social.coves.community.post/3kpostup1',
    cid: 'bafyreibrootup1cid',
    preview: 'Seed swap',
  },
  upvoteCount: 3,
  recentUpvoters: [
    { did: 'did:plc:voterup1', handle: 'voterup1.local.coves.dev' },
  ],
}
const upvoteOnPostHref =
  '/c/gardening.local.coves.dev/post/did%3Aplc%3Aviewer7f3kq2/3kpostup1'

/** An upvote group on the viewer's comment under someone else's thread. */
const upvoteOnComment = {
  reason: 'upvote',
  sortAt: '2026-10-12T09:35:00.123456789Z',
  isRead: true,
  rootPost: {
    uri: 'at://did:plc:opuc1/social.coves.community.post/3kthreaduc1',
    cid: 'bafyreibrootuc1cid',
    title: 'Compost bins',
    community: gardening,
  },
  subject: {
    uri: 'at://did:plc:viewer7f3kq2/social.coves.community.comment/3kcommentuc1',
    cid: 'bafyreibsubjectuc1cid',
    preview: 'Use a tumbler',
  },
  upvoteCount: 1,
  recentUpvoters: [
    { did: 'did:plc:voteruc1', handle: 'voteruc1.local.coves.dev' },
  ],
}
const upvoteOnCommentHref =
  '/c/gardening.local.coves.dev/post/did%3Aplc%3Aopuc1/3kthreaduc1/comment/did%3Aplc%3Aviewer7f3kq2/3kcommentuc1'

/** A reply row from `replier<key>` with the given reason and root. */
function replyRow(
  key: string,
  reason: 'postReply' | 'commentReply' | 'mention',
  rootPost: Record<string, unknown>,
  excerpt: string,
) {
  return {
    reason,
    sortAt: '2026-10-12T09:30:00.123456789Z',
    isRead: false,
    rootPost,
    record: {
      uri: `at://did:plc:replier${key}/social.coves.community.comment/3kcomment${key}`,
      cid: `bafyreibrecord${key}cid`,
      excerpt,
      createdAt: '2026-10-12T09:29:58.000Z',
    },
    author: {
      did: `did:plc:replier${key}`,
      handle: `replier${key}.local.coves.dev`,
      displayName: `Replier ${key}`,
    },
  }
}

const postReply = replyRow(
  'pr1',
  'postReply',
  {
    uri: 'at://did:plc:viewer7f3kq2/social.coves.community.post/3kpostpr1',
    cid: 'bafyreibrootpr1cid',
    title: 'Tomato blight',
    community: gardening,
  },
  'Try copper spray',
)
const postReplyHref =
  '/c/gardening.local.coves.dev/post/did%3Aplc%3Aviewer7f3kq2/3kpostpr1/comment/replierpr1.local.coves.dev/3kcommentpr1'

const commentReply = replyRow(
  'cr1',
  'commentReply',
  {
    uri: 'at://did:plc:opcr1/social.coves.community.post/3kthreadcr1',
    cid: 'bafyreibrootcr1cid',
    title: 'Raised beds',
    community: gardening,
  },
  'Cedar lasts longer',
)
const commentReplyHref =
  '/c/gardening.local.coves.dev/post/did%3Aplc%3Aopcr1/3kthreadcr1/comment/repliercr1.local.coves.dev/3kcommentcr1'

const mention = replyRow(
  'mc1',
  'mention',
  {
    uri: 'at://did:plc:opmc1/social.coves.community.post/3kthreadmc1',
    cid: 'bafyreibrootmc1cid',
    title: 'Pollinators',
    community: gardening,
  },
  'Ask the viewer about bees',
)
const mentionHref =
  '/c/gardening.local.coves.dev/post/did%3Aplc%3Aopmc1/3kthreadmc1/comment/repliermc1.local.coves.dev/3kcommentmc1'

/** A reply under a root the moderators removed: no title, no community. */
const replyUnderRemovedRoot = replyRow(
  'dr1',
  'postReply',
  {
    uri: 'at://did:plc:posterdr1/social.coves.community.post/3kthreaddr1',
    cid: 'bafyreibrootdr1cid',
    status: 'removedByModerator',
  },
  'Still worth reading',
)
const replyUnderRemovedRootHref =
  '/c/did%3Aplc%3Aposterdr1/post/did%3Aplc%3Aposterdr1/3kthreaddr1/comment/replierdr1.local.coves.dev/3kcommentdr1'

/** A reason this client does not know: the page must not render it. */
const invalidRow = {
  reason: 'follow',
  sortAt: '2026-10-12T09:20:00.000Z',
  isRead: false,
  rootPost: {
    uri: 'at://did:plc:viewer7f3kq2/social.coves.community.post/3kpostinvalid1',
    cid: 'bafyreibrootinvalid1cid',
    title: 'Invisible thread',
  },
}

const seenAt = '2026-10-12T09:15:30.123456789Z'

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  vi.stubGlobal('__VERSION__', 'test')
  fetchSpy.mockReset().mockImplementation(notificationFetch.handle)
  vi.stubGlobal('fetch', fetchSpy)
  notificationLog.logNotificationFailure.mockReset()
  notificationFetch.reset()
  navigationHooks.before.clear()
  navigationHooks.after.clear()
  Object.assign(navigatingState, { type: null, from: null, to: null })
  await importInstances()
  profile.syncFromServer(undefined)
  svelte.flushSync()
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  await unmountPage()
  target.remove()
  vi.unstubAllGlobals()
  expect(notificationFetch.unexpectedUrls).toEqual([])
})

afterAll(() => {
  for (const instance of profiles) instance.mainEffect()
})

// ---------------------------------------------------------------------------
// Behaviors
// ---------------------------------------------------------------------------

describe('notifications page loading', () => {
  it('shows the title and a spinner while page one is pending, and never the empty state before page one resolves with rows', async () => {
    // Records every text the page ever puts in the DOM, including nodes that
    // are added and removed again before the end of the test.
    const seenTexts: string[] = []
    const record = (mutations: MutationRecord[]) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes)
          seenTexts.push(node.textContent ?? '')
        if (mutation.type === 'characterData')
          seenTexts.push(mutation.target.textContent ?? '')
      }
    }
    const observer = new MutationObserver(record)
    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    signIn(alice)
    await mountPage()
    await settle(svelte)

    expect(headings()).toContain('Notifications')
    expect(spinner(), 'spinner while page one is pending').not.toBeNull()
    expect(listGets(), 'one page-one request').toHaveLength(1)

    listGets()[0].resolve(json(200, { notifications: [postReply], seenAt }))
    await settle(svelte)
    record(observer.takeRecords())
    observer.disconnect()

    expect(rowLinks()).toEqual([[postReplyHref, 'ReplyCard']])
    expect(spinner(), 'no spinner once page one shows').toBeNull()
    expect(seenTexts.filter((seen) => seen.includes(emptyTitle))).toEqual([])
    expect(seenTexts.filter((seen) => seen.includes(emptyDescription))).toEqual(
      [],
    )
  })

  it('renders nothing and sends no reload after it unmounts with page one in flight', async () => {
    const generation = signIn(alice)
    await mountPage()
    await settle(svelte)
    expect(
      listGets(),
      'precondition: page one requested on mount',
    ).toHaveLength(1)

    await unmountPage()
    listGets()[0].resolve(json(200, { notifications: [postReply], seenAt }))
    await settle(svelte)

    expect(target.innerHTML).toBe('')

    expireAndReviveSameGeneration(alice, generation)
    await settle(svelte)

    expect(listGets(), 'no request after unmount').toHaveLength(1)
    expect(target.innerHTML).toBe('')
  })

  it('loads page one again for a fresh mount under the same session and shows its rows', async () => {
    signIn(alice)
    answerWith({ notifications: [postReply], seenAt })
    await mountPage()
    await settle(svelte)
    expect(
      rowLinks(),
      'precondition: the first mount shows its page one',
    ).toEqual([[postReplyHref, 'ReplyCard']])

    await unmountPage()
    notificationFetch.answer = undefined
    await mountPage()
    await settle(svelte)

    expect(listGets(), 'one new page-one request').toHaveLength(2)
    listGets()[1].resolve(json(200, { notifications: [mention], seenAt }))
    await settle(svelte)

    expect(rowLinks()).toEqual([[mentionHref, 'ReplyCard']])
    expect(text()).toContain('Ask the viewer about bees')
    expect(text()).not.toContain('Try copper spray')
  })
})

describe('notifications page rows', () => {
  it.each([
    {
      page: 'a mixed page',
      notifications: [
        upvoteOnPost,
        postReply,
        invalidRow,
        commentReply,
        mention,
        replyUnderRemovedRoot,
      ],
      expected: [
        [upvoteOnPostHref, 'UpvoteRow'],
        [postReplyHref, 'ReplyCard'],
        [commentReplyHref, 'ReplyCard'],
        [mentionHref, 'ReplyCard'],
        [replyUnderRemovedRootHref, 'ReplyCard'],
      ],
    },
    {
      page: 'an upvote-only page',
      notifications: [upvoteOnPost, invalidRow, upvoteOnComment],
      expected: [
        [upvoteOnPostHref, 'UpvoteRow'],
        [upvoteOnCommentHref, 'UpvoteRow'],
      ],
    },
  ])(
    'renders every valid row of $page with its component in server order, and no empty state',
    async ({ notifications, expected }) => {
      signIn(alice)
      answerWith({ notifications, seenAt })
      await mountPage()
      await settle(svelte)

      expect(rowLinks()).toEqual(expected)
      expect(text()).not.toContain('Invisible thread')
      expect(text()).not.toContain(emptyTitle)
      expect(spinner()).toBeNull()
    },
  )

  it('shows the empty state when page one has no notifications', async () => {
    signIn(alice)
    answerWith({ notifications: [], seenAt })
    await mountPage()
    await settle(svelte)

    expect(text()).toContain(emptyTitle)
    expect(text()).toContain(emptyDescription)
    expect(spinner()).toBeNull()
    expect(rowLinks()).toEqual([])
  })
})

describe('notifications page failure', () => {
  it.each([
    {
      failure: 'a 500',
      fail: (request: NotificationRequest) =>
        request.resolve(
          json(500, { error: 'InternalServerError', message: 'boom' }),
        ),
    },
    {
      failure: 'a network rejection',
      fail: (request: NotificationRequest) =>
        request.reject(new TypeError('Failed to fetch')),
    },
  ])(
    'shows the load error with Retry after $failure, and Retry sends one more page-one request whose rows replace the error',
    async ({ fail }) => {
      signIn(alice)
      notificationFetch.answer = fail
      await mountPage()
      await settle(svelte)

      expect(alert()?.textContent?.trim()).toBe(loadFailed)
      const retry = retryButton()
      expect(retry, 'a Retry button').toBeDefined()
      expect(spinner()).toBeNull()
      expect(text()).not.toContain(emptyTitle)
      expect(listGets(), 'one failed page-one request').toHaveLength(1)

      answerWith({ notifications: [postReply], seenAt })
      retry?.click()
      await settle(svelte)

      expect(listGets(), 'exactly one more page-one request').toHaveLength(2)
      expect(rowLinks()).toEqual([[postReplyHref, 'ReplyCard']])
      expect(alert()).toBeNull()
      expect(text()).not.toContain(loadFailed)
    },
  )
})

describe('notifications page header', () => {
  it('links to the notification settings with the Settings icon', async () => {
    signIn(alice)
    answerWith({ notifications: [], seenAt })
    await mountPage()
    await settle(svelte)

    const link = target.querySelector('a[href="/settings/notifications"]')
    expect(link, 'a link to /settings/notifications').not.toBeNull()
    expect(link?.getAttribute('aria-label') ?? link?.textContent?.trim()).toBe(
      'Notification settings',
    )
    expect(link?.querySelector('svg.lucide-settings')).not.toBeNull()
  })
  it('gives the notification settings link a 44px target', async () => {
    signIn(alice)
    answerWith({ notifications: [], seenAt })
    await mountPage()
    await settle(svelte)

    const link = [...target.querySelectorAll('a')].find(
      (element) => accessibleName(element) === 'Notification settings',
    )
    expect(link, 'the Notification settings link').toBeDefined()
    expect(link?.classList.contains('size-11')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Batch 2: expired session, sensitive rows, reveal across a reload
// ---------------------------------------------------------------------------

describe('notifications page with an expired session', () => {
  it('sends nothing and shows no rows, spinner, empty state or error while expired, then loads page one after alice signs in again', async () => {
    signIn(alice)
    profile.expireSession(profile.sessionGeneration)
    svelte.flushSync()
    await mountPage()
    await settle(svelte)

    expect(listGets(), 'no request while expired').toEqual([])
    expect(rowLinks()).toEqual([])
    expect(spinner()).toBeNull()
    expect(text()).not.toContain(emptyTitle)
    expect(text()).not.toContain(emptyDescription)
    expect(text()).not.toContain(loadFailed)
    expect(alert()).toBeNull()

    answerWith({ notifications: [postReply], seenAt })
    signIn(alice)
    await settle(svelte)

    expect(listGets(), 'one page-one request after re-login').toHaveLength(1)
    expect(rowLinks()).toEqual([[postReplyHref, 'ReplyCard']])
    expect(text()).toContain('Try copper spray')
  })
})

describe('notifications page after the session drops', () => {
  it('shows a login link and no list once a stored signed-in profile drops to a guest that is not expired', async () => {
    // A hard load: localStorage holds alice's profile, but this page load has
    // no session generation yet, so a failed validation can drop it.
    signIn(alice)
    vi.resetModules()
    await importInstances()
    expect(profile.isAuthenticated, 'precondition: restored signed in').toBe(
      true,
    )
    // The list waits for the root layout's sync, which this load has not had.
    await mountPage()
    await settle(svelte)

    // The validation found no cookie: a guest, not an expired session.
    profile.syncFromServer(undefined, {})
    await settle(svelte)
    expect(profile.isAuthenticated, 'precondition: dropped').toBe(false)
    expect(profile.sessionExpired, 'precondition: not expired').toBe(false)

    const login = target.querySelector(
      'a[href="/login?redirect=%2Fnotifications"]',
    )
    expect(login, 'a login link back to /notifications').not.toBeNull()
    expect(login?.textContent?.trim()).toBe('Log in')
    expect(listGets(), 'no list request').toEqual([])
    expect(rowLinks()).toEqual([])
    expect(spinner()).toBeNull()
    expect(text()).not.toContain(emptyTitle)
  })
})

const nsfwLabels = { values: [{ val: 'nsfw' }] }

const sensitiveReplyBase = replyRow(
  'ns1',
  'postReply',
  {
    uri: 'at://did:plc:viewer7f3kq2/social.coves.community.post/3kpostns1',
    cid: 'bafyreibrootns1cid',
    title: 'Hot sauce',
    community: gardening,
  },
  'Ghost peppers everywhere',
)
/** A postReply whose record is NSFW-labelled, excerpt "Ghost peppers everywhere". */
const sensitiveReply = {
  ...sensitiveReplyBase,
  record: { ...sensitiveReplyBase.record, labels: nsfwLabels },
}
const sensitiveReplyHref =
  '/c/gardening.local.coves.dev/post/did%3Aplc%3Aviewer7f3kq2/3kpostns1/comment/replierns1.local.coves.dev/3kcommentns1'

const otherSensitiveReplyBase = replyRow(
  'ns3',
  'postReply',
  {
    uri: 'at://did:plc:viewer7f3kq2/social.coves.community.post/3kpostns3',
    cid: 'bafyreibrootns3cid',
    title: 'Salsa verde',
    community: gardening,
  },
  'Tomatillos need husking',
)
/** A second NSFW-labelled postReply, excerpt "Tomatillos need husking". */
const otherSensitiveReply = {
  ...otherSensitiveReplyBase,
  record: { ...otherSensitiveReplyBase.record, labels: nsfwLabels },
}
const otherSensitiveReplyHref =
  '/c/gardening.local.coves.dev/post/did%3Aplc%3Aviewer7f3kq2/3kpostns3/comment/replierns3.local.coves.dev/3kcommentns3'

/** An upvote group on the viewer's NSFW-labelled comment "Chili harvest close-up". */
const sensitiveUpvote = {
  reason: 'upvote',
  sortAt: '2026-10-12T09:25:00.123456789Z',
  isRead: false,
  rootPost: {
    uri: 'at://did:plc:opns2/social.coves.community.post/3kthreadns2',
    cid: 'bafyreibrootns2cid',
    title: 'Pepper season',
    community: gardening,
  },
  subject: {
    uri: 'at://did:plc:viewer7f3kq2/social.coves.community.comment/3kcommentns2',
    cid: 'bafyreibsubjectns2cid',
    preview: 'Chili harvest close-up',
    labels: nsfwLabels,
  },
  upvoteCount: 2,
  recentUpvoters: [
    { did: 'did:plc:voterns2', handle: 'voterns2.local.coves.dev' },
  ],
}
const sensitiveUpvoteHref =
  '/c/gardening.local.coves.dev/post/did%3Aplc%3Aopns2/3kthreadns2/comment/did%3Aplc%3Aviewer7f3kq2/3kcommentns2'

/** The Show button of the row whose link is `href`; it sits beside the link. */
const showButtonFor = (href: string) =>
  Array.from(
    target
      .querySelector(`a[href="${href}"]`)
      ?.parentElement?.querySelectorAll<HTMLButtonElement>(
        'button[aria-controls]',
      ) ?? [],
  ).find((button) => button.textContent?.includes('NSFW Content')) ?? null

describe('notifications page sensitive rows', () => {
  it('conceals two sensitive replies and a sensitive upvote, and Show reveals only the row it belongs to', async () => {
    settings.nsfwBlur = true
    signIn(alice)
    answerWith({
      notifications: [sensitiveReply, otherSensitiveReply, sensitiveUpvote],
      seenAt,
    })
    await mountPage()
    await settle(svelte)

    expect(rowLinks(), 'precondition: all three rows render').toEqual([
      [sensitiveReplyHref, 'ReplyCard'],
      [otherSensitiveReplyHref, 'ReplyCard'],
      [sensitiveUpvoteHref, 'UpvoteRow'],
    ])
    expect(target.innerHTML).not.toContain('Ghost peppers everywhere')
    expect(target.innerHTML).not.toContain('Tomatillos need husking')
    expect(target.innerHTML).not.toContain('Chili harvest close-up')

    const replyShow = showButtonFor(sensitiveReplyHref)
    expect(
      replyShow,
      'precondition: the reply has a Show button',
    ).not.toBeNull()
    replyShow?.click()
    await settle(svelte)

    expect(text()).toContain('Ghost peppers everywhere')
    expect(
      showButtonFor(sensitiveReplyHref)?.getAttribute('aria-expanded'),
    ).toBe('true')
    expect(
      target.innerHTML,
      'revealing one reply leaves the other reply concealed',
    ).not.toContain('Tomatillos need husking')
    expect(
      showButtonFor(otherSensitiveReplyHref)?.getAttribute('aria-expanded'),
    ).toBe('false')
    expect(target.innerHTML).not.toContain('Chili harvest close-up')
    expect(
      showButtonFor(sensitiveUpvoteHref)?.getAttribute('aria-expanded'),
    ).toBe('false')

    showButtonFor(sensitiveUpvoteHref)?.click()
    await settle(svelte)

    expect(text()).toContain('Chili harvest close-up')
    expect(text()).toContain('Ghost peppers everywhere')
    expect(target.innerHTML).not.toContain('Tomatillos need husking')

    // The other direction: a fresh mount starts concealed, and revealing the
    // upvote first must leave both replies concealed.
    await unmountPage()
    await mountPage()
    await settle(svelte)

    expect(
      target.innerHTML,
      'precondition: a fresh mount conceals the reply',
    ).not.toContain('Ghost peppers everywhere')
    expect(
      target.innerHTML,
      'precondition: a fresh mount conceals the other reply',
    ).not.toContain('Tomatillos need husking')
    expect(
      target.innerHTML,
      'precondition: a fresh mount conceals the upvote',
    ).not.toContain('Chili harvest close-up')

    const upvoteShow = showButtonFor(sensitiveUpvoteHref)
    expect(
      upvoteShow,
      'precondition: the upvote has a Show button',
    ).not.toBeNull()
    upvoteShow?.click()
    await settle(svelte)

    expect(text()).toContain('Chili harvest close-up')
    expect(
      showButtonFor(sensitiveUpvoteHref)?.getAttribute('aria-expanded'),
    ).toBe('true')
    expect(target.innerHTML).not.toContain('Ghost peppers everywhere')
    expect(target.innerHTML).not.toContain('Tomatillos need husking')
    expect(
      showButtonFor(sensitiveReplyHref)?.getAttribute('aria-expanded'),
    ).toBe('false')
    expect(
      showButtonFor(otherSensitiveReplyHref)?.getAttribute('aria-expanded'),
    ).toBe('false')

    showButtonFor(sensitiveReplyHref)?.click()
    await settle(svelte)

    expect(text()).toContain('Ghost peppers everywhere')
    expect(text()).toContain('Chili harvest close-up')
    expect(target.innerHTML).not.toContain('Tomatillos need husking')
  })

  it('keeps a revealed row revealed when a same-owner reload replaces it with changed content', async () => {
    settings.nsfwBlur = true
    const generation = signIn(alice)
    await mountPage()
    await settle(svelte)
    expect(listGets(), 'precondition: page one requested').toHaveLength(1)
    listGets()[0].resolve(
      json(200, { notifications: [sensitiveReply], seenAt }),
    )
    await settle(svelte)

    showButtonFor(sensitiveReplyHref)?.click()
    await settle(svelte)
    expect(text(), 'precondition: the row is revealed').toContain(
      'Ghost peppers everywhere',
    )

    expireAndReviveSameGeneration(alice, generation)
    await settle(svelte)
    expect(listGets(), 'precondition: the owner reload is sent').toHaveLength(2)

    listGets()[1].resolve(
      json(200, {
        notifications: [
          {
            ...sensitiveReply,
            record: {
              ...sensitiveReply.record,
              excerpt: 'Ghost peppers, edited',
            },
          },
        ],
        seenAt,
      }),
    )
    await settle(svelte)

    expect(text()).toContain('Ghost peppers, edited')
    expect(text()).not.toContain('Ghost peppers everywhere')
    expect(
      showButtonFor(sensitiveReplyHref)?.getAttribute('aria-expanded'),
    ).toBe('true')
  })
})

// ---------------------------------------------------------------------------
// Mark seen
// ---------------------------------------------------------------------------

const updateSeenPath = /\/xrpc\/social\.coves\.notification\.updateSeen$/
const getUnreadCountPath =
  /\/xrpc\/social\.coves\.notification\.getUnreadCount$/

/** Every POST updateSeen the fetch spy has seen, in send order. */
const updateSeenPosts = () =>
  requests.filter(
    (request) => request.method === 'POST' && updateSeenPath.test(request.path),
  )

const fetchUrl = (input: RequestInfo | URL) =>
  input instanceof Request ? input.url : String(input)

describe('notifications page marking page one seen', () => {
  let visibility: ReturnType<typeof controlVisibility>

  beforeEach(() => {
    visibility = controlVisibility('visible')
  })

  afterEach(() => {
    visibility.restore()
  })

  /** Hides the document, then shows it again. */
  async function hideThenShow() {
    visibility.set('hidden')
    await settle(svelte)
    visibility.set('visible')
    await settle(svelte)
  }

  it('sends one updateSeen with the newest sortAt byte for byte once page one is in the document, with every row shown when it is sent', async () => {
    // What the page shows and the raw body at the moment the POST is sent.
    // Recorded, not asserted, here: a throw inside fetch would become a failed
    // POST that the list swallows.
    const sent: { rows: ReturnType<typeof rowLinks>; body: unknown }[] = []
    fetchSpy.mockImplementation((input, init) => {
      if (
        updateSeenPath.test(
          new URL(fetchUrl(input), 'http://localhost').pathname,
        )
      )
        sent.push({
          rows: rowLinks(),
          body: init?.body,
        })
      return notificationFetch.handle(input, init)
    })

    signIn(alice)
    await mountPage()
    await settle(svelte)
    expect(listGets(), 'precondition: page one requested').toHaveLength(1)

    // The newest row is listed last, so "the first row" is the wrong answer.
    listGets()[0].resolve(
      json(200, {
        notifications: [
          { ...upvoteOnPost, sortAt: '2026-10-12T09:00:00.5Z' },
          {
            ...replyUnderRemovedRoot,
            reason: 'commentReply',
            sortAt: '2026-10-12T08:00:00Z',
          },
          { ...postReply, sortAt: '2026-10-12T10:00:00.123456789Z' },
        ],
        seenAt,
      }),
    )
    await settle(svelte)

    const posts = updateSeenPosts()
    expect(posts, 'exactly one updateSeen').toHaveLength(1)
    expect(sent).toEqual([
      {
        rows: [
          [upvoteOnPostHref, 'UpvoteRow'],
          [replyUnderRemovedRootHref, 'ReplyCard'],
          [postReplyHref, 'ReplyCard'],
        ],
        body: '{"seenAt":"2026-10-12T10:00:00.123456789Z"}',
      },
    ])
  })

  it.each([
    {
      when: 'unmounted before page one resolves',
      act: async () => {
        await mountPage()
        await settle(svelte)
        expect(listGets(), 'precondition: page one requested').toHaveLength(1)
        await unmountPage()
        listGets()[0].resolve(json(200, { notifications: [postReply], seenAt }))
        await settle(svelte)
      },
    },
    {
      when: 'unmounted while hidden after page one resolved',
      act: async () => {
        visibility.set('hidden')
        await mountPage()
        await settle(svelte)
        expect(listGets(), 'precondition: page one requested').toHaveLength(1)
        listGets()[0].resolve(json(200, { notifications: [postReply], seenAt }))
        await settle(svelte)
        expect(rowLinks(), 'precondition: page one shown').toEqual([
          [postReplyHref, 'ReplyCard'],
        ])
        await unmountPage()
      },
    },
    {
      when: 'unmounted as soon as page one enters the document',
      act: async () => {
        await mountPage()
        await settle(svelte)
        expect(listGets(), 'precondition: page one requested').toHaveLength(1)
        // Unmounts from the mutation that adds the rows, before anything that
        // waits for the rows to render continues.
        let unmountedWithRows = false
        const observer = new MutationObserver(() => {
          if (!mounted || rowLinks().length === 0) return
          unmountedWithRows = true
          void svelte.unmount(mounted, { outro: false })
          mounted = undefined
        })
        observer.observe(target, { childList: true, subtree: true })
        listGets()[0].resolve(json(200, { notifications: [postReply], seenAt }))
        await settle(svelte)
        observer.disconnect()
        expect(
          unmountedWithRows,
          'precondition: unmounted with the rows in the document',
        ).toBe(true)
      },
    },
  ])(
    'sends no updateSeen when $when, even after the document becomes visible',
    async ({ act }) => {
      signIn(alice)
      await act()
      await hideThenShow()

      expect(updateSeenPosts()).toEqual([])
    },
  )
})

// ---------------------------------------------------------------------------
// Later pages: the sentinel, the footer and the read state
// ---------------------------------------------------------------------------

/** A postReply under "Tomato blight" from `replier<key>`. */
const laterReply = (key: string, excerpt: string) =>
  replyRow(key, 'postReply', postReply.rootPost, excerpt)

const mulch = laterReply('lp1', 'Mulch in spring')
const mulchHref =
  '/c/gardening.local.coves.dev/post/did%3Aplc%3Aviewer7f3kq2/3kpostpr1/comment/replierlp1.local.coves.dev/3kcommentlp1'
const dawn = laterReply('lp2', 'Water at dawn')
const dawnHref =
  '/c/gardening.local.coves.dev/post/did%3Aplc%3Aviewer7f3kq2/3kpostpr1/comment/replierlp2.local.coves.dev/3kcommentlp2'
const prune = laterReply('lp3', 'Prune in autumn')
const pruneHref =
  '/c/gardening.local.coves.dev/post/did%3Aplc%3Aviewer7f3kq2/3kpostpr1/comment/replierlp3.local.coves.dev/3kcommentlp3'

const listNotificationsNsid = 'social.coves.notification.listNotifications'

/** The page-one GETs: the ones sent without a cursor. */
const pageOneGets = () =>
  listGets().filter((request) => !request.searchParams.has('cursor'))

/** The GETs sent with `cursor`. */
const getsWithCursor = (cursor: string) =>
  listGets().filter((request) => request.searchParams.get('cursor') === cursor)

/** The `data-unread` value of the row whose link is `href`, or null. */
const unreadFor = (href: string) =>
  target
    .querySelector(`a[href="${href}"]`)
    ?.closest('li')
    ?.querySelector('[data-unread]')
    ?.getAttribute('data-unread') ?? null

describe('notifications page later pages', () => {
  let observerStub: IntersectionObserverStub

  beforeEach(() => {
    observerStub = installIntersectionObserverStub(vi.stubGlobal)
    // updateSeen after page one is answered at once; list GETs are held.
    notificationFetch.answer = (request) => {
      if (request.method === 'POST' && updateSeenPath.test(request.path))
        request.resolve(json(200, {}))
    }
  })

  /** Signs alice in, mounts the page and shows page one. */
  async function showPageOne(body: Record<string, unknown>) {
    signIn(alice)
    await mountPage()
    await settle(svelte)
    expect(pageOneGets(), 'precondition: page one requested').toHaveLength(1)
    pageOneGets()[0].resolve(json(200, body))
    await settle(svelte)
  }

  /** The one live sentinel observer; it must use rootMargin 300px. */
  function sentinel() {
    const observing = observerStub.observing()
    expect(
      observing.map((observer) => observer.rootMargin),
      'one sentinel observer with rootMargin 300px',
    ).toEqual(['300px'])
    return observing[0]
  }

  async function intersect(isIntersecting: boolean) {
    sentinel().deliver(isIntersecting)
    await settle(svelte)
  }

  describe.each([{ infiniteScroll: true }, { infiniteScroll: false }])(
    'with infiniteScroll $infiniteScroll',
    ({ infiniteScroll }) => {
      let previous: boolean

      beforeEach(() => {
        previous = settings.infiniteScroll
        settings.infiniteScroll = infiniteScroll
      })

      afterEach(() => {
        settings.infiniteScroll = previous
      })

      it('requests cursor c1 once when the sentinel intersects, and appends its rows after page one in order', async () => {
        await showPageOne({
          notifications: [postReply],
          cursor: 'c1',
          seenAt,
        })
        expect(
          getsWithCursor('c1'),
          'no later page before the sentinel intersects',
        ).toEqual([])

        await intersect(true)
        expect(getsWithCursor('c1'), 'one request with cursor c1').toHaveLength(
          1,
        )

        await intersect(true)
        expect(
          getsWithCursor('c1'),
          'no second request while c1 is in flight',
        ).toHaveLength(1)
        expect(listGets()).toHaveLength(2)

        getsWithCursor('c1')[0].resolve(
          json(200, { notifications: [mulch, dawn] }),
        )
        await settle(svelte)

        expect(rowLinks()).toEqual([
          [postReplyHref, 'ReplyCard'],
          [mulchHref, 'ReplyCard'],
          [dawnHref, 'ReplyCard'],
        ])
        expect(
          listGets(),
          'no request after a page without cursor',
        ).toHaveLength(2)
      })
    },
  )

  it('keeps requesting the next cursor after each page while the sentinel stays intersecting, and stops once it reports not intersecting', async () => {
    await showPageOne({ notifications: [postReply], cursor: 'c1', seenAt })

    await intersect(true)
    expect(getsWithCursor('c1'), 'precondition: c1 requested').toHaveLength(1)

    getsWithCursor('c1')[0].resolve(
      json(200, { notifications: [mulch], cursor: 'c2' }),
    )
    await settle(svelte)
    expect(
      getsWithCursor('c2'),
      'c2 requested without a callback',
    ).toHaveLength(1)

    getsWithCursor('c2')[0].resolve(
      json(200, { notifications: [], cursor: 'c3' }),
    )
    await settle(svelte)
    expect(
      getsWithCursor('c3'),
      'c3 requested without a callback',
    ).toHaveLength(1)

    await intersect(false)
    getsWithCursor('c3')[0].resolve(
      json(200, { notifications: [dawn], cursor: 'c4' }),
    )
    await settle(svelte)

    expect(getsWithCursor('c4'), 'no request once not intersecting').toEqual([])
    expect(listGets()).toHaveLength(4)
    expect(rowLinks()).toEqual([
      [postReplyHref, 'ReplyCard'],
      [mulchHref, 'ReplyCard'],
      [dawnHref, 'ReplyCard'],
    ])
  })

  it('keeps the first occurrence of each row across and within later pages, renders no duplicate and raises no each_key_duplicate', async () => {
    const errors: string[] = []
    const onError = (event: ErrorEvent) =>
      errors.push(String(event.error ?? event.message))
    window.addEventListener('error', onError)
    const consoleError = vi.spyOn(console, 'error')
    try {
      await showPageOne({ notifications: [postReply], cursor: 'c1', seenAt })

      await intersect(true)
      expect(getsWithCursor('c1'), 'precondition: c1 requested').toHaveLength(1)
      getsWithCursor('c1')[0].resolve(
        json(200, {
          notifications: [
            {
              ...postReply,
              record: { ...postReply.record, excerpt: 'Copper spray again' },
            },
            mulch,
            { ...mulch, record: { ...mulch.record, excerpt: 'Mulch again' } },
            dawn,
          ],
          cursor: 'c2',
        }),
      )
      await settle(svelte)

      await intersect(true)
      expect(getsWithCursor('c2'), 'precondition: c2 requested').toHaveLength(1)
      getsWithCursor('c2')[0].resolve(
        json(200, {
          notifications: [
            { ...dawn, record: { ...dawn.record, excerpt: 'Dawn again' } },
            prune,
          ],
        }),
      )
      await settle(svelte)

      expect(rowLinks()).toEqual([
        [postReplyHref, 'ReplyCard'],
        [mulchHref, 'ReplyCard'],
        [dawnHref, 'ReplyCard'],
        [pruneHref, 'ReplyCard'],
      ])
      for (const kept of [
        'Try copper spray',
        'Mulch in spring',
        'Water at dawn',
        'Prune in autumn',
      ])
        expect(text()).toContain(kept)
      for (const dropped of ['Copper spray again', 'Mulch again', 'Dawn again'])
        expect(text()).not.toContain(dropped)
      expect(
        [
          ...errors,
          ...consoleError.mock.calls.map((call) => call.map(String).join(' ')),
        ].filter((message) => message.includes('each_key_duplicate')),
      ).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
      consoleError.mockRestore()
    }
  })

  const networkError = new TypeError('Failed to fetch')

  it.each([
    {
      failure: 'a 500',
      fail: (request: NotificationRequest) =>
        request.resolve(
          json(500, { error: 'InternalServerError', message: 'boom' }),
        ),
      logged: expect.objectContaining({ name: 'XrpcError', status: 500 }),
    },
    {
      failure: 'a network rejection',
      fail: (request: NotificationRequest) => request.reject(networkError),
      logged: networkError,
    },
  ])(
    'keeps page one and shows the footer with Retry after $failure on a later page, logs it once, and the sentinel requests nothing while the footer shows',
    async ({ fail, logged }) => {
      await showPageOne({ notifications: [postReply], cursor: 'c1', seenAt })

      await intersect(true)
      expect(getsWithCursor('c1'), 'precondition: c1 requested').toHaveLength(1)
      fail(getsWithCursor('c1')[0])
      await settle(svelte)

      expect(rowLinks()).toEqual([[postReplyHref, 'ReplyCard']])
      expect(alert()?.textContent?.trim()).toBe(loadFailed)
      expect(retryButton(), 'a Retry button').toBeDefined()
      expect(notificationLog.logNotificationFailure.mock.calls).toEqual([
        [listNotificationsNsid, logged],
      ])

      await intersect(true)
      expect(
        getsWithCursor('c1'),
        'no request from the sentinel while the footer shows',
      ).toHaveLength(1)
      expect(listGets()).toHaveLength(2)
    },
  )

  /** Status regions exposed to assistive technology (not under aria-hidden). */
  const exposedStatuses = (root: Element) =>
    [...root.querySelectorAll('[role="status"]')].filter(
      (element) => element.closest('[aria-hidden="true"]') === null,
    )

  /** The exposed status regions whose text is "Loading more notifications". */
  const loadingMore = () =>
    exposedStatuses(target).filter(
      (element) => element.textContent?.trim() === 'Loading more notifications',
    )

  it('shows a "Loading more notifications" status after the rows while a later page is pending, and removes it once the page arrives', async () => {
    await showPageOne({ notifications: [postReply], cursor: 'c1', seenAt })
    expect(loadingMore(), 'no status before a later page is requested').toEqual(
      [],
    )

    await intersect(true)
    expect(getsWithCursor('c1'), 'precondition: c1 requested').toHaveLength(1)

    const statuses = loadingMore()
    expect(statuses).toHaveLength(1)
    expect(
      exposedStatuses(statuses[0]),
      'no status region nested inside the loading status',
    ).toEqual([])
    const rowLink = target.querySelector(`a[href="${postReplyHref}"]`)
    expect(rowLink, 'precondition: the page-one row').not.toBeNull()
    expect(
      rowLink && statuses[0]
        ? rowLink.compareDocumentPosition(statuses[0]) &
            Node.DOCUMENT_POSITION_FOLLOWING
        : 0,
      'the status follows the rows',
    ).not.toBe(0)

    getsWithCursor('c1')[0].resolve(json(200, { notifications: [mulch] }))
    await settle(svelte)

    expect(rowLinks()).toEqual([
      [postReplyHref, 'ReplyCard'],
      [mulchHref, 'ReplyCard'],
    ])
    expect(loadingMore()).toEqual([])
  })

  it('removes the "Loading more notifications" status and shows the footer error when a later page fails', async () => {
    await showPageOne({ notifications: [postReply], cursor: 'c1', seenAt })

    await intersect(true)
    expect(getsWithCursor('c1'), 'precondition: c1 requested').toHaveLength(1)
    expect(loadingMore()).toHaveLength(1)

    getsWithCursor('c1')[0].reject(new TypeError('Failed to fetch'))
    await settle(svelte)

    expect(loadingMore()).toEqual([])
    expect(alert()?.textContent?.trim()).toBe(loadFailed)
  })

  it('Retry on the footer requests cursor c1 again, appends its rows and removes the footer', async () => {
    await showPageOne({ notifications: [postReply], cursor: 'c1', seenAt })

    await intersect(true)
    expect(getsWithCursor('c1'), 'precondition: c1 requested').toHaveLength(1)
    getsWithCursor('c1')[0].resolve(
      json(500, { error: 'InternalServerError', message: 'boom' }),
    )
    await settle(svelte)
    const retry = retryButton()
    expect(retry, 'a Retry button on the footer').toBeDefined()

    retry?.click()
    await settle(svelte)
    expect(getsWithCursor('c1'), 'c1 requested again').toHaveLength(2)

    getsWithCursor('c1')[1].resolve(json(200, { notifications: [mulch] }))
    await settle(svelte)

    expect(rowLinks()).toEqual([
      [postReplyHref, 'ReplyCard'],
      [mulchHref, 'ReplyCard'],
    ])
    expect(alert()).toBeNull()
    expect(retryButton()).toBeUndefined()
    expect(text()).not.toContain(loadFailed)
  })

  it("marks later-page rows read against page one's raw seenAt, ignoring later pages' seenAt and the server isRead", async () => {
    await showPageOne({
      notifications: [{ ...postReply, sortAt: '2026-10-12T09:00:00Z' }],
      cursor: 'c1',
      seenAt: '2026-10-12T10:00:00.000000005Z',
    })

    await intersect(true)
    expect(getsWithCursor('c1'), 'precondition: c1 requested').toHaveLength(1)
    getsWithCursor('c1')[0].resolve(
      json(200, {
        notifications: [
          { ...mulch, sortAt: '2026-10-12T10:00:00.000000004Z', isRead: false },
        ],
        cursor: 'c2',
        seenAt: '2026-10-12T11:00:00Z',
      }),
    )
    await settle(svelte)

    await intersect(true)
    expect(getsWithCursor('c2'), 'precondition: c2 requested').toHaveLength(1)
    getsWithCursor('c2')[0].resolve(
      json(200, {
        notifications: [
          { ...dawn, sortAt: '2026-10-12T10:00:00.000000006Z', isRead: true },
        ],
      }),
    )
    await settle(svelte)

    expect(rowLinks()).toEqual([
      [postReplyHref, 'ReplyCard'],
      [mulchHref, 'ReplyCard'],
      [dawnHref, 'ReplyCard'],
    ])
    expect(unreadFor(mulchHref), 'older than page one seenAt: read').toBeNull()
    expect(unreadFor(dawnHref), 'newer than page one seenAt: unread').toBe(
      'true',
    )
  })

  it('requests cursor c1 again without a new observer callback after expiry and same-owner revival reload page one with the same cursor', async () => {
    await showPageOne({ notifications: [postReply], cursor: 'c1', seenAt })
    const generation = profile.sessionGeneration
    expect(generation, 'precondition: a session generation').toBeDefined()

    await intersect(true)
    expect(getsWithCursor('c1'), 'precondition: c1 requested').toHaveLength(1)

    expireAndReviveSameGeneration(alice, generation ?? '')
    await settle(svelte)
    expect(pageOneGets(), 'precondition: page one reloaded').toHaveLength(2)
    pageOneGets()[1].resolve(
      json(200, { notifications: [postReply], cursor: 'c1', seenAt }),
    )
    await settle(svelte)

    expect(
      getsWithCursor('c1'),
      'c1 requested again while the sentinel stays intersecting',
    ).toHaveLength(2)
  })

  it('requests cursor c1 again without a new observer callback when a reload starts with c1 in flight and fails', async () => {
    const visibility = controlVisibility('visible')
    try {
      await showPageOne({ notifications: [postReply], cursor: 'c1', seenAt })
      await intersect(true)
      expect(getsWithCursor('c1'), 'precondition: c1 requested').toHaveLength(1)

      // The store adopts alice's session and reports 1, above the 0 the list
      // was created at: a rise, so page one reloads.
      const { unreadNotifications } =
        await import('$lib/feature/notification/unread.svelte')
      const stop = unreadNotifications.start()
      try {
        svelte.flushSync()
        await settle(svelte)
        const counts = requests.filter(
          (request) =>
            request.method === 'GET' && getUnreadCountPath.test(request.path),
        )
        expect(counts, 'precondition: one count GET').toHaveLength(1)
        counts[0].resolve(json(200, { count: 1 }))
        await settle(svelte)
        expect(pageOneGets(), 'precondition: the reload is sent').toHaveLength(
          2,
        )
        expect(
          getsWithCursor('c1'),
          'precondition: c1 not re-sent during the reload',
        ).toHaveLength(1)

        pageOneGets()[1].resolve(json(500, { error: 'InternalServerError' }))
        await settle(svelte)

        expect(
          getsWithCursor('c1'),
          'c1 requested again while the sentinel stays intersecting',
        ).toHaveLength(2)
      } finally {
        stop()
      }
    } finally {
      visibility.restore()
    }
  })

  it('replaces the empty placeholder with the rows of a later page when page one had none but a cursor', async () => {
    await showPageOne({ notifications: [], cursor: 'c1', seenAt })
    expect(text(), 'precondition: placeholder shown').toContain(emptyTitle)

    await intersect(true)
    expect(getsWithCursor('c1'), 'precondition: c1 requested').toHaveLength(1)
    getsWithCursor('c1')[0].resolve(json(200, { notifications: [mulch] }))
    await settle(svelte)

    expect(rowLinks()).toEqual([[mulchHref, 'ReplyCard']])
    expect(text()).not.toContain(emptyTitle)
  })
})

// ---------------------------------------------------------------------------
// Return restore: a row followed, then back to /notifications
// ---------------------------------------------------------------------------

const notificationsPath = '/notifications'

/** One client navigation: its Kit type and the destination href. */
interface Hop {
  readonly type: AfterNavigate['type']
  readonly to: string
  /** Where a loader redirect lands; Kit runs no second `beforeNavigate`. */
  readonly landsAt?: string
  /** Started while another navigation loads: Kit runs no `beforeNavigate`. */
  readonly interrupts?: true
  /** Interrupted by the next hop before it lands. */
  readonly abandoned?: true
}

/** The Kit route id of `path`, as the routes in src/routes name it. */
function routeIdFor(path: string): string {
  if (path.includes('/comment/'))
    return '/c/[handle=handle]/post/[owner=actor]/[rkey]/comment/[commenter=actor]/[crkey]'
  if (path.startsWith('/c/'))
    return '/c/[handle=handle]/post/[owner=actor]/[rkey]'
  return path
}

/** `mulchHref` with the post owner as a handle, where its loader redirects. */
const canonicalMulchHref = mulchHref.replace(
  'did%3Aplc%3Aviewer7f3kq2',
  'viewer.local.coves.dev',
)

/** A later-page row "Mulch in spring" newer than `restoreSeenAt`: unread. */
const unreadMulch = { ...mulch, sortAt: '2026-10-12T09:30:00Z', isRead: true }
/** A later-page row "Water at dawn" older than `restoreSeenAt`: read. */
const readDawn = { ...dawn, sortAt: '2026-10-12T09:20:00Z', isRead: false }
const restoreSeenAt = '2026-10-12T09:28:00Z'

/** The rows of the list `showListToFollow` builds, in page order. */
const savedRows = [
  [sensitiveReplyHref, 'ReplyCard'],
  [upvoteOnCommentHref, 'UpvoteRow'],
  [mulchHref, 'ReplyCard'],
  [dawnHref, 'ReplyCard'],
]

describe('notifications page return restore', () => {
  let observerStub: IntersectionObserverStub
  /** Where the driver's last navigation went; undefined before the first. */
  let here: string | undefined
  let scrollY: number
  /** The largest offset the next `scrollTo` reaches; undefined: no limit. */
  let scrollLimits: (number | undefined)[]
  let alwaysLimitTo: number | undefined
  let now: number
  let animationFrames: Map<number, FrameRequestCallback>
  let nextAnimationFrameId: number
  let afterNavigateDelivered: boolean
  /** Every `window.scrollTo` call, with what the page showed at that moment. */
  let scrollCalls: {
    top: number | undefined
    behavior: ScrollBehavior | undefined
    afterNavigate: boolean
    rows: ReturnType<typeof rowLinks>
    at: number
  }[]
  let scrollYDescriptor: PropertyDescriptor | undefined

  beforeEach(() => {
    observerStub = installIntersectionObserverStub(vi.stubGlobal)
    // updateSeen is answered at once; list GETs are held.
    notificationFetch.answer = (request) => {
      if (request.method === 'POST' && updateSeenPath.test(request.path))
        request.resolve(json(200, {}))
    }
    here = undefined
    scrollY = 0
    scrollLimits = []
    alwaysLimitTo = undefined
    now = 1000
    animationFrames = new Map()
    nextAnimationFrameId = 1
    afterNavigateDelivered = false
    scrollCalls = []
    scrollYDescriptor = Object.getOwnPropertyDescriptor(window, 'scrollY')
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => scrollY,
    })
    vi.stubGlobal(
      'scrollTo',
      vi.fn((first: number | ScrollToOptions, second?: number) => {
        const options = typeof first === 'object' ? first : undefined
        const top = options ? options.top : second
        scrollCalls.push({
          top,
          behavior: options?.behavior,
          afterNavigate: afterNavigateDelivered,
          rows: rowLinks(),
          at: now,
        })
        if (typeof top !== 'number') return
        const limit = scrollLimits.shift() ?? alwaysLimitTo
        scrollY = limit === undefined ? top : Math.min(top, limit)
      }),
    )
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextAnimationFrameId++
      animationFrames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      animationFrames.delete(id)
    })
    vi.spyOn(performance, 'now').mockImplementation(() => now)
  })

  afterEach(() => {
    vi.mocked(performance.now).mockRestore()
    if (scrollYDescriptor)
      Object.defineProperty(window, 'scrollY', scrollYDescriptor)
    else Reflect.deleteProperty(window, 'scrollY')
  })

  /** Runs the pending animation frames `advanceMs` after the last. */
  async function runAnimationFrame(advanceMs = 16) {
    now += advanceMs
    const callbacks = [...animationFrames.values()]
    animationFrames.clear()
    for (const callback of callbacks) callback(now)
    await settle(svelte)
  }

  /**
   * Delivers one client navigation as Kit and the root layout would: the
   * layout's `notificationListReturn.noteNavigation` and the page's
   * `beforeNavigate` callbacks (in the order `layoutFirst` gives), then the
   * page unmounts when the navigation leaves /notifications and mounts when
   * it arrives there, and the mounted page's `afterNavigate` callbacks run.
   * `beforeAfterNavigate` stands in for Kit's own scroll handling, which runs
   * between the mount and `afterNavigate`. Kit's `navigating` holds the hop
   * while it loads, and the layout's `notificationListReturn.noteArrival`
   * sees every landing.
   */
  async function navigate(
    hop: Hop,
    options: {
      layoutFirst?: boolean
      beforeAfterNavigate?: () => void | Promise<void>
    } = {},
  ) {
    const { layoutFirst = true } = options
    const from =
      here === undefined
        ? null
        : {
            url: new URL(here, 'http://localhost'),
            params: {},
            route: { id: null },
          }
    const to = {
      url: new URL(hop.to, 'http://localhost'),
      params: {},
      route: { id: routeIdFor(hop.to) },
    }
    if (hop.type !== 'enter' && !hop.interrupts) {
      const before = {
        type: hop.type,
        from,
        to,
        willUnload: false,
        cancel() {},
      } as BeforeNavigate
      const layout = () => notificationListReturn.noteNavigation(before)
      const page = () => {
        for (const callback of [...navigationHooks.before]) callback(before)
      }
      if (layoutFirst) {
        layout()
        page()
      } else {
        page()
        layout()
      }
    }
    const landedPath = hop.landsAt ?? hop.to
    const landed = {
      url: new URL(landedPath, 'http://localhost'),
      params: {},
      route: { id: routeIdFor(landedPath) },
    }
    if (hop.type !== 'enter')
      Object.assign(navigatingState, { type: hop.type, from, to: landed })
    if (hop.abandoned) return
    here = landedPath
    if (
      from?.url.pathname === notificationsPath &&
      landed.url.pathname !== notificationsPath
    ) {
      await unmountPage()
      expect(
        [navigationHooks.before.size, navigationHooks.after.size],
        'the unmounted page left no navigation callback',
      ).toEqual([0, 0])
    }
    if (landed.url.pathname === notificationsPath) {
      if (!mounted) await mountPage()
      await options.beforeAfterNavigate?.()
    }
    const after = {
      type: hop.type,
      from,
      to: landed,
      willUnload: false,
      complete: Promise.resolve(),
    } as AfterNavigate
    notificationListReturn.noteArrival(after)
    for (const callback of [...navigationHooks.after]) callback(after)
    Object.assign(navigatingState, { type: null, from: null, to: null })
    await settle(svelte)
  }

  /** The one live sentinel observer's callback, reporting `isIntersecting`. */
  async function intersect(isIntersecting: boolean) {
    const observing = observerStub.observing()
    expect(observing, 'one live sentinel observer').toHaveLength(1)
    observing[0].deliver(isIntersecting)
    await settle(svelte)
  }

  /** Alice enters /notifications and page one with `cursor` is shown. */
  async function showPageOne(notifications: unknown[], cursor?: string) {
    signIn(alice)
    notificationListReturn.start()
    await navigate({ type: 'enter', to: notificationsPath })
    expect(pageOneGets(), 'precondition: page one requested').toHaveLength(1)
    pageOneGets()[0].resolve(json(200, { notifications, cursor, seenAt }))
    await settle(svelte)
  }

  /**
   * Alice's list with page one and one later page, cursor c2 next, the
   * sensitive reply revealed, and the later page's rows read by page one's
   * seenAt: "Mulch in spring" unread, "Water at dawn" read.
   */
  async function showListToFollow() {
    settings.nsfwBlur = true
    signIn(alice)
    notificationListReturn.start()
    await navigate({ type: 'enter', to: notificationsPath })
    expect(pageOneGets(), 'precondition: page one requested').toHaveLength(1)
    pageOneGets()[0].resolve(
      json(200, {
        notifications: [sensitiveReply, upvoteOnComment],
        cursor: 'c1',
        seenAt: restoreSeenAt,
      }),
    )
    await settle(svelte)
    await intersect(true)
    await intersect(false)
    expect(getsWithCursor('c1'), 'precondition: c1 requested').toHaveLength(1)
    getsWithCursor('c1')[0].resolve(
      json(200, { notifications: [unreadMulch, readDawn], cursor: 'c2' }),
    )
    await settle(svelte)
    showButtonFor(sensitiveReplyHref)?.click()
    await settle(svelte)

    expect(rowLinks(), 'precondition: both pages shown').toEqual(savedRows)
    expect(unreadMarks(), 'precondition: read marks').toEqual(savedUnreadMarks)
    expect(text(), 'precondition: the reply is revealed').toContain(
      'Ghost peppers everywhere',
    )
  }

  /** The `data-unread` value of every saved row, in `savedRows` order. */
  const unreadMarks = () => savedRows.map(([href]) => unreadFor(href ?? ''))
  const savedUnreadMarks = ['true', null, 'true', null]

  it.each([
    {
      return: 'by Back after following a row, the layout callback first',
      hops: [
        { type: 'link', to: mulchHref },
        { type: 'popstate', to: notificationsPath },
      ],
      layoutFirst: true,
    },
    {
      return: 'by Back after following a row, the page callback first',
      hops: [
        { type: 'link', to: mulchHref },
        { type: 'popstate', to: notificationsPath },
      ],
      layoutFirst: false,
    },
    {
      return: 'by Back, Forward to the same thread, then Back again',
      hops: [
        { type: 'link', to: mulchHref },
        { type: 'popstate', to: notificationsPath },
        { type: 'popstate', to: mulchHref },
        { type: 'popstate', to: notificationsPath },
      ],
      layoutFirst: true,
    },
    {
      return: 'by the bell from the thread',
      hops: [
        { type: 'link', to: mulchHref },
        { type: 'link', to: notificationsPath },
      ],
      layoutFirst: true,
    },
    {
      return: 'by the bell after a comment-sort goto on the thread',
      hops: [
        { type: 'link', to: mulchHref },
        { type: 'goto', to: `${mulchHref}?sort=new` },
        { type: 'link', to: notificationsPath },
      ],
      layoutFirst: true,
    },
    {
      return:
        'by the bell after a comment-sort goto on the thread the row redirected to',
      hops: [
        { type: 'link', to: mulchHref, landsAt: canonicalMulchHref },
        { type: 'goto', to: `${canonicalMulchHref}?sort=new` },
        { type: 'link', to: notificationsPath },
      ],
      layoutFirst: true,
    },
    {
      return:
        'by Back, Forward to the thread the row redirected to, then Back again',
      hops: [
        { type: 'link', to: mulchHref, landsAt: canonicalMulchHref },
        { type: 'popstate', to: notificationsPath },
        { type: 'popstate', to: canonicalMulchHref },
        { type: 'popstate', to: notificationsPath },
      ],
      layoutFirst: true,
    },
    {
      return: 'by the bell clicked while a comment-sort goto is loading',
      hops: [
        { type: 'link', to: mulchHref },
        { type: 'goto', to: `${mulchHref}?sort=new`, abandoned: true },
        { type: 'link', to: notificationsPath, interrupts: true },
      ],
      layoutFirst: true,
    },
  ] satisfies { return: string; hops: Hop[]; layoutFirst: boolean }[])(
    'restores the same rows, read marks, reveal and cursor without a page-one request on a return $return',
    async ({ hops, layoutFirst }) => {
      await showListToFollow()

      for (const hop of hops) await navigate(hop, { layoutFirst })

      expect(rowLinks(), 'the saved rows in the saved order').toEqual(savedRows)
      expect(unreadMarks()).toEqual(savedUnreadMarks)
      expect(text(), 'the revealed row stays revealed').toContain(
        'Ghost peppers everywhere',
      )
      expect(
        showButtonFor(sensitiveReplyHref)?.getAttribute('aria-expanded'),
      ).toBe('true')
      expect(
        pageOneGets(),
        'no page-one request after the return',
      ).toHaveLength(1)
      expect(
        notificationListReturn.take(),
        'the restore took the save',
      ).toBeUndefined()

      await intersect(true)
      expect(
        getsWithCursor('c2'),
        'the next intersecting callback sends the saved cursor',
      ).toHaveLength(1)
    },
  )

  it.each([
    {
      entry: 'the first entry, with no save',
      follow: [],
      entryHop: { type: 'enter', to: notificationsPath },
    },
    {
      entry: 'the bell after a row is followed and the thread links to /',
      follow: [
        { type: 'link', to: postReplyHref },
        { type: 'link', to: '/' },
      ],
      entryHop: { type: 'link', to: notificationsPath },
    },
    {
      entry:
        'the bell after a row is followed and Home interrupts it before the thread renders',
      follow: [
        { type: 'link', to: postReplyHref, abandoned: true },
        { type: 'link', to: '/', interrupts: true },
      ],
      entryHop: { type: 'link', to: notificationsPath },
    },
    {
      entry:
        'the bell after a row is followed and Back to another thread interrupts it before the thread renders',
      follow: [
        { type: 'link', to: postReplyHref, abandoned: true },
        { type: 'popstate', to: commentReplyHref, interrupts: true },
      ],
      entryHop: { type: 'link', to: notificationsPath },
    },
    {
      entry: 'Back from the notification settings gear link',
      follow: [{ type: 'link', to: '/settings/notifications' }],
      entryHop: { type: 'popstate', to: notificationsPath },
    },
    {
      entry: 'a goto to /notifications after a row is followed',
      follow: [{ type: 'link', to: postReplyHref }],
      entryHop: { type: 'goto', to: notificationsPath },
    },
  ] satisfies { entry: string; follow: Hop[]; entryHop: Hop }[])(
    'loads page one once, shows no saved row before it resolves and holds no save afterwards on $entry',
    async ({ follow, entryHop }) => {
      if (follow.length > 0) {
        await showPageOne([postReply])
        expect(rowLinks(), 'precondition: page one shown').toEqual([
          [postReplyHref, 'ReplyCard'],
        ])
        for (const hop of follow) await navigate(hop)
      } else {
        signIn(alice)
        notificationListReturn.start()
      }
      const pageOnesBefore = pageOneGets().length

      await navigate(entryHop)

      expect(
        pageOneGets().slice(pageOnesBefore),
        'one page-one request',
      ).toHaveLength(1)
      expect(rowLinks(), 'no saved row before page one resolves').toEqual([])
      pageOneGets()[pageOnesBefore].resolve(
        json(200, { notifications: [mention], seenAt }),
      )
      await settle(svelte)
      expect(rowLinks()).toEqual([[mentionHref, 'ReplyCard']])
      expect(notificationListReturn.take(), 'no save held').toBeUndefined()
    },
  )

  describe.each([
    { return: 'Back', hop: { type: 'popstate', to: notificationsPath } },
    { return: 'the bell', hop: { type: 'link', to: notificationsPath } },
  ] satisfies { return: string; hop: Hop }[])(
    'scroll restore by $return',
    ({ hop }) => {
      const restoredRows = [
        [postReplyHref, 'ReplyCard'],
        [mentionHref, 'ReplyCard'],
      ]

      /**
       * Follows the reply at scrollY 1200 and returns by `hop`.
       * `beforeAfterNavigate` runs after the page mounted, before its
       * `afterNavigate` callbacks.
       */
      async function followAt1200AndReturn(
        beforeAfterNavigate?: () => Promise<void>,
      ) {
        await showPageOne([postReply, mention])
        expect(rowLinks(), 'precondition: page one shown').toEqual(restoredRows)
        scrollY = 1200
        await navigate({ type: 'link', to: postReplyHref })
        // Kit puts the thread at the top.
        scrollY = 0
        await navigate(hop, {
          beforeAfterNavigate: async () => {
            await beforeAfterNavigate?.()
            // Kit's own scroll handling, before afterNavigate.
            scrollY = 0
            afterNavigateDelivered = true
          },
        })
      }

      it('scrolls to 1200 instantly once, after afterNavigate, with every restored row in the document', async () => {
        await followAt1200AndReturn(async () => {
          await settle(svelte)
          await runAnimationFrame(0)
          await runAnimationFrame(0)
          expect(
            rowLinks(),
            'precondition: the restored rows are mounted',
          ).toEqual(restoredRows)
          expect(
            window.scrollTo,
            'no scroll after mount before afterNavigate',
          ).not.toHaveBeenCalled()
        })
        expect(window.scrollTo).toHaveBeenCalledWith({
          top: 1200,
          behavior: 'instant',
        })
        await runAnimationFrame()
        await runAnimationFrame()

        expect(scrollCalls).toEqual([
          {
            top: 1200,
            behavior: 'instant',
            afterNavigate: true,
            rows: restoredRows,
            at: 1000,
          },
        ])
        expect(window.scrollY).toBe(1200)
      })

      it('applies 1200 again on the next frame when the first attempt is clamped, then stops once it holds', async () => {
        scrollLimits = [600]
        await followAt1200AndReturn()
        expect(
          scrollCalls.map((call) => call.top),
          'precondition: one clamped attempt',
        ).toEqual([1200])
        expect(window.scrollY, 'precondition: clamped').toBe(600)

        await runAnimationFrame()
        await runAnimationFrame()
        await runAnimationFrame()

        expect(scrollCalls.map((call) => [call.top, call.behavior])).toEqual([
          [1200, 'instant'],
          [1200, 'instant'],
        ])
        expect(window.scrollY).toBe(1200)
        expect(animationFrames.size, 'no frame left scheduled').toBe(0)
      })

      it('stops re-applying 1200 once frames pass 500 ms when every attempt is clamped', async () => {
        alwaysLimitTo = 600
        await followAt1200AndReturn()
        expect(
          scrollCalls.map((call) => call.top),
          'precondition: one clamped attempt',
        ).toEqual([1200])

        for (let frame = 0; frame < 10; frame++) await runAnimationFrame(100)

        const attemptTimes = scrollCalls.map((call) => call.at - 1000)
        expect(attemptTimes, 'attempts continue until 400 ms').toContain(400)
        expect(
          attemptTimes.filter((elapsed) => elapsed > 500),
          'no attempt after 500 ms',
        ).toEqual([])
        expect(animationFrames.size, 'no frame left scheduled').toBe(0)
      })
    },
  )

  it('writes no list data to storage or history when a row is followed, and a fresh module instance loads page one on the return', async () => {
    /** Strings that only the saved list would carry. */
    const listMarkers = [
      'Try copper spray',
      '3kcommentpr1',
      seenAt,
      'cursor-b9',
    ]
    const carriesListData = (values: unknown[]) => {
      const serialized = values.map((value) => {
        try {
          return JSON.stringify(value) ?? ''
        } catch {
          return String(value)
        }
      })
      return serialized.some((value) =>
        listMarkers.some((marker) => value.includes(marker)),
      )
    }
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const historyPushState = vi.spyOn(history, 'pushState')
    const historyReplaceState = vi.spyOn(history, 'replaceState')
    const appNavigation = await import('$app/navigation')
    const navigationCalls = () => [
      ...vi.mocked(appNavigation.goto).mock.calls,
      ...vi.mocked(appNavigation.pushState).mock.calls,
      ...vi.mocked(appNavigation.replaceState).mock.calls,
    ]
    const navigationCallsBefore = navigationCalls().length
    try {
      await showPageOne([postReply], 'cursor-b9')
      expect(rowLinks(), 'precondition: page one shown').toEqual([
        [postReplyHref, 'ReplyCard'],
      ])

      await navigate({ type: 'link', to: postReplyHref })

      expect(
        setItem.mock.calls.filter((call) => carriesListData(call)),
        'no storage write carries the list',
      ).toEqual([])
      expect(historyPushState.mock.calls).toEqual([])
      expect(historyReplaceState.mock.calls).toEqual([])
      expect(
        navigationCalls()
          .slice(navigationCallsBefore)
          .filter((call) => carriesListData(call)),
        'no navigation state carries the list',
      ).toEqual([])
    } finally {
      setItem.mockRestore()
      historyPushState.mockRestore()
      historyReplaceState.mockRestore()
    }

    // A full page reload: fresh modules, the layout's session sync and start.
    vi.resetModules()
    await importInstances()
    signIn(alice)
    notificationListReturn.start()
    const pageOnesBefore = pageOneGets().length

    await navigate({ type: 'popstate', to: notificationsPath })

    expect(
      pageOneGets().slice(pageOnesBefore),
      'one page-one request after the reload',
    ).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// notif-design acceptance: the root post card and Quick Reply
// ---------------------------------------------------------------------------

/** The postReply whose root carries its author, creation time and stats. */
const postReplyWithRootCard = {
  ...postReply,
  rootPost: {
    ...postReply.rootPost,
    author: {
      did: 'did:plc:rootauthorpr1',
      handle: 'root-author.coves.social',
    },
    createdAt: '2026-10-11T08:00:00.000Z',
    stats: { upvotes: 12, downvotes: 0, score: 12, commentCount: 4 },
  },
}

describe('notifications page reply card', () => {
  it('shows the fetched root post card with its author and score, and Reply opens a composer in that row', async () => {
    signIn(alice)
    answerWith({ notifications: [postReplyWithRootCard], seenAt })
    await mountPage()
    await settle(svelte)

    const row = target
      .querySelector(`a[href="${postReplyHref}"]`)
      ?.closest('li')
    expect(row, 'the reply row').not.toBeNull()
    const card = row?.querySelector('[data-part="post-card"]')
    expect(card, 'the root post card').not.toBeNull()
    expect(card?.textContent).toContain('@root-author.coves.social')
    expect(
      card?.querySelector('[data-part="post-score"]')?.textContent?.trim(),
    ).toBe('12')

    const reply = [...(row?.querySelectorAll('button') ?? [])].find(
      (button) => button.getAttribute('aria-label') === 'Reply to Replier pr1',
    )
    expect(reply, 'the Quick Reply button').toBeDefined()
    expect(row?.querySelector('textarea')).toBeNull()

    reply?.click()
    await settle(svelte)

    expect(row?.querySelector('textarea')).not.toBeNull()
  })
})
