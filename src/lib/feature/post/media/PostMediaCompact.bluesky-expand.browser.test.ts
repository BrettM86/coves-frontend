// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { AtUri, CID, PostEmbed } from '$lib/api/coves/types'

const { showImage } = vi.hoisted(() => ({ showImage: vi.fn() }))
type PageState = { openModals?: string[] }
const navigation = vi.hoisted(() => ({
  read: (): PageState => ({}),
  write: (_state: PageState) => {},
}))

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$lib/ui/generic/ExpandableImage.svelte', () => ({ showImage }))
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

const IMAGE_THUMB =
  'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/compact@jpeg'
const IMAGE_FULL =
  'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:alice/compact@jpeg'
const AVATAR = 'https://cdn.bsky.app/img/avatar/plain/did:plc:alice/avatar@jpeg'
const PREVIEW_THUMB =
  'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/preview@jpeg'
const FULL_TEXT = `${'Long selectable Bluesky text. '.repeat(20)}POPUP_TEXT_END`

const embed: PostEmbed = {
  $type: 'social.coves.embed.post#view',
  post: {
    uri: 'at://did:plc:alice/app.bsky.feed.post/root' as AtUri,
    cid: 'bafyreiroot' as CID,
  },
  resolved: {
    uri: 'at://did:plc:alice/app.bsky.feed.post/root',
    cid: 'bafyreiroot',
    author: {
      did: 'did:plc:alice',
      handle: 'sky.example',
      displayName: 'Sky Pilot',
      avatar: AVATAR,
    },
    text: FULL_TEXT,
    createdAt: '2026-09-18T14:30:00Z',
    replyCount: 1,
    repostCount: 2,
    likeCount: 3,
    mediaCount: 1,
    hasMedia: true,
    unavailable: false,
    images: [
      {
        thumb: IMAGE_THUMB,
        fullsize: IMAGE_FULL,
        alt: 'Compact Bluesky image',
      },
    ],
    embed: {
      uri: 'https://news.example/story',
      title: 'Full preview story',
      description: 'Full preview description',
      thumb: PREVIEW_THUMB,
    },
    quotedPost: {
      uri: 'at://did:plc:bob/app.bsky.feed.post/quote',
      cid: 'bafyreiquote',
      author: { did: 'did:plc:bob', handle: 'quote.example' },
      text: 'Full quoted post text',
      createdAt: '2026-09-18T13:00:00Z',
      replyCount: 4,
      repostCount: 5,
      likeCount: 6,
      hasMedia: false,
      mediaCount: 0,
      unavailable: false,
    },
  },
}

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')
let SvelteMap: (typeof import('svelte/reactivity'))['SvelteMap']
let settings: (typeof import('$lib/app/state/settings.svelte'))['settings']
let mediaType: (typeof import('../helpers'))['mediaType']
let PostMediaCompact: (typeof import('./PostMediaCompact.svelte'))['default']

beforeAll(async () => {
  client = await import('svelte')
  SvelteMap = (await import('svelte/reactivity')).SvelteMap
  settings = (await import('$lib/app/state/settings.svelte')).settings
  mediaType = (await import('../helpers')).mediaType
  PostMediaCompact = (await import('./PostMediaCompact.svelte')).default
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
  showImage.mockClear()
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  settings.expandImages = true
  settings.openLinksInNewTab = false
  vi.restoreAllMocks()
  target?.remove()
})

const mountTile = (media: PostEmbed = embed, initialBlur = false) => {
  const values = new SvelteMap([['blur', initialBlur]])
  const props = {
    embed: media,
    type: mediaType(media),
    view: 'compact' as const,
    get blur() {
      return values.get('blur') ?? false
    },
    set blur(value: boolean) {
      values.set('blur', value)
    },
  }
  mounted = client.mount(PostMediaCompact, {
    target,
    props,
    intro: false,
  })
  client.flushSync()
  return props
}

const openButton = (): HTMLButtonElement => {
  const button = target.querySelector<HTMLButtonElement>(
    'button[aria-label="Open Bluesky post"]',
  )
  expect(button).not.toBeNull()
  if (!button) throw new Error('Missing Open Bluesky post button')
  return button
}

