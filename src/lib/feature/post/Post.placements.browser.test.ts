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
import { facetOver } from '$lib/feature/richtext/test-helpers'

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

const placement = (index: number) => ({
  $type: 'social.coves.richtext.facet#image',
  index,
})

const LIGHTHOUSE: EmbedImage = {
  thumb:
    'https://img.coves.test/img/content_preview/plain/did:plc:a/lighthouse',
  fullsize:
    'https://img.coves.test/img/content_full/plain/did:plc:a/lighthouse',
  alt: 'Lighthouse at dusk',
}
const HARBOUR: EmbedImage = {
  thumb: 'https://img.coves.test/img/content_preview/plain/did:plc:a/harbour',
  fullsize: 'https://img.coves.test/img/content_full/plain/did:plc:a/harbour',
  alt: 'Harbour at dawn',
}
const DUNES: EmbedImage = {
  thumb: 'https://img.coves.test/img/content_preview/plain/did:plc:a/dunes',
  fullsize: 'https://img.coves.test/img/content_full/plain/did:plc:a/dunes',
  alt: 'Dunes in fog',
}
const ALTS = ['Lighthouse at dusk', 'Harbour at dawn', 'Dunes in fog']

const threeImages: PostEmbed = {
  $type: 'social.coves.embed.images#view',
  images: [LIGHTHOUSE, HARBOUR, DUNES],
}

const threeImagesWithExternal: PostEmbed = {
  $type: 'social.coves.embed.imagesWithAttachment#view',
  images: {
    $type: 'social.coves.embed.images#view',
    images: [LIGHTHOUSE, HARBOUR, DUNES],
  },
  attachment: {
    $type: 'social.coves.embed.external#viewExternal',
    uri: 'https://news.example.test/harbour-story',
    title: 'Harbour story',
  },
}

/** Every image placed; the covered text of the first placement leads. */
const ALL_PLACED = '[lighthouse]\n\nHello there\n\n[harbour]\n\n[dunes]'
const allPlacedFacets = [
  facetOver(ALL_PLACED, '[lighthouse]', placement(0)),
  facetOver(ALL_PLACED, '[harbour]', placement(1)),
  facetOver(ALL_PLACED, '[dunes]', placement(2)),
]

/** Only image 0 placed, by a leading covered-text line. */
const FIRST_PLACED = '[lighthouse]\n\nHello there'
const firstPlacedFacets = [
  facetOver(FIRST_PLACED, '[lighthouse]', placement(0)),
]

interface Fixture {
  content: string
  facets: unknown[]
  embed?: PostEmbed
  title?: string
  sensitive?: boolean
}

function postWith({
  content,
  facets,
  embed = threeImages,
  title = 'Placed images post',
  sensitive = false,
}: Fixture): PostView {
  return {
    uri: 'at://did:plc:author/social.coves.community.post/placed' as AtUri,
    rkey: 'placed',
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
      ...(title ? { title } : {}),
      content,
      facets,
      author: 'did:plc:author',
      community: 'did:plc:community',
      createdAt: '2026-09-01T00:00:00Z',
      ...(sensitive ? { labels: { values: [{ val: 'nsfw' }] } } : {}),
    },
    embed,
  } as PostView
}

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

function mountPost(
  post: PostView,
  { expandBody, view }: { expandBody: boolean; view: 'cozy' | 'compact' },
): void {
  mounted = client.mount(Harness, {
    target,
    props: { post, expandBody, view },
    intro: false,
  })
  client.flushSync()
}

async function settle(): Promise<void> {
  await client.tick()
  client.flushSync()
}

function host(name: 'post' | 'lightbox'): HTMLElement {
  const found = target.querySelector<HTMLElement>(`[data-testid="${name}"]`)
  if (!found) throw new Error(`Harness has no ${name}`)
  return found
}

/** PostBody renders the post body as a <section>. */
function body(): HTMLElement {
  const found = host('post').querySelector<HTMLElement>('section')
  expect(found, 'post body section').not.toBeNull()
  if (!found) throw new Error('The post rendered no body')
  return found
}

function follows(first: Node, second: Node): boolean {
  return (
    (first.compareDocumentPosition(second) &
      Node.DOCUMENT_POSITION_FOLLOWING) !==
    0
  )
}

/** The post's images (by alt) rendered outside the body, in document order. */
function galleryImages(): HTMLImageElement[] {
  const section = host('post').querySelector('section')
  return [...host('post').querySelectorAll('img')].filter(
    (img) =>
      ALTS.includes(img.getAttribute('alt') ?? '') &&
      !(section && section.contains(img)),
  )
}

function altsOf(images: HTMLImageElement[]): string[] {
  return images.map((img) => img.getAttribute('alt') ?? '')
}

/** Every src/srcset in the post that points at one of the post's images. */
function postImageSources(): string[] {
  return [...host('post').querySelectorAll('[src], [srcset]')]
    .flatMap((element) => [
      element.getAttribute('src') ?? '',
      element.getAttribute('srcset') ?? '',
    ])
    .filter((source) => source.includes('img.coves.test'))
}

