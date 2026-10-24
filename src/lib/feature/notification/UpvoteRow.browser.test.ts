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
  NotificationSubject,
} from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import { loadTranslations, locale } from '$lib/app/state/i18n'
import { settings } from '$lib/app/state/settings.svelte'
import type { UpvoteNotificationRow } from './rows'

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
// Fixtures: Alice, Bob and Carol upvote the viewer's post in !cats@coves.social.
// ---------------------------------------------------------------------------

/** Pinned "now"; the group was sorted 3 h before. */
const now = '2026-10-12T12:00:00.000Z'
const threeHoursAgo = '2026-10-12T09:00:00.000Z'

const viewerDid = 'did:plc:viewer7f3kq2' as DID
const catsDid = 'did:plc:cats' as DID

const postUri =
  `at://${viewerDid}/social.coves.community.post/3kpostcats1` as AtUri
const commentUri =
  `at://${viewerDid}/social.coves.community.comment/3kcommentcats1` as AtUri

const aliceAvatarUrl = 'https://cdn.coves.social/avatar/alice.jpg'
const bobAvatarUrl = 'https://cdn.coves.social/avatar/bob.jpg'

/** A served community whose mention form is "!cats@coves.social". */
const cats: CommunityRef = {
  did: catsDid,
  name: 'cats',
  origin: 'coves.social',
}

const alice: NotificationActor = {
  did: 'did:plc:alice4x7k' as DID,
  handle: 'alice.coves.social',
  displayName: 'Alice',
  avatar: aliceAvatarUrl,
}

const bob: NotificationActor = {
  did: 'did:plc:bob5m2q' as DID,
  handle: 'bob.coves.social',
  displayName: 'Bob',
  avatar: bobAvatarUrl,
}

/** Carol has no avatar. */
const carol: NotificationActor = {
  did: 'did:plc:carol9z1w' as DID,
  handle: 'carol.coves.social',
  displayName: 'Carol',
}

/** Row fields to replace; `subject` fields are merged over the default subject. */
type UpvoteRowOverrides = Partial<Omit<UpvoteNotificationRow, 'subject'>> & {
  subject?: Partial<NotificationSubject>
}

/**
 * A read upvote group on the viewer's post "Look at this cat": four upvotes,
 * the three most recent from Alice, Bob and Carol, sorted 3 h before now.
 */
function upvoteRow({
  subject,
  ...overrides
}: UpvoteRowOverrides = {}): UpvoteNotificationRow {
  return {
    reason: 'upvote',
    sortAt: threeHoursAgo,
    isRead: true,
    rootPost: {
      uri: postUri,
      cid: 'bafyreibrootcats1' as CID,
      title: 'Look at this cat',
      community: cats,
    },
    upvoteCount: 4,
    recentUpvoters: [alice, bob, carol],
    ...overrides,
    subject: {
      uri: postUri,
      cid: 'bafyreibrootcats1' as CID,
      preview: 'Look at this cat',
      ...subject,
    },
  }
}

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------

let target: HTMLDivElement
let client: typeof import('svelte')
let UpvoteRow: typeof import('./UpvoteRow.svelte').default
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

const initialAbsoluteDates = settings.absoluteDates
/** The setting's value at import (its default comes from env). */
const initialNsfwBlur = settings.nsfwBlur

beforeAll(async () => {
  UpvoteRow = (await import('./UpvoteRow.svelte')).default
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
  settings.absoluteDates = initialAbsoluteDates
  settings.nsfwBlur = initialNsfwBlur
  locale.set('en')
  vi.useRealTimers()
})

function mountRow(
  row: UpvoteNotificationRow,
  revealed = false,
  onreveal: (identity: string) => void = () => {},
): void {
  mounted = client.mount(UpvoteRow, {
    target,
    intro: false,
    props: { row, revealed, onreveal },
  })
  client.flushSync()
}

/** The row's only link; fails the test when there is not exactly one. */
function onlyLink(): HTMLAnchorElement {
  const links = target.querySelectorAll('a')
  expect(links).toHaveLength(1)
  const [link] = links
  if (!link) throw new Error('The row has no link')
  return link
}

function linkName(): string | null | undefined {
  return target.querySelector('a')?.getAttribute('aria-label')
}

/** The heading: the title line and the names line, found through the link. */
function sentence(): Element | null {
  return target.querySelector('a [data-part="sentence"]')
}

/** The heading's title line ("Liked your post"). */
function titleText(): string | undefined {
  return sentence()
    ?.querySelector('[data-part="title"]')
    ?.textContent?.replace(/\s+/g, ' ')
    .trim()
}

