// @vitest-environment jsdom
/**
 * The optimistic render path for a comment with images: a comment or reply
 * submitted from the real CommentForm renders from the composer's `blob:`
 * URLs through the real Comment / PostGallery, until the server copy replaces
 * it and the URLs are revoked.
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
import type {
  AtUri,
  CID,
  CommentView,
  PostView,
  ThreadViewComment,
} from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import {
  imageFile,
  pickFiles,
  stubImageDecoding,
  stubObjectUrls,
  uploadOutput,
} from '$lib/feature/image-upload/test-helpers'

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

const { createComment, profile } = vi.hoisted(() => ({
  createComment: vi.fn(),
  profile: {
    isAuthenticated: true,
    meta: {},
    sessionExpired: false,
    current: {
      type: 'authenticated',
      jwt: 'test-session',
      did: 'did:plc:viewer',
      handle: 'viewer.test',
    },
  },
}))
vi.mock('$lib/api/client.svelte', () => ({
  coves: () => ({
    createComment,
    uploadImage: async (file: File, contentType: string) =>
      uploadOutput(file, contentType),
  }),
}))
vi.mock('$lib/app/state/auth.svelte', () => ({ profile }))

const KITE = 'blob:http://localhost/kite.jpg'
const HERON = 'blob:http://localhost/heron.png'
const WREN = 'blob:http://localhost/wren.jpg'
const UNAVAILABLE = 'Image unavailable'
const BODY = 'Two birds'

const proxy = (preset: string, name: string) =>
  `https://img.coves.test/img/${preset}/plain/did:plc:viewer/bafy-${name}`

const postRef = {
  uri: 'at://did:plc:author/social.coves.community.post/one' as AtUri,
  cid: 'bafypost' as CID,
}
const ROOT_CREATED = {
  uri: 'at://did:plc:viewer/social.coves.community.comment/fresh1' as AtUri,
  cid: 'bafyfresh1' as CID,
}
const REPLY_CREATED = {
  uri: 'at://did:plc:viewer/social.coves.community.comment/reply1' as AtUri,
  cid: 'bafyreply1' as CID,
}

function postFixture(): PostView {
  return {
    ...postRef,
    rkey: 'one',
    createdAt: '2026-09-01T00:00:00Z',
    indexedAt: '2026-09-01T00:00:00Z',
    author: { did: 'did:plc:author' as DID, handle: 'author.test' as Handle },
    community: {
      did: 'did:plc:community' as DID,
      handle: 'community.test' as Handle,
      name: 'Community',
    },
    stats: { upvotes: 0, downvotes: 0, score: 0, commentCount: 1 },
  }
}

function commentView(
  ref: { uri: AtUri; cid: CID },
  content: string,
  author: { did: DID; handle: Handle },
): CommentView {
  return {
    ...ref,
    createdAt: '2026-09-01T00:00:00Z',
    indexedAt: '2026-09-01T00:00:00Z',
    author,
    post: postRef,
    parent: postRef,
    record: {
      $type: 'social.coves.community.comment',
      content,
      reply: { root: postRef, parent: postRef },
      createdAt: '2026-09-01T00:00:00Z',
    },
    stats: { upvotes: 0, downvotes: 0, score: 0, replyCount: 0 },
  }
}

const existing: ThreadViewComment = {
  comment: commentView(
    {
      uri: 'at://did:plc:alice/social.coves.community.comment/parent' as AtUri,
      cid: 'bafyparent' as CID,
    },
    'Existing comment',
    { did: 'did:plc:alice' as DID, handle: 'alice.test' as Handle },
  ),
  replies: [],
}

/** The server's copy of the submitted root comment, its images behind the proxy. */
function serverCopy(): ThreadViewComment {
  return {
    comment: {
      ...commentView(ROOT_CREATED, BODY, {
        did: 'did:plc:viewer' as DID,
        handle: 'viewer.test' as Handle,
      }),
      cid: 'bafyindexed' as CID,
      embed: {
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
    },
    replies: [],
  }
}

let target: HTMLDivElement
let client: typeof import('svelte')
let Harness: typeof import('./CommentProvider.test-harness.svelte').default
let isImageSourceUrl: (typeof import('$lib/api/coves/image-proxy'))['isImageSourceUrl']
let mounted:
  | {
      refresh: (comments: ThreadViewComment[]) => void
      navigate: (post: PostView) => void
    }
  | undefined
let objectUrls: { revoked: string[] }

beforeAll(async () => {
  client = await import('svelte')
  Harness = (await import('./CommentProvider.test-harness.svelte')).default
  isImageSourceUrl = (await import('$lib/api/coves/image-proxy'))
    .isImageSourceUrl
}, 60_000)

beforeEach(async () => {
  const { settings } = await import('$lib/app/state/settings.svelte')
  settings.expandImages = true
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  createComment.mockReset()
  objectUrls = stubObjectUrls()
  stubImageDecoding()
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
  vi.unstubAllGlobals()
})

function mountProvider(): {
  refresh: (comments: ThreadViewComment[]) => void
  navigate: (post: PostView) => void
} {
  const provider = client.mount(Harness, {
    target,
    intro: false,
    props: { initialPost: postFixture(), initialComments: [existing] },
  })
  mounted = provider
  client.flushSync()
  return provider
}

async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    client.flushSync()
  }
}

