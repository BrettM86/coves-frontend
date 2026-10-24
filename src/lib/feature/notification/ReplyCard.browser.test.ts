// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type {
  AtUri,
  CID,
  CommunityRef,
  NotificationActor,
  NotificationRecord,
} from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import { locale } from '$lib/app/state/i18n'
import { settings } from '$lib/app/state/settings.svelte'
import type { ReplyNotificationRow } from './rows'
import {
  accessibleName,
  createGenerationFactory,
  json,
  session,
  settle,
} from './notification-test-harness'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/state', () => ({
  page: {
    state: {},
    url: new URL('http://localhost/notifications'),
    route: { id: '/notifications' },
  },
}))
vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  pushState: vi.fn(),
  replaceState: vi.fn(),
}))
const svelteClientEntry = async (subpath: string): Promise<unknown> => {
  const { createRequire } = await import('node:module')
  const require_ = createRequire(import.meta.url)
  return await import(
    /* @vite-ignore */ require_
      .resolve('svelte/package.json')
      .replace('package.json', subpath)
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
// The real Avatar never puts its `alt` in the DOM; the probe renders the
// props it received as data attributes (data-avatar, data-url, data-has-url,
// data-alt).
vi.mock('$lib/ui/generic/Avatar.svelte', async () => ({
  default: (await import('./AvatarProbe.test.svelte')).default,
}))

// ---------------------------------------------------------------------------
// Fixtures: Alice replies to the viewer's post in !cats@coves.social.
// ---------------------------------------------------------------------------

/** Pinned "now"; the record was created 3 h before and sorted 2 days before. */
const now = '2026-10-12T12:00:00.000Z'
const threeHoursAgo = '2026-10-12T09:00:00.000Z'
const twoDaysAgo = '2026-10-10T12:00:00.000Z'

const viewerDid = 'did:plc:viewer7f3kq2' as DID
const aliceDid = 'did:plc:alice4x7k' as DID
const catsDid = 'did:plc:cats' as DID

const rootPostUri =
  `at://${viewerDid}/social.coves.community.post/3kpostcats1` as AtUri
const replyUri =
  `at://${aliceDid}/social.coves.community.comment/3kcommentcats1` as AtUri

const catsAvatarUrl = 'https://cdn.coves.social/avatar/cats.jpg'
const aliceAvatarUrl = 'https://cdn.coves.social/avatar/alice.jpg'

/** A served community whose mention form is "!cats@coves.social". */
const cats: CommunityRef = {
  did: catsDid,
  name: 'cats',
  origin: 'coves.social',
  avatar: catsAvatarUrl,
}

const alice: NotificationActor = {
  did: aliceDid,
  handle: 'alice.coves.social',
  displayName: 'Alice',
  avatar: aliceAvatarUrl,
}

/** Alice's reply comment, excerpt "Cute", created 3 h before now. */
function replyRecord(
  overrides: Partial<NotificationRecord> = {},
): NotificationRecord {
  return {
    uri: replyUri,
    cid: 'bafyreibrecordcats1' as CID,
    excerpt: 'Cute',
    createdAt: threeHoursAgo,
    ...overrides,
  }
}

/** A read postReply from Alice under a live root post in cats. */
function replyRow(
  overrides: Partial<ReplyNotificationRow> = {},
): ReplyNotificationRow {
  return {
    reason: 'postReply',
    sortAt: twoDaysAgo,
    isRead: true,
    rootPost: {
      uri: rootPostUri,
      cid: 'bafyreibrootcats1' as CID,
      title: 'Look at this cat',
      community: cats,
    },
    record: replyRecord(),
    author: alice,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------

let target: HTMLDivElement
let client: typeof import('svelte')
let ReplyCard: typeof import('./ReplyCard.svelte').default
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

beforeAll(async () => {
  ReplyCard = (await import('./ReplyCard.svelte')).default
}, 30_000)

beforeEach(async () => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(now))
  locale.set('en')
  client = await import('svelte')
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
  settings.absoluteDates = false
  vi.useRealTimers()
})

function mountCard(
  row: ReplyNotificationRow,
  revealed = false,
  onreveal: (identity: string) => void = () => {},
): void {
  mounted = client.mount(ReplyCard, {
    target,
    intro: false,
    props: { row, revealed, onreveal },
  })
  client.flushSync()
}

/** The card's only link; fails the test when there is not exactly one. */
function onlyLink(): HTMLAnchorElement {
  const links = target.querySelectorAll('a')
  expect(links).toHaveLength(1)
  const [link] = links
  if (!link) throw new Error('The card has no link')
  return link
}

function header(): Element | null {
  return target.querySelector('[data-part="header"]')
}

function headerTimeText(): string | undefined {
  return header()?.querySelector('time')?.textContent?.trim()
}

// ---------------------------------------------------------------------------
// Batch 1: link, header and header time
// ---------------------------------------------------------------------------

describe('ReplyCard link', () => {
  it('renders a postReply as one link to the comment permalink, named for the row', () => {
    mountCard(replyRow())

    const links = target.querySelectorAll('a')
    expect(links.length).toBe(1)
    expect(links[0]?.getAttribute('href')).toBe(
      '/c/cats@coves.social/post/did%3Aplc%3Aviewer7f3kq2/3kpostcats1/comment/alice.coves.social/3kcommentcats1',
    )
    expect(links[0]?.getAttribute('aria-label')).toBe(
      'Alice replied to your post in !cats@coves.social: Cute. 3h ago',
    )
  })
})

describe('ReplyCard header', () => {
  it.each<[ReplyNotificationRow['reason'], string]>([
    ['postReply', 'Reply to your post'],
    ['commentReply', 'Reply to your comment'],
    ['mention', 'Mentioned you'],
  ])(
    'shows the community avatar, the %s reason line and the community',
    (reason, reasonLine) => {
      mountCard(replyRow({ reason }))

      const headerElement = header()
      expect(headerElement).not.toBeNull()
      const avatars = headerElement?.querySelectorAll('[data-avatar]') ?? []
      expect(avatars).toHaveLength(1)
      expect(avatars[0]?.getAttribute('data-url')).toBe(
        'https://cdn.coves.social/avatar/cats.jpg',
      )
      expect(avatars[0]?.getAttribute('data-alt')).toBe('did:plc:cats')
      expect(headerElement?.textContent).toContain(reasonLine)
      expect(headerElement?.textContent).toContain('!cats@coves.social')
    },
  )

  it('times the header by the record creation, not the sort time', () => {
    mountCard(replyRow())

    expect(headerTimeText()).toBe('3h ago')
    expect(header()?.querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-10-12T09:00:00.000Z',
    )
    expect(onlyLink().getAttribute('aria-label')).toMatch(/\. 3h ago$/)
  })

  it.each<[string, unknown]>([
    ['an unparseable string', 'garbage'],
    ['an empty string', ''],
    ['a number', 42],
  ])(
    'times the header by the sort time when the record creation time is %s',
    (_title, createdAt) => {
      const record = replyRecord({
        createdAt: createdAt as NotificationRecord['createdAt'],
      })

      expect(() => mountCard(replyRow({ record }))).not.toThrow()

      expect(headerTimeText()).toBe('2d ago')
      expect(header()?.querySelector('time')?.getAttribute('datetime')).toBe(
        '2026-10-10T12:00:00.000Z',
      )
      expect(onlyLink().getAttribute('aria-label')).toBe(
        'Alice replied to your post in !cats@coves.social: Cute. 2d ago',
      )
    },
  )

  it('omits the header time and the link name time when neither the creation nor the sort time is usable', () => {
    mountCard(
      replyRow({
        sortAt: 'garbage',
        record: replyRecord({ createdAt: 'garbage' }),
      }),
    )

    expect(header()?.querySelector('time')).toBeNull()
    expect(onlyLink().getAttribute('aria-label')).toBe(
      'Alice replied to your post in !cats@coves.social: Cute',
    )
  })

  it('times the header by the sort time when the record has no creation time', () => {
    const record = replyRecord()
    delete record.createdAt
    mountCard(replyRow({ record }))

    expect(headerTimeText()).toBe('2d ago')
    expect(onlyLink().getAttribute('aria-label')).toMatch(/\. 2d ago$/)
  })

  it('switches the header time and the link name to an absolute date when the setting turns on', () => {
    mountCard(replyRow())
    expect(headerTimeText()).toBe('3h ago')

    settings.absoluteDates = true
    client.flushSync()

    const absoluteText = headerTimeText() ?? ''
    expect(absoluteText).toMatch(
      /^\d{1,2}\/\d{1,2}\/\d{2}, \d{1,2}:\d{2}\s?[AP]M$/,
    )
    expect(absoluteText).not.toContain('ago')
    expect(onlyLink().getAttribute('aria-label')).toBe(
      `Alice replied to your post in !cats@coves.social: Cute. ${absoluteText}`,
    )
  })
})

// ---------------------------------------------------------------------------
// Batch 2: bubble author line, rootless community and unread tint
// ---------------------------------------------------------------------------

function authorLine(): Element | null {
  return target.querySelector('[data-part="author"]')
}

/** The author line's single Avatar probe; fails when there is not exactly one. */
function authorAvatar(): Element {
  const line = authorLine()
  expect(line).not.toBeNull()
  const avatars = line?.querySelectorAll('[data-avatar]') ?? []
  expect(avatars).toHaveLength(1)
  const [avatar] = avatars
  if (!avatar) throw new Error('The author line has no avatar')
  return avatar
}

/** A read postReply whose wire row has no `author` key at all. */
function replyRowWithoutAuthor(): ReplyNotificationRow {
  const row = replyRow()
  delete row.author
  return row
}

/** Every element inside the card, the mount target excluded. */
function cardElements(): Element[] {
  return Array.from(target.querySelectorAll('*'))
}

describe('ReplyCard author line', () => {
  it('shows the author avatar, display name and @handle', () => {
    mountCard(replyRow())

    const line = authorLine()
    expect(line).not.toBeNull()
    expect(line?.textContent).toContain('Alice')
    expect(line?.textContent).toContain('@alice.coves.social')
    const avatar = authorAvatar()
    expect(avatar.getAttribute('data-url')).toBe(
      'https://cdn.coves.social/avatar/alice.jpg',
    )
    expect(avatar.getAttribute('data-has-url')).toBe('true')
    expect(avatar.getAttribute('data-alt')).toBe('did:plc:alice4x7k')
  })

  it('names a DID-only author "Unknown user" with no @handle and a seeded avatar', () => {
    mountCard(replyRow({ author: { did: aliceDid } }))

    const line = authorLine()
    expect(line).not.toBeNull()
    expect(line?.textContent).toContain('Unknown user')
    expect(line?.textContent).not.toContain('@')
    const avatar = authorAvatar()
    expect(avatar.getAttribute('data-has-url')).toBe('false')
    expect(avatar.getAttribute('data-alt')).toBe('did:plc:alice4x7k')
  })

  it('renders a row without an author as "Unknown user", seeding the avatar by the record', () => {
    expect(() => mountCard(replyRowWithoutAuthor())).not.toThrow()

    const line = authorLine()
    expect(line).not.toBeNull()
    expect(line?.textContent).toContain('Unknown user')
    expect(line?.textContent).not.toContain('@')
    const avatar = authorAvatar()
    expect(avatar.getAttribute('data-has-url')).toBe('false')
    expect(avatar.getAttribute('data-alt')).toBe(
      'at://did:plc:alice4x7k/social.coves.community.comment/3kcommentcats1',
    )
  })
})

describe('ReplyCard header without a community', () => {
  it.each<[string, ReplyNotificationRow['rootPost']]>([
    [
      'a root without a community',
      {
        uri: rootPostUri,
        cid: 'bafyreibrootcats1' as CID,
        title: 'Look at this cat',
      },
    ],
    [
      'a root whose community has an invalid DID',
      {
        uri: rootPostUri,
        cid: 'bafyreibrootcats1' as CID,
        title: 'Look at this cat',
        community: { did: 'not-a-did' as DID, name: 'cats' },
      },
    ],
  ])(
    'shows the reason line and time but no community avatar or !community line for %s',
    (_title, rootPost) => {
      mountCard(replyRow({ rootPost }))

      expect(onlyLink().getAttribute('aria-label')).not.toContain(' in !')
      const headerElement = header()
      expect(headerElement).not.toBeNull()
      expect(headerElement?.textContent).toContain('Reply to your post')
      expect(headerTimeText()).toBe('3h ago')
      expect(headerElement?.querySelectorAll('[data-avatar]')).toHaveLength(0)
      expect(headerElement?.textContent).not.toContain('!')
      expect(
        Array.from(target.querySelectorAll('[data-avatar]')).filter(
          (avatar) => !avatar.closest('[data-part="post-card"]'),
        ),
      ).toHaveLength(1)
      expect(authorAvatar().getAttribute('data-alt')).toBe('did:plc:alice4x7k')
    },
  )
})

describe('ReplyCard unread tint', () => {
  it('tints an unread card and keeps the link inside the tinted element', () => {
    mountCard(replyRow({ isRead: false }))

    const tinted = target.querySelector('[data-unread="true"]')
    expect(tinted).not.toBeNull()
    expect(tinted?.classList.contains('bg-primary-900/5')).toBe(true)
    expect(tinted?.classList.contains('dark:bg-primary-100/5')).toBe(true)
    expect(tinted?.contains(onlyLink())).toBe(true)
  })

  it('leaves a read card untinted', () => {
    mountCard(replyRow({ isRead: true }))

    expect(onlyLink()).toBeDefined()
    expect(target.querySelector('[data-unread]')).toBeNull()
    expect(
      cardElements().filter(
        (element) =>
          element.classList.contains('bg-primary-900/5') ||
          element.classList.contains('dark:bg-primary-100/5'),
      ),
    ).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Chunk 12, batch 1: title, thumbnail, bubble excerpt and placeholders
// ---------------------------------------------------------------------------

const thumbnailUrl = 'https://cdn.coves.social/thumb/cat.jpg'
const thumbnailAlt = 'A grey cat on a windowsill'

/** Alice's mention of the viewer in a post of her own (a "post mention"). */
const mentionPostUri =
  `at://${aliceDid}/social.coves.community.post/3kpostmention1` as AtUri

/** The live root post in cats, with the given fields added or replaced. */
function rootPost(
  overrides: Partial<ReplyNotificationRow['rootPost']> = {},
): ReplyNotificationRow['rootPost'] {
  return {
    uri: rootPostUri,
    cid: 'bafyreibrootcats1' as CID,
    title: 'Look at this cat',
    community: cats,
    ...overrides,
  }
}

/** The root title: the post card's title, or the legacy title part. */
function titlePart(): Element | null {
  return target.querySelector(
    '[data-part="post-card"] [data-part="post-title"], [data-part="title"]',
  )
}

/** The root thumbnail: the post card's media image, or the legacy part. */
function thumbnailPart(): HTMLImageElement | null {
  return target.querySelector(
    '[data-part="post-card"] [data-part="post-media"] img, img[data-part="thumbnail"]',
  )
}

function excerptPart(): Element | null {
  return target.querySelector('[data-part="excerpt"]')
}

/** How many times `text` appears in the card's visible text. */
function occurrences(text: string): number {
  return (target.textContent ?? '').split(text).length - 1
}

/** Unmounts the current card and mounts `row` in its place. */
async function remountCard(row: ReplyNotificationRow): Promise<void> {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.replaceChildren()
  mountCard(row)
}

describe('ReplyCard title and thumbnail', () => {
  it.each(['javascript:alert(1)', 'data:text/html,x.png'])(
    'renders no thumbnail image for the unsafe source %s',
    (unsafe) => {
      mountCard(replyRow({ rootPost: rootPost({ thumbnail: unsafe }) }))

      expect(thumbnailPart()).toBeNull()
      const sources = Array.from(target.querySelectorAll('img'), (img) =>
        img.getAttribute('src'),
      )
      expect(sources).not.toContain(unsafe)
      expect(titlePart()?.textContent?.trim()).toBe('Look at this cat')
    },
  )

  it('gives a thumbnail without alt text an empty alt attribute', () => {
    mountCard(replyRow({ rootPost: rootPost({ thumbnail: thumbnailUrl }) }))

    const thumbnail = thumbnailPart()
    expect(thumbnail).not.toBeNull()
    expect(thumbnail?.hasAttribute('alt')).toBe(true)
    expect(thumbnail?.getAttribute('alt')).toBe('')
  })

  it('shows the thumbnail without a title position when the root has no title', () => {
    mountCard(
      replyRow({
        rootPost: rootPost({ title: undefined, thumbnail: thumbnailUrl }),
      }),
    )

    expect(thumbnailPart()?.getAttribute('src')).toBe(
      'https://cdn.coves.social/thumb/cat.jpg',
    )
    expect(titlePart()).toBeNull()
  })

  it('shows the title without an image when the root has no thumbnail', () => {
    mountCard(replyRow())

    expect(titlePart()?.textContent?.trim()).toBe('Look at this cat')
    expect(thumbnailPart()).toBeNull()
    expect(target.querySelector('img')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// notif-design: the root post card
// ---------------------------------------------------------------------------

/** The root post was created 5 days before now: not the record or sort time. */
const fiveDaysAgo = '2026-10-07T12:00:00.000Z'
const rootAuthorAvatarUrl = 'https://cdn.coves.social/avatar/root-author.jpg'

/** The live root with an author other than the reply author, a time and stats. */
function cardRootPost(
  overrides: Partial<ReplyNotificationRow['rootPost']> = {},
): ReplyNotificationRow['rootPost'] {
  return rootPost({
    author: {
      did: 'did:plc:rootauthor9q2w' as DID,
      handle: 'root-author.coves.social' as Handle,
      avatar: rootAuthorAvatarUrl,
    },
    createdAt: fiveDaysAgo,
    stats: { upvotes: 14, downvotes: 2, score: 12, commentCount: 4 },
    ...overrides,
  })
}

function postCard(): Element | null {
  return target.querySelector('[data-part="post-card"]')
}

function cardPart(name: string): Element | null {
  return postCard()?.querySelector(`[data-part="${name}"]`) ?? null
}

describe('ReplyCard root post card', () => {
  it('shows the root author handle, its own time, title, score, comment count and thumbnail inside the row link', () => {
    mountCard(
      replyRow({
        rootPost: cardRootPost({ thumbnail: thumbnailUrl, thumbnailAlt }),
      }),
    )

    const card = postCard()
    expect(card).not.toBeNull()
    expect(onlyLink().contains(card)).toBe(true)

    const meta = cardPart('post-meta')
    expect(meta?.textContent).toContain('@root-author.coves.social')
    expect(meta?.textContent).not.toContain('alice')
    const metaAvatars = meta?.querySelectorAll('[data-avatar]') ?? []
    expect(metaAvatars).toHaveLength(1)
    expect(metaAvatars[0]?.getAttribute('data-url')).toBe(
      'https://cdn.coves.social/avatar/root-author.jpg',
    )
    const metaTime = meta?.querySelector('time')
    expect(metaTime?.textContent?.trim()).toBe('5d ago')
    expect(metaTime?.getAttribute('datetime')).toBe('2026-10-07T12:00:00.000Z')
    expect(headerTimeText()).toBe('3h ago')

    expect(cardPart('post-title')?.textContent?.trim()).toBe('Look at this cat')
    const stats = cardPart('post-stats')
    expect(
      stats?.querySelector('[data-part="post-score"]')?.textContent?.trim(),
    ).toBe('12')
    expect(
      stats?.querySelector('[data-part="post-comments"]')?.textContent?.trim(),
    ).toBe('4')

    const image = cardPart('post-media')?.querySelector('img')
    expect(image?.getAttribute('src')).toBe(
      'https://cdn.coves.social/thumb/cat.jpg',
    )
    expect(image?.getAttribute('alt')).toBe('A grey cat on a windowsill')
    expect(cardPart('post-media-text')).toBeNull()
  })

  it('adds no link or button inside the row link', () => {
    mountCard(
      replyRow({
        rootPost: cardRootPost({ thumbnail: thumbnailUrl, thumbnailAlt }),
      }),
    )

    expect(postCard()).not.toBeNull()
    expect(postCard()?.querySelectorAll('a, button')).toHaveLength(0)
    expect(onlyLink().querySelectorAll('a, button')).toHaveLength(0)
  })

  it.each<[string, string | undefined]>([
    ['no thumbnail', undefined],
    ['an unsafe thumbnail', 'javascript:alert(1)'],
  ])(
    'shows the text-post tile and no image for a root with %s',
    (_title, thumbnail) => {
      mountCard(replyRow({ rootPost: cardRootPost({ thumbnail }) }))

      const media = cardPart('post-media')
      expect(media).not.toBeNull()
      expect(
        media?.querySelector('[data-part="post-media-text"]'),
      ).not.toBeNull()
      expect(media?.querySelector('img')).toBeNull()
    },
  )

  it.each<[string, Partial<ReplyNotificationRow['rootPost']>, string, string]>([
    [
      'a score of 0 and no comments',
      { stats: { upvotes: 0, downvotes: 0, score: 0, commentCount: 0 } },
      '0',
      '0',
    ],
    [
      'a negative score',
      { stats: { upvotes: 1, downvotes: 4, score: -3, commentCount: 2 } },
      '-3',
      '2',
    ],
  ])('renders %s', (_title, overrides, score, comments) => {
    mountCard(replyRow({ rootPost: cardRootPost(overrides) }))

    expect(cardPart('post-score')?.textContent?.trim()).toBe(score)
    expect(cardPart('post-comments')?.textContent?.trim()).toBe(comments)
  })

  it('omits the author from the meta line of a root without an author, keeping its time', () => {
    mountCard(replyRow({ rootPost: cardRootPost({ author: undefined }) }))

    const meta = cardPart('post-meta')
    expect(meta?.querySelector('time')?.textContent?.trim()).toBe('5d ago')
    expect(meta?.textContent).not.toContain('@')
    expect(postCard()?.querySelectorAll('[data-avatar]')).toHaveLength(0)
  })

  it('omits the time from the meta line of a root without a creation time, keeping its author', () => {
    mountCard(replyRow({ rootPost: cardRootPost({ createdAt: undefined }) }))

    const meta = cardPart('post-meta')
    expect(meta?.textContent).toContain('@root-author.coves.social')
    expect(postCard()?.querySelector('time')).toBeNull()
  })

  it('omits the meta line of a root without an author or a creation time', () => {
    mountCard(
      replyRow({
        rootPost: cardRootPost({ author: undefined, createdAt: undefined }),
      }),
    )

    expect(cardPart('post-title')?.textContent?.trim()).toBe('Look at this cat')
    expect(cardPart('post-meta')).toBeNull()
  })

  it('omits the stats of a root without stats', () => {
    mountCard(replyRow({ rootPost: cardRootPost({ stats: undefined }) }))

    expect(cardPart('post-title')?.textContent?.trim()).toBe('Look at this cat')
    expect(cardPart('post-stats')).toBeNull()
    expect(cardPart('post-score')).toBeNull()
    expect(cardPart('post-comments')).toBeNull()
  })
})

describe('ReplyCard removed or deleted root post card', () => {
  it.each<[string, string]>([
    ['deleted', '[Deleted by user]'],
    ['removedByServerAdmin', '[Removed by server admin]'],
  ])(
    'shows the %s placeholder muted and italic in the card title, a text tile, and no meta or stats',
    (status, placeholder) => {
      mountCard(
        replyRow({
          rootPost: cardRootPost({ status, thumbnail: thumbnailUrl }),
        }),
      )

      expect(header()).toBeNull()
      const title = cardPart('post-title')
      expect(title?.textContent?.trim()).toBe(placeholder)
      expect(title?.classList.contains('text-slate-600')).toBe(true)
      expect(title?.classList.contains('dark:text-zinc-400')).toBe(true)
      expect(title?.classList.contains('italic')).toBe(true)
      expect(cardPart('post-meta')).toBeNull()
      expect(cardPart('post-stats')).toBeNull()
      expect(postCard()?.textContent).not.toContain('root-author')
      const media = cardPart('post-media')
      expect(
        media?.querySelector('[data-part="post-media-text"]'),
      ).not.toBeNull()
      expect(media?.querySelector('img')).toBeNull()
      expect(postCard()?.querySelectorAll('a, button')).toHaveLength(0)
    },
  )
})

describe('ReplyCard bubble excerpt', () => {
  it('shows the record excerpt in the bubble after the author line, and no excerpt part when there is none', async () => {
    mountCard(replyRow())

    const excerpt = excerptPart()
    expect(excerpt?.textContent?.trim()).toBe('Cute')
    const author = authorLine()
    expect(author?.parentElement?.contains(excerpt)).toBe(true)
    expect(
      author && excerpt
        ? author.compareDocumentPosition(excerpt) &
            Node.DOCUMENT_POSITION_FOLLOWING
        : 0,
    ).not.toBe(0)

    await remountCard(replyRow({ record: replyRecord({ excerpt: undefined }) }))

    expect(authorLine()).not.toBeNull()
    expect(excerptPart()).toBeNull()
  })

  it.each<[string, string]>([
    ['deleted', '[Deleted by user]'],
    ['removedByServerAdmin', '[Removed by server admin]'],
  ])(
    'shows the %s placeholder instead of the excerpt',
    (status, placeholder) => {
      mountCard(replyRow({ record: replyRecord({ status, excerpt: 'Cute' }) }))

      expect(excerptPart()?.textContent?.trim()).toBe(placeholder)
      expect(target.textContent).not.toContain('Cute')
      expect(excerptPart()?.classList.contains('italic')).toBe(true)
      expect(excerptPart()?.classList.contains('text-slate-600')).toBe(true)
    },
  )

  it('draws a live excerpt upright in the body colour', () => {
    mountCard(replyRow())

    expect(excerptPart()?.classList.contains('italic')).toBe(false)
    expect(excerptPart()?.classList.contains('text-slate-800')).toBe(true)
  })
})

describe('ReplyCard removed root post', () => {
  it('drops the header and shows the placeholder in the title position instead of a stale title', () => {
    mountCard(
      replyRow({
        rootPost: {
          uri: rootPostUri,
          cid: 'bafyreibrootcats1' as CID,
          status: 'removedByModerator',
          title: 'Look at this cat',
        },
      }),
    )

    expect(titlePart()?.textContent?.trim()).toBe(
      '[Removed by community moderator]',
    )
    expect(header()).toBeNull()
    expect(target.innerHTML).not.toContain('Look at this cat')
  })
})

describe('ReplyCard placeholder shown once', () => {
  it.each<[string, string, string]>([
    ['deleted', 'deleted', '[Deleted by user]'],
    ['quarantined', 'removedByModerator', '[Removed by community moderator]'],
  ])(
    'shows the copy once, in the title, for a %s root and a %s record',
    (rootStatus, recordStatus, placeholder) => {
      mountCard(
        replyRow({
          rootPost: rootPost({ status: rootStatus }),
          record: replyRecord({ status: recordStatus }),
        }),
      )

      expect(titlePart()?.textContent?.trim()).toBe(placeholder)
      expect(occurrences(placeholder)).toBe(1)
      expect(excerptPart()).toBeNull()
    },
  )

  it('shows both placeholders when the root and record copies differ', () => {
    mountCard(
      replyRow({
        rootPost: rootPost({ status: 'deleted' }),
        record: replyRecord({ status: 'removedByModerator' }),
      }),
    )

    expect(titlePart()?.textContent?.trim()).toBe('[Deleted by user]')
    expect(excerptPart()?.textContent?.trim()).toBe(
      '[Removed by community moderator]',
    )
  })
})

describe('ReplyCard post mention excerpt', () => {
  it('omits the excerpt of a post mention that repeats the root title', () => {
    mountCard(
      replyRow({
        reason: 'mention',
        record: replyRecord({
          uri: mentionPostUri,
          excerpt: 'Look at this cat',
        }),
      }),
    )

    expect(titlePart()?.textContent?.trim()).toBe('Look at this cat')
    expect(occurrences('Look at this cat')).toBe(1)
    expect(excerptPart()).toBeNull()
  })

  it('omits the excerpt of a post mention whose title is over 140 graphemes and whose excerpt is its backend cut', () => {
    const longTitle = 'Lost grey cat seen near the Elm Street bakery. '
      .repeat(5)
      .slice(0, 200)
    const cut = longTitle.slice(0, 140)
    mountCard(
      replyRow({
        reason: 'mention',
        rootPost: rootPost({ title: longTitle }),
        record: replyRecord({ uri: mentionPostUri, excerpt: cut }),
      }),
    )

    expect(titlePart()?.textContent?.trim()).toBe(longTitle.trim())
    expect(excerptPart()).toBeNull()
    expect(occurrences(cut)).toBe(1)
    expect(onlyLink().getAttribute('aria-label')).not.toContain(cut)
  })

  it.each<[string, NotificationRecord, string]>([
    [
      'a post mention with a different excerpt',
      replyRecord({ uri: mentionPostUri, excerpt: 'Cute' }),
      'Cute',
    ],
    [
      'a comment mention repeating the title',
      replyRecord({ excerpt: 'Look at this cat' }),
      'Look at this cat',
    ],
    [
      'a deleted post mention repeating the title',
      replyRecord({
        uri: mentionPostUri,
        excerpt: 'Look at this cat',
        status: 'deleted',
      }),
      '[Deleted by user]',
    ],
  ])('shows the excerpt part for %s', (_title, record, excerptText) => {
    mountCard(replyRow({ reason: 'mention', record }))

    expect(excerptPart()?.textContent?.trim()).toBe(excerptText)
  })

  it('drops the author bubble of a post mention whose excerpt repeats the title, keeping a Reply button below the post card', () => {
    mountCard(
      replyRow({
        reason: 'mention',
        rootPost: cardRootPost(),
        record: replyRecord({
          uri: mentionPostUri,
          excerpt: 'Look at this cat',
        }),
      }),
    )

    expect(authorLine()).toBeNull()
    const reply = target.querySelector('[data-part="reply-row"] button')
    expect(reply?.textContent?.trim()).toBe('Reply')
  })

  it('keeps the author bubble of a title-repeating post mention while the row is concealed', () => {
    settings.nsfwBlur = true
    mountCard(
      replyRow({
        reason: 'mention',
        rootPost: rootPost({ labels: nsfwLabels }),
        record: replyRecord({
          uri: mentionPostUri,
          excerpt: 'Look at this cat',
        }),
      }),
    )

    expect(target.querySelector('[data-part="post-card"]')).toBeNull()
    expect(authorLine()).not.toBeNull()
  })

  it.each<[string, ReplyNotificationRow['rootPost']['author']]>([
    ['no root author', undefined],
    [
      'a root author with an empty handle',
      { did: aliceDid, handle: '' as Handle },
    ],
    [
      'a root author with the invalid handle',
      { did: aliceDid, handle: 'handle.invalid' as Handle },
    ],
  ])(
    'keeps the author bubble of a title-repeating post mention with %s',
    (_title, author) => {
      mountCard(
        replyRow({
          reason: 'mention',
          rootPost: cardRootPost({ author }),
          record: replyRecord({
            uri: mentionPostUri,
            excerpt: 'Look at this cat',
          }),
        }),
      )

      expect(authorLine()).not.toBeNull()
    },
  )

  it('keeps the author bubble of a mention in a removed post', () => {
    mountCard(
      replyRow({
        reason: 'mention',
        rootPost: rootPost({ status: 'deleted' }),
        record: replyRecord({
          uri: mentionPostUri,
          excerpt: 'Look at this cat',
          status: 'deleted',
        }),
      }),
    )

    expect(authorLine()).not.toBeNull()
  })

  it('keeps the author bubble of a post mention with a different excerpt', () => {
    mountCard(
      replyRow({
        reason: 'mention',
        record: replyRecord({ uri: mentionPostUri, excerpt: 'Cute' }),
      }),
    )

    expect(authorLine()).not.toBeNull()
  })

  it('keeps the author bubble of a comment without an excerpt', () => {
    mountCard(replyRow({ record: replyRecord({ excerpt: undefined }) }))

    expect(authorLine()).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Chunk 12, batch 2: sensitive concealment and Show
// ---------------------------------------------------------------------------

/** The setting's value at import (its default comes from env). */
const initialNsfwBlur = settings.nsfwBlur

afterEach(() => {
  settings.nsfwBlur = initialNsfwBlur
})

const nsfwLabels = { values: [{ val: 'nsfw' }] }

/** An unread postReply under an NSFW-labelled root with a title, thumbnail and excerpt "Cute". */
function sensitiveRow(): ReplyNotificationRow {
  return replyRow({
    isRead: false,
    rootPost: rootPost({
      thumbnail: thumbnailUrl,
      thumbnailAlt,
      labels: nsfwLabels,
    }),
  })
}

/** The same row without the NSFW label. */
function plainRow(): ReplyNotificationRow {
  return replyRow({
    isRead: false,
    rootPost: rootPost({ thumbnail: thumbnailUrl, thumbnailAlt }),
  })
}

/** The sensitive banner's buttons: those carrying the "NSFW Content" label. */
function bannerButtons(container: Element = target): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button')).filter((button) =>
    button.textContent?.includes('NSFW Content'),
  )
}

function isFollowing(first: Node, second: Node): boolean {
  return (
    (first.compareDocumentPosition(second) &
      Node.DOCUMENT_POSITION_FOLLOWING) !==
    0
  )
}

describe('ReplyCard sensitive concealment', () => {
  it('conceals the title, thumbnail and excerpt behind the banner, keeping the header, author line and tint', () => {
    settings.nsfwBlur = true
    mountCard(sensitiveRow())

    expect(bannerButtons()).toHaveLength(1)
    expect(titlePart()).toBeNull()
    expect(thumbnailPart()).toBeNull()
    expect(excerptPart()).toBeNull()
    expect(target.innerHTML).not.toContain('Look at this cat')
    expect(target.innerHTML).not.toContain('Cute')
    expect(target.innerHTML).not.toContain(
      'https://cdn.coves.social/thumb/cat.jpg',
    )
    expect(target.innerHTML).not.toContain(thumbnailAlt)
    expect(header()).not.toBeNull()
    expect(authorLine()).not.toBeNull()
    expect(target.querySelector('[data-unread="true"]')).not.toBeNull()
    expect(onlyLink().getAttribute('aria-label')).toBe(
      'Alice replied to your post in !cats@coves.social. 3h ago',
    )
  })

  it('conceals both placeholders of a removed root and a deleted record whose record carries the NSFW label', () => {
    settings.nsfwBlur = true
    mountCard(
      replyRow({
        rootPost: rootPost({ status: 'removedByModerator' }),
        record: replyRecord({ status: 'deleted', labels: nsfwLabels }),
      }),
    )

    expect(bannerButtons()).toHaveLength(1)
    expect(titlePart()).toBeNull()
    expect(excerptPart()).toBeNull()
    for (const placeholder of [
      '[Removed by community moderator]',
      '[Deleted by user]',
    ]) {
      expect(target.textContent).not.toContain(placeholder)
      expect(target.innerHTML).not.toContain(placeholder)
    }
    expect(authorLine()).not.toBeNull()
  })

  it.each<[string, () => ReplyNotificationRow, boolean]>([
    ['a sensitive row with the blur setting off', sensitiveRow, false],
    ['a row without an NSFW label with the blur setting on', plainRow, true],
  ])('shows the body and no banner for %s', (_title, row, nsfwBlur) => {
    settings.nsfwBlur = nsfwBlur
    mountCard(row())

    expect(titlePart()?.textContent?.trim()).toBe('Look at this cat')
    expect(thumbnailPart()?.getAttribute('src')).toBe(
      'https://cdn.coves.social/thumb/cat.jpg',
    )
    expect(excerptPart()?.textContent?.trim()).toBe('Cute')
    expect(bannerButtons()).toHaveLength(0)
    expect(onlyLink().getAttribute('aria-label')).toBe(
      'Alice replied to your post in !cats@coves.social: Cute. 3h ago',
    )
  })
})

describe('ReplyCard sensitive banner placement', () => {
  it('places one collapsed banner button after the row link, outside it, controlling a region inside the link', () => {
    settings.nsfwBlur = true
    mountCard(sensitiveRow())

    const buttons = bannerButtons()
    expect(buttons).toHaveLength(1)
    const [button] = buttons
    if (!button) throw new Error('The card has no button')
    const link = onlyLink()
    expect(button.closest('a')).toBeNull()
    expect(button.parentElement).toBe(link.parentElement)
    expect(isFollowing(link, button)).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    const region = document.getElementById(
      button.getAttribute('aria-controls') ?? '',
    )
    expect(region).not.toBeNull()
    expect(link.contains(region)).toBe(true)
  })

  it('gives two concealed cards different controlled regions, each inside its own link', async () => {
    settings.nsfwBlur = true
    mountCard(sensitiveRow())
    const otherTarget = document.createElement('div')
    document.body.appendChild(otherTarget)
    const other = client.mount(ReplyCard, {
      target: otherTarget,
      intro: false,
      props: { row: sensitiveRow(), revealed: false, onreveal: () => {} },
    })
    client.flushSync()

    try {
      const controls = [target, otherTarget].map((container) => {
        const [button] = bannerButtons(container)
        const link = container.querySelector('a')
        const id = button?.getAttribute('aria-controls') ?? ''
        const region = document.getElementById(id)
        expect(region).not.toBeNull()
        expect(link?.contains(region)).toBe(true)
        return id
      })
      expect(controls[0]).not.toBe(controls[1])
    } finally {
      await client.unmount(other, { outro: false })
      otherTarget.remove()
    }
  })
})

describe('ReplyCard Show', () => {
  it('asks the list to reveal the row by its identity and stays concealed while not revealed', () => {
    settings.nsfwBlur = true
    const onreveal = vi.fn()
    mountCard(sensitiveRow(), false, onreveal)

    bannerButtons()[0]?.click()
    client.flushSync()

    expect(onreveal).toHaveBeenCalledTimes(1)
    expect(onreveal).toHaveBeenCalledWith(
      'postReply|at://did:plc:alice4x7k/social.coves.community.comment/3kcommentcats1',
    )
    expect(titlePart()).toBeNull()
    expect(thumbnailPart()).toBeNull()
    expect(excerptPart()).toBeNull()
    expect(onlyLink().getAttribute('aria-label')).toBe(
      'Alice replied to your post in !cats@coves.social. 3h ago',
    )
  })
})

describe('ReplyCard revealed by the list', () => {
  let RevealHost: typeof import('./RevealHost.test.svelte').default

  beforeAll(async () => {
    RevealHost = (await import('./RevealHost.test.svelte')).default
  }, 30_000)

  it('renders the body inside the controlled region on the same card once the list reveals it', () => {
    settings.nsfwBlur = true
    mounted = client.mount(RevealHost, {
      target,
      intro: false,
      props: { row: sensitiveRow(), record: vi.fn() },
    })
    client.flushSync()
    const link = target.querySelector('a')
    const [button] = bannerButtons()
    const controls = button?.getAttribute('aria-controls')

    button?.click()
    client.flushSync()

    const title = titlePart()
    const thumbnail = thumbnailPart()
    const excerpt = excerptPart()
    expect(title?.textContent?.trim()).toBe('Look at this cat')
    expect(thumbnail?.getAttribute('src')).toBe(
      'https://cdn.coves.social/thumb/cat.jpg',
    )
    expect(excerpt?.textContent?.trim()).toBe('Cute')
    expect(target.querySelector('a')).toBe(link)
    expect(bannerButtons()[0]).toBe(button)
    expect(button?.getAttribute('aria-controls')).toBe(controls)
    const region = document.getElementById(controls ?? '')
    expect(region).not.toBeNull()
    expect(region?.contains(title)).toBe(true)
    expect(region?.contains(thumbnail)).toBe(true)
    expect(region?.contains(excerpt)).toBe(true)
    expect(button?.getAttribute('aria-expanded')).toBe('true')
    expect(link?.getAttribute('aria-label')).toBe(
      'Alice replied to your post in !cats@coves.social: Cute. 3h ago',
    )
  })
})

// ---------------------------------------------------------------------------
// notif-design B5: Quick Reply
// ---------------------------------------------------------------------------

/** The signed-in viewer the composer writes as. */
const viewerAccount = { did: viewerDid, handle: 'viewer.coves.social' }

/** One comment create the fetch spy saw, held until the test answers it. */
interface CommentCreateRequest {
  body: unknown
  resolve(response: Response): void
}

describe('ReplyCard Quick Reply', () => {
  let profile: (typeof import('$lib/app/state/auth.svelte'))['profile']
  const createRequests: CommentCreateRequest[] = []
  const unexpectedUrls: string[] = []
  const nextGeneration = createGenerationFactory('reply-card-quick-reply')

  beforeAll(async () => {
    profile = (await import('$lib/app/state/auth.svelte')).profile
  }, 30_000)

  beforeEach(() => {
    createRequests.length = 0
    unexpectedUrls.length = 0
    // A Vite `define` the vitest config does not set.
    vi.stubGlobal('__VERSION__', 'test')
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input)
        if (!url.includes('social.coves.community.comment.create')) {
          unexpectedUrls.push(url)
          return Promise.resolve(json(404, { error: 'UnexpectedFetch' }))
        }
        const response = Promise.withResolvers<Response>()
        createRequests.push({
          body:
            typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
          resolve: response.resolve,
        })
        return response.promise
      }),
    )
    profile.syncFromServer(session(viewerAccount, nextGeneration()))
    client.flushSync()
  })

  afterEach(() => {
    profile.syncFromServer(undefined)
    vi.unstubAllGlobals()
    expect(unexpectedUrls).toEqual([])
  })

  /** The buttons named "Reply to Alice". */
  function replyButtons(): HTMLButtonElement[] {
    return Array.from(target.querySelectorAll('button')).filter(
      (button) => accessibleName(button) === 'Reply to Alice',
    )
  }

  /** The single "Reply to Alice" button; fails when there is not exactly one. */
  function replyButton(): HTMLButtonElement {
    const buttons = replyButtons()
    expect(buttons).toHaveLength(1)
    const [button] = buttons
    if (!button) throw new Error('The card has no Reply button')
    return button
  }

  function composer(): HTMLTextAreaElement | null {
    return target.querySelector('textarea')
  }

  /** Opens the composer, types `text` and submits it. */
  async function replyWith(text: string): Promise<void> {
    replyButton().click()
    client.flushSync()
    const textarea = composer()
    if (!textarea) throw new Error('The composer did not open')
    textarea.value = text
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    client.flushSync()
    const submitButton = Array.from(
      target.querySelectorAll('button[type="submit"]'),
    ).find((button) => button.textContent?.trim() === 'Submit')
    if (!(submitButton instanceof HTMLButtonElement))
      throw new Error('The composer has no Submit button')
    submitButton.click()
    await settle(client)
  }

  it('shows a collapsed "Reply" button named for the author, in the bubble row after the row link and outside it', () => {
    mountCard(replyRow())

    const button = replyButton()
    const link = onlyLink()
    expect(button.textContent?.trim()).toBe('Reply')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.closest('a')).toBeNull()
    const row = button.closest('[data-part="reply-row"]')
    expect(row?.parentElement).toBe(link.parentElement)
    expect(row && isFollowing(link, row)).toBe(true)
    expect(composer()).toBeNull()
  })

  it('opens the composer inside the card below the link and marks the button expanded', () => {
    mountCard(replyRow())

    replyButton().click()
    client.flushSync()

    const textarea = composer()
    expect(textarea).not.toBeNull()
    const link = target.querySelector('a')
    expect(link?.contains(textarea)).toBe(false)
    expect(textarea && link ? isFollowing(link, textarea) : false).toBe(true)
    expect(replyButton().getAttribute('aria-expanded')).toBe('true')
  })

  it.each<[string, ReplyNotificationRow, unknown]>([
    [
      'a reply comment, with the comment as the parent',
      replyRow(),
      {
        root: {
          uri: 'at://did:plc:viewer7f3kq2/social.coves.community.post/3kpostcats1',
          cid: 'bafyreibrootcats1',
        },
        parent: {
          uri: 'at://did:plc:alice4x7k/social.coves.community.comment/3kcommentcats1',
          cid: 'bafyreibrecordcats1',
        },
      },
    ],
    [
      'a post mention, with the root post as the parent',
      replyRow({
        reason: 'mention',
        record: replyRecord({
          uri: mentionPostUri,
          cid: 'bafyreibmentionpost1' as CID,
          excerpt: 'Hey @viewer',
        }),
      }),
      {
        root: {
          uri: 'at://did:plc:viewer7f3kq2/social.coves.community.post/3kpostcats1',
          cid: 'bafyreibrootcats1',
        },
        parent: {
          uri: 'at://did:plc:viewer7f3kq2/social.coves.community.post/3kpostcats1',
          cid: 'bafyreibrootcats1',
        },
      },
    ],
  ])('creates a comment replying to %s', async (_title, row, reply) => {
    mountCard(row)

    await replyWith('Thanks')

    expect(createRequests).toHaveLength(1)
    const body = createRequests[0]?.body as
      { reply?: unknown; content?: unknown } | undefined
    expect(body?.reply).toEqual(reply)
    expect(body?.content).toBe('Thanks')
  })

  it('keeps the composer open while the create is pending, then closes it and focuses the Reply button', async () => {
    mountCard(replyRow())

    await replyWith('Thanks')

    expect(createRequests).toHaveLength(1)
    expect(composer()).not.toBeNull()
    expect(replyButton().getAttribute('aria-expanded')).toBe('true')

    createRequests[0]?.resolve(
      json(200, {
        uri: 'at://did:plc:viewer7f3kq2/social.coves.community.comment/3kquickreply1',
        cid: 'bafyreibquickreply1',
      }),
    )
    await settle(client)

    expect(composer()).toBeNull()
    const button = replyButton()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button)
  })

  it('closes the composer on Cancel', () => {
    mountCard(replyRow())
    replyButton().click()
    client.flushSync()
    expect(composer()).not.toBeNull()

    const cancel = target.querySelector('button[title="Cancel"]')
    if (!(cancel instanceof HTMLButtonElement))
      throw new Error('The composer has no Cancel button')
    cancel.click()
    client.flushSync()

    expect(composer()).toBeNull()
    expect(replyButton().getAttribute('aria-expanded')).toBe('false')
  })

  it('closes the composer when Reply is clicked again and marks the button collapsed', () => {
    mountCard(replyRow())
    replyButton().click()
    client.flushSync()
    expect(composer()).not.toBeNull()

    replyButton().click()
    client.flushSync()

    expect(composer()).toBeNull()
    expect(replyButton().getAttribute('aria-expanded')).toBe('false')
  })

  it('moves focus to the Reply button when Cancel closes the composer', async () => {
    mountCard(replyRow())
    replyButton().click()
    client.flushSync()
    const cancel = target.querySelector('button[title="Cancel"]')
    if (!(cancel instanceof HTMLButtonElement))
      throw new Error('The composer has no Cancel button')
    cancel.focus()

    cancel.click()
    await settle(client)

    expect(composer()).toBeNull()
    expect(document.activeElement).toBe(replyButton())
  })

  it('disables Cancel while the create is pending, keeping the composer open until it resolves', async () => {
    mountCard(replyRow())
    await replyWith('Thanks')
    expect(createRequests).toHaveLength(1)
    const cancel = target.querySelector('button[title="Cancel"]')
    if (!(cancel instanceof HTMLButtonElement))
      throw new Error('The composer has no Cancel button')

    expect(cancel.disabled).toBe(true)
    cancel.click()
    client.flushSync()
    expect(composer()).not.toBeNull()

    createRequests[0]?.resolve(
      json(200, {
        uri: 'at://did:plc:viewer7f3kq2/social.coves.community.comment/3kquickreply1',
        cid: 'bafyreibquickreply1',
      }),
    )
    await settle(client)

    expect(composer()).toBeNull()
    expect(replyButton().getAttribute('aria-expanded')).toBe('false')
  })

  it('offers Reply on a post mention whose record has no cid, since the root is the parent', () => {
    const { cid: _omittedCid, ...recordWithoutCid } = replyRecord({
      uri: mentionPostUri,
    })
    mountCard(
      replyRow({
        reason: 'mention',
        record: recordWithoutCid as NotificationRecord,
      }),
    )

    expect(replyButton().getAttribute('aria-expanded')).toBe('false')
  })

  it.each<[string, () => ReplyNotificationRow]>([
    [
      'the root post has no cid',
      () => {
        const { cid: _omittedCid, ...rootWithoutCid } = rootPost()
        return replyRow({
          rootPost: rootWithoutCid as ReplyNotificationRow['rootPost'],
        })
      },
    ],
    [
      'the root post has an empty cid',
      () => replyRow({ rootPost: rootPost({ cid: '' as CID }) }),
    ],
    [
      'the replied comment has no cid',
      () => {
        const { cid: _omittedCid, ...recordWithoutCid } = replyRecord()
        return replyRow({ record: recordWithoutCid as NotificationRecord })
      },
    ],
    [
      'the replied comment has an empty cid',
      () => replyRow({ record: replyRecord({ cid: '' as CID }) }),
    ],
    [
      'the root post is removed',
      () => replyRow({ rootPost: rootPost({ status: 'removedByModerator' }) }),
    ],
    [
      'the record is deleted',
      () => replyRow({ record: replyRecord({ status: 'deleted' }) }),
    ],
    [
      'the row is concealed',
      () => {
        settings.nsfwBlur = true
        return sensitiveRow()
      },
    ],
  ])('shows no Reply button when %s', (_title, row) => {
    mountCard(row())

    expect(replyButtons()).toHaveLength(0)
    expect(composer()).toBeNull()
  })

  it('removes the Reply button and an open composer when the blur setting conceals the row', () => {
    settings.nsfwBlur = false
    mountCard(sensitiveRow())
    replyButton().click()
    client.flushSync()
    expect(composer()).not.toBeNull()

    settings.nsfwBlur = true
    client.flushSync()

    expect(replyButtons()).toHaveLength(0)
    expect(composer()).toBeNull()
  })

  it('disables the Reply toggle while the create is pending, keeping the composer open', async () => {
    mountCard(replyRow())
    await replyWith('Thanks')
    expect(createRequests).toHaveLength(1)

    const button = replyButton()
    expect(button.disabled).toBe(true)
    button.click()
    client.flushSync()
    expect(composer()).not.toBeNull()
    expect(replyButton().getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps a composer reopened after concealment open with its draft when the first create resolves', async () => {
    settings.nsfwBlur = false
    mountCard(sensitiveRow())
    await replyWith('Thanks')
    expect(createRequests).toHaveLength(1)
    settings.nsfwBlur = true
    client.flushSync()
    expect(composer()).toBeNull()
    settings.nsfwBlur = false
    client.flushSync()

    replyButton().click()
    client.flushSync()
    const reopened = composer()
    if (!reopened) throw new Error('The composer did not reopen')
    reopened.value = 'second draft'
    reopened.dispatchEvent(new Event('input', { bubbles: true }))
    client.flushSync()

    createRequests[0]?.resolve(
      json(200, {
        uri: 'at://did:plc:viewer7f3kq2/social.coves.community.comment/3kquickreply1',
        cid: 'bafyreibquickreply1',
      }),
    )
    await settle(client)

    expect(composer()?.value).toBe('second draft')
    expect(replyButton().getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps a reopened composer locked while its own create is pending after a concealed earlier create resolves', async () => {
    settings.nsfwBlur = false
    mountCard(sensitiveRow())
    await replyWith('Thanks')
    settings.nsfwBlur = true
    client.flushSync()
    settings.nsfwBlur = false
    client.flushSync()
    await replyWith('Second reply')
    expect(createRequests).toHaveLength(2)

    createRequests[0]?.resolve(
      json(200, {
        uri: 'at://did:plc:viewer7f3kq2/social.coves.community.comment/3kquickreply1',
        cid: 'bafyreibquickreply1',
      }),
    )
    await settle(client)

    const submitButton = target.querySelector('button[type="submit"]')
    const cancel = target.querySelector('button[title="Cancel"]')
    if (
      !(submitButton instanceof HTMLButtonElement) ||
      !(cancel instanceof HTMLButtonElement)
    )
      throw new Error('The second composer is not open')
    expect(submitButton.disabled).toBe(true)
    expect(cancel.disabled).toBe(true)
    expect(replyButton().disabled).toBe(true)
    expect(replyButton().getAttribute('aria-expanded')).toBe('true')

    createRequests[1]?.resolve(
      json(200, {
        uri: 'at://did:plc:viewer7f3kq2/social.coves.community.comment/3kquickreply2',
        cid: 'bafyreibquickreply2',
      }),
    )
    await settle(client)

    expect(composer()).toBeNull()
    expect(replyButton().disabled).toBe(false)
    expect(replyButton().getAttribute('aria-expanded')).toBe('false')
  })

  it('shows a collapsed Reply button and no composer once a row concealed while replying is revealed', async () => {
    const RevealHost = (await import('./RevealHost.test.svelte')).default
    settings.nsfwBlur = false
    mounted = client.mount(RevealHost, {
      target,
      intro: false,
      props: { row: sensitiveRow(), record: vi.fn() },
    })
    client.flushSync()
    replyButton().click()
    client.flushSync()
    expect(composer()).not.toBeNull()
    settings.nsfwBlur = true
    client.flushSync()
    expect(replyButtons()).toHaveLength(0)

    bannerButtons()[0]?.click()
    client.flushSync()

    expect(replyButton().getAttribute('aria-expanded')).toBe('false')
    expect(composer()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// notif-design: a reply to the viewer's comment
// ---------------------------------------------------------------------------

describe("ReplyCard reply to the viewer's comment", () => {
  const viewerCommentUri =
    `at://${viewerDid}/social.coves.community.comment/3kmine1` as AtUri

  function commentReplyRow(
    subject: Partial<NonNullable<ReplyNotificationRow['subject']>> = {},
    overrides: Partial<ReplyNotificationRow> = {},
  ): ReplyNotificationRow {
    return replyRow({
      reason: 'commentReply',
      subject: {
        uri: viewerCommentUri,
        cid: 'bafyreibmine1' as CID,
        preview: 'Try a 24mm',
        ...subject,
      },
      ...overrides,
    })
  }

  function yourComment(): Element | null {
    return target.querySelector('a [data-part="your-comment"]')
  }

  it("quotes the viewer's comment above the reply in place of the root post card", () => {
    mountCard(commentReplyRow())

    expect(target.querySelector('[data-part="post-card"]')).toBeNull()
    expect(target.textContent).not.toContain('Look at this cat')
    const quote = yourComment()
    expect(quote?.textContent?.trim()).toBe('Try a 24mm')
    const reply = excerptPart()
    if (!quote || !reply) throw new Error('No quote or reply excerpt')
    expect(isFollowing(quote, reply)).toBe(true)
    expect(excerptPart()?.textContent?.trim()).toBe('Cute')
  })

  it("keeps the root post card's placeholder instead of the quote when the root post is removed", () => {
    mountCard(
      commentReplyRow({}, { rootPost: rootPost({ status: 'deleted' }) }),
    )

    expect(target.querySelector('[data-part="post-card"]')).not.toBeNull()
    expect(target.querySelector('[data-part="your-comment"]')).toBeNull()
    expect(target.textContent).toContain('[Deleted by user]')
  })

  it('shows the placeholder copy in muted italic for a removed comment of the viewer', () => {
    mountCard(commentReplyRow({ status: 'removedByModerator' }))

    const text = yourComment()?.querySelector('p')
    expect(text?.textContent?.trim()).toBe('[Removed by community moderator]')
    expect(text?.classList.contains('italic')).toBe(true)
    expect(target.textContent).not.toContain('Try a 24mm')
  })

  it.each<[string, ReplyNotificationRow]>([
    ['a commentReply without a subject', replyRow({ reason: 'commentReply' })],
    [
      'a commentReply whose subject has no preview',
      commentReplyRow({ preview: undefined }),
    ],
    [
      'a postReply',
      replyRow({
        subject: {
          uri: viewerCommentUri,
          cid: 'bafyreibmine1' as CID,
          preview: 'Try a 24mm',
        },
      }),
    ],
  ])('keeps the root post card for %s', (_title, row) => {
    mountCard(row)

    expect(target.querySelector('[data-part="post-card"]')).not.toBeNull()
    expect(yourComment()).toBeNull()
  })

  it("hides the viewer's comment while the row is concealed", () => {
    settings.nsfwBlur = true
    mountCard(commentReplyRow({ labels: nsfwLabels }))

    expect(yourComment()).toBeNull()
    expect(target.innerHTML).not.toContain('Try a 24mm')
  })
})
