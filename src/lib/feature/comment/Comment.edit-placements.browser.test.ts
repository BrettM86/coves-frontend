// @vitest-environment jsdom
/**
 * Editing a comment that places its images: the editor opens with the stored
 * placement as a `![covered](image:N)` token, the comment's images show as a
 * read-only strip offering only Insert in text, saving without changes sends
 * the stored record back, and a placement the token cannot express is dropped
 * with a notice in the editor.
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
  CommentEmbedRecord,
  CommentView,
  ImagesEmbedRecord,
  PostEmbed,
  UpdateCommentInput,
} from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import english from '$lib/app/state/i18n/en.json'
import { editorSourceFor } from './comment-submit'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
// The edit Modal keeps itself open only while page.state lists it, so the
// shallow-routing state has to be reactive.
type PageState = Record<string, unknown>
const navigation = vi.hoisted(() => ({
  read: (): PageState => ({}),
  write: (_state: PageState) => {},
}))
vi.mock('$app/state', () => ({
  page: {
    get state() {
      return navigation.read()
    },
    url: new URL('http://localhost/c/community.test/post/author.test/one'),
    route: { id: '/c/[handle=handle]/post/[owner=actor]/[rkey]' },
  },
}))
vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  pushState: (_url: string, state: PageState) => navigation.write(state),
  replaceState: (_url: string, state: PageState) => navigation.write(state),
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

const { updateComment, profile } = vi.hoisted(() => ({
  updateComment: vi.fn(),
  profile: {
    isAuthenticated: true,
    meta: {},
    sessionExpired: false,
    current: {
      type: 'authenticated',
      did: 'did:plc:commenter',
      handle: 'commenter.test',
      jwt: 'authenticated',
    },
  },
}))
vi.mock('$lib/api/client.svelte', () => ({
  coves: () => ({
    updateComment,
    resolveHandle: async () => ({ did: 'did:plc:mentioned' }),
    getCommunity: async () => ({ did: 'did:plc:community' }),
  }),
}))
vi.mock('$lib/app/state/auth.svelte', () => ({ profile }))

const postRef = {
  uri: 'at://did:plc:author/social.coves.community.post/one' as AtUri,
  cid: 'bafypost' as CID,
}
const COMMENT_URI =
  'at://did:plc:commenter/social.coves.community.comment/c1' as AtUri

const NS = 'social.coves.richtext.facet'

function storedImage(name: string, alt: string) {
  return {
    image: {
      $type: 'blob' as const,
      ref: { $link: `bafy-${name}` },
      mimeType: 'image/jpeg',
      size: 64,
    },
    alt,
    aspectRatio: { width: 300, height: 200 },
  }
}

function viewImage(name: string, alt: string) {
  return {
    thumb: `https://img.coves.test/${name}-thumb.jpg`,
    fullsize: `https://img.coves.test/${name}-full.jpg`,
    alt,
    aspectRatio: { width: 300, height: 200 },
  }
}

const twoImagesRecord: ImagesEmbedRecord = {
  $type: 'social.coves.embed.images',
  images: [storedImage('cat.jpg', 'A cat'), storedImage('dog.jpg', 'A dog')],
}
const twoImagesView: PostEmbed = {
  $type: 'social.coves.embed.images#view',
  images: [viewImage('cat', 'A cat'), viewImage('dog', 'A dog')],
}
const oneImageRecord: ImagesEmbedRecord = {
  $type: 'social.coves.embed.images',
  images: [storedImage('cat.jpg', 'A cat')],
}
const oneImageView: PostEmbed = {
  $type: 'social.coves.embed.images#view',
  images: [viewImage('cat', 'A cat')],
}

// `A cat` is bytes 6..11 of `Hello\nA cat\nBye`.
const placementFacet = {
  index: { byteStart: 6, byteEnd: 11 },
  features: [{ $type: `${NS}#image`, index: 0 }],
}

function ownComment(
  record: { content: string; facets: unknown[]; embed: CommentEmbedRecord },
  view: PostEmbed,
): CommentView {
  return {
    uri: COMMENT_URI,
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
      reply: { root: postRef, parent: postRef },
      createdAt: '2026-09-01T00:00:00Z',
      ...record,
    },
    stats: { upvotes: 1, downvotes: 0, score: 1, replyCount: 0 },
    embed: view,
  }
}

const placedComment = () =>
  ownComment(
    {
      content: 'Hello\nA cat\nBye',
      facets: [placementFacet],
      embed: twoImagesRecord,
    },
    twoImagesView,
  )

let target: HTMLDivElement
let client: typeof import('svelte')
let Harness: typeof import('./Comment.test-harness.svelte').default
let toasts: (typeof import('$lib/ui/kit/toast/toasts'))['toasts']
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

beforeAll(async () => {
  client = await import('svelte')
  Harness = (await import('./Comment.test-harness.svelte')).default
  toasts = (await import('$lib/ui/kit/toast/toasts')).toasts
}, 60_000)

beforeEach(async () => {
  const { SvelteMap } = await import('svelte/reactivity')
  const current = new SvelteMap<string, PageState>([['state', {}]])
  navigation.read = () => current.get('state') ?? {}
  navigation.write = (state) => current.set('state', state)
  const { shownModal } = await import('$lib/ui/kit/modal/modal')
  shownModal.set(undefined)
  toasts.set([])
  updateComment.mockReset()
  updateComment.mockResolvedValue({ uri: COMMENT_URI, cid: 'bafyedited' })
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
})

async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    client.flushSync()
  }
}

function buttonIn(root: ParentNode, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent?.trim() === text,
  )
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}

/** Opens the edit dialog from the comment's actions menu. */
async function openEditor(comment: CommentView): Promise<HTMLElement> {
  mounted = client.mount(Harness, {
    target,
    intro: false,
    props: { initialComment: comment, postRef },
  })
  client.flushSync()
  const trigger = target.querySelector<HTMLButtonElement>(
    'button[title="Actions"]',
  )
  if (!trigger) throw new Error('Missing comment actions menu trigger')
  trigger.click()
  await vi.waitFor(() => buttonIn(document.body, 'Edit'))
  buttonIn(document.body, 'Edit').click()
  await vi.waitFor(() =>
    expect(document.querySelector('[role="dialog"] textarea')).not.toBeNull(),
  )
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  if (!dialog) throw new Error('Missing edit dialog')
  return dialog
}