function button(text: string): HTMLButtonElement {
  const result = [...target.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === text,
  )
  if (!result) throw new Error(`Missing button: ${text}`)
  return result
}

/** The one open comment composer. */
function composer(): HTMLFormElement {
  const forms = target.querySelectorAll('form')
  expect(forms, 'one open comment composer').toHaveLength(1)
  return forms[0]
}

/** Picks images into the open composer, types its text and submits it. */
async function submitComposer(files: File[], text: string): Promise<void> {
  const form = composer()
  const input = form.querySelector<HTMLInputElement>('input[type="file"]')
  expect(input, 'the composer’s attachment file input').not.toBeNull()
  if (input) pickFiles(input, files)
  await vi.waitFor(() =>
    expect(
      [...form.querySelectorAll('li')].filter((item) =>
        item.querySelector('img'),
      ),
    ).toHaveLength(files.length),
  )
  const textarea = form.querySelector('textarea')
  if (!textarea) throw new Error('The composer has no textarea')
  textarea.value = text
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  client.flushSync()
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await settle()
}

async function submitRootWithTwoImages(): Promise<void> {
  createComment.mockResolvedValueOnce(ROOT_CREATED)
  button('Add a comment').click()
  client.flushSync()
  await submitComposer(
    [imageFile('kite.jpg', 'jpeg'), imageFile('heron.png', 'png')],
    BODY,
  )
  expect(createComment).toHaveBeenCalledTimes(1)
}

function commentElement(rkey: string): HTMLElement {
  const found = target.querySelector<HTMLElement>(`#comment-${rkey}`)
  if (!found) throw new Error(`Missing comment ${rkey}`)
  return found
}

/** The gallery tiles of this comment, not of a reply nested in it. */
function galleryTiles(comment: HTMLElement): HTMLElement[] {
  return [
    ...comment.querySelectorAll<HTMLElement>('[style*="aspect-ratio"]'),
  ].filter((tile) => tile.closest('li[id^="comment-"]') === comment)
}

/** Each tile's foreground img src (a tile also draws a blurred backdrop). */
function foregroundSources(comment: HTMLElement): (string | null)[] {
  return galleryTiles(comment).map(
    (tile) =>
      [...tile.querySelectorAll('picture')]
        .at(-1)
        ?.querySelector('img')
        ?.getAttribute('src') ?? null,
  )
}

/** The innermost element of this comment holding its body text. */
function bodyElement(comment: HTMLElement, text: string): Element {
  const element = [...comment.querySelectorAll('*')]
    .filter((candidate) => candidate.textContent?.includes(text))
    .at(-1)
  if (!element) throw new Error('Missing comment body')
  return element
}

