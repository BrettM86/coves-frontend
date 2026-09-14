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
    url: new URL('https://coves.test/'),
    state: { marker: 'post-page' } as App.PageState & { marker?: string },
  },
}))
vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  invalidate: vi.fn(),
  replaceState: vi.fn(),
}))
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: { current: { jwt: undefined }, meta: {} },
}))
const getComments = vi.hoisted(() => vi.fn())
vi.mock('$lib/api/client.svelte', () => ({ coves: () => ({ getComments }) }))
vi.mock('$lib/feature/post', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/feature/post')>()),
  Post: (await import('$lib/feature/post/PostNavigation.test.svelte')).default,
}))
// The post body is unrelated; retain real comment controls and pagination.
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

import { goto, replaceState } from '$app/navigation'
import { page } from '$app/state'
import { settings } from '$lib/app/state/settings.svelte'
import { ReactiveState } from '$lib/app/util/reactive.svelte'
import { toasts } from '$lib/ui/kit/toast/toasts'
import { get } from 'svelte/store'
import PostPage from './+page.svelte'
import CommentPage from './comment/[commenter=actor]/[crkey]/+page.svelte'

const postUri = 'at://did:plc:author/social.coves.community.postv2/one'
const postPath = '/c/community.test/post/author.test/one'
const feedOrigin: NonNullable<App.PageState['postFeedOrigin']> = {
  url: '/?sort=top#focused',
  scrollY: 481,
}
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
  record: { title: 'Pagination test' },
} as unknown as PostView
let target: HTMLDivElement
let client: typeof import('svelte')
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

beforeEach(async () => {
  client = await import('svelte')
  window.history.replaceState({}, '', '/')
  page.state = {}
  vi.mocked(goto).mockReset().mockResolvedValue()
  vi.mocked(replaceState).mockReset()
  getComments
    .mockReset()
    .mockResolvedValue({ comments: [], cursor: 'refreshed+/=' })
  settings.defaultSort.comments = 'hot'
  toasts.set([])
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
  toasts.set([])
})

async function mountPage(
  query = '?cursor=old-hot',
  cursor?: string,
  beforeFlush?: () => void,
  afterFlush?: () => void,
) {
  page.url = new URL(
    `${postPath}${query}`,
    'https://coves.test',
  ) as typeof page.url
  const value = new ReactiveState({
    post,
    comments: Promise.resolve({ comments: [], cursor }),
    params: {
      postUri,
      comments: {
        post: postUri,
        sort: 'hot',
        depth: 3,
        limit: 50,
        cursor: 'old-hot',
      },
      thread: {},
    },
  })
  mounted = client.mount(PostPage, {
    target,
    intro: false,
    props: {
      data: { data: value } as unknown as ComponentProps<
        typeof PostPage
      >['data'],
    },
  })
  beforeFlush?.()
  client.flushSync()
  afterFlush?.()
  await vi.waitFor(() => expect(target.querySelector('select')).not.toBeNull())
  return value
}

describe('transient post URI cleanup', () => {
  it('defers removal of a consumed uri and preserves the other query and hash', async () => {
    const query = new URLSearchParams({ uri: postUri, sort: 'top' })
    let callsAfterSynchronousFlush = -1
    await mountPage(`?${query}#comments`, undefined, undefined, () => {
      callsAfterSynchronousFlush = vi.mocked(replaceState).mock.calls.length
    })

    expect(callsAfterSynchronousFlush).toBe(0)
    await vi.waitFor(() => expect(replaceState).toHaveBeenCalledTimes(1))
    expect(replaceState).toHaveBeenCalledWith(
      `${postPath}?sort=top#comments`,
      page.state,
    )
  })

  it('preserves a fragment held only by the browser location', async () => {
    window.history.replaceState({}, '', '#comments')
    const query = new URLSearchParams({ uri: postUri, sort: 'top' })
    await mountPage(`?${query}`)

    await vi.waitFor(() => expect(replaceState).toHaveBeenCalledTimes(1))
    expect(replaceState).toHaveBeenCalledWith(
      `${postPath}?sort=top#comments`,
      page.state,
    )
  })

  it('cancels deferred cleanup when another navigation supersedes the post page', async () => {
    const query = new URLSearchParams({ uri: postUri, sort: 'top' })
    const unrelated = new URL(
      `/explore/communities?uri=${encodeURIComponent(postUri)}#results`,
      'https://coves.test',
    )

    await mountPage(`?${query}#comments`, undefined, undefined, () => {
      page.url = unrelated as typeof page.url
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(replaceState).not.toHaveBeenCalled()
    expect(page.url.href).toBe(unrelated.href)
  })

  it('does not carry the consumed uri into a later comment-sort navigation', async () => {
    const query = new URLSearchParams({ uri: postUri, sort: 'hot' })
    await mountPage(`?${query}`)
    await vi.waitFor(() => expect(replaceState).toHaveBeenCalledTimes(1))

    chooseSort('new')
    await vi.waitFor(() => expect(goto).toHaveBeenCalledTimes(1))
    const destination = new URL(
      String(vi.mocked(goto).mock.calls[0]?.[0]),
      page.url,
    )
    expect(destination.searchParams.get('sort')).toBe('new')
    expect(destination.searchParams.has('uri')).toBe(false)
  })
})

function sortSelect(): HTMLSelectElement {
  const select = target.querySelector('select')
  if (!select) throw new Error('Missing comment sort selector')
  return select
}
function chooseSort(sort: string) {
  sortSelect().value = sort
  sortSelect().dispatchEvent(new Event('change', { bubbles: true }))
  client.flushSync()
}
function backLink(): HTMLAnchorElement {
  const link = [...target.querySelectorAll<HTMLAnchorElement>('a')].find(
    (candidate) => {
      const name =
        candidate.getAttribute('aria-label') ??
        candidate.textContent?.trim() ??
        candidate.getAttribute('title') ??
        ''
      return /^back$/i.test(name)
    },
  )
  if (!link) throw new Error('Missing Back link')
  return link
}
function clickLink(
  link: HTMLAnchorElement,
  init: MouseEventInit = {},
): boolean {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  })
  let preventedByComponent = false
  window.addEventListener(
    'click',
    (arrivingEvent) => {
      preventedByComponent = arrivingEvent.defaultPrevented
      arrivingEvent.preventDefault()
    },
    { once: true },
  )
  link.dispatchEvent(event)
  return preventedByComponent
}
function nextLink(): HTMLAnchorElement | null {
  return target.querySelector('a[title="Next"]')
}
function nextUrl(): URL {
  const href = nextLink()?.getAttribute('href')
  if (!href) throw new Error('Missing Next link')
  return new URL(href, page.url)
}