function editorTextarea(dialog: HTMLElement): HTMLTextAreaElement {
  const textarea = dialog.querySelector('textarea')
  if (!textarea) throw new Error('The edit dialog has no textarea')
  return textarea
}

/** Each image tile is a list item showing its image. */
function tiles(dialog: HTMLElement): HTMLLIElement[] {
  return [...dialog.querySelectorAll('li')].filter(
    (item) => item.querySelector('img') !== null,
  )
}

/** The tile's visible number: its leaf element whose whole text is digits. */
function tileNumber(tile: Element): string | undefined {
  return [...tile.querySelectorAll('*')]
    .find(
      (element) =>
        element.children.length === 0 &&
        /^\d+$/.test(element.textContent?.trim() ?? ''),
    )
    ?.textContent?.trim()
}

function accessibleName(element: Element): string {
  return (
    element.getAttribute('aria-label') ??
    element.getAttribute('title') ??
    element.textContent ??
    ''
  ).trim()
}

function buttonsNamed(root: ParentNode, name: RegExp): HTMLButtonElement[] {
  return [...root.querySelectorAll('button')].filter((button) =>
    name.test(accessibleName(button)),
  )
}

function buttonNamed(root: ParentNode, name: RegExp): HTMLButtonElement {
  const [button] = buttonsNamed(root, name)
  if (!button) throw new Error(`Unable to find button named ${name}`)
  return button
}

