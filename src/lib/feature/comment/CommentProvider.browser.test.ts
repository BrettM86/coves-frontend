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
  PostView,
  ThreadViewComment,
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
  page: { url: new URL('http://localhost/post/one'), route: { id: '/post' } },
}))
vi.mock('$app/navigation', () => ({ goto: vi.fn() }))
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
}))

const { createComment, profile } = vi.hoisted(() => ({
  createComment: vi.fn(),
  profile: {
    current: {
      type: 'authenticated',
      jwt: 'test-session',
      did: 'did:plc:alice',
      handle: 'alice.test',
      instance: 'http://localhost:8081',
    },
  },
}))
vi.mock('$lib/api/client.svelte', () => ({ coves: () => ({ createComment }) }))
vi.mock('$lib/app/state/auth.svelte', () => ({ profile }))

const postRef = {
  uri: 'at://did:plc:author/social.coves.community.post/one' as AtUri,
  cid: 'bafypost' as CID,
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
function commentFixture(
  key: string,
  content: string,
  parent = postRef,
): ThreadViewComment {
  return {
    comment: {
      uri: `at://did:plc:alice/social.coves.community.comment/${key}` as AtUri,
      cid: `bafy${key}` as CID,
      createdAt: '2026-09-01T00:00:00Z',
      indexedAt: '2026-09-01T00:00:00Z',
      author: { did: 'did:plc:alice' as DID, handle: 'alice.test' as Handle },
      post: postRef,
      parent,
      record: {
        $type: 'social.coves.community.comment',
        content,
        reply: { root: postRef, parent },
        createdAt: '2026-09-01T00:00:00Z',
      },
      stats: { upvotes: 0, downvotes: 0, score: 0, replyCount: 0 },
    },
    replies: [],
  }
}

let target: HTMLDivElement
let client: typeof import('svelte')
let Harness: typeof import('./CommentProvider.test-harness.svelte').default
let mounted:
  | {
      refresh: (comments: ThreadViewComment[]) => void
      navigate: (post: PostView) => void
    }
  | undefined

beforeAll(async () => {
  Harness = (await import('./CommentProvider.test-harness.svelte')).default
}, 30_000)

beforeEach(async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  createComment.mockReset()
  profile.current.type = 'authenticated'
  profile.current.jwt = 'test-session'
  client = await import('svelte')
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
  vi.unstubAllGlobals()
})

async function mountProvider() {
  mounted = client.mount(Harness, {
    target,
    intro: false,
    props: {
      initialPost: postFixture(),
      initialComments: [commentFixture('parent', 'Existing comment')],
    },
  })
  client.flushSync()
  return mounted
}
function button(text: string): HTMLButtonElement {
  const result = [...target.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === text,
  )
  if (!result) throw new Error(`Missing button: ${text}`)
  return result
}
function compose(content: string) {
  const textarea = target.querySelector('textarea')
  const form = target.querySelector('form')
  if (!textarea || !form) throw new Error('Missing comment form')
  textarea.value = content
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  client.flushSync()
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}
function count() {
  return target.querySelector('output[aria-label="Comment count"]')?.textContent
}