const settle = async (): Promise<void> => {
  await client.tick()
  client.flushSync()
}

it.each([false, true])(
  'lazily opens the full cozy card instead of the image viewer with expandImages=%s',
  async (expandImages) => {
    settings.expandImages = expandImages
    settings.openLinksInNewTab = true
    mountTile()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[aria-label="Bluesky post"]')).toBeNull()
    expect(document.querySelectorAll('img')).toHaveLength(0)
    expect(document.body.textContent).not.toContain('Sky Pilot')
    expect(document.body.textContent).not.toContain('POPUP_TEXT_END')
    expect(navigation.read().openModals ?? []).toHaveLength(0)

    const button = openButton()
    expect(button.getAttribute('aria-haspopup')).toBe('dialog')
    expect(button.tabIndex).toBe(0)
    button.click()
    await settle()

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-label')).toBe('Bluesky post preview')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(
      dialog?.querySelector('button[aria-label="Close Bluesky post"]'),
    ).not.toBeNull()
    const card = dialog?.querySelector('[aria-label="Bluesky post"]')
    expect(card).not.toBeNull()
    expect(
      document.querySelectorAll('[aria-label="Bluesky post"]'),
    ).toHaveLength(1)
    expect(card?.textContent).toContain('Sky Pilot')
    expect(card?.textContent).toContain('@sky.example')
    expect(card?.textContent).toContain(FULL_TEXT)
    expect(card?.textContent).toContain('Full quoted post text')
    expect(card?.textContent).toContain('Full preview story')
    expect(card?.textContent).toContain('Full preview description')
    for (const source of [AVATAR, IMAGE_THUMB, PREVIEW_THUMB]) {
      expect(card?.querySelector(`img[src="${source}"]`)).not.toBeNull()
    }
    expect(
      card?.querySelector('time[datetime="2026-09-18T14:30:00Z"]'),
    ).not.toBeNull()
    for (const label of ['Replies: 1', 'Reposts: 2', 'Likes: 3']) {
      expect(card?.querySelector(`[aria-label="${label}"]`)).not.toBeNull()
    }
    for (const href of [
      'https://bsky.app/profile/sky.example',
      'https://bsky.app/profile/sky.example/post/root',
      'https://news.example/story',
      IMAGE_FULL,
    ]) {
      const link = card?.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)
      expect(link).not.toBeNull()
      expect(link?.target).toBe('_blank')
      expect(link?.rel.split(/\s+/)).toEqual(
        expect.arrayContaining(['noopener', 'noreferrer', 'nofollow']),
      )
    }
    expect(navigation.read().openModals).toHaveLength(1)
    expect(showImage).not.toHaveBeenCalled()
  },
)

it.each(['Escape', 'backdrop', 'close button'] as const)(
  'removes the popup with the kit modal %s and can reopen it',
  async (dismissal) => {
    mountTile()
    openButton().click()
    await settle()
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog).not.toBeNull()
    if (!dialog) throw new Error('Missing Bluesky dialog')

    // Clicking card content must not be mistaken for a backdrop click.
    dialog.querySelector<HTMLElement>('article p')?.click()
    await settle()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    if (dismissal === 'Escape') {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      )
    } else if (dismissal === 'backdrop') {
      dialog.click()
    } else {
      const close = dialog.querySelector<HTMLButtonElement>(
        'button[aria-label="Close Bluesky post"]',
      )
      expect(close).not.toBeNull()
      close?.click()
    }
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[aria-label="Bluesky post"]')).toBeNull()
    expect(document.querySelectorAll('img')).toHaveLength(0)
    expect(navigation.read().openModals ?? []).toHaveLength(0)

    openButton().click()
    await settle()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      FULL_TEXT,
    )
    expect(showImage).not.toHaveBeenCalled()
  },
)