/** The heading's line naming the upvoters. */
function namesText(): string | undefined {
  return sentence()
    ?.querySelector('[data-part="names"]')
    ?.textContent?.replace(/\s+/g, ' ')
    .trim()
}

/** Whether `element` sits inside the root post card. */
function inPostCard(element: Element): boolean {
  return element.closest('[data-part="post-card"]') !== null
}

/** The row's elements matching `selector`, those in the root post card excluded. */
function outsidePostCard(selector: string): Element[] {
  return Array.from(target.querySelectorAll(selector)).filter(
    (element) => !inPostCard(element),
  )
}

/** The row's time, at the heading's top right. */
function rowTimeText(): string | undefined {
  return target.querySelector('a [data-part="row-time"]')?.textContent?.trim()
}

function avatarStack(): Element | null {
  return target.querySelector('a [data-part="avatars"]')
}

// ---------------------------------------------------------------------------
// B1: link
// ---------------------------------------------------------------------------

describe('UpvoteRow link', () => {
  it('renders an upvote group as one link to the upvoted post, named for the group', () => {
    mountRow(upvoteRow())

    const links = target.querySelectorAll('a')
    expect(links.length).toBe(1)
    expect(links[0]?.getAttribute('href')).toBe(
      '/c/cats@coves.social/post/did%3Aplc%3Aviewer7f3kq2/3kpostcats1',
    )
    expect(links[0]?.getAttribute('aria-label')).toBe(
      'Alice and 3 others liked your post: Look at this cat. 3h ago',
    )
  })
})

// ---------------------------------------------------------------------------
// B2: heart
// ---------------------------------------------------------------------------

