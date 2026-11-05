// @vitest-environment jsdom
/**
 * The optimistic render path for a post with images: a post submitted from
 * the real PostForm renders from the composer's `blob:` URLs, in a feed card
 * and on this post page, through the real Post / PostMedia / PostGallery and
 * the lightbox, until the server copy replaces it and the URLs are revoked.
 *
 * jsdom never loads or decodes an image, so "the image loads" is checked in
 * the live Firefox check; here the outcome is the `src` each img is given and
 * the absence of the "Image unavailable" placeholder.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { ComponentProps } from 'svelte'
import type { PostView } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import {
  imageFile,
  pickFiles,
  stubImageDecoding,
  stubObjectUrls,
  uploadOutput,
} from '$lib/feature/image-upload/test-helpers'

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
    url: new URL('https://coves.test/c/community.test/post/viewer.test/fresh1'),
    route: { id: '/c/[handle=handle]/post/[owner=actor]/[rkey]' },
    params: {},
    get state() {
      return navigation.read()
    },
  },
}))
vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  invalidate: vi.fn(),
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

const api = vi.hoisted(() => ({ client: {} as Record<string, unknown> }))
vi.mock('$lib/api/client.svelte', () => ({ coves: () => api.client }))
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: {
    current: {
      type: 'authenticated',
      id: 'did:plc:viewer',
      did: 'did:plc:viewer',
      handle: 'viewer.test',
      jwt: 'authenticated',
    },
    isAuthenticated: true,
    meta: {},
    sessionExpired: false,
  },
}))
// The comment tree is not under test; the post above it is.
vi.mock('$lib/feature/comment/CommentProvider.svelte', () => ({
  default: () => {},
}))

let client: typeof import('svelte')
let SvelteMap: (typeof import('svelte/reactivity'))['SvelteMap']
let ReactiveState: (typeof import('$lib/app/util/reactive.svelte'))['ReactiveState']
let PostForm: (typeof import('$lib/feature/post/form/PostForm.svelte'))['default']
let PostFormState: (typeof import('$lib/feature/post/form/post-form.svelte'))['PostFormState']
let PostWithLightbox: (typeof import('$lib/feature/post/PostLightbox.test.svelte'))['default']
let ExpandableImage: (typeof import('$lib/ui/generic/ExpandableImage.svelte'))['default']
let showImage: (typeof import('$lib/ui/generic/ExpandableImage.svelte'))['showImage']
let imageUrl: (typeof import('$lib/api/coves/image-proxy'))['imageUrl']
let PostPage: (typeof import('./+page.svelte'))['default']

const targets: HTMLDivElement[] = []
const mountedComponents: ReturnType<(typeof import('svelte'))['mount']>[] = []
let objectUrls: { revoked: string[] }

// Cold-loading PostForm, Post and the post page takes seconds under
// full-suite load; pay it once, outside any per-test timeout.
beforeAll(async () => {
  client = await import('svelte')
  SvelteMap = (await import('svelte/reactivity')).SvelteMap
  ReactiveState = (await import('$lib/app/util/reactive.svelte')).ReactiveState
  PostForm = (await import('$lib/feature/post/form/PostForm.svelte')).default
  PostFormState = (await import('$lib/feature/post/form/post-form.svelte'))
    .PostFormState
  PostWithLightbox = (
    await import('$lib/feature/post/PostLightbox.test.svelte')
  ).default
  const lightbox = await import('$lib/ui/generic/ExpandableImage.svelte')
  ExpandableImage = lightbox.default
  showImage = lightbox.showImage
  imageUrl = (await import('$lib/api/coves/image-proxy')).imageUrl
  PostPage = (await import('./+page.svelte')).default
}, 60_000)

beforeEach(async () => {
  const { settings } = await import('$lib/app/state/settings.svelte')
  settings.expandImages = true
  settings.nsfwBlur = false
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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  objectUrls = stubObjectUrls()
  stubImageDecoding()
})

afterEach(async () => {
  for (const component of mountedComponents.splice(0)) {
    await client.unmount(component, { outro: false })
  }
  for (const target of targets.splice(0)) target.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const KITE = 'blob:http://localhost/kite.jpg'
const HERON = 'blob:http://localhost/heron.png'
const UNREGISTERED = 'blob:http://localhost/never-registered'
const UNAVAILABLE = 'Image unavailable'
const POST_URI = 'at://did:plc:viewer/social.coves.community.post/fresh1'
const STORY = 'https://example.com/story'

const proxy = (preset: string, name: string) =>
  `https://img.coves.test/img/${preset}/plain/did:plc:viewer/bafy-${name}`

function newTarget(): HTMLDivElement {
  const target = document.createElement('div')
  document.body.appendChild(target)
  targets.push(target)
  return target
}

function mount<Props extends Record<string, unknown>>(
  component: import('svelte').Component<Props>,
  props: Props,
): HTMLDivElement {
  const target = newTarget()
  mountedComponents.push(
    client.mount(component, { target, props, intro: false }),
  )
  client.flushSync()
  return target
}

async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    client.flushSync()
  }
}

/**
 * Submits a post with two images and a URL through the real PostForm, then
 * unmounts the form as the create page does when it navigates away. Returns
 * the optimistic view the create flow hands to the post page.
 */