it.each([
  ['text', {}, 'POPUP_TEXT_END'],
  [
    'external',
    { embed: { uri: 'https://news.example/story', title: 'External story' } },
    'External story',
  ],
  ['video', { hasMedia: true, mediaCount: 1 }, 'Media: 1'],
  [
    'unavailable',
    { unavailable: true, message: 'This Bluesky post is unavailable.' },
    'This Bluesky post is unavailable.',
  ],
] as const)(
  'opens the %s post from the same tile',
  async (_shape, overrides, content) => {
    settings.expandImages = false
    mountTile({
      ...embed,
      resolved: {
        ...(embed.resolved as Record<string, unknown>),
        images: [],
        embed: undefined,
        quotedPost: undefined,
        hasMedia: false,
        mediaCount: 0,
        ...overrides,
      },
    })
    expect(document.querySelector('[aria-label="Bluesky post"]')).toBeNull()
    expect(document.querySelectorAll('img')).toHaveLength(0)
    openButton().click()
    await settle()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(
      dialog?.querySelector('[aria-label="Bluesky post"]')?.textContent,
    ).toContain(content)
    expect(dialog?.querySelector('a[href*="/post/root"]')).not.toBeNull()
    expect(showImage).not.toHaveBeenCalled()
  },
)

it('preserves native compact image expansion through the image viewer', () => {
  settings.expandImages = true
  const fullsize = 'https://media.example/native.jpg'
  mountTile({
    $type: 'social.coves.embed.images#view',
    images: [
      {
        image: fullsize,
        thumb: 'https://media.example/native-thumb.jpg',
        fullsize,
        alt: 'Native image control',
      },
    ],
  })
  const button = target.querySelector('img')?.closest('button')
  expect(button).not.toBeNull()
  button?.click()
  expect(showImage).toHaveBeenCalledExactlyOnceWith(fullsize)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('closes and resets an open preview on blur, requiring an explicit click after reveal', async () => {
  const props = mountTile()
  expect(openButton().getAttribute('aria-expanded')).toBe('false')
  openButton().click()
  await settle()
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(openButton().getAttribute('aria-expanded')).toBe('true')

  props.blur = true
  await settle()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect.soft(openButton().getAttribute('aria-expanded')).toBe('false')
  expect(openButton().disabled).toBe(true)
  openButton().click()
  await settle()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(navigation.read().openModals ?? []).toHaveLength(0)

  props.blur = false
  await settle()
  expect(openButton().disabled).toBe(false)
  expect.soft(openButton().getAttribute('aria-expanded')).toBe('false')
  expect.soft(document.querySelector('[role="dialog"]')).toBeNull()
  expect.soft(document.querySelector('[aria-label="Bluesky post"]')).toBeNull()

  openButton().click()
  await settle()
  expect(openButton().getAttribute('aria-expanded')).toBe('true')
  expect(
    document.querySelector('[role="dialog"]')?.getAttribute('aria-label'),
  ).toBe('Bluesky post preview')
})

it.each([
  {
    label: 'native image',
    media: {
      $type: 'social.coves.embed.images#view',
      images: [
        {
          image: 'https://media.example/native.jpg',
          thumb: 'https://media.example/native-thumb.jpg',
          fullsize: 'https://media.example/native.jpg',
          alt: 'Native image',
        },
      ],
    } satisfies PostEmbed,
  },
  {
    label: 'external thumbnail',
    media: {
      $type: 'social.coves.embed.external#view',
      external: {
        uri: 'https://news.example/story',
        title: 'Story',
        description: 'Preview',
        thumb: 'https://media.example/external-thumb.jpg',
      },
    } satisfies PostEmbed,
  },
])(
  'reveals the $label after an image error while blurred',
  async ({ media }) => {
    const props = mountTile(media, true)
    const image = target.querySelector('img')
    expect(image).not.toBeNull()
    expect(image?.getAttribute('src')).toBe('')
    image?.dispatchEvent(new Event('error'))
    await settle()

    props.blur = false
    await settle()
    const revealed = target.querySelector('img')
    expect(revealed).not.toBeNull()
    expect(revealed?.getAttribute('src')).toBe(
      media.$type === 'social.coves.embed.images#view'
        ? 'https://media.example/native-thumb.jpg'
        : 'https://media.example/external-thumb.jpg',
    )
    expect(revealed?.classList.contains('blur-xl')).toBe(false)
  },
)
