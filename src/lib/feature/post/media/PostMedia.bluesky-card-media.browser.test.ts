// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { AtUri, CID, PostEmbed } from '$lib/api/coves/types'
import {
  mockDefaultTimezone,
  NativeDateTimeFormat,
} from './bluesky-time.fixture'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
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

const IMAGE_ONE =
  'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/one@jpeg'
const IMAGE_ONE_FULL =
  'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:alice/one@jpeg'
const IMAGE_ONE_UPDATED =
  'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/one-updated@jpeg'
const IMAGE_ONE_UPDATED_FULL =
  'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:alice/one-updated@jpeg'
const IMAGE_TWO =
  'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/two@jpeg'
const IMAGE_TWO_FULL =
  'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:alice/two@jpeg'
const AVATAR_ONE =
  'https://cdn.bsky.app/img/avatar/plain/did:plc:alice/avatar-one@jpeg'
const AVATAR_TWO =
  'https://cdn.bsky.app/img/avatar/plain/did:plc:alice/avatar-two@jpeg'
const PREVIEW_ONE =
  'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/preview-one@jpeg'
const PREVIEW_TWO =
  'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/preview-two@jpeg'
const PROFILE_URL = 'https://bsky.app/profile/sky.example'
const ORIGINAL_URL = `${PROFILE_URL}/post/root`
const PREVIEW_URL = 'https://news.example/story'

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')
let SvelteMap: (typeof import('svelte/reactivity'))['SvelteMap']
let PostMedia: (typeof import('./PostMedia.svelte'))['default']

beforeAll(async () => {
  client = await import('svelte')
  SvelteMap = (await import('svelte/reactivity')).SvelteMap
  PostMedia = (await import('./PostMedia.svelte')).default
}, 60_000)

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  vi.useRealTimers()
  target?.remove()
})

const resolvedPost = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  uri: 'at://did:plc:alice/app.bsky.feed.post/root',
  cid: 'bafyreiroot',
  author: {
    did: 'did:plc:alice',
    handle: 'sky.example',
    displayName: 'Sky Pilot',
  },
  text: 'Mounted Bluesky card.',
  createdAt: '2026-09-18T14:30:00Z',
  replyCount: 1,
  repostCount: 2,
  likeCount: 3,
  mediaCount: 0,
  hasMedia: false,
  unavailable: false,
  ...overrides,
})

const postEmbed = (resolved: unknown): PostEmbed => ({
  $type: 'social.coves.embed.post#view',
  post: {
    uri: 'at://did:plc:alice/app.bsky.feed.post/root' as AtUri,
    cid: 'bafyreiroot' as CID,
  },
  resolved,
})

interface MountedProps {
  embed: PostEmbed
  readonly type: 'embed'
  readonly view: 'cozy'
}

const mountCard = (initial: PostEmbed): MountedProps => {
  const values = new SvelteMap<string, PostEmbed>([['embed', initial]])
  const props: MountedProps = {
    get embed(): PostEmbed {
      const current = values.get('embed')
      if (!current) throw new Error('Missing Bluesky embed fixture')
      return current
    },
    set embed(next: PostEmbed) {
      values.set('embed', next)
    },
    type: 'embed',
    view: 'cozy',
  }
  mounted = client.mount(PostMedia, { target, props, intro: false })
  client.flushSync()
  return props
}

const imageBySource = (source: string): HTMLImageElement | null =>
  [...target.querySelectorAll<HTMLImageElement>('img')].find(
    (image) => image.getAttribute('src') === source,
  ) ?? null

const accessibleName = (link: HTMLAnchorElement): string =>
  [
    link.getAttribute('aria-label'),
    link.getAttribute('title'),
    link.textContent?.trim(),
    link.querySelector('[aria-label]')?.getAttribute('aria-label'),
    link.querySelector('img[alt]')?.getAttribute('alt'),
    link.querySelector('title')?.textContent,
  ]
    .filter(Boolean)
    .join(' ')
    .trim()

it('isolates image failures, keeps siblings and the original link, and restores a changed source', () => {
  const props = mountCard(
    postEmbed(
      resolvedPost({
        hasMedia: true,
        mediaCount: 2,
        images: [
          {
            thumb: IMAGE_ONE,
            fullsize: IMAGE_ONE_FULL,
            alt: 'First image',
          },
          {
            thumb: IMAGE_TWO,
            fullsize: IMAGE_TWO_FULL,
            alt: 'Second image',
          },
        ],
      }),
    ),
  )

  const failed = imageBySource(IMAGE_ONE)
  expect(failed).not.toBeNull()
  expect(imageBySource(IMAGE_TWO)).not.toBeNull()
  failed?.dispatchEvent(new Event('error'))
  client.flushSync()

  expect(imageBySource(IMAGE_ONE)).toBeNull()
  expect(imageBySource(IMAGE_TWO)).not.toBeNull()
  expect(target.querySelector(`a[href="${ORIGINAL_URL}"]`)).not.toBeNull()
  expect(target.textContent).not.toContain('Media: 2')

  imageBySource(IMAGE_TWO)?.dispatchEvent(new Event('error'))
  client.flushSync()
  expect(imageBySource(IMAGE_TWO)).toBeNull()
  expect.soft(target.textContent).toContain('Media: 2')

  props.embed = postEmbed(
    resolvedPost({
      hasMedia: true,
      mediaCount: 2,
      images: [
        {
          thumb: IMAGE_ONE_UPDATED,
          fullsize: IMAGE_ONE_UPDATED_FULL,
          alt: 'First image updated',
        },
        {
          thumb: IMAGE_TWO,
          fullsize: IMAGE_TWO_FULL,
          alt: 'Second image',
        },
      ],
    }),
  )
  client.flushSync()

  expect(imageBySource(IMAGE_ONE_UPDATED)).not.toBeNull()
  expect(imageBySource(IMAGE_TWO)).toBeNull()
  expect(target.textContent).not.toContain('Media: 2')
})

