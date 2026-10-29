// @vitest-environment jsdom
/**
 * Editing a comment down to no text: allowed when the comment carries images
 * (the update keeps them), refused with the existing message otherwise.
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
import { get } from 'svelte/store'
import type {
  AtUri,
  CID,
  CommentRecord,
  CommentView,
  ImagesEmbedRecord,
  ImagesWithAttachmentRecord,
  PostEmbed,
  UpdateCommentInput,
} from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'

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

const imagesRecord: ImagesEmbedRecord = {
  $type: 'social.coves.embed.images',
  images: [
    {
      image: {
        $type: 'blob',
        ref: { $link: 'bafy-kite.jpg' },
        mimeType: 'image/jpeg',
        size: 64,
      },
      alt: 'A kite',
      aspectRatio: { width: 300, height: 200 },
    },
  ],
}
const imagesView: PostEmbed = {
  $type: 'social.coves.embed.images#view',
  images: [
    {
      thumb: 'https://img.coves.test/kite-thumb.jpg',
      fullsize: 'https://img.coves.test/kite-full.jpg',
      alt: 'A kite',
      aspectRatio: { width: 300, height: 200 },
    },
  ],
}

// A comment written by another client: images wrapped together with a quoted
// post, which the backend accepts on comments.
const imagesWithAttachmentRecord: ImagesWithAttachmentRecord = {
  $type: 'social.coves.embed.imagesWithAttachment',
  images: imagesRecord,
  attachment: {
    $type: 'social.coves.embed.post',
    post: {
      uri: 'at://did:plc:author/social.coves.community.post/quoted' as AtUri,
      cid: 'bafyquoted' as CID,
    },
  },
}

function ownComment(
  withImages: boolean,
  recordEmbed: CommentRecord['embed'] = { ...imagesRecord },
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
      content: 'Look at this',
      reply: { root: postRef, parent: postRef },
      createdAt: '2026-09-01T00:00:00Z',
      ...(withImages ? { embed: recordEmbed } : {}),
    },
    stats: { upvotes: 1, downvotes: 0, score: 1, replyCount: 0 },
    ...(withImages ? { embed: imagesView } : {}),
  }
}

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

/** Clears the editor's text and presses the dialog's Submit. */
async function saveWithNoText(dialog: HTMLElement): Promise<void> {
  const textarea = dialog.querySelector('textarea')
  if (!textarea) throw new Error('The edit dialog has no textarea')
  textarea.value = ''
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  client.flushSync()
  buttonIn(dialog, 'Submit').click()
  await settle()
}

describe('saving an edited comment with no text', () => {
  it('saves a comment with images, sending empty content and the original images embed', async () => {
    const dialog = await openEditor(ownComment(true))

    await saveWithNoText(dialog)

    expect(updateComment).toHaveBeenCalledTimes(1)
    const input = updateComment.mock.calls[0][0] as UpdateCommentInput
    expect(input.content).toBe('')
    expect(input.embed).toEqual(imagesRecord)
  })

  it('saves a comment whose images come wrapped with an attachment, keeping that embed', async () => {
    const dialog = await openEditor(
      ownComment(true, imagesWithAttachmentRecord),
    )

    await saveWithNoText(dialog)

    expect(updateComment).toHaveBeenCalledTimes(1)
    const input = updateComment.mock.calls[0][0] as UpdateCommentInput
    expect(input.content).toBe('')
    expect(input.embed).toEqual(imagesWithAttachmentRecord)
  })

  // Guard: passes before this run. The empty-text check it covers is the one
  // this run relaxes for comments with images.
  it('refuses a comment without images with "Comment cannot be empty." and sends nothing', async () => {
    const dialog = await openEditor(ownComment(false))

    await saveWithNoText(dialog)

    expect(updateComment).not.toHaveBeenCalled()
    expect(get(toasts).map((toast) => toast.content)).toContain(
      'Comment cannot be empty.',
    )
  })
})