async function submitTwoImagesWithUrl(): Promise<PostView> {
  api.client = {
    uploadImage: async (file: File, contentType: string) =>
      uploadOutput(file, contentType),
    createPost: async () => ({ uri: POST_URI, cid: 'bafyfresh' }),
  }
  const state = new PostFormState({
    title: 'Two birds',
    url: STORY,
    community: {
      did: 'did:plc:community' as DID,
      handle: 'community.test' as Handle,
      name: 'Community',
    },
  })
  const onsubmit = vi.fn()
  const target = newTarget()
  const form = client.mount(PostForm, {
    target,
    props: { init: state, onsubmit },
    intro: false,
  })
  client.flushSync()

  const input = target.querySelector<HTMLInputElement>('input[type="file"]')
  expect(input, 'the attachment strip’s file input').not.toBeNull()
  if (input) {
    pickFiles(input, [
      imageFile('kite.jpg', 'jpeg'),
      imageFile('heron.png', 'png'),
    ])
  }
  await vi.waitFor(() => expect(state.attachments.items).toHaveLength(2))
  target
    .querySelector('form')
    ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(onsubmit).toHaveBeenCalledTimes(1))

  await client.unmount(form, { outro: false })
  const post = (onsubmit.mock.calls[0][0] as { post?: PostView }).post
  expect(post, 'the optimistic post view').toBeDefined()
  return post as PostView
}

/** The server's copy of the same post, its images behind the proxy. */
function serverCopy(fresh: PostView): PostView {
  return {
    ...fresh,
    cid: 'bafyindexed' as PostView['cid'],
    embed: {
      $type: 'social.coves.embed.imagesWithAttachment#view',
      images: {
        $type: 'social.coves.embed.images#view',
        images: [
          {
            thumb: proxy('content_preview', 'kite.jpg'),
            fullsize: proxy('content_full', 'kite.jpg'),
            aspectRatio: { width: 300, height: 200 },
          },
          {
            thumb: proxy('content_preview', 'heron.png'),
            fullsize: proxy('content_full', 'heron.png'),
            aspectRatio: { width: 300, height: 200 },
          },
        ],
      },
      attachment: {
        $type: 'social.coves.embed.external#viewExternal',
        uri: STORY,
      },
    },
  } as PostView
}

/** Route data as the post page's loader returns it for `post`. */
function routeData(post: PostView): ComponentProps<typeof PostPage>['data'] {
  return {
    data: new ReactiveState({
      post,
      comments: Promise.resolve({ comments: [] }),
      params: {
        postUri: post.uri,
        comments: { post: post.uri, sort: 'hot', depth: 3, limit: 50 },
        thread: { showContext: false, singleThread: false },
        freshPost: true,
      },
    }),
    communityHandle: 'community.test',
  } as unknown as ComponentProps<typeof PostPage>['data']
}

