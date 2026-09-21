// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { AtUri, CID, PostView } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'

type PageState = { openModals?: string[] }
const navigation = vi.hoisted(() => ({
  read: (): PageState => ({}),
  write: (_state: PageState) => {},
}))
vi.mock('$app/state', () => ({
  page: {
    get state() {
      return navigation.read()
    },
  },
}))
vi.mock('$app/navigation', () => ({
  pushState: (_url: string, state: PageState) => navigation.write(state),
  replaceState: (_url: string, state: PageState) => navigation.write(state),
}))
vi.mock('svelte/transition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte/transition')>()),
  fade: () => ({ duration: 0 }),
  scale: () => ({ duration: 0 }),
}))
vi.mock('trap-focus-svelte', () => ({
  trapFocus: () => ({ destroy: () => {} }),
}))

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

const AVATAR =
  'https://cdn.bsky.app/img/avatar/plain/did:plc:alice/sensitive-avatar@jpeg'
const POST_THUMB =
  'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/sensitive-post@jpeg'
const POST_FULL =
  'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:alice/sensitive-post@jpeg'
const PREVIEW_THUMB =
  'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/sensitive-preview@jpeg'
const ALL_CARD_IMAGES = [AVATAR, POST_THUMB, PREVIEW_THUMB]

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')
let settings: (typeof import('$lib/app/state/settings.svelte'))['settings']
let Post: (typeof import('./Post.svelte'))['default']

beforeAll(async () => {
  client = await import('svelte')
  settings = (await import('$lib/app/state/settings.svelte')).settings
  Post = (await import('./Post.svelte')).default
}, 60_000)

beforeEach(async () => {
  const { SvelteMap } = await import('svelte/reactivity')
  const state = new SvelteMap<string, PageState>([['page', {}]])
  navigation.read = () => state.get('page') ?? {}
  navigation.write = (value) => {
    state.set('page', value)
  }
  vi.spyOn(window.history, 'back').mockImplementation(() =>
    navigation.write({}),
  )
  settings.nsfwBlur = true
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  vi.restoreAllMocks()
  target?.remove()
})

const fixture = (): PostView =>
  ({
    uri: 'at://did:plc:author/social.coves.community.post/sensitive' as AtUri,
    rkey: 'sensitive',
    cid: 'bafyreicoves' as CID,
    indexedAt: '2026-09-18T15:00:00Z',
    createdAt: '2026-09-18T15:00:00Z',
    author: {
      did: 'did:plc:author' as DID,
      handle: 'author.example' as Handle,
    },
    community: { did: 'did:plc:community' as DID, name: 'Community' },
    record: {
      $type: 'social.coves.community.post',
      title: 'Sensitive Coves wrapper',
      author: 'did:plc:author',
      community: 'did:plc:community',
      createdAt: '2026-09-18T15:00:00Z',
      labels: { values: [{ val: 'nsfw' }] },
    },
    embed: {
      $type: 'social.coves.embed.post#view',
      post: {
        uri: 'at://did:plc:alice/app.bsky.feed.post/root' as AtUri,
        cid: 'bafyreibluesky' as CID,
      },
      resolved: {
        uri: 'at://did:plc:alice/app.bsky.feed.post/root',
        cid: 'bafyreibluesky',
        author: {
          did: 'did:plc:alice',
          handle: 'sky.example',
          displayName: 'Sensitive Sky Pilot',
          avatar: AVATAR,
        },
        text: 'Sensitive Bluesky card text.',
        createdAt: '2026-09-18T14:30:00Z',
        replyCount: 1,
        repostCount: 2,
        likeCount: 3,
        mediaCount: 1,
        hasMedia: true,
        unavailable: false,
        images: [
          {
            thumb: POST_THUMB,
            fullsize: POST_FULL,
            alt: 'Sensitive Bluesky image',
          },
        ],
        embed: {
          uri: 'https://news.example/story',
          title: 'Sensitive preview story',
          description: 'Sensitive preview description',
          thumb: PREVIEW_THUMB,
        },
      },
    },
  }) as PostView

const mountPost = (view: 'cozy' | 'compact'): void => {
  mounted = client.mount(Post, {
    target,
    props: { post: fixture(), view, actions: false },
    intro: false,
  })
  client.flushSync()
}

const toggle = (name: string): HTMLButtonElement => {
  const button = target.querySelector<HTMLButtonElement>(
    `button[aria-label="${name}"]`,
  )
  expect(button).not.toBeNull()
  if (!button) throw new Error(`Missing ${name} button`)
  return button
}

it.each(['cozy', 'compact'] as const)(
  'mounts no Bluesky images while concealed, then reveals and removes the %s rendering',
  async (view) => {
    mountPost(view)

    expect(target.querySelectorAll('img')).toHaveLength(0)
    for (const source of ALL_CARD_IMAGES) {
      expect(target.innerHTML).not.toContain(source)
    }
    expect(target.textContent).not.toContain('Sensitive Sky Pilot')
    expect(target.textContent).not.toContain('Sensitive Bluesky card text.')
    expect(
      target.querySelector('button[aria-label="Open Bluesky post"]'),
    ).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    toggle('Show sensitive content').click()
    client.flushSync()

    if (view === 'cozy') {
      expect(target.textContent).toContain('Sensitive Sky Pilot')
      expect(target.textContent).toContain('Sensitive Bluesky card text.')
      expect(target.querySelector(`img[src="${POST_THUMB}"]`)).not.toBeNull()
      expect(target.querySelector(`img[src="${AVATAR}"]`)).not.toBeNull()
      expect(target.querySelector(`img[src="${PREVIEW_THUMB}"]`)).not.toBeNull()
    } else {
      expect(document.querySelectorAll('img')).toHaveLength(0)
      expect(document.querySelector('[aria-label="Bluesky post"]')).toBeNull()
      expect(target.textContent).not.toContain('Sensitive Bluesky card text.')
      const button = toggle('Open Bluesky post')
      expect(button.getAttribute('aria-haspopup')).toBe('dialog')
      button.click()
      await client.tick()
      client.flushSync()
      const dialog = document.querySelector('[role="dialog"]')
      expect(dialog).not.toBeNull()
      expect(dialog?.textContent).toContain('Sensitive Sky Pilot')
      expect(dialog?.textContent).toContain('Sensitive Bluesky card text.')
      for (const source of ALL_CARD_IMAGES) {
        expect(dialog?.querySelector(`img[src="${source}"]`)).not.toBeNull()
      }
      expect(
        dialog?.querySelector(
          'a[href="https://bsky.app/profile/sky.example/post/root"]',
        ),
      ).not.toBeNull()
    }

    toggle('Hide sensitive content').click()
    await client.tick()
    client.flushSync()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[aria-label="Bluesky post"]')).toBeNull()
    expect(
      target.querySelector('button[aria-label="Open Bluesky post"]'),
    ).toBeNull()
    expect(document.querySelectorAll('img')).toHaveLength(0)
    for (const source of ALL_CARD_IMAGES) {
      expect(document.body.innerHTML).not.toContain(source)
    }
    expect(document.body.textContent).not.toContain('Sensitive Sky Pilot')
    expect(document.body.textContent).not.toContain(
      'Sensitive Bluesky card text.',
    )
    expect(navigation.read().openModals ?? []).toHaveLength(0)

    if (view === 'compact') {
      toggle('Show sensitive content').click()
      client.flushSync()
      expect(toggle('Open Bluesky post')).toBeDefined()
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(document.querySelectorAll('img')).toHaveLength(0)
    }
  },
)
