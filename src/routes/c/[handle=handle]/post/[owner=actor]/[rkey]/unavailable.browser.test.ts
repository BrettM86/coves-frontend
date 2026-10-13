// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'svelte'
import type { PostView } from '$lib/api/coves/types'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/state', () => ({
  page: {
    url: new URL('https://coves.test/c/community.test/post/author.test/one'),
    state: {},
  },
}))
vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  invalidate: vi.fn(),
  replaceState: vi.fn(),
}))
// A signed-in reader: on a live thread they would get the comment composer.
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: {
    current: { jwt: 'authenticated', did: 'did:plc:reader' },
    meta: {},
    sessionExpired: false,
  },
}))
const getComments = vi.hoisted(() => vi.fn())
const getPosts = vi.hoisted(() => vi.fn())
vi.mock('$lib/api/client.svelte', () => ({
  coves: () => ({ getComments, getPosts }),
}))
vi.mock('$lib/feature/post', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/feature/post')>()),
  Post: (await import('$lib/feature/post/PostNavigation.test.svelte')).default,
}))
async function svelteClientEntry(subpath: string): Promise<unknown> {
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
vi.mock('svelte/transition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte/transition')>()),
  fly: () => ({ duration: 0 }),
}))

import { XrpcError } from '$lib/api/coves/xrpc'
import { log } from '$lib/app/util/log'
import { ReactiveState } from '$lib/app/util/reactive.svelte'
import { toasts } from '$lib/ui/kit/toast/toasts'
import { get } from 'svelte/store'
import PostPage from './+page.svelte'

const postUri = 'at://did:plc:author/social.coves.community.postv2/one'
const post = {
  uri: postUri,
  cid: 'bafytest',
  rkey: 'one',
  author: { did: 'did:plc:author', handle: 'author.test' },
  community: {
    did: 'did:plc:community',
    handle: 'community.test',
    name: 'Community',
  },
  record: { title: 'Removed thread test' },
  stats: { upvotes: 0, downvotes: 0, score: 0, commentCount: 0 },
} as unknown as PostView

let target: HTMLDivElement
let client: typeof import('svelte')
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

beforeEach(async () => {
  client = await import('svelte')
  getComments.mockReset()
  getPosts.mockReset()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
  vi.unstubAllGlobals()
})

function mountPage(value: unknown) {
  mounted = client.mount(PostPage, {
    target,
    intro: false,
    props: {
      data: { data: new ReactiveState(value) } as unknown as ComponentProps<
        typeof PostPage
      >['data'],
    },
  })
  client.flushSync()
}

function backAnchor(): HTMLAnchorElement | undefined {
  return [...target.querySelectorAll<HTMLAnchorElement>('a')].find(
    (anchor) => anchor.getAttribute('aria-label') === 'Back',
  )
}

function buttonsWithText(text: string): HTMLButtonElement[] {
  return [...target.querySelectorAll('button')].filter(
    (button) => button.textContent?.trim() === text,
  )
}

describe('post page with an unavailable thread', () => {
  it('says the comments are unavailable and offers no retry or composer', async () => {
    mountPage({
      post,
      comments: Promise.resolve({ unavailable: true }),
      params: {
        postUri,
        comments: { post: postUri, sort: 'hot', depth: 3, limit: 50 },
        thread: {},
      },
    })

    await vi.waitFor(() =>
      expect(target.textContent).toContain(
        'Comments are unavailable for this post.',
      ),
    )
    expect(buttonsWithText('Retry')).toEqual([])
    expect(buttonsWithText('Add a comment')).toEqual([])
    expect(target.querySelector('textarea')).toBeNull()
    expect(target.textContent).not.toContain('No comments yet')
  })
})

describe('post page for a moderated post', () => {
  it('explains that the server admin removed it', () => {
    mountPage({ unavailable: 'moderated' })

    expect(target.textContent).toContain('Removed by server admin.')
  })
})

describe('post page whose preloaded post turns out removed', () => {
  it('replaces the post with the server-admin tombstone once the comments say so', async () => {
    mountPage({
      post,
      comments: Promise.resolve({
        unavailable: true,
        postUnavailable: 'moderated',
        community: { did: 'did:plc:community', name: 'gardening' },
      }),
      params: {
        postUri,
        comments: { post: postUri, sort: 'hot', depth: 3, limit: 50 },
        thread: {},
      },
    })

    await vi.waitFor(() =>
      expect(target.textContent).toContain('Removed by server admin.'),
    )
    expect(target.textContent).toContain('Posted in gardening')
    // The stale post and its comments section are gone, not shown above it.
    expect(target.querySelector('#comments')).toBeNull()
  })
})

