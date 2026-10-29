// @vitest-environment jsdom
// Call sites of the DID-keyed default avatar (PRD_DEFAULT_AVATARS §4.5): each
// component renders the real Avatar for a user without an avatar, so the
// default picture for that user's DID must appear. Communities keep DiceBear.
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { Component } from 'svelte'
import type {
  AtUri,
  AuthorView,
  CID,
  CommunityRef,
  CommunityView,
  NotificationRootPost,
} from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import type {
  ReplyNotificationRow,
  UpvoteNotificationRow,
} from '$lib/feature/notification/rows'
import {
  createGenerationFactory,
  session,
} from '$lib/feature/notification/notification-test-harness'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.social' },
}))
vi.mock('$lib/app/state/instance/env', () => ({
  DEFAULT_INSTANCE_URL: 'http://localhost:8081',
  LINKED_INSTANCE_URL: undefined,
}))
vi.mock('$app/navigation', () => ({
  invalidate: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
  goto: vi.fn(),
  pushState: vi.fn(),
  replaceState: vi.fn(),
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
vi.mock('svelte/transition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte/transition')>()),
  slide: () => ({ duration: 0 }),
  fly: () => ({ duration: 0 }),
  fade: () => ({ duration: 0 }),
  scale: () => ({ duration: 0 }),
}))

// ---------------------------------------------------------------------------
// PRD §4.2 vectors and the call-site literal, written out (never computed).
// ---------------------------------------------------------------------------

const OCEAN_WAVE_DID = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz' as DID
const PUFFERFISH_DID = 'did:plc:z72i7hdynmk6r22z27h6tvur' as DID
const SANDCASTLE_DID = 'did:web:coves.social' as DID

const DEFAULTS = 'https://coves.social/img/default-avatars/v1'
const OCEAN_WAVE = {
  src: `${DEFAULTS}/ocean-wave.webp`,
  tint: '#D5E6E3',
}
const PUFFERFISH = {
  src: `${DEFAULTS}/pufferfish.webp`,
  tint: '#D8E8D4',
}
const SANDCASTLE = {
  src: `${DEFAULTS}/sandcastle.webp`,
  tint: '#D5E6E3',
}
/** `did:plc:replieranon`, the authorless reply's record URI authority. */
const OYSTER = {
  src: `${DEFAULTS}/oyster-with-a-pearl.webp`,
  tint: '#D5E6E3',
}
const MIST = '#DCE0EA'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = '2026-10-12T12:00:00.000Z'
const threeHoursAgo = '2026-10-12T09:00:00.000Z'
const viewerDid = 'did:plc:viewer7f3kq2' as DID
const postUri =
  `at://${viewerDid}/social.coves.community.post/3kpostcats1` as AtUri

const cats: CommunityRef = {
  did: 'did:plc:cats' as DID,
  name: 'cats',
  origin: 'coves.social',
}

/** Ocean (no avatar), whose DID maps to ocean-wave. */
const ocean: AuthorView = {
  did: OCEAN_WAVE_DID,
  handle: 'ocean.coves.social' as Handle,
  displayName: 'Ocean',
}

/** Sandy (no avatar), whose DID maps to sandcastle. */
const sandy: AuthorView = {
  did: SANDCASTLE_DID,
  handle: 'sandy.coves.social' as Handle,
}

/** Puffer, signed in without an avatar; the DID maps to pufferfish. */
const puffer = {
  did: PUFFERFISH_DID,
  handle: 'puffer.coves.social',
}

const rootPost: NotificationRootPost = {
  uri: postUri,
  cid: 'bafyreibrootcats1' as CID,
  title: 'Look at this cat',
  community: cats,
  author: sandy,
  createdAt: threeHoursAgo,
}

function upvoteRow(): UpvoteNotificationRow {
  return {
    reason: 'upvote',
    sortAt: threeHoursAgo,
    isRead: true,
    rootPost: {
      uri: postUri,
      cid: 'bafyreibrootcats1' as CID,
      community: cats,
    },
    subject: {
      uri: postUri,
      cid: 'bafyreibrootcats1' as CID,
      preview: 'Look at this cat',
    },
    upvoteCount: 1,
    recentUpvoters: [{ did: ocean.did, handle: ocean.handle }],
  }
}