describe('created comment feedback', () => {
  it('keeps a successful in-flight reply when refreshed comments omit its parent', async () => {
    const provider = await mountProvider()
    let finish: ((output: { uri: AtUri; cid: CID }) => void) | undefined
    createComment.mockReturnValue(
      new Promise<{ uri: AtUri; cid: CID }>((resolve) => {
        finish = resolve
      }),
    )
    button('Reply').click()
    client.flushSync()
    compose('Saved during refresh')
    await vi.waitFor(() => expect(createComment).toHaveBeenCalledTimes(1))
    provider.refresh([])
    client.flushSync()
    if (!finish) throw new Error('Missing create completion')
    finish(
      commentFixture(
        'during-refresh',
        'Saved during refresh',
        commentFixture('parent', 'Existing comment').comment,
      ).comment,
    )
    await client.tick()
    await client.tick()
    client.flushSync()
    expect(
      target.querySelector('#comment-during-refresh')?.textContent ?? '',
    ).toContain('Saved during refresh')
    expect(count()).toBe('2')
  })

  it('preserves newest-first order across repeated stale refreshes', async () => {
    const provider = await mountProvider()
    button('Add a comment').click()
    client.flushSync()
    for (const key of ['first-created', 'second-created']) {
      createComment.mockResolvedValue(commentFixture(key, key).comment)
      compose(key)
      await vi.waitFor(() =>
        expect(target.querySelector('textarea')?.value).toBe(''),
      )
    }
    const order = () =>
      [...target.querySelectorAll('li[id^="comment-"]')].map(
        (element) => element.id,
      )
    expect(order()).toEqual([
      'comment-second-created',
      'comment-first-created',
      'comment-parent',
    ])
    for (let refresh = 0; refresh < 2; refresh++) {
      provider.refresh([commentFixture('parent', 'Existing comment')])
      client.flushSync()
      expect(order()).toEqual([
        'comment-second-created',
        'comment-first-created',
        'comment-parent',
      ])
    }
  })

  it.each(['root', 'reply'])(
    'keeps an in-flight %s create associated with its original post after navigation',
    async (kind) => {
      const provider = await mountProvider()
      let finish: ((output: { uri: AtUri; cid: CID }) => void) | undefined
      createComment.mockReturnValue(
        new Promise<{ uri: AtUri; cid: CID }>((resolve) => {
          finish = resolve
        }),
      )
      button(kind === 'root' ? 'Add a comment' : 'Reply').click()
      client.flushSync()
      compose('Comment on original post')
      await vi.waitFor(() => expect(createComment).toHaveBeenCalledTimes(1))
      provider.navigate({
        ...postFixture(),
        uri: 'at://did:plc:author/social.coves.community.post/two' as AtUri,
        rkey: 'two',
        stats: { upvotes: 0, downvotes: 0, score: 0, commentCount: 0 },
      })
      client.flushSync()
      if (!finish) throw new Error('Missing create completion')
      finish(
        commentFixture('original-post-comment', 'Comment on original post')
          .comment,
      )
      await client.tick()
      await client.tick()
      client.flushSync()
      expect(count()).toBe('0')
      expect(target.querySelector('#comment-original-post-comment')).toBeNull()
    },
  )

  it('creates only one comment when the form submits again before the request completes', async () => {
    await mountProvider()
    let finish: ((output: { uri: AtUri; cid: CID }) => void) | undefined
    createComment.mockReturnValue(
      new Promise<{ uri: AtUri; cid: CID }>((resolve) => {
        finish = resolve
      }),
    )
    button('Add a comment').click()
    client.flushSync()
    compose('Single comment')
    const form = target.querySelector('form')
    if (!form) throw new Error('Missing comment form')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(createComment).toHaveBeenCalledTimes(1))
    if (!finish) throw new Error('Missing create completion')
    finish(commentFixture('single-comment', 'Single comment').comment)
    await vi.waitFor(() =>
      expect(target.querySelector('textarea')?.value).toBe(''),
    )
    expect(target.querySelectorAll('#comment-single-comment')).toHaveLength(1)
    expect(count()).toBe('2')
  })

  it('keeps a root comment after clearing the draft and refreshing a lagging server tree', async () => {
    const provider = await mountProvider()
    createComment.mockResolvedValue(
      commentFixture('new-root', 'Saved root').comment,
    )
    button('Add a comment').click()
    client.flushSync()
    compose('Saved root')
    await vi.waitFor(() =>
      expect(target.querySelector('textarea')?.value).toBe(''),
    )
    expect(target.querySelector('#comment-new-root')?.textContent).toContain(
      'Saved root',
    )
    provider.refresh([commentFixture('parent', 'Existing comment')])
    client.flushSync()
    expect(target.querySelector('#comment-new-root')?.textContent).toContain(
      'Saved root',
    )
  })

  it('updates the displayed post comment count immediately after a root comment succeeds', async () => {
    await mountProvider()
    createComment.mockResolvedValue(
      commentFixture('new-root', 'Saved root').comment,
    )
    button('Add a comment').click()
    client.flushSync()
    compose('Saved root')
    await vi.waitFor(() =>
      expect(target.querySelector('textarea')?.value).toBe(''),
    )
    expect(count()).toBe('2')
  })

  it('keeps a nested reply on stale refresh and reconciles the indexed reply without duplicates', async () => {
    const provider = await mountProvider()
    const parent = commentFixture('parent', 'Existing comment')
    const reply = commentFixture('new-reply', 'Saved reply', parent.comment)
    createComment.mockResolvedValue(reply.comment)
    button('Reply').click()
    client.flushSync()
    compose('Saved reply')
    await vi.waitFor(() =>
      expect(target.querySelector('#comment-new-reply')).not.toBeNull(),
    )
    provider.refresh([commentFixture('parent', 'Existing comment')])
    client.flushSync()
    expect(
      target.querySelector('#comment-parent #comment-new-reply')?.textContent,
    ).toContain('Saved reply')
    provider.refresh([{ ...parent, replies: [reply] }])
    client.flushSync()
    expect(target.querySelectorAll('#comment-new-reply')).toHaveLength(1)
    expect(count()).toBe('2')
  })

  it('updates the displayed post comment count immediately after a nested reply succeeds', async () => {
    await mountProvider()
    createComment.mockResolvedValue(
      commentFixture(
        'new-reply',
        'Saved reply',
        commentFixture('parent', 'Existing comment').comment,
      ).comment,
    )
    button('Reply').click()
    client.flushSync()
    compose('Saved reply')
    await vi.waitFor(() =>
      expect(target.querySelector('#comment-new-reply')).not.toBeNull(),
    )
    expect(count()).toBe('2')
  })

  it('preserves a successful reply when the session expires while the request is pending', async () => {
    await mountProvider()
    let finish: ((output: { uri: AtUri; cid: CID }) => void) | undefined
    createComment.mockReturnValue(
      new Promise<{ uri: AtUri; cid: CID }>((resolve) => {
        finish = resolve
      }),
    )
    button('Reply').click()
    client.flushSync()
    compose('Saved before expiry')
    await vi.waitFor(() => expect(createComment).toHaveBeenCalledTimes(1))
    profile.current.type = 'anonymous'
    profile.current.jwt = ''
    if (!finish) throw new Error('Missing create completion')
    finish(
      commentFixture(
        'after-expiry',
        'Saved before expiry',
        commentFixture('parent', 'Existing comment').comment,
      ).comment,
    )
    await vi.waitFor(() =>
      expect(
        target.querySelector('#comment-after-expiry')?.textContent,
      ).toContain('Saved before expiry'),
    )
    expect(count()).toBe('2')
  })
})