describe('optimistic comment with images', () => {
  it('renders a root comment from the composer’s blob: URLs after its body until the server copy replaces it, then revokes them', async () => {
    const provider = mountProvider()
    await submitRootWithTwoImages()

    const fresh = commentElement('fresh1')
    expect(foregroundSources(fresh)).toEqual([KITE, HERON])
    expect(fresh.textContent).not.toContain(UNAVAILABLE)
    const [firstTile] = galleryTiles(fresh)
    expect(
      bodyElement(fresh, BODY).compareDocumentPosition(firstTile) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      'the gallery follows the body',
    ).toBeTruthy()

    provider.refresh([serverCopy(), existing])
    await settle()

    expect(foregroundSources(commentElement('fresh1'))).toEqual([
      proxy('content_full', 'kite.jpg'),
      proxy('content_full', 'heron.png'),
    ])
    expect(objectUrls.revoked).toEqual(expect.arrayContaining([KITE, HERON]))
    expect(isImageSourceUrl(KITE)).toBe(false)
    expect(isImageSourceUrl(HERON)).toBe(false)
  })

  it('keeps a root comment on its blob: URLs through a refresh that does not have the server copy yet', async () => {
    const provider = mountProvider()
    await submitRootWithTwoImages()
    expect(foregroundSources(commentElement('fresh1'))).toEqual([KITE, HERON])

    provider.refresh([existing])
    await settle()

    const fresh = commentElement('fresh1')
    await vi.waitFor(() =>
      expect(foregroundSources(fresh)).toEqual([KITE, HERON]),
    )
    expect(fresh.textContent).not.toContain(UNAVAILABLE)
    expect(objectUrls.revoked).not.toContain(KITE)
    expect(objectUrls.revoked).not.toContain(HERON)
    expect(isImageSourceUrl(KITE)).toBe(true)
    expect(isImageSourceUrl(HERON)).toBe(true)
  })

  it('closes the reply composer after a reply with an image and keeps the reply on its blob: URL', async () => {
    mountProvider()
    createComment.mockResolvedValueOnce(REPLY_CREATED)
    button('Reply').click()
    client.flushSync()

    await submitComposer([imageFile('wren.jpg', 'jpeg')], 'One bird')

    expect(createComment).toHaveBeenCalledTimes(1)
    expect(target.querySelector('form')).toBeNull()
    const reply = commentElement('reply1')
    expect(foregroundSources(reply)).toEqual([WREN])
    expect(reply.textContent).not.toContain(UNAVAILABLE)
    expect(objectUrls.revoked).not.toContain(WREN)
  })

  it('revokes a local comment’s blob: URLs when the comment list is unmounted', async () => {
    mountProvider()
    await submitRootWithTwoImages()
    expect(foregroundSources(commentElement('fresh1'))).toEqual([KITE, HERON])
    expect(objectUrls.revoked).not.toContain(KITE)

    if (mounted) await client.unmount(mounted, { outro: false })
    mounted = undefined

    expect(objectUrls.revoked).toEqual(expect.arrayContaining([KITE, HERON]))
  })

  it('revokes the blob: URLs of a root comment created after the page moved to another post', async () => {
    const provider = mountProvider()
    const created = Promise.withResolvers<typeof ROOT_CREATED>()
    createComment.mockReturnValueOnce(created.promise)
    button('Add a comment').click()
    client.flushSync()
    const egret = 'blob:http://localhost/cp-egret.jpg'
    await submitComposer([imageFile('cp-egret.jpg', 'jpeg')], 'One egret')
    expect(createComment).toHaveBeenCalledTimes(1)

    provider.navigate({
      ...postFixture(),
      uri: 'at://did:plc:author/social.coves.community.post/two' as AtUri,
      cid: 'bafypost2' as CID,
      rkey: 'two',
    })
    client.flushSync()
    created.resolve(ROOT_CREATED)

    await vi.waitFor(() => expect(objectUrls.revoked).toContain(egret))
    expect(isImageSourceUrl(egret)).toBe(false)
  })
})