it.each(['root', 'quote'] as const)(
  'uses resolved image count for the %s fallback even when media metadata says none',
  (location) => {
    const content = resolvedPost({
      hasMedia: false,
      mediaCount: 0,
      images: [
        { thumb: IMAGE_ONE, fullsize: IMAGE_ONE_FULL, alt: 'Resolved image' },
      ],
    })
    mountCard(
      postEmbed(
        location === 'root' ? content : resolvedPost({ quotedPost: content }),
      ),
    )
    const scope =
      location === 'root'
        ? target
        : target.querySelector('[aria-label="Quoted Bluesky post"]')
    expect(scope).not.toBeNull()
    expect(imageBySource(IMAGE_ONE)).not.toBeNull()
    expect(scope?.textContent).not.toContain('Media: 1')
    imageBySource(IMAGE_ONE)?.dispatchEvent(new Event('error'))
    client.flushSync()
    expect(imageBySource(IMAGE_ONE)).toBeNull()
    expect(scope?.textContent).toContain('Media: 1')
    expect(scope?.querySelector(`a[href="${ORIGINAL_URL}"]`)).not.toBeNull()
  },
)

it('exposes all three engagement counts as named images with decorative icons', () => {
  mountCard(postEmbed(resolvedPost()))

  expect.soft(target.querySelectorAll('span[role="img"]')).toHaveLength(3)
  for (const label of ['Replies: 1', 'Reposts: 2', 'Likes: 3']) {
    const count = target.querySelector(`span[aria-label="${label}"]`)
    expect.soft(count).not.toBeNull()
    expect.soft(count?.getAttribute('role')).toBe('img')
    expect.soft(count?.getAttribute('aria-label')).toBe(label)
    expect.soft(count?.getAttribute('aria-hidden')).not.toBe('true')
    expect
      .soft(count?.querySelector('svg')?.getAttribute('aria-hidden'))
      .toBe('true')
  }
})

it.each(['America/Los_Angeles', 'Asia/Tokyo'])(
  'starts in UTC, switches to local time on mount in %s, updates every minute and cleans up',
  async (timeZone) => {
    mockDefaultTimezone(timeZone)
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    const createdAt =
      timeZone === 'Asia/Tokyo'
        ? '2026-09-20T23:55:00Z'
        : '2026-09-20T00:05:00Z'
    vi.setSystemTime(Date.parse(createdAt) + 60_000)
    const interval = vi.spyOn(globalThis, 'setInterval')
    const clear = vi.spyOn(globalThis, 'clearInterval')
    mounted = client.mount(PostMedia, {
      target,
      props: {
        embed: postEmbed(resolvedPost({ createdAt })),
        type: 'embed',
        view: 'cozy',
      },
      intro: false,
    })
    // Before effects/onMount run, the client must match server markup.
    const time = target.querySelector('time')
    expect(time).not.toBeNull()
    expect.soft(time?.getAttribute('datetime')).toBe(createdAt)
    expect.soft(time?.children).toHaveLength(2)
    const visibleTime = time?.querySelector(
      ':scope > span[aria-hidden="true"]',
    )
    const screenReaderLabel = time?.querySelector(':scope > span.sr-only')
    expect
      .soft(screenReaderLabel?.getAttribute('aria-hidden'))
      .not.toBe('true')
    const initialLabel = new NativeDateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(createdAt))
    expect
      .soft(visibleTime?.textContent?.trim())
      .toBe(
        new NativeDateTimeFormat('en', { timeZone: 'UTC' }).format(
          new Date(createdAt),
        ),
      )
    expect.soft(time?.getAttribute('title')).toBe(initialLabel)
    expect.soft(time?.hasAttribute('aria-label')).toBe(false)
    expect.soft(screenReaderLabel?.textContent?.trim()).toBe(initialLabel)

    client.flushSync()
    const localLabel = new NativeDateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(new Date(createdAt))
    expect(localLabel).not.toBe(initialLabel)
    expect.soft(visibleTime?.textContent?.trim()).toBe('1m')
    expect(time?.getAttribute('title')).toBe(localLabel)
    expect.soft(time?.hasAttribute('aria-label')).toBe(false)
    expect.soft(screenReaderLabel?.textContent?.trim()).toBe(localLabel)
    expect(interval).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function),
      60_000,
    )

    vi.advanceTimersByTime(59_999)
    client.flushSync()
    expect.soft(visibleTime?.textContent?.trim()).toBe('1m')
    vi.advanceTimersByTime(1)
    client.flushSync()
    expect.soft(visibleTime?.textContent?.trim()).toBe('2m')
    vi.advanceTimersByTime(60_000)
    client.flushSync()
    expect.soft(visibleTime?.textContent?.trim()).toBe('3m')
    expect(time?.getAttribute('title')).toBe(localLabel)
    expect.soft(time?.hasAttribute('aria-label')).toBe(false)
    expect.soft(screenReaderLabel?.textContent?.trim()).toBe(localLabel)

    const timer = interval.mock.results[0]?.value
    expect(timer).toBeDefined()
    await client.unmount(mounted, { outro: false })
    mounted = undefined
    expect(clear).toHaveBeenCalledWith(timer)
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(60_000)
    client.flushSync()
    expect(target.querySelector('time')).toBeNull()
  },
)