/** Media drawn for an image that has no source: the unavailable tile and any
 * open-image control, neither of which carries a `src`. */
function imageMediaWithoutSource(): string[] {
  const post = host('post')
  const unavailable = (post.textContent ?? '').includes('Image unavailable')
    ? ['Image unavailable']
    : []
  const openImageTiles = [...post.querySelectorAll('[aria-label]')]
    .map((element) => element.getAttribute('aria-label') ?? '')
    .filter((label) => /^open image/i.test(label))
  return [...unavailable, ...openImageTiles]
}

/** Gallery tiles: the aspect-ratio boxes outside the body. */
function galleryTiles(): HTMLElement[] {
  const section = host('post').querySelector('section')
  return [
    ...host('post').querySelectorAll<HTMLElement>('[style*="aspect-ratio"]'),
  ].filter((tile) => !(section && section.contains(tile)))
}

async function openFirstGalleryTile(): Promise<void> {
  const [tile] = galleryTiles()
  expect(tile, 'a gallery tile outside the body').toBeDefined()
  if (!tile) throw new Error('The post rendered no gallery tile')
  const button = [...tile.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() !== 'ALT',
  )
  if (!button) throw new Error('Tile has no expand button')
  button.focus()
  button.click()
  await settle()
}

function lightboxImage(): HTMLImageElement {
  const found = [...host('lightbox').querySelectorAll('img')].find(
    (img) => (img.getAttribute('src') ?? '') !== '',
  )
  if (!found) throw new Error('The lightbox shows no image')
  return found
}

async function press(name: RegExp): Promise<void> {
  const button = [...host('lightbox').querySelectorAll('button')].find(
    (candidate) => name.test(candidate.getAttribute('aria-label') ?? ''),
  )
  if (!button) throw new Error(`The lightbox has no ${name} button`)
  button.click()
  await settle()
}

function expectShowing(fullsize: string, alt: string): void {
  const shown = lightboxImage()
  expect(shown.getAttribute('src')).toBe(fullsize)
  expect(shown.getAttribute('alt')).toBe(alt)
}

/** Elements whose own text is only a number: the count badge candidates. */
function numericBadges(): string[] {
  return [...host('post').querySelectorAll('*')]
    .filter(
      (element) =>
        element.children.length === 0 &&
        /^\d+$/.test(element.textContent?.trim() ?? ''),
    )
    .map((element) => element.textContent?.trim() ?? '')
}

describe('post page placements', () => {
  it('keeps the gallery above the body when no placement is accepted', () => {
    const content = '[image]\n\nHello'
    mountPost(
      postWith({
        content,
        facets: [facetOver(content, '[image]', placement(3))],
      }),
      { expandBody: true, view: 'cozy' },
    )

    expect(body().textContent).toContain('[image]')
    expect(body().querySelector('img')).toBeNull()
    const gallery = galleryImages()
    expect(altsOf(gallery)).toEqual([
      'Lighthouse at dusk',
      'Harbour at dawn',
      'Dunes in fog',
    ])
    for (const img of gallery) expect(follows(img, body())).toBe(true)
  })

  it('renders the placed image in the body and the unplaced images in a gallery after it', () => {
    const content = 'Intro\n\n[image]\n\nHello'
    mountPost(
      postWith({
        content,
        facets: [facetOver(content, '[image]', placement(0))],
      }),
      { expandBody: true, view: 'cozy' },
    )

    const inline = [...body().querySelectorAll('img')].map((img) => ({
      alt: img.getAttribute('alt'),
      src: img.getAttribute('src'),
    }))
    expect(inline).toEqual([
      {
        alt: 'Lighthouse at dusk',
        src: 'https://img.coves.test/img/content_full/plain/did:plc:a/lighthouse',
      },
    ])
    const gallery = galleryImages()
    expect(altsOf(gallery)).toEqual(['Harbour at dawn', 'Dunes in fog'])
    for (const img of gallery) expect(follows(body(), img)).toBe(true)
  })

  it('steps from the first gallery tile back to the placed image, then forward through the gallery', async () => {
    const content = 'Intro\n\n[image]\n\nHello'
    mountPost(
      postWith({
        content,
        facets: [facetOver(content, '[image]', placement(0))],
      }),
      { expandBody: true, view: 'cozy' },
    )

    await openFirstGalleryTile()
    expectShowing(
      'https://img.coves.test/img/content_full/plain/did:plc:a/harbour',
      'Harbour at dawn',
    )
    await press(/previous/i)
    expectShowing(
      'https://img.coves.test/img/content_full/plain/did:plc:a/lighthouse',
      'Lighthouse at dusk',
    )
    await press(/next/i)
    expectShowing(
      'https://img.coves.test/img/content_full/plain/did:plc:a/harbour',
      'Harbour at dawn',
    )
    await press(/next/i)
    expectShowing(
      'https://img.coves.test/img/content_full/plain/did:plc:a/dunes',
      'Dunes in fog',
    )
  })

  it('orders the lightbox by body position of the placements, then the gallery', async () => {
    const content = 'Start\n\n[dunes]\n\nMiddle\n\n[lighthouse]\n\nEnd'
    mountPost(
      postWith({
        content,
        // The image-0 facet is listed first but sits second in the body.
        facets: [
          facetOver(content, '[lighthouse]', placement(0)),
          facetOver(content, '[dunes]', placement(2)),
        ],
      }),
      { expandBody: true, view: 'cozy' },
    )

    await openFirstGalleryTile()
    expectShowing(
      'https://img.coves.test/img/content_full/plain/did:plc:a/harbour',
      'Harbour at dawn',
    )
    await press(/previous/i)
    expectShowing(
      'https://img.coves.test/img/content_full/plain/did:plc:a/lighthouse',
      'Lighthouse at dusk',
    )
    await press(/previous/i)
    expectShowing(
      'https://img.coves.test/img/content_full/plain/did:plc:a/dunes',
      'Dunes in fog',
    )
    await press(/next/i)
    await press(/next/i)
    expectShowing(
      'https://img.coves.test/img/content_full/plain/did:plc:a/harbour',
      'Harbour at dawn',
    )
    await press(/next/i)
    expectShowing(
      'https://img.coves.test/img/content_full/plain/did:plc:a/dunes',
      'Dunes in fog',
    )
  })
})