describe('post comment navigation', () => {
  it.each([
    '?cursor=old-hot&thread=0.focus',
    '?sort=hot&cursor=old-hot&thread=0.focus',
  ])(
    'changing sort starts at page one and preserves thread context from %s',
    async (query) => {
      await mountPage(query, 'next-hot')
      chooseSort('new')
      await vi.waitFor(() => expect(goto).toHaveBeenCalledTimes(1))
      const destination = new URL(
        String(vi.mocked(goto).mock.calls[0][0]),
        page.url,
      )
      expect(destination.pathname).toBe(postPath)
      expect(destination.searchParams.get('sort')).toBe('new')
      expect(destination.searchParams.has('cursor')).toBe(false)
      expect(destination.searchParams.get('thread')).toBe('0.focus')
      expect(getComments).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(settings.defaultSort.comments).toBe('new'))
    },
  )

  it('carries the feed origin through sort navigation so Back survives a remount', async () => {
    page.state = { postFeedOrigin: feedOrigin }
    await mountPage('?sort=hot')
    chooseSort('new')
    await vi.waitFor(() => expect(goto).toHaveBeenCalledTimes(1))

    const [sortDestination, sortOptions] = vi.mocked(goto).mock.calls[0]
    expect.soft(sortOptions?.state).toEqual({ postFeedOrigin: feedOrigin })

    if (mounted) await client.unmount(mounted, { outro: false })
    mounted = undefined
    target.replaceChildren()
    page.state = sortOptions?.state ?? {}
    const sortedUrl = new URL(String(sortDestination), page.url)
    await mountPage(`${sortedUrl.search}${sortedUrl.hash}`)

    vi.mocked(goto).mockClear()
    const back = backLink()
    expect.soft(back.getAttribute('href')).toBe(feedOrigin.url)
    clickLink(back)
    expect(goto).toHaveBeenCalledWith(feedOrigin.url, {
      state: { postFeedOrigin: feedOrigin },
    })
  })

  it('shows the loaded sort even when the saved default differs', async () => {
    settings.defaultSort.comments = 'top'
    await mountPage('?sort=hot&cursor=old-hot')
    expect(sortSelect().value).toBe('hot')
    expect(settings.defaultSort.comments).toBe('top')
  })

  it('restores the selected sort if the navigation API rejects', async () => {
    vi.mocked(goto).mockRejectedValue(new Error('Navigation failed'))
    await mountPage('?sort=hot&cursor=old-hot', 'next-hot')
    chooseSort('new')
    await vi.waitFor(() =>
      expect(get(toasts).some((toast) => toast.type === 'error')).toBe(true),
    )
    expect(sortSelect().value).toBe('hot')
    expect(settings.defaultSort.comments).toBe('hot')
    expect(nextUrl().searchParams.get('cursor')).toBe('next-hot')
  })

  it('refreshes the current comment page without resetting its cursor', async () => {
    await mountPage('?cursor=old-hot', 'next-hot')
    settings.defaultSort.comments = 'top'
    client.flushSync()
    const refresh = target.querySelector('button')
    if (!refresh) throw new Error('Missing refresh button')
    refresh.click()
    await vi.waitFor(() => expect(getComments).toHaveBeenCalledTimes(1))
    expect(getComments).toHaveBeenCalledWith({
      post: postUri,
      sort: 'hot',
      cursor: 'old-hot',
      depth: 3,
      limit: 50,
    })
    expect(goto).not.toHaveBeenCalled()
    await vi.waitFor(() =>
      expect(nextUrl().searchParams.get('cursor')).toBe('refreshed+/='),
    )
  })

  it.each(['?thread=0.focus', '?sort=hot&thread=0.focus'])(
    'Next encodes the cursor and pins the loaded sort while preserving context from %s',
    async (query) => {
      await mountPage(query, 'opaque+/=2')
      const destination = nextUrl()
      expect(destination.searchParams.get('cursor')).toBe('opaque+/=2')
      expect(destination.searchParams.get('sort')).toBe('hot')
      expect(destination.searchParams.get('thread')).toBe('0.focus')
    },
  )

  it('carries the feed origin through Next navigation so Back survives a remount', async () => {
    page.state = { postFeedOrigin: feedOrigin }
    await mountPage('?sort=hot&cursor=old-hot', 'opaque+/=2')
    const next = nextLink()
    if (!next) throw new Error('Missing Next link')
    const expectedNextUrl = nextUrl()

    expect(clickLink(next, { ctrlKey: true })).toBe(false)
    expect(goto).not.toHaveBeenCalled()

    expect.soft(clickLink(next)).toBe(true)
    expect.soft(goto).toHaveBeenCalledTimes(1)
    const nextCall = vi.mocked(goto).mock.calls[0]
    const nextDestination = nextCall?.[0] ?? expectedNextUrl
    const nextOptions = nextCall?.[1]
    expect.soft(nextOptions?.state).toEqual({ postFeedOrigin: feedOrigin })

    if (mounted) await client.unmount(mounted, { outro: false })
    mounted = undefined
    target.replaceChildren()
    page.state = nextOptions?.state ?? {}
    const paginatedUrl = new URL(String(nextDestination), page.url)
    await mountPage(`${paginatedUrl.search}${paginatedUrl.hash}`)

    vi.mocked(goto).mockClear()
    const back = backLink()
    expect.soft(back.getAttribute('href')).toBe(feedOrigin.url)
    clickLink(back)
    expect(goto).toHaveBeenCalledWith(feedOrigin.url, {
      state: { postFeedOrigin: feedOrigin },
    })
  })

  it('offers retry when the streamed comments fail after navigation', async () => {
    const value = await mountPage('?sort=hot&cursor=old-hot')
    const failure = Promise.reject(new Error('Comments unavailable'))
    void failure.catch(() => undefined)
    value.value.comments = failure
    client.flushSync()
    await vi.waitFor(() =>
      expect(target.textContent).toContain('Failed to load comments.'),
    )
    const retry = Array.from(target.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Retry',
    )
    expect(retry).toBeDefined()
    retry?.click()
    await vi.waitFor(() => expect(getComments).toHaveBeenCalledTimes(1))
    expect(getComments).toHaveBeenCalledWith({
      post: postUri,
      sort: 'hot',
      cursor: 'old-hot',
      depth: 3,
      limit: 50,
    })
    await vi.waitFor(() =>
      expect(target.querySelector('select')).not.toBeNull(),
    )
    expect(target.textContent).not.toContain('Failed to load comments.')
    expect(nextUrl().searchParams.get('cursor')).toBe('refreshed+/=')
  })

  it('uses the loaded sort for permalink selection and refresh', async () => {
    settings.defaultSort.comments = 'top'
    page.url = new URL(
      `${postPath}/comment/reader.test/focus`,
      'https://coves.test',
    ) as typeof page.url
    mounted = client.mount(CommentPage, {
      target,
      intro: false,
      props: {
        data: {
          data: new ReactiveState({
            post,
            focused: {
              rkey: 'focus',
              uri: 'at://did:plc:reader/social.coves.community.comment/focus',
            },
            comments: Promise.resolve([]),
            params: {
              postUri,
              comments: {
                post: postUri,
                sort: 'hot',
                parentRkey: 'focus',
                depth: 3,
                limit: 50,
              },
            },
          }),
        } as unknown as ComponentProps<typeof CommentPage>['data'],
      },
    })
    client.flushSync()
    await vi.waitFor(() =>
      expect(target.querySelector('select')).not.toBeNull(),
    )
    expect(sortSelect().value).toBe('hot')
    const refresh = target.querySelector('button')
    if (!refresh) throw new Error('Missing refresh button')
    refresh.click()
    await vi.waitFor(() => expect(getComments).toHaveBeenCalledTimes(1))
    expect(getComments).toHaveBeenCalledWith({
      post: postUri,
      sort: 'hot',
      parentRkey: 'focus',
      depth: 3,
      limit: 50,
    })
    expect(settings.defaultSort.comments).toBe('top')
  })

  it('has no Next link on the terminal page', async () => {
    await mountPage('?sort=hot&cursor=old-hot')
    expect(nextLink()).toBeNull()
  })
})