describe('post page with a comment deep link into an unavailable thread', () => {
  beforeEach(() => {
    toasts.set([])
    window.history.replaceState(null, '', '#comment-gone')
  })
  afterEach(() => {
    vi.useRealTimers()
    window.history.replaceState(null, '', window.location.pathname)
    toasts.set([])
  })

  it('does not report the linked comment as missing', async () => {
    vi.useFakeTimers()
    mountPage({
      post,
      comments: Promise.resolve({ unavailable: true }),
      params: {
        postUri,
        comments: { post: postUri, sort: 'hot', depth: 3, limit: 50 },
        thread: {},
      },
    })

    // Past the page's 2000ms budget for the target row to mount.
    await vi.advanceTimersByTimeAsync(2500)

    expect(target.textContent).toContain(
      'Comments are unavailable for this post.',
    )
    expect(get(toasts).map((toast) => toast.content)).toEqual([])
  })
})

describe('post page whose comments retry finds the post removed', () => {
  it('replaces the post with the server-admin tombstone', async () => {
    const failedComments = Promise.reject(
      new XrpcError(503, 'UnknownError', 'XRPC request failed with status 503'),
    )
    failedComments.catch(() => undefined)
    mountPage({
      post,
      comments: failedComments,
      params: {
        postUri,
        comments: { post: postUri, sort: 'hot', depth: 3, limit: 50 },
        thread: {},
      },
    })
    await vi.waitFor(() =>
      expect(target.textContent).toContain('Failed to load comments.'),
    )
    getComments.mockRejectedValue(
      new XrpcError(404, 'RootNotFound', 'Root post not found'),
    )
    getPosts.mockResolvedValue({
      posts: [
        {
          $type: 'social.coves.community.post.defs#moderatedPost',
          uri: postUri,
          moderation: {
            state: 'removed',
            sources: [
              {
                authorityDid: 'did:plc:instance',
                scope: { kind: 'instance' },
              },
            ],
          },
          authorDid: 'did:plc:author',
          community: { did: 'did:plc:community', name: 'gardening' },
        },
      ],
    })

    const [retry] = buttonsWithText('Retry')
    expect(retry).toBeDefined()
    retry?.click()

    await vi.waitFor(() =>
      expect(target.textContent).toContain('Removed by server admin.'),
    )
    // The stale post and its comments section are gone.
    expect(target.querySelector('#comments')).toBeNull()
    expect(target.textContent).not.toContain('Failed to load comments.')
  })
})