describe('feed card placements', () => {
  it('renders a cozy card whose images are all placed as a text post without the covered text', () => {
    mountPost(postWith({ content: ALL_PLACED, facets: allPlacedFacets }), {
      expandBody: false,
      view: 'cozy',
    })

    expect(postImageSources()).toEqual([])
    expect(imageMediaWithoutSource()).toEqual([])
    expect(body().querySelector('img')).toBeNull()
    const text = body().textContent ?? ''
    expect(text).toContain('Hello there')
    for (const covered of ['[lighthouse]', '[harbour]', '[dunes]'])
      expect(text).not.toContain(covered)
  })

  it('shows no thumbnail and a title excerpt without the covered text in a compact card whose images are all placed', () => {
    mountPost(
      postWith({ content: ALL_PLACED, facets: allPlacedFacets, title: '' }),
      { expandBody: false, view: 'compact' },
    )

    expect(postImageSources()).toEqual([])
    expect(imageMediaWithoutSource()).toEqual([])
    const text = host('post').textContent ?? ''
    expect(text).toContain('Hello there')
    expect(text).not.toContain('[lighthouse]')
  })

  it('shows the first unplaced image with a count of the unplaced images in a compact card', () => {
    mountPost(postWith({ content: FIRST_PLACED, facets: firstPlacedFacets }), {
      expandBody: false,
      view: 'compact',
    })

    const thumbnails = [...host('post').querySelectorAll('img')].filter((img) =>
      (img.getAttribute('src') ?? '').includes('img.coves.test'),
    )
    expect(
      thumbnails.map((img) => ({
        src: img.getAttribute('src'),
        alt: img.getAttribute('alt'),
      })),
    ).toEqual([
      {
        src: 'https://img.coves.test/img/content_preview/plain/did:plc:a/harbour',
        alt: 'Harbour at dawn',
      },
    ])
    expect(numericBadges()).toEqual(['2'])
  })

  it('shows only the unplaced images in a cozy card gallery', () => {
    mountPost(postWith({ content: FIRST_PLACED, facets: firstPlacedFacets }), {
      expandBody: false,
      view: 'cozy',
    })

    expect(altsOf(galleryImages())).toEqual(['Harbour at dawn', 'Dunes in fog'])
  })

  it('keeps the attachment link card but no gallery when every image of an imagesWithAttachment post is placed', () => {
    mountPost(
      postWith({
        content: ALL_PLACED,
        facets: allPlacedFacets,
        embed: threeImagesWithExternal,
      }),
      { expandBody: false, view: 'cozy' },
    )

    const card = host('post').querySelector(
      'a[href="https://news.example.test/harbour-story"]',
    )
    expect(card?.textContent).toContain('Harbour story')
    expect(postImageSources()).toEqual([])
  })

  it.each(['compact', 'cozy'] as const)(
    'shows the blurred preview tile for a sensitive %s card whose images are all placed',
    (view) => {
      settings.nsfwBlur = true
      mountPost(
        postWith({
          content: ALL_PLACED,
          facets: allPlacedFacets,
          sensitive: true,
        }),
        { expandBody: false, view },
      )

      const tile = [
        ...host('post').querySelectorAll<HTMLButtonElement>(
          'button[aria-label="Show sensitive content"]',
        ),
      ].find((button) => button.querySelector('img'))
      expect(tile, 'image-bearing reveal button').toBeDefined()
    },
  )
})