it('restores an avatar when its source changes on the same mounted card', () => {
  const props = mountCard(
    postEmbed(
      resolvedPost({
        author: {
          did: 'did:plc:alice',
          handle: 'sky.example',
          displayName: 'Sky Pilot',
          avatar: AVATAR_ONE,
        },
      }),
    ),
  )

  const failed = imageBySource(AVATAR_ONE)
  expect(failed).not.toBeNull()
  failed?.dispatchEvent(new Event('error'))
  client.flushSync()
  expect(imageBySource(AVATAR_ONE)).toBeNull()
  expect(target.textContent).toContain('Sky Pilot')
  expect(target.querySelector(`a[href="${PROFILE_URL}"]`)).not.toBeNull()

  props.embed = postEmbed(
    resolvedPost({
      author: {
        did: 'did:plc:alice',
        handle: 'sky.example',
        displayName: 'Sky Pilot',
        avatar: AVATAR_TWO,
      },
    }),
  )
  client.flushSync()
  expect(imageBySource(AVATAR_TWO)).not.toBeNull()
})

it('retains preview content after an image error and restores a changed thumbnail', () => {
  const props = mountCard(
    postEmbed(
      resolvedPost({
        embed: {
          uri: PREVIEW_URL,
          title: 'Accessible preview title',
          description: 'Preview description remains after image failure.',
          thumb: PREVIEW_ONE,
        },
      }),
    ),
  )

  const failed = imageBySource(PREVIEW_ONE)
  expect(failed).not.toBeNull()
  failed?.dispatchEvent(new Event('error'))
  client.flushSync()
  expect(imageBySource(PREVIEW_ONE)).toBeNull()
  expect(target.textContent).toContain('Accessible preview title')
  expect(target.querySelector(`a[href="${PREVIEW_URL}"]`)).not.toBeNull()

  props.embed = postEmbed(
    resolvedPost({
      embed: {
        uri: PREVIEW_URL,
        title: 'Accessible preview title',
        description: 'Preview description remains after image failure.',
        thumb: PREVIEW_TWO,
      },
    }),
  )
  client.flushSync()
  expect(imageBySource(PREVIEW_TWO)).not.toBeNull()
})

it('makes header identity and butterfly profile links accessible without nested anchors', () => {
  mountCard(
    postEmbed(
      resolvedPost({
        author: {
          did: 'did:plc:alice',
          handle: 'sky.example',
          displayName: 'Sky Pilot',
          avatar: AVATAR_ONE,
        },
        hasMedia: true,
        mediaCount: 1,
        images: [
          {
            thumb: IMAGE_ONE,
            fullsize: IMAGE_ONE_FULL,
            alt: 'Accessible post image',
          },
        ],
        quotedPost: resolvedPost({
          uri: 'at://did:plc:bob/app.bsky.feed.post/quote',
          author: {
            did: 'did:plc:bob',
            handle: 'weather.example',
            displayName: 'Weather Watch',
          },
          text: 'Quoted preview.',
          embed: {
            uri: PREVIEW_URL,
            title: 'Accessible preview title',
            description: 'Accessible preview description.',
            thumb: PREVIEW_ONE,
          },
        }),
      }),
    ),
  )

  const profileLinks = [
    ...target.querySelectorAll<HTMLAnchorElement>(`a[href="${PROFILE_URL}"]`),
  ]
  const avatar = imageBySource(AVATAR_ONE)
  expect(avatar?.closest('a')?.getAttribute('href')).toBe(PROFILE_URL)
  expect(
    profileLinks.some((link) => link.textContent?.includes('Sky Pilot')),
  ).toBe(true)
  expect(
    profileLinks.some((link) => link.textContent?.includes('@sky.example')),
  ).toBe(true)
  expect(profileLinks.some((link) => link.querySelector('svg'))).toBe(true)

  const links = [...target.querySelectorAll<HTMLAnchorElement>('a')]
  expect(links.length).toBeGreaterThanOrEqual(5)
  for (const link of links) {
    expect(link.querySelector('a')).toBeNull()
    expect(accessibleName(link)).not.toBe('')
  }
})
