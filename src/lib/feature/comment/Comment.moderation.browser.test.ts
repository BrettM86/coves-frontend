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
  CommentView,
  ModerationSourceView,
} from '$lib/api/coves/types'
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
// A signed-in reader: on a live comment they would see Reply and the votes.
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

const authorDid = 'did:plc:removedauthor' as DID
const postRef = {
  uri: 'at://did:plc:author/social.coves.community.post/one' as AtUri,
  cid: 'bafypost' as CID,
}

const instanceSource: ModerationSourceView = {
  authorityDid: 'did:plc:instance' as DID,
  scope: { kind: 'instance' },
}

/**
 * A wire tombstone as getComments serves it: record null and the author
 * reduced to its DID with the unresolvable handle.
 */
function tombstone(overrides: Partial<CommentView>): CommentView {
  return {
    uri: `at://${authorDid}/social.coves.community.comment/gone` as AtUri,
    cid: 'bafygone' as CID,
    createdAt: '2026-09-01T00:00:00Z',
    indexedAt: '2026-09-01T00:00:00Z',
    author: { did: authorDid, handle: 'handle.invalid' as Handle },
    post: postRef,
    parent: postRef,
    record: null,
    isDeleted: true,
    deletedAt: '2026-09-02T00:00:00Z',
    stats: { upvotes: 3, downvotes: 0, score: 3, replyCount: 0 },
    ...overrides,
  }
}

const removedByAdmin = (): CommentView =>
  tombstone({
    deletionReason: 'moderator',
    moderation: { state: 'removed', sources: [instanceSource] },
  })
const deletedByAuthor = (): CommentView =>
  tombstone({ deletionReason: 'author' })

let target: HTMLDivElement
let client: typeof import('svelte')
let Comment: typeof import('./Comment.svelte').default
let buildCommentsTree: typeof import('./comments.svelte').buildCommentsTree
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

beforeAll(async () => {
  Comment = (await import('./Comment.svelte')).default
  buildCommentsTree = (await import('./comments.svelte')).buildCommentsTree
}, 30_000)

beforeEach(async () => {
  client = await import('svelte')
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
})

function mountComment(comment: CommentView) {
  const [node] = buildCommentsTree([{ comment, replies: [] }])
  if (!node) throw new Error('Missing comment node')
  mounted = client.mount(Comment, {
    target,
    intro: false,
    props: { node, postRef },
  })
  client.flushSync()
}

function buttonsLabelled(name: string): HTMLButtonElement[] {
  return [...target.querySelectorAll('button')].filter(
    (button) =>
      button.getAttribute('aria-label') === name ||
      button.textContent?.trim() === name,
  )
}

function authorLinks(): HTMLAnchorElement[] {
  return [...target.querySelectorAll('a')].filter((link) => {
    const href = link.getAttribute('href') ?? ''
    return (
      href.includes(authorDid) ||
      href.includes('handle.invalid') ||
      href.startsWith('/profile')
    )
  })
}

describe('removed comment', () => {
  it('shows the admin placeholder with no author identity, votes or Reply', () => {
    mountComment(removedByAdmin())

    expect(target.textContent).toContain('[Removed by server admin]')
    expect(target.textContent).not.toContain('handle.invalid')
    expect(authorLinks()).toEqual([])
    expect(buttonsLabelled('Upvote')).toEqual([])
    expect(buttonsLabelled('Downvote')).toEqual([])
    expect(buttonsLabelled('Reply')).toEqual([])
    expect(target.querySelectorAll('[aria-label="Removed"]')).toHaveLength(1)
  })
})

describe('author-deleted comment', () => {
  it('shows the deleted placeholder with no author identity, votes or Reply', () => {
    mountComment(deletedByAuthor())

    expect(target.textContent).toContain('[Deleted by user]')
    expect(target.textContent).not.toContain('handle.invalid')
    expect(authorLinks()).toEqual([])
    expect(buttonsLabelled('Upvote')).toEqual([])
    expect(buttonsLabelled('Downvote')).toEqual([])
    expect(buttonsLabelled('Reply')).toEqual([])
  })

  it('carries no Removed badge', () => {
    mountComment(deletedByAuthor())

    expect(target.querySelectorAll('[aria-label="Removed"]')).toHaveLength(0)
  })
})

describe('comment removed while its reply composer is open', () => {
  it('closes the composer once the comment becomes a placeholder', async () => {
    const Harness = (await import('./Comment.test-harness.svelte')).default
    const live = tombstone({
      author: { did: authorDid, handle: 'author.test' as Handle },
      record: {
        $type: 'social.coves.community.comment',
        content: 'A live reply target',
        reply: { root: postRef, parent: postRef },
        createdAt: '2026-09-01T00:00:00Z',
      },
      isDeleted: false,
      deletedAt: undefined,
    })
    const harness = client.mount(Harness, {
      target,
      intro: false,
      props: { initialComment: live, postRef, initiallyReplying: true },
    })
    mounted = harness
    client.flushSync()
    // Precondition: the reply composer is open on the live comment.
    expect(target.querySelector('textarea')).not.toBeNull()

    harness.replaceComment(removedByAdmin())
    client.flushSync()

    expect(target.textContent).toContain('[Removed by server admin]')
    expect(target.querySelector('textarea')).toBeNull()
  })
})