describe('editing a comment with a placed image', () => {
  it('opens the editor with the stored placement as a token and a read-only strip offering only Insert in text', async () => {
    const dialog = await openEditor(placedComment())

    expect(editorTextarea(dialog).value).toBe('Hello\n![A cat](image:1)\nBye')
    const shown = tiles(dialog)
    expect(shown.map(tileNumber)).toEqual(['1', '2'])
    expect(
      shown.map(
        (tile, index) =>
          buttonsNamed(
            tile,
            new RegExp(`^insert in text: image ${index + 1}$`, 'i'),
          ).length,
      ),
    ).toEqual([1, 1])
    expect(buttonsNamed(dialog, /^remove image \d+$/i)).toEqual([])
    expect(buttonsNamed(dialog, /^move image \d+ (earlier|later)$/i)).toEqual(
      [],
    )
    expect(
      dialog.querySelectorAll('input:not([type]), input[type="text"]'),
    ).toHaveLength(0)
    expect(dialog.querySelector('input[type="file"]')).toBeNull()
    expect(
      [...dialog.querySelectorAll('button')].filter(
        (button) => accessibleName(button) === english.form.post.addImages,
      ),
    ).toEqual([])
    expect(dialog.querySelector('[role="status"]')).toBeNull()
  })

  it('inserts image 2’s token at the editor caret', async () => {
    const dialog = await openEditor(placedComment())
    const textarea = editorTextarea(dialog)
    textarea.selectionStart = textarea.value.length
    textarea.selectionEnd = textarea.value.length

    const insert = buttonNamed(dialog, /^insert in text: image 2$/i)
    insert.focus()
    insert.click()
    client.flushSync()

    expect(editorTextarea(dialog).value).toBe(
      'Hello\n![A cat](image:1)\nBye\n![A dog](image:2)',
    )
  })

  it('sends the stored content, placement facet and embed back when saved without changes', async () => {
    const dialog = await openEditor(placedComment())

    buttonIn(dialog, 'Submit').click()
    await settle()

    expect(updateComment).toHaveBeenCalled()
    const input = updateComment.mock.calls[0][0] as UpdateCommentInput
    expect(input.content).toBe('Hello\nA cat\nBye')
    expect(input.facets).toEqual([
      {
        index: { byteStart: 6, byteEnd: 11 },
        features: [{ $type: `${NS}#image`, index: 0 }],
      },
    ])
    expect(input.embed).toEqual(twoImagesRecord)
  })
})

describe('editing a comment with a placement the token cannot express', () => {
  it('drops the placement half-overlapping bold from the editor and shows a notice', async () => {
    // `ab c` (bytes 0..4) is bold; `cd` (bytes 3..5) is placed.
    const dialog = await openEditor(
      ownComment(
        {
          content: 'ab cd',
          facets: [
            {
              index: { byteStart: 0, byteEnd: 4 },
              features: [{ $type: `${NS}#bold` }],
            },
            {
              index: { byteStart: 3, byteEnd: 5 },
              features: [{ $type: `${NS}#image`, index: 0 }],
            },
          ],
          embed: oneImageRecord,
        },
        oneImageView,
      ),
    )

    await vi.waitFor(() =>
      expect(dialog.querySelector('[role="status"]')).not.toBeNull(),
    )
    expect(editorTextarea(dialog).value).not.toContain('](image:')
  })
})

describe('editing a comment whose stored embed is malformed or of an unknown type', () => {
  // The record embed is whatever the AppView indexed; the editor must still
  // open, treating the comment as carrying no images.
  const placedRecord = {
    content: 'Hello\nA cat\nBye',
    facets: [placementFacet],
  }
  const asNetworkEmbed = (embed: unknown) => embed as CommentEmbedRecord

  it.each([
    [
      'an images embed without images',
      asNetworkEmbed({ $type: 'social.coves.embed.images' }),
    ],
    [
      'images with attachment whose inner images is malformed',
      asNetworkEmbed({
        $type: 'social.coves.embed.imagesWithAttachment',
        images: { images: null },
      }),
    ],
    [
      'an unknown embed type',
      asNetworkEmbed({
        $type: 'social.coves.embed.external',
        external: { uri: 'https://example.com' },
      }),
    ],
  ])(
    'opens the editor for %s as a comment with no images',
    async (_label, embed) => {
      const dialog = await openEditor(
        ownComment({ ...placedRecord, embed }, twoImagesView),
      )

      const expected = editorSourceFor(placedRecord, 0)
      expect(editorTextarea(dialog).value).toBe(expected.source)
      expect(editorTextarea(dialog).value).not.toContain('](image:')
      expect(dialog.querySelector('[role="status"]') !== null).toBe(
        expected.droppedPlacements > 0,
      )
    },
  )
})
