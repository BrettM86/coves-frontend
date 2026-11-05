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
  EmbedImage,
  PostEmbed,
  PostView,
} from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import { touchDriver, useTouchEnvironment } from './media/touch-test-helpers'

type PageState = Record<string, unknown>
const navigation = vi.hoisted(() => ({
  read: (): PageState => ({}),
  push: (_state: PageState) => {},
  replace: (_state: PageState) => {},
  back: () => {},
}))

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/state', () => ({
  page: {
    get state() {
      return navigation.read()
    },
  },
}))
vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  invalidateAll: vi.fn(),
  pushState: (_url: string, state: PageState) => navigation.push(state),
  replaceState: (_url: string, state: PageState) => navigation.replace(state),
}))
vi.mock('svelte/transition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte/transition')>()),
  fade: () => ({ duration: 0 }),
  scale: () => ({ duration: 0 }),
  fly: () => ({ duration: 0 }),
  slide: () => ({ duration: 0 }),
}))

// Vitest resolves `svelte` with server conditions; the components were
// compiled for the DOM, so point both halves at the client runtime.
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

const BIRDS = ['Kite', 'Heron', 'Wren', 'Owl', 'Finch', 'Robin']

function photo(n: number): EmbedImage {
  return {
    thumb: `https://img.coves.test/img/content_preview/plain/did:plc:a/bafy${n}`,
    fullsize: `https://img.coves.test/img/content_full/plain/did:plc:a/bafy${n}`,
    alt: `${BIRDS[n - 1]} photo`,
  }
}

const sixImages: PostEmbed = {
  $type: 'social.coves.embed.images#view',
  images: [photo(1), photo(2), photo(3), photo(4), photo(5), photo(6)],
}

const post = {
  uri: 'at://did:plc:author/social.coves.community.post/birds' as AtUri,
  rkey: 'birds',
  cid: 'bafyreiexample' as CID,
  indexedAt: '2026-09-01T00:00:00Z',
  author: {
    did: 'did:plc:author' as DID,
    handle: 'author.example' as Handle,
  },
  community: { did: 'did:plc:community' as DID, name: 'Community' },
  createdAt: '2026-09-01T00:00:00Z',
  record: {
    $type: 'social.coves.community.post',
    title: 'Six birds',
    content: 'Spotted at the estuary',
    facets: [],
    author: 'did:plc:author',
    community: 'did:plc:community',
    createdAt: '2026-09-01T00:00:00Z',
  },
  embed: sixImages,
} as PostView

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')
let settings: (typeof import('$lib/app/state/settings.svelte'))['settings']
let SvelteMap: (typeof import('svelte/reactivity'))['SvelteMap']
let Harness: (typeof import('./PostLightbox.test.svelte'))['default']

// Cold-loading Post.svelte and its tree takes seconds under full-suite load;
// load it once, outside any per-test timeout.
beforeAll(async () => {
  client = await import('svelte')
  settings = (await import('$lib/app/state/settings.svelte')).settings
  SvelteMap = (await import('svelte/reactivity')).SvelteMap
  Harness = (await import('./PostLightbox.test.svelte')).default
}, 60_000)

beforeEach(() => {
  settings.nsfwBlur = false
  settings.expandImages = true
  const current = new SvelteMap<string, PageState>([['state', {}]])
  const history: PageState[] = [{}]
  let index = 0
  navigation.read = () => current.get('state') ?? {}
  navigation.push = (state) => {
    history.splice(index + 1)
    history.push(state)
    index++
    current.set('state', state)
  }
  navigation.replace = (state) => {
    history[index] = state
    current.set('state', state)
  }
  navigation.back = () => {
    if (index > 0) index--
    current.set('state', history[index] ?? {})
  }
  vi.spyOn(window.history, 'back').mockImplementation(() => navigation.back())
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target?.remove()
  vi.restoreAllMocks()
})

async function settle(): Promise<void> {
  await client.tick()
  client.flushSync()
}

function host(name: 'post' | 'lightbox'): HTMLElement {
  const found = target.querySelector<HTMLElement>(`[data-testid="${name}"]`)
  if (!found) throw new Error(`Harness has no ${name}`)
  return found
}

/** The open button of each gallery tile now shown, named by its alt. */
function tileButtons(): HTMLElement[] {
  return [
    ...host('post').querySelectorAll<HTMLElement>(
      '[data-gallery-tile] [aria-label$=" photo"]',
    ),
  ].filter((button) => button.closest('[inert]') == null)
}

function shownTiles(): string[] {
  return tileButtons().map((button) => button.getAttribute('aria-label') ?? '')
}

function lightboxImage(): HTMLImageElement | null {
  return (
    [...host('lightbox').querySelectorAll('img')].find(
      (img) => (img.getAttribute('src') ?? '') !== '',
    ) ?? null
  )
}

describe('Post gallery touch gestures', () => {
  useTouchEnvironment()
  const { pointer, swipe } = touchDriver(() => client.flushSync())

  it('swipes to page 2, opens image 5 with a tap, and swipes the lightbox closed', async () => {
    mounted = client.mount(Harness, {
      target,
      props: { post, expandBody: true, view: 'cozy' },
      intro: false,
    })
    client.flushSync()
    expect(shownTiles()).toEqual([
      'Kite photo',
      'Heron photo',
      'Wren photo',
      'Owl photo',
    ])

    const first = tileButtons()[0]
    swipe(first, { from: [200, 100], to: [100, 100] })
    first.click()
    await settle()
    expect(shownTiles()).toEqual(['Finch photo', 'Robin photo'])
    expect(lightboxImage()).toBeNull()

    const finch = tileButtons()[0]
    pointer(finch, 'pointerdown', { at: [100, 100] })
    vi.advanceTimersByTime(80)
    pointer(finch, 'pointerup', { at: [100, 100] })
    finch.click()
    await settle()
    expect(lightboxImage()?.getAttribute('src')).toBe(
      'https://img.coves.test/img/content_full/plain/did:plc:a/bafy5',
    )
    expect(lightboxImage()?.getAttribute('alt')).toBe('Finch photo')

    const image = lightboxImage()
    if (!image) throw new Error('The lightbox shows no image')
    swipe(image, { from: [200, 200], to: [200, 350] })
    await settle()
    expect(lightboxImage()).toBeNull()
  })
})