/** A reply row without `author`, attributed to "Unknown user". */
function authorlessReplyRow(recordUri: string): ReplyNotificationRow {
  return {
    reason: 'postReply',
    sortAt: threeHoursAgo,
    isRead: true,
    rootPost: {
      uri: postUri,
      cid: 'bafyreibrootcats1' as CID,
      title: 'Look at this cat',
      community: cats,
    },
    record: {
      uri: recordUri as AtUri,
      cid: 'bafyreibrecordanon' as CID,
      excerpt: 'Cute',
      createdAt: threeHoursAgo,
    },
  }
}

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------

let svelte: typeof import('svelte')
let profile: (typeof import('$lib/app/state/auth.svelte'))['profile']
let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

beforeAll(async () => {
  const { loadTranslations } = await import('$lib/app/state/i18n')
  await loadTranslations('en')
}, 30_000)

beforeEach(async () => {
  localStorage.clear()
  vi.stubGlobal('__VERSION__', 'test')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  )
  // Sidebar's theme state reads the colour-scheme preference.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(now))
  svelte = await import('svelte')
  profile = (await import('$lib/app/state/auth.svelte')).profile
  profile.syncFromServer(undefined)
  svelte.flushSync()
  const { locale } = await import('$lib/app/state/i18n')
  locale.set('en')
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await svelte.unmount(mounted, { outro: false })
  mounted = undefined
  svelte.flushSync()
  target.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

afterAll(() => {
  profile.mainEffect()
})

function mountComponent(
  component: Component<never>,
  props: Record<string, unknown>,
): void {
  mounted = svelte.mount(component, {
    target,
    intro: false,
    props: props as never,
  })
  svelte.flushSync()
}

const nextGeneration = createGenerationFactory('default-avatar')

function signIn(): void {
  const generation = nextGeneration()
  profile.syncFromServer(session(puffer, generation), {
    sessionGeneration: generation,
    sessionExpired: false,
  })
  svelte.flushSync()
}

/**
 * The inline background colour as uppercase `#RRGGBB`. jsdom serialises a
 * mounted `background-color: #D5E6E3` as `rgb(213, 230, 227)`, so an `rgb()`
 * value is converted; a hex value is only uppercased.
 */
function backgroundColor(element: Element | null | undefined): string {
  const match = /background-color:\s*([^;]+)/i.exec(
    element?.getAttribute('style') ?? '',
  )
  const value = (match?.[1] ?? '').trim()
  const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/i.exec(value)
  if (!rgb) return value.toUpperCase()
  return `#${rgb
    .slice(1)
    .map((channel) => Number(channel).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase()
}

function scopeOf(selector: string | undefined): Element {
  const scope = selector ? target.querySelector(selector) : target
  if (!scope) throw new Error(`Nothing rendered matches ${selector}`)
  return scope
}

/** Every <img> src in the scope, so a failure lists what did render. */
function imageSources(scope: Element): (string | null)[] {
  return Array.from(scope.querySelectorAll('img')).map((image) =>
    image.getAttribute('src'),
  )
}

// ---------------------------------------------------------------------------
// One case per user call site
// ---------------------------------------------------------------------------

interface CallSite {
  name: string
  load: () => Promise<{ default: unknown }>
  /** Sets up state and returns the component's props. */
  props: () => Record<string, unknown>
  /** Narrows the assertion to the user avatar's part of the component. */
  scope?: string
  /** Text the scope shows on any base, proving the component rendered. */
  rendered: string
  expected: { src: string; tint: string }
}

const callSites: CallSite[] = [
  {
    name: 'UserLink',
    load: () => import('./UserLink.svelte'),
    props: () => ({ user: ocean, avatar: true }),
    rendered: 'ocean.coves.social',
    expected: OCEAN_WAVE,
  },
  {
    name: 'Navbar (signed-in profile without an avatar)',
    load: () => import('$lib/feature/shell/navbar/Navbar.svelte'),
    props: () => {
      signIn()
      return {}
    },
    scope: 'nav',
    rendered: 'Create',
    expected: PUFFERFISH,
  },
  {
    name: 'Sidebar (signed-in profile without an avatar)',
    load: () => import('$lib/feature/shell/Sidebar.svelte'),
    props: () => {
      signIn()
      return {}
    },
    scope: 'nav',
    rendered: 'puffer.coves.social',
    expected: PUFFERFISH,
  },
  {
    name: 'NotificationPostCard (post author)',
    load: () => import('$lib/feature/notification/NotificationPostCard.svelte'),
    props: () => ({ post: rootPost }),
    scope: '[data-part="post-meta"]',
    rendered: 'sandy.coves.social',
    expected: SANDCASTLE,
  },
  {
    name: 'UpvoteRow (upvoter)',
    load: () => import('$lib/feature/notification/UpvoteRow.svelte'),
    props: () => ({
      row: upvoteRow(),
      revealed: false,
      onreveal: () => {},
    }),
    scope: '[data-part="avatars"]',
    rendered: '',
    expected: OCEAN_WAVE,
  },
  {
    name: 'ReplyCard (authorless reply, record URI with a DID authority)',
    load: () => import('$lib/feature/notification/ReplyCard.svelte'),
    props: () => ({
      row: authorlessReplyRow(
        'at://did:plc:replieranon/social.coves.community.comment/3kcommentanon',
      ),
      revealed: false,
      onreveal: () => {},
    }),
    scope: '[data-part="author"]',
    rendered: 'Unknown user',
    expected: OYSTER,
  },
  {
    name: 'EntityHeader (with did)',
    load: () => import('$lib/feature/shell/EntityHeader.svelte'),
    props: () => ({ name: 'Sandy', did: SANDCASTLE_DID }),
    rendered: 'Sandy',
    expected: SANDCASTLE,
  },
  {
    name: 'blocked users page (blocked DID with no resolved profile)',
    load: () =>
      import('../../../routes/profile/(local_user)/blocks/users/+page.svelte'),
    props: () => ({
      data: {
        blockedUsers: {
          value: [
            {
              block: {
                blockedDid: PUFFERFISH_DID,
                recordUri:
                  `at://${viewerDid}/social.coves.actor.block/3kblock1` as AtUri,
                recordCid: 'bafyreibblock1' as CID,
                blockedAt: threeHoursAgo,
              },
            },
          ],
        },
      },
    }),
    rendered: PUFFERFISH_DID,
    expected: PUFFERFISH,
  },
]