describe('UpvoteRow heart', () => {
  it('marks the title with one filled, still heart in the default upvote colour, after the avatar stack', () => {
    mountRow(upvoteRow())

    const hearts = outsidePostCard('a .animated-heart')
    expect(hearts).toHaveLength(1)
    expect(outsidePostCard('.animated-heart')).toHaveLength(1)
    const [heart] = hearts
    if (!(heart instanceof HTMLElement)) throw new Error('No heart')

    const stack = avatarStack()
    expect(stack).not.toBeNull()
    if (!stack) throw new Error('No avatar stack')
    expect(
      stack.compareDocumentPosition(heart) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(heart.closest('[data-part="title"]')).not.toBeNull()

    expect(heart.querySelector('path[d^="M12.489,21.372"]')).not.toBeNull()
    expect(heart.style.getPropertyValue('--heart-color').trim()).toBe('#FF0033')
    expect(target.querySelector('.animating')).toBeNull()
    expect(target.querySelector('.circle-burst')).toBeNull()
    expect(target.querySelector('.particle')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// B3: avatar stack
// ---------------------------------------------------------------------------

describe('UpvoteRow avatar stack', () => {
  it('stacks one overlapping avatar per recent upvoter, in order', () => {
    mountRow(upvoteRow())

    expect(outsidePostCard('[data-avatar]')).toHaveLength(3)
    const stack = avatarStack()
    const avatars = Array.from(stack?.querySelectorAll('[data-avatar]') ?? [])
    expect(avatars).toHaveLength(3)
    expect(avatars.map((avatar) => avatar.getAttribute('data-url'))).toEqual([
      'https://cdn.coves.social/avatar/alice.jpg',
      'https://cdn.coves.social/avatar/bob.jpg',
      '',
    ])
    expect(
      avatars.map((avatar) => avatar.getAttribute('data-has-url')),
    ).toEqual(['true', 'true', 'false'])
    expect(avatars.map((avatar) => avatar.getAttribute('data-alt'))).toEqual([
      'did:plc:alice4x7k',
      'did:plc:bob5m2q',
      'did:plc:carol9z1w',
    ])
    expect(stack?.classList.contains('-space-x-2')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// B4: heading and time
// ---------------------------------------------------------------------------

describe('UpvoteRow heading and time', () => {
  it('renders the title, the names and count below it, and the relative time', () => {
    mountRow(upvoteRow())

    expect(namesText()).toBe('Alice and 3 others')
    expect(titleText()).toBe('Liked your post')
    expect(outsidePostCard('time')).toHaveLength(1)
    expect(rowTimeText()).toBe('3h ago')
  })

  it('drops the time from the row and the link name when the sort time is not a date', () => {
    mountRow(upvoteRow({ sortAt: 'garbage' }))

    expect(namesText()).toBe('Alice and 3 others')
    expect(titleText()).toBe('Liked your post')
    expect(linkName()).toBe(
      'Alice and 3 others liked your post: Look at this cat',
    )
    expect(outsidePostCard('time')).toHaveLength(0)
  })

  it('switches the time and the link name to an absolute date when the setting turns on', () => {
    mountRow(upvoteRow())
    expect(rowTimeText()).toBe('3h ago')

    settings.absoluteDates = true
    client.flushSync()

    // Platform Intl on a literal date is the oracle; the host time zone
    // applies to both sides.
    const absoluteText = new Intl.DateTimeFormat('en', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date('2026-10-12T09:00:00.000Z'))
    expect(rowTimeText()).toBe(absoluteText)
    expect(linkName()).toBe(
      `Alice and 3 others liked your post: Look at this cat. ${absoluteText}`,
    )
  })

  it('reformats the count and the time when the locale changes', async () => {
    mountRow(upvoteRow({ recentUpvoters: [], upvoteCount: 1000 }))
    expect(namesText()).toBe('1,000 people')
    expect(titleText()).toBe('Liked your post')
    expect(rowTimeText()).toBe('3h ago')

    await loadTranslations('de')
    client.flushSync()

    expect(namesText()).toBe('1.000 people')
    expect(titleText()).toBe('Liked your post')
    expect(rowTimeText()).toBe('vor 3 Std.')
    expect(linkName()).toBe(
      '1.000 people liked your post: Look at this cat. vor 3 Std.',
    )
  })
})

// ---------------------------------------------------------------------------
// B5–B6: bridged-only group, native group without a count
// ---------------------------------------------------------------------------

describe('UpvoteRow without recent upvoters or a count', () => {
  it('renders a bridged-only group as a count with no avatar stack', () => {
    expect(() =>
      mountRow(upvoteRow({ recentUpvoters: [], upvoteCount: 4 })),
    ).not.toThrow()

    expect(namesText()).toBe('4 people')
    expect(titleText()).toBe('Liked your post')
    expect(rowTimeText()).toBe('3h ago')
    expect(target.querySelector('[data-part="avatars"]')).toBeNull()
    expect(outsidePostCard('[data-avatar]')).toHaveLength(0)
  })

  it('names both native upvoters of a comment when there is no count', () => {
    const withoutCount = upvoteRow({
      recentUpvoters: [alice, bob],
      subject: {
        uri: commentUri,
        cid: 'bafyreibcommentcats1' as CID,
        preview: 'So fluffy',
      },
    })
    delete withoutCount.upvoteCount

    expect(() => mountRow(withoutCount)).not.toThrow()

    expect(namesText()).toBe('Alice and Bob')
    expect(titleText()).toBe('Liked your comment')
    expect(rowTimeText()).toBe('3h ago')
    expect(outsidePostCard('[data-avatar]')).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// B7: unread tint
// ---------------------------------------------------------------------------

describe('UpvoteRow unread tint', () => {
  it('tints an unread row and keeps the link inside the tinted element', () => {
    mountRow(upvoteRow({ isRead: false }))

    const tinted = target.querySelector('[data-unread="true"]')
    expect(tinted).not.toBeNull()
    expect(tinted?.classList.contains('bg-primary-900/5')).toBe(true)
    expect(tinted?.classList.contains('dark:bg-primary-100/5')).toBe(true)
    const link = onlyLink()
    expect(tinted).not.toBe(link)
    expect(tinted?.contains(link)).toBe(true)
  })

  it('leaves a read row untinted', () => {
    mountRow(upvoteRow({ isRead: true }))

    expect(onlyLink()).toBeDefined()
    expect(target.querySelector('[data-unread]')).toBeNull()
    expect(
      Array.from(target.querySelectorAll('*')).filter(
        (element) =>
          element.classList.contains('bg-primary-900/5') ||
          element.classList.contains('dark:bg-primary-100/5'),
      ),
    ).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Chunk 14: preview, placeholder, thumbnail, concealment and Show
// ---------------------------------------------------------------------------

const commentPreview = 'So fluffy, look at those paws'
const pawsThumbnailUrl = 'https://cdn.coves.social/thumb/paws.jpg'
const pawsThumbnailAlt = 'Two white paws on a blanket'
const rootThumbnailUrl = 'https://cdn.coves.social/thumb/cat.jpg'
const nsfwLabels = { values: [{ val: 'nsfw' }] }

/**
 * The group upvoted the viewer's comment "So fluffy, look at those paws"
 * under the post "Look at this cat", whose own thumbnail differs from the
 * comment's.
 */
function commentUpvoteRow(
  subject: Partial<NotificationSubject> = {},
  overrides: UpvoteRowOverrides = {},
): UpvoteNotificationRow {
  return upvoteRow({
    rootPost: {
      uri: postUri,
      cid: 'bafyreibrootcats1' as CID,
      title: 'Look at this cat',
      thumbnail: rootThumbnailUrl,
      community: cats,
    },
    ...overrides,
    subject: {
      uri: commentUri,
      cid: 'bafyreibcommentcats1' as CID,
      preview: commentPreview,
      ...subject,
    },
  })
}

/** An unread comment upvote with a thumbnail, NSFW-labelled on its root post. */
function sensitiveRootRow(): UpvoteNotificationRow {
  const row = commentUpvoteRow(
    { thumbnail: pawsThumbnailUrl, thumbnailAlt: pawsThumbnailAlt },
    { isRead: false },
  )
  row.rootPost.labels = nsfwLabels
  return row
}

/** The same row, NSFW-labelled on the upvoted comment instead. */
function sensitiveSubjectRow(): UpvoteNotificationRow {
  return commentUpvoteRow(
    {
      thumbnail: pawsThumbnailUrl,
      thumbnailAlt: pawsThumbnailAlt,
      labels: nsfwLabels,
    },
    { isRead: false },
  )
}

/** The same row without any NSFW label. */
function plainCommentRow(): UpvoteNotificationRow {
  return commentUpvoteRow(
    { thumbnail: pawsThumbnailUrl, thumbnailAlt: pawsThumbnailAlt },
    { isRead: false },
  )
}

const fullLinkName =
  'Alice and 3 others liked your comment: So fluffy, look at those paws. 3h ago'
const concealedLinkName = 'Alice and 3 others liked your comment. 3h ago'

function previewPart(): Element | null {
  return target.querySelector('[data-part="preview"]')
}

function thumbnailPart(): HTMLImageElement | null {
  return target.querySelector('img[data-part="thumbnail"]')
}

function showButton(): HTMLButtonElement | null {
  return target.querySelector('button[aria-controls]')
}

function isFollowing(first: Node, second: Node): boolean {
  return (
    (first.compareDocumentPosition(second) &
      Node.DOCUMENT_POSITION_FOLLOWING) !==
    0
  )
}

describe('UpvoteRow preview', () => {
  it('renders the subject preview below the sentence inside the link, muted and clamped to three lines', () => {
    mountRow(commentUpvoteRow())

    const preview = previewPart()
    expect(preview).not.toBeNull()
    if (!preview) throw new Error('The row has no preview')
    expect(preview.textContent?.trim()).toBe('So fluffy, look at those paws')
    const link = onlyLink()
    expect(link.contains(preview)).toBe(true)
    // The preview row has no Show button naming the region, so the region is
    // the element directly holding the preview.
    expect(preview.parentElement?.classList.contains('hidden')).toBe(false)
    const line = sentence()
    if (!line) throw new Error('The row has no sentence')
    expect(line.contains(preview)).toBe(false)
    expect(isFollowing(line, preview)).toBe(true)
    for (const token of [
      'text-sm',
      'text-slate-600',
      'dark:text-zinc-400',
      'line-clamp-3',
    ]) {
      expect(preview.classList.contains(token)).toBe(true)
    }
    expect(target.textContent).not.toContain('Look at this cat')
    expect(link.getAttribute('aria-label')).toBe(
      'Alice and 3 others liked your comment: So fluffy, look at those paws. 3h ago',
    )
  })
})

describe('UpvoteRow subject placeholder', () => {
  it.each<[string, string]>([
    ['deleted', '[Deleted by user]'],
    ['quarantined', '[Removed by community moderator]'],
  ])(
    'shows the %s placeholder in the preview position instead of the preview',
    (status, placeholder) => {
      mountRow(commentUpvoteRow({ status }))

      expect(previewPart()?.textContent?.trim()).toBe(placeholder)
      expect(target.textContent).not.toContain('So fluffy, look at those paws')
    },
  )

  it('shows the server-admin placeholder for a subject without a preview', () => {
    mountRow(
      commentUpvoteRow({ status: 'removedByServerAdmin', preview: undefined }),
    )

    expect(previewPart()?.textContent?.trim()).toBe('[Removed by server admin]')
  })
})

describe('UpvoteRow thumbnail', () => {
  it('trails the text with a square image of the subject thumbnail and its alt text', () => {
    mountRow(
      commentUpvoteRow({
        thumbnail: pawsThumbnailUrl,
        thumbnailAlt: pawsThumbnailAlt,
      }),
    )

    const thumbnail = thumbnailPart()
    expect(thumbnail).not.toBeNull()
    if (!thumbnail) throw new Error('The row has no thumbnail')
    expect(thumbnail.getAttribute('src')).toBe(
      'https://cdn.coves.social/thumb/paws.jpg',
    )
    expect(thumbnail.getAttribute('alt')).toBe('Two white paws on a blanket')
    expect(onlyLink().contains(thumbnail)).toBe(true)
    expect(thumbnail.classList.contains('size-16')).toBe(true)
    expect(thumbnail.classList.contains('object-cover')).toBe(true)
    const line = sentence()
    const preview = previewPart()
    if (!line || !preview) throw new Error('No sentence or preview')
    for (const text of [line, preview]) {
      expect(text.contains(thumbnail)).toBe(false)
      expect(isFollowing(text, thumbnail)).toBe(true)
    }
  })

  it('gives a thumbnail without alt text an empty alt attribute', () => {
    mountRow(commentUpvoteRow({ thumbnail: pawsThumbnailUrl }))

    const thumbnail = thumbnailPart()
    expect(thumbnail).not.toBeNull()
    expect(thumbnail?.hasAttribute('alt')).toBe(true)
    expect(thumbnail?.getAttribute('alt')).toBe('')
  })

  it('shows the preview without an image when the subject has no thumbnail', () => {
    mountRow(commentUpvoteRow())

    expect(previewPart()?.textContent?.trim()).toBe(
      'So fluffy, look at those paws',
    )
    expect(thumbnailPart()).toBeNull()
    expect(target.querySelector('img')).toBeNull()
  })

  it.each(['javascript:alert(1)', 'data:text/html,x.png'])(
    'shows the preview without an image for the unsafe source %s',
    (unsafe) => {
      mountRow(commentUpvoteRow({ thumbnail: unsafe }))

      expect(previewPart()?.textContent?.trim()).toBe(
        'So fluffy, look at those paws',
      )
      expect(thumbnailPart()).toBeNull()
      const sources = Array.from(target.querySelectorAll('img'), (img) =>
        img.getAttribute('src'),
      )
      expect(sources).not.toContain(unsafe)
    },
  )
})

describe('UpvoteRow sensitive concealment', () => {
  it.each<[string, () => UpvoteNotificationRow]>([
    ['the root post', sensitiveRootRow],
    ['the upvoted comment', sensitiveSubjectRow],
  ])(
    'conceals the preview and thumbnail behind the banner when %s is labelled, keeping the heart, avatars, heading, time and tint',
    (_where, row) => {
      settings.nsfwBlur = true
      mountRow(row())

      const buttons = target.querySelectorAll('button')
      expect(buttons).toHaveLength(1)
      expect(buttons[0]?.textContent).toContain('NSFW Content')
      expect(previewPart()).toBeNull()
      expect(thumbnailPart()).toBeNull()
      expect(target.innerHTML).not.toContain('So fluffy, look at those paws')
      expect(target.innerHTML).not.toContain(
        'https://cdn.coves.social/thumb/paws.jpg',
      )
      expect(target.innerHTML).not.toContain('Two white paws on a blanket')
      expect(outsidePostCard('a .animated-heart')).toHaveLength(1)
      expect(avatarStack()).not.toBeNull()
      expect(namesText()).toBe('Alice and 3 others')
      expect(titleText()).toBe('Liked your comment')
      expect(rowTimeText()).toBe('3h ago')
      expect(target.querySelector('[data-unread="true"]')).not.toBeNull()
      expect(onlyLink().getAttribute('aria-label')).toBe(
        'Alice and 3 others liked your comment. 3h ago',
      )
    },
  )

  it('conceals the placeholder of a deleted sensitive subject', () => {
    settings.nsfwBlur = true
    mountRow(commentUpvoteRow({ status: 'deleted', labels: nsfwLabels }))

    expect(target.querySelectorAll('button')).toHaveLength(1)
    expect(previewPart()).toBeNull()
    expect(target.innerHTML).not.toContain('[Deleted by user]')
    expect(onlyLink().getAttribute('aria-label')).toBe(concealedLinkName)
  })

  it.each<[string, () => UpvoteNotificationRow, boolean]>([
    ['a sensitive row with the blur setting off', sensitiveRootRow, false],
    [
      'a row without an NSFW label with the blur setting on',
      plainCommentRow,
      true,
    ],
  ])('shows the body and no banner for %s', (_title, row, nsfwBlur) => {
    settings.nsfwBlur = nsfwBlur
    mountRow(row())

    expect(previewPart()?.textContent?.trim()).toBe(
      'So fluffy, look at those paws',
    )
    expect(thumbnailPart()?.getAttribute('src')).toBe(
      'https://cdn.coves.social/thumb/paws.jpg',
    )
    expect(target.querySelector('button')).toBeNull()
    expect(onlyLink().getAttribute('aria-label')).toBe(fullLinkName)
  })
})

describe('UpvoteRow sensitive banner placement', () => {
  it('places one collapsed Show button right after the row link, outside it, controlling a region inside the link, with nothing interactive inside the link', () => {
    settings.nsfwBlur = true
    mountRow(sensitiveRootRow())

    const buttons = target.querySelectorAll('button')
    expect(buttons).toHaveLength(1)
    const [button] = buttons
    if (!button) throw new Error('The row has no button')
    const link = onlyLink()
    expect(button.closest('a')).toBeNull()
    expect(button.parentElement).toBe(link.parentElement)
    expect(link.nextElementSibling).toBe(button)
    expect(button.getAttribute('aria-label')).toBe('Show sensitive content')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    const region = document.getElementById(
      button.getAttribute('aria-controls') ?? '',
    )
    expect(region).not.toBeNull()
    expect(link.contains(region)).toBe(true)
    expect(region?.classList.contains('hidden')).toBe(true)
    expect(
      link.querySelectorAll(
        'button, a, input, select, textarea, [tabindex], [role="button"]',
      ),
    ).toHaveLength(0)
  })

  it('gives two concealed rows different controlled regions, each inside its own link', async () => {
    settings.nsfwBlur = true
    mountRow(sensitiveRootRow())
    const otherTarget = document.createElement('div')
    document.body.appendChild(otherTarget)
    const other = client.mount(UpvoteRow, {
      target: otherTarget,
      intro: false,
      props: { row: sensitiveRootRow(), revealed: false, onreveal: () => {} },
    })
    client.flushSync()

    try {
      const controls = [target, otherTarget].map((container) => {
        const button = container.querySelector('button')
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

describe('UpvoteRow Show', () => {
  it('asks the list to reveal the row by its identity and stays concealed while not revealed', () => {
    settings.nsfwBlur = true
    const onreveal = vi.fn()
    mountRow(sensitiveRootRow(), false, onreveal)

    showButton()?.click()
    client.flushSync()

    expect(onreveal).toHaveBeenCalledTimes(1)
    expect(onreveal).toHaveBeenCalledWith(
      'upvote|at://did:plc:viewer7f3kq2/social.coves.community.comment/3kcommentcats1',
    )
    expect(showButton()?.getAttribute('aria-expanded')).toBe('false')
    expect(previewPart()).toBeNull()
    expect(thumbnailPart()).toBeNull()
    expect(onlyLink().getAttribute('aria-label')).toBe(
      'Alice and 3 others liked your comment. 3h ago',
    )
  })
})

describe('UpvoteRow revealed by the list', () => {
  let UpvoteRevealHost: typeof import('./UpvoteRevealHost.test.svelte').default

  beforeAll(async () => {
    UpvoteRevealHost = (await import('./UpvoteRevealHost.test.svelte')).default
  }, 30_000)

  it('renders the preview and thumbnail inside the controlled region of a revealed sensitive row, with the full link name', () => {
    settings.nsfwBlur = true
    mountRow(sensitiveSubjectRow(), true)

    const button = showButton()
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-expanded')).toBe('true')
    const region = document.getElementById(
      button?.getAttribute('aria-controls') ?? '',
    )
    expect(region).not.toBeNull()
    const preview = previewPart()
    const thumbnail = thumbnailPart()
    expect(preview?.textContent?.trim()).toBe('So fluffy, look at those paws')
    expect(thumbnail?.getAttribute('src')).toBe(
      'https://cdn.coves.social/thumb/paws.jpg',
    )
    expect(region?.contains(preview)).toBe(true)
    expect(region?.contains(thumbnail)).toBe(true)
    expect(region?.classList.contains('hidden')).toBe(false)
    const link = onlyLink()
    expect(region).not.toBe(link)
    expect(link.contains(region)).toBe(true)
    expect(region?.contains(sentence())).toBe(false)
    expect(link.getAttribute('aria-label')).toBe(
      'Alice and 3 others liked your comment: So fluffy, look at those paws. 3h ago',
    )
  })

  it('renders the body inside the controlled region on the same row once the list reveals it', () => {
    settings.nsfwBlur = true
    const record = vi.fn()
    mounted = client.mount(UpvoteRevealHost, {
      target,
      intro: false,
      props: { row: sensitiveRootRow(), record },
    })
    client.flushSync()
    const link = target.querySelector('a')
    const button = showButton()
    const controls = button?.getAttribute('aria-controls')
    expect(button).not.toBeNull()

    button?.click()
    client.flushSync()

    expect(record).toHaveBeenCalledWith(
      'upvote|at://did:plc:viewer7f3kq2/social.coves.community.comment/3kcommentcats1',
    )
    const preview = previewPart()
    const thumbnail = thumbnailPart()
    expect(preview?.textContent?.trim()).toBe('So fluffy, look at those paws')
    expect(thumbnail?.getAttribute('src')).toBe(
      'https://cdn.coves.social/thumb/paws.jpg',
    )
    expect(target.querySelector('a')).toBe(link)
    expect(showButton()).toBe(button)
    expect(button?.getAttribute('aria-controls')).toBe(controls)
    const region = document.getElementById(controls ?? '')
    expect(region).not.toBeNull()
    expect(region?.contains(preview)).toBe(true)
    expect(region?.contains(thumbnail)).toBe(true)
    expect(region?.classList.contains('hidden')).toBe(false)
    expect(region).not.toBe(link)
    expect(link?.contains(region)).toBe(true)
    expect(region?.contains(sentence())).toBe(false)
    expect(button?.getAttribute('aria-expanded')).toBe('true')
    expect(link?.getAttribute('aria-label')).toBe(fullLinkName)
  })
})

// ---------------------------------------------------------------------------
// notif-design: post card, quote box and the row time
// ---------------------------------------------------------------------------

/** The root post was created 5 days before now: not the group's sort time. */
const fiveDaysAgo = '2026-10-07T12:00:00.000Z'

/** The upvoted post itself, with an author, a creation time and stats. */
const cardRoot: UpvoteNotificationRow['rootPost'] = {
  uri: postUri,
  cid: 'bafyreibrootcats1' as CID,
  title: 'Look at this cat',
  community: cats,
  author: {
    did: 'did:plc:rootauthor9q2w' as DID,
    handle: 'root-author.coves.social' as Handle,
  },
  createdAt: fiveDaysAgo,
  stats: { upvotes: 14, downvotes: 2, score: 12, commentCount: 4 },
}

/** An upvote on the viewer's post whose root carries card data. */
function postCardRow(
  overrides: UpvoteRowOverrides = {},
): UpvoteNotificationRow {
  return upvoteRow({ rootPost: cardRoot, ...overrides })
}

function postCard(): Element | null {
  return target.querySelector('a [data-part="post-card"]')
}

function previewQuote(): Element | null {
  return target.querySelector('a [data-part="preview-quote"]')
}

function rowTime(): Element | null {
  return target.querySelector('a [data-part="row-time"]')
}

describe('UpvoteRow root post card', () => {
  it('renders the root post card below the sentence for an upvote on the post itself', () => {
    mountRow(postCardRow())

    const card = postCard()
    expect(card).not.toBeNull()
    if (!card) throw new Error('The row has no post card')
    const line = sentence()
    if (!line) throw new Error('The row has no sentence')
    expect(line.contains(card)).toBe(false)
    expect(isFollowing(line, card)).toBe(true)
    expect(
      card.querySelector('[data-part="post-meta"]')?.textContent,
    ).toContain('@root-author.coves.social')
    expect(
      card.querySelector('[data-part="post-title"]')?.textContent?.trim(),
    ).toBe('Look at this cat')
    expect(
      card.querySelector('[data-part="post-score"]')?.textContent?.trim(),
    ).toBe('12')
    expect(card.querySelectorAll('a, button')).toHaveLength(0)
    expect(previewQuote()).toBeNull()
  })

  it('swaps a thumbnail that fails to load for the text tile', () => {
    mountRow(
      postCardRow({
        rootPost: { ...cardRoot, thumbnail: 'https://example.com/cat.jpg' },
      }),
    )
    const image = postCard()?.querySelector('[data-part="post-media"] img')
    if (!image) throw new Error('The post card has no thumbnail image')

    image.dispatchEvent(new Event('error'))
    client.flushSync()

    const media = postCard()?.querySelector('[data-part="post-media"]')
    expect(media?.querySelector('img')).toBeNull()
    expect(media?.querySelector('[data-part="post-media-text"]')).not.toBeNull()
  })

  it('renders no post card for an upvote on a comment', () => {
    mountRow(commentUpvoteRow({}, { rootPost: cardRoot }))

    expect(previewQuote()).not.toBeNull()
    expect(target.querySelector('[data-part="post-card"]')).toBeNull()
  })
})

describe('UpvoteRow comment quote box', () => {
  it('renders the comment preview inside a bordered quote box below the sentence', () => {
    mountRow(commentUpvoteRow())

    const quote = previewQuote()
    expect(quote).not.toBeNull()
    if (!quote) throw new Error('The row has no quote box')
    expect(quote.textContent?.trim()).toBe('So fluffy, look at those paws')
    expect(quote.classList.contains('border')).toBe(true)
    const line = sentence()
    if (!line) throw new Error('The row has no sentence')
    expect(line.contains(quote)).toBe(false)
    expect(isFollowing(line, quote)).toBe(true)
  })

  it('renders the placeholder of a removed comment without a preview inside the quote box', () => {
    mountRow(
      commentUpvoteRow({ status: 'removedByModerator', preview: undefined }),
    )

    expect(previewQuote()?.textContent?.trim()).toBe(
      '[Removed by community moderator]',
    )
  })
})

describe('UpvoteRow row time placement', () => {
  it.each<[string, () => UpvoteNotificationRow]>([
    ['an upvote on a post', () => postCardRow()],
    ['an upvote on a comment with a preview', () => commentUpvoteRow()],
    [
      'an upvote on a comment with no preview but a usable thumbnail',
      () =>
        commentUpvoteRow({ preview: undefined, thumbnail: pawsThumbnailUrl }),
    ],
    [
      'an upvote on a removed comment with no preview',
      () =>
        commentUpvoteRow({ status: 'removedByModerator', preview: undefined }),
    ],
  ])(
    'shows the time as a separate element outside the sentence for %s',
    (_title, row) => {
      mountRow(row())

      const time = rowTime()
      expect(time?.tagName).toBe('TIME')
      expect(time?.textContent?.trim()).toBe('3h ago')
      expect(time?.getAttribute('datetime')).toBe('2026-10-12T09:00:00.000Z')
      const line = sentence()
      if (!line || !time) throw new Error('No sentence or row time')
      expect(line.contains(time)).toBe(false)
      expect(inPostCard(time)).toBe(false)
      expect(line.querySelector('time')).toBeNull()
      expect(line.textContent).not.toContain(' · ')
      expect(onlyLink().getAttribute('aria-label')).toMatch(/\. 3h ago$/)
    },
  )

  it('keeps the row time apart from the root post card time', () => {
    mountRow(postCardRow())

    expect(rowTime()?.textContent?.trim()).toBe('3h ago')
    const cardTime = postCard()?.querySelector('time')
    expect(cardTime?.textContent?.trim()).toBe('5d ago')
    expect(cardTime?.getAttribute('datetime')).toBe('2026-10-07T12:00:00.000Z')
  })

  it.each<[string, () => UpvoteNotificationRow, boolean, string]>([
    [
      'an upvote on a comment with neither a preview nor a thumbnail',
      () => commentUpvoteRow({ preview: undefined }),
      false,
      'Liked your comment',
    ],
    [
      'an upvote on a comment with no preview and an unsafe thumbnail',
      () =>
        commentUpvoteRow({
          preview: undefined,
          thumbnail: 'javascript:alert(1)',
        }),
      false,
      'Liked your comment',
    ],
    [
      'a concealed upvote on a sensitive comment',
      sensitiveSubjectRow,
      true,
      'Liked your comment',
    ],
    [
      'a concealed upvote on a sensitive post',
      () => postCardRow({ rootPost: { ...cardRoot, labels: nsfwLabels } }),
      true,
      'Liked your post',
    ],
  ])(
    'keeps the row time at the top right with no body for %s',
    (_title, row, nsfwBlur, expected) => {
      settings.nsfwBlur = nsfwBlur
      mountRow(row())

      expect(namesText()).toBe('Alice and 3 others')
      expect(titleText()).toBe(expected)
      expect(rowTimeText()).toBe('3h ago')
      expect(sentence()?.querySelector('time')).toBeNull()
      expect(target.querySelector('[data-part="post-card"]')).toBeNull()
      expect(previewQuote()).toBeNull()
    },
  )
})