describe('post page showing a late tombstone', () => {
  it('still offers Back navigation', async () => {
    mountPage({
      post,
      comments: Promise.resolve({
        unavailable: true,
        postUnavailable: 'moderated',
      }),
      params: {
        postUri,
        comments: { post: postUri, sort: 'hot', depth: 3, limit: 50 },
        thread: {},
      },
    })

    await vi.waitFor(() =>
      expect(target.textContent).toContain('Removed by server admin.'),
    )
    expect(backAnchor()).toBeDefined()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const moderatedPostView = {
  $type: 'social.coves.community.post.defs#moderatedPost',
  uri: postUri,
  moderation: {
    state: 'removed',
    sources: [
      { authorityDid: 'did:plc:instance', scope: { kind: 'instance' } },
    ],
  },
  authorDid: 'did:plc:author',
  community: { did: 'did:plc:community', name: 'gardening' },
}

const pageParams = {
  postUri,
  comments: { post: postUri, sort: 'hot', depth: 3, limit: 50 },
  thread: {},
}

/** Mounts the page on a failed comments load, so Retry calls reloadComments. */
async function mountWithFailedComments(): Promise<void> {
  const failedComments = Promise.reject(
    new XrpcError(503, 'UnknownError', 'XRPC request failed with status 503'),
  )
  failedComments.catch(() => undefined)
  mountPage({ post, comments: failedComments, params: pageParams })
  await vi.waitFor(() =>
    expect(target.textContent).toContain('Failed to load comments.'),
  )
}

function clickRetry(): void {
  const [retry] = buttonsWithText('Retry')
  expect(retry).toBeDefined()
  retry?.click()
}

describe('post page navigated to another post while the first one loads', () => {
  it("ignores the first post's late tombstone", async () => {
    const firstComments = deferred<unknown>()
    const state = new ReactiveState<unknown>({
      post,
      comments: firstComments.promise,
      params: pageParams,
    })
    mounted = client.mount(PostPage, {
      target,
      intro: false,
      props: {
        data: { data: state } as unknown as ComponentProps<
          typeof PostPage
        >['data'],
      },
    })
    client.flushSync()

    const secondUri = 'at://did:plc:author/social.coves.community.postv2/two'
    state.value = {
      post: {
        ...post,
        uri: secondUri,
        rkey: 'two',
        stats: { upvotes: 0, downvotes: 0, score: 0, commentCount: 7 },
      },
      comments: Promise.resolve({ comments: [] }),
      params: { ...pageParams, postUri: secondUri },
    }
    client.flushSync()
    await vi.waitFor(() => expect(target.textContent).toContain('(7)'))

    firstComments.resolve({ unavailable: true, postUnavailable: 'moderated' })
    await firstComments.promise
    await new Promise((resolve) => setTimeout(resolve, 0))
    client.flushSync()

    expect(target.textContent).not.toContain('Removed by server admin.')
    expect(target.querySelector('#comments')).not.toBeNull()
    expect(target.textContent).toContain('(7)')
  })
})

describe('post page with overlapping comment reloads', () => {
  it('keeps the tombstone from a newer reload over an older late success', async () => {
    await mountWithFailedComments()
    const olderReload = deferred<unknown>()
    getComments
      .mockReturnValueOnce(olderReload.promise)
      .mockRejectedValueOnce(
        new XrpcError(404, 'RootNotFound', 'Root post not found'),
      )
    getPosts.mockResolvedValue({ posts: [moderatedPostView] })

    clickRetry()
    clickRetry()
    await vi.waitFor(() =>
      expect(target.textContent).toContain('Removed by server admin.'),
    )

    olderReload.resolve({ comments: [] })
    await olderReload.promise
    await new Promise((resolve) => setTimeout(resolve, 0))
    client.flushSync()

    expect(target.textContent).toContain('Removed by server admin.')
    expect(target.querySelector('#comments')).toBeNull()
  })

  it('keeps a newer successful reload over an older late re-probe', async () => {
    await mountWithFailedComments()
    const reprobe = deferred<unknown>()
    getComments
      .mockRejectedValueOnce(
        new XrpcError(404, 'RootNotFound', 'Root post not found'),
      )
      .mockResolvedValueOnce({ comments: [] })
    getPosts.mockReturnValueOnce(reprobe.promise)

    clickRetry()
    await vi.waitFor(() => expect(getPosts).toHaveBeenCalledTimes(1))
    clickRetry()
    await vi.waitFor(() =>
      expect(target.textContent).toContain('No comments yet'),
    )

    reprobe.resolve({ posts: [moderatedPostView] })
    await reprobe.promise
    await new Promise((resolve) => setTimeout(resolve, 0))
    client.flushSync()

    expect(target.textContent).not.toContain('Removed by server admin.')
    expect(target.textContent).toContain('No comments yet')
  })
})

describe('post page navigated away while a comments reload is in flight', () => {
  beforeEach(() => toasts.set([]))
  afterEach(() => toasts.set([]))

  it("does not toast the first post's reload failure on the second post", async () => {
    const failedComments = Promise.reject(
      new XrpcError(503, 'UnknownError', 'XRPC request failed with status 503'),
    )
    failedComments.catch(() => undefined)
    const state = new ReactiveState<unknown>({
      post,
      comments: failedComments,
      params: pageParams,
    })
    mounted = client.mount(PostPage, {
      target,
      intro: false,
      props: {
        data: { data: state } as unknown as ComponentProps<
          typeof PostPage
        >['data'],
      },
    })
    client.flushSync()
    await vi.waitFor(() =>
      expect(target.textContent).toContain('Failed to load comments.'),
    )
    let rejectReload!: (err: unknown) => void
    getComments.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectReload = reject
      }),
    )
    clickRetry()

    const secondUri = 'at://did:plc:author/social.coves.community.postv2/two'
    state.value = {
      post: { ...post, uri: secondUri, rkey: 'two' },
      comments: Promise.resolve({ comments: [] }),
      params: { ...pageParams, postUri: secondUri },
    }
    client.flushSync()
    await vi.waitFor(() =>
      expect(target.textContent).toContain('No comments yet'),
    )

    rejectReload(
      new XrpcError(503, 'UnknownError', 'XRPC request failed with status 503'),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(get(toasts)).toEqual([])
  })
})

describe('post page whose comments reload finds the thread gone', () => {
  it('logs which not-found error named the thread gone', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    try {
      await mountWithFailedComments()
      getComments.mockRejectedValue(new XrpcError(404, 'NotFound', 'Not found'))
      getPosts.mockResolvedValue({ posts: [moderatedPostView] })

      clickRetry()
      await vi.waitFor(() =>
        expect(target.textContent).toContain('Removed by server admin.'),
      )

      const messages = warn.mock.calls.map(([message]) => String(message))
      expect(messages).toContainEqual(expect.stringContaining('NotFound'))
      expect(messages).toContainEqual(expect.stringContaining(postUri))
      expect(messages).not.toContainEqual(
        expect.stringContaining('RootNotFound'),
      )
    } finally {
      warn.mockRestore()
    }
  })
})