/** The gallery's tiles: the boxes laid out in its two-column grid. */
function galleryTiles(root: Element): HTMLElement[] {
  const grid = root.querySelector('.grid-cols-2')
  expect(grid, 'the two-image gallery grid').not.toBeNull()
  return [
    ...(grid?.querySelectorAll<HTMLElement>(
      ':scope > [style*="aspect-ratio"]',
    ) ?? []),
  ]
}

/** Every distinct img src in each tile. */
function tileSources(root: Element): string[][] {
  return galleryTiles(root).map((tile) => [
    ...new Set(
      [...tile.querySelectorAll('img')].map(
        (image) => image.getAttribute('src') ?? '',
      ),
    ),
  ])
}

function expandButton(tile: Element): HTMLElement {
  const found = [
    ...tile.querySelectorAll<HTMLElement>('[role="button"], button'),
  ].find((button) => button.textContent?.trim() !== 'ALT')
  if (!found) throw new Error('Tile has no expand button')
  return found
}

function host(root: Element, name: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(`[data-testid="${name}"]`)
  if (!found) throw new Error(`Harness has no ${name}`)
  return found
}

const imageOf = (url: string) => ({ thumb: url, fullsize: url })

describe('optimistic post with images', () => {
  it('renders in a feed card from the composer’s blob: URLs, and its lightbox shows them', async () => {
    const post = await submitTwoImagesWithUrl()

    const root = mount(PostWithLightbox, {
      post,
      expandBody: false,
      view: 'cozy',
    })
    const card = host(root, 'post')

    expect(tileSources(card)).toEqual([[KITE], [HERON]])
    expect(card.textContent).not.toContain(UNAVAILABLE)

    expandButton(galleryTiles(card)[0]).click()
    client.flushSync()

    const lightbox = host(root, 'lightbox')
    expect(lightbox.querySelector('img')?.getAttribute('src')).toBe(KITE)
    expect(lightbox.textContent).not.toContain(UNAVAILABLE)
  })

  it('lets the lightbox show a registered composer blob: URL but not an unregistered one', async () => {
    await submitTwoImagesWithUrl()
    const lightbox = mount(ExpandableImage, {})

    showImage(
      [
        { url: KITE, alt: 'Kite' },
        { url: UNREGISTERED, alt: 'Stranger' },
      ],
      0,
    )
    client.flushSync()
    expect(lightbox.querySelector('img')?.getAttribute('src')).toBe(KITE)

    showImage(
      [
        { url: KITE, alt: 'Kite' },
        { url: UNREGISTERED, alt: 'Stranger' },
      ],
      1,
    )
    client.flushSync()
    expect(lightbox.textContent).toContain(UNAVAILABLE)
    expect(lightbox.querySelector(`img[src="${UNREGISTERED}"]`)).toBeNull()
  })

  it('renders on the post page from the blob: URLs until the server copy replaces it, then revokes them', async () => {
    const fresh = await submitTwoImagesWithUrl()
    const values = new SvelteMap([['data', routeData(fresh)]])
    const page = mount(PostPage, {
      get data() {
        const data = values.get('data')
        if (!data) throw new Error('Missing route data')
        return data
      },
    })
    await settle()

    expect(tileSources(page)).toEqual([[KITE], [HERON]])
    expect(page.textContent).not.toContain(UNAVAILABLE)

    values.set('data', routeData(serverCopy(fresh)))
    await settle()

    expect(tileSources(page)).toEqual([
      [proxy('content_preview', 'kite.jpg'), proxy('content_full', 'kite.jpg')],
      [
        proxy('content_preview', 'heron.png'),
        proxy('content_full', 'heron.png'),
      ],
    ])
    expect(imageUrl(imageOf(KITE))).toBeUndefined()
    expect(imageUrl(imageOf(HERON))).toBeUndefined()
    expect(objectUrls.revoked).toEqual(expect.arrayContaining([KITE, HERON]))
  })
})