describe('default avatar at user call sites (PRD §4.5)', () => {
  it.each(callSites)(
    '$name shows the default picture for the DID on its tint',
    async ({ load, props, scope, rendered, expected }) => {
      const component = (await load()).default as Component<never>
      mountComponent(component, props())

      const part = scopeOf(scope)
      // The component rendered; on a base without DID defaults this holds
      // and only the default picture below is missing.
      expect(part.textContent).toContain(rendered)

      expect(imageSources(part)).toContain(expected.src)
      const image = part.querySelector(`img[src="${expected.src}"]`)
      expect(image?.getAttribute('alt')).toBe('')
      expect(backgroundColor(image?.parentElement)).toBe(expected.tint)
    },
  )

  it('ReplyCard draws a plain Mist circle for an authorless reply whose record URI authority is not a DID', async () => {
    const ReplyCard = (
      await import('$lib/feature/notification/ReplyCard.svelte')
    ).default as Component<never>
    // The parser rejects this URI, so the row is built directly.
    mountComponent(ReplyCard, {
      row: authorlessReplyRow(
        'at://alice.example/social.coves.community.comment/3k',
      ),
      revealed: false,
      onreveal: () => {},
    })

    const author = scopeOf('[data-part="author"]')
    expect(author.textContent).toContain('Unknown user')
    const circle = author.firstElementChild
    expect(backgroundColor(circle)).toBe(MIST)
    expect(author.querySelector('img')).toBeNull()
    expect(author.querySelector('svg')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Guards: communities keep DiceBear (pass before and after the change).
// ---------------------------------------------------------------------------

describe('communities without an avatar keep DiceBear (guard)', () => {
  const community: CommunityView = {
    did: 'did:plc:cats' as DID,
    name: 'cats',
    origin: 'coves.social',
    subscriberCount: 0,
    memberCount: 0,
    postCount: 0,
  }

  it.each([
    {
      name: 'CommunityLink',
      load: () => import('$lib/feature/community/CommunityLink.svelte'),
      props: { community, avatar: true },
    },
    {
      name: 'CommunityTitle',
      load: () => import('$lib/feature/community/CommunityTitle.svelte'),
      props: { community },
    },
  ])('$name renders the DiceBear svg', async ({ load, props }) => {
    const component = (await load()).default as Component<never>
    mountComponent(component, props)

    expect(target.querySelector('svg')).not.toBeNull()
    expect(target.querySelector('img')).toBeNull()
  })
})
