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
import type { AtUri, CID, CommentView, PostEmbed } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'

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
    url: new URL('http://localhost/c/community.test/post/author.test/one'),
    route: { id: '/c/[handle=handle]/post/[owner=actor]/[rkey]' },
  },
}))
vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  pushState: vi.fn(),
  replaceState: vi.fn(),
}))
const profile = vi.hoisted(() => ({
  isAuthenticated: true,
  meta: {},
  current: {
    type: 'authenticated',
    did: 'did:plc:reader',
    handle: 'reader.test',
    jwt: 'authenticated',
  },
}))
vi.mock('$lib/app/state/auth.svelte', () => ({ profile }))
vi.mock('$lib/api/client.svelte', () => ({ coves: () => ({}) }))
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

const postRef = {
  uri: 'at://did:plc:author/social.coves.community.post/one' as AtUri,
  cid: 'bafypost' as CID,
}

const BODY = 'Comment body text'

const twoImages = {
  $type: 'social.coves.embed.images#view',
  images: [
    {
      thumb: 'https://img.coves.test/comment-one-thumb.jpg',
      fullsize: 'https://img.coves.test/comment-one-full.jpg',
      alt: 'Comment first image',
    },
    {
      thumb: 'https://img.coves.test/comment-two-thumb.jpg',
      fullsize: 'https://img.coves.test/comment-two-full.jpg',
      alt: 'Comment second image',
    },
  ],
} as const satisfies PostEmbed

const imagesWithExternal: PostEmbed = {
  $type: 'social.coves.embed.imagesWithAttachment#view',
  images: twoImages,
  attachment: {
    $type: 'social.coves.embed.external#viewExternal',
    uri: 'https://news.example.test/harbour-story',
    title: 'Harbour story',
    thumb: 'https://news.example.test/media/harbour-card.jpg',
  },
}

function liveComment(embed?: PostEmbed): CommentView {
  return {
    uri: 'at://did:plc:commenter/social.coves.community.comment/c1' as AtUri,
    cid: 'bafycomment' as CID,
    createdAt: '2026-09-01T00:00:00Z',
    indexedAt: '2026-09-01T00:00:00Z',
    author: {
      did: 'did:plc:commenter' as DID,
      handle: 'commenter.test' as Handle,
    },
    post: postRef,
    parent: postRef,
    record: {
      $type: 'social.coves.community.comment',
      content: BODY,
      reply: { root: postRef, parent: postRef },
      createdAt: '2026-09-01T00:00:00Z',
    },
    stats: { upvotes: 1, downvotes: 0, score: 1, replyCount: 0 },
    ...(embed ? { embed } : {}),
  }
}

let target: HTMLDivElement
let client: typeof import('svelte')
let Harness: typeof import('./Comment.test-harness.svelte').default
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

beforeAll(async () => {
  client = await import('svelte')
  Harness = (await import('./Comment.test-harness.svelte')).default
}, 30_000)

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
})

function mountComment(comment: CommentView): void {
  mounted = client.mount(Harness, {
    target,
    intro: false,
    props: { initialComment: comment, postRef },
  })
  client.flushSync()
}

/** The innermost element holding the comment body text. */
function bodyElement(): Element {
  const element = [...target.querySelectorAll('*')]
    .filter((candidate) => candidate.textContent?.includes(BODY))
    .at(-1)
  expect(element, 'comment body element').toBeDefined()
  if (!element) throw new Error('Missing comment body')
  return element
}

function expectUnblurredImagesAfterBody(): void {
  const body = bodyElement()
  const expected = [
    {
      alt: 'Comment first image',
      src: 'https://img.coves.test/comment-one-full.jpg',
    },
    {
      alt: 'Comment second image',
      src: 'https://img.coves.test/comment-two-full.jpg',
    },
  ]
  const foreground = expected.map(({ alt }) =>
    target.querySelector(`img[alt="${alt}"]`),
  )
  expect(foreground.map((img) => img?.getAttribute('src'))).toEqual(
    expected.map(({ src }) => src),
  )
  for (const img of foreground) {
    if (!img) continue
    expect(
      body.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING,
      `${img.getAttribute('alt')} follows the body`,
    ).toBeTruthy()
    // PostGallery's `blur` empties the src and adds blur-3xl.
    expect(img.classList.contains('blur-3xl')).toBe(false)
  }
  const [first, second] = foreground
  if (first && second)
    expect(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
}

describe('comment image embeds', () => {
  it('renders an images#view embed as an unblurred gallery after the body', () => {
    mountComment(liveComment(twoImages))

    expectUnblurredImagesAfterBody()
  })

  it('renders the images of an imagesWithAttachment embed after the body, without a link card', () => {
    mountComment(liveComment(imagesWithExternal))

    expectUnblurredImagesAfterBody()
    expect(
      target.querySelector('a[href="https://news.example.test/harbour-story"]'),
    ).toBeNull()
    expect(target.textContent).not.toContain('Harbour story')
    expect(target.innerHTML).not.toContain('harbour-card.jpg')
  })

  it('removes the gallery when the author deletes the comment in the same session', () => {
    mountComment(liveComment(twoImages))
    expect(
      target.querySelector('img[alt="Comment first image"]'),
    ).not.toBeNull()

    const exports = mounted as { deleteInPlace?: () => void } | undefined
    if (!exports?.deleteInPlace)
      throw new Error('Harness missing deleteInPlace')
    exports.deleteInPlace()
    client.flushSync()

    expect(target.textContent).not.toContain(BODY)
    expect(target.querySelector('img[alt="Comment first image"]')).toBeNull()
    expect(target.querySelector('img[alt="Comment second image"]')).toBeNull()
  })

  it('renders no gallery for a comment without an embed', () => {
    mountComment(liveComment())

    expect(target.textContent).toContain(BODY)
    expect(target.querySelector('picture')).toBeNull()
    expect(target.querySelector('[style*="aspect-ratio"]')).toBeNull()
  })
})
