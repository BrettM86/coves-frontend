// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'svelte'
import type { PostView } from '$lib/api/coves/types'

interface NavigationOptions {
  state?: App.PageState
}

const navigation = vi.hoisted(() => ({
  goto: vi.fn(
    async (_destination: string | URL, _options?: NavigationOptions) => {},
  ),
  replaceState: vi.fn(),
}))
const page = vi.hoisted(() => ({
  url: new URL('https://coves.test/c/community.test/post/author.test/one'),
  get state(): App.PageState {
    return this.readState()
  },
  set state(value: App.PageState) {
    this.writeState(value)
  },
  readState: () => ({}) as App.PageState,
  writeState: (_value: App.PageState) => {},
}))

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/state', () => ({ page }))
vi.mock('$app/navigation', () => ({
  goto: navigation.goto,
  replaceState: navigation.replaceState,
}))
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: { current: { jwt: undefined }, meta: {}, sessionExpired: false },
}))
vi.mock('$lib/api/client.svelte', () => ({
  coves: () => ({ getComments: vi.fn() }),
}))
vi.mock('$lib/feature/post', async () => ({
  Post: (await import('$lib/feature/post/PostNavigation.test.svelte')).default,
}))
vi.mock('$lib/feature/comment/CommentProvider.svelte', () => ({
  default: () => {},
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

import { ReactiveState } from '$lib/app/util/reactive.svelte'
import PostPage from './+page.svelte'

const ORIGIN: NonNullable<App.PageState['postFeedOrigin']> = {
  url: '/?sort=top#focused',
  scrollY: 481,
}
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
  record: { title: 'Back navigation test' },
} as unknown as PostView

const loaded = () => ({
  post,
  comments: Promise.resolve({ comments: [] }),
  params: {
    postUri,
    comments: { post: postUri, sort: 'hot', depth: 3, limit: 50 },
    thread: {},
  },
})

let client: typeof import('svelte')
let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

beforeEach(async () => {
  client = await import('svelte')
  const { SvelteMap } = await import('svelte/reactivity')
  const state = new SvelteMap<string, App.PageState>([['page', {}]])
  page.readState = () => state.get('page') ?? {}
  page.writeState = (value) => state.set('page', value)
  target = document.createElement('div')
  document.body.appendChild(target)
  page.state = {}
  navigation.goto.mockClear()
  navigation.replaceState.mockClear()
  window.history.replaceState({}, '', '/post-shell')
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
})

async function mountPage(value: unknown): Promise<void> {
  mounted = client.mount(PostPage, {
    target,
    intro: false,
    props: {
      data: {
        data: new ReactiveState(value),
      } as unknown as ComponentProps<typeof PostPage>['data'],
    },
  })
  client.flushSync()
}

function backAnchor(): HTMLAnchorElement | undefined {
  return [...target.querySelectorAll<HTMLAnchorElement>('a')].find((anchor) => {
    const name =
      anchor.getAttribute('aria-label') ||
      anchor.textContent?.trim() ||
      anchor.getAttribute('title') ||
      ''
    return /^back$/i.test(name)
  })
}

function activate(
  anchor: HTMLAnchorElement,
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
  anchor.dispatchEvent(event)
  return preventedByComponent
}

describe('post page Back navigation', () => {
  it.each([
    ['loaded', loaded()],
    ['loading', undefined],
    ['unavailable', { unavailable: 'not_found' }],
  ])('renders an accessible Back anchor while %s', async (_state, value) => {
    await mountPage(value)
    expect(backAnchor()).toBeDefined()
  })

  it('returns directly to the feed with a one-use restoration request', async () => {
    page.state = { postFeedOrigin: ORIGIN }
    window.history.pushState({}, '', '/post-shell?sort=top')
    window.history.pushState({}, '', '/post-shell?sort=new#comments')
    const historyBack = vi.spyOn(window.history, 'back')
    await mountPage(loaded())

    const back = backAnchor()
    expect(back).toBeDefined()
    if (!back) return

    expect(activate(back)).toBe(true)
    expect(historyBack).not.toHaveBeenCalled()
    expect(navigation.goto).toHaveBeenCalledWith(ORIGIN.url, {
      state: { postFeedOrigin: ORIGIN },
    })
  })

  it('retains its feed origin when later same-post navigation clears page state', async () => {
    page.state = { postFeedOrigin: ORIGIN }
    await mountPage(loaded())
    const back = backAnchor()
    expect(back).toBeDefined()
    if (!back) return
    expect(back.getAttribute('href')).toBe(ORIGIN.url)

    page.state = {}
    client.flushSync()

    expect(back.getAttribute('href')).toBe(ORIGIN.url)
    expect(activate(back)).toBe(true)
    expect(navigation.goto).toHaveBeenCalledWith(ORIGIN.url, {
      state: { postFeedOrigin: ORIGIN },
    })
  })

  it('keeps modified origin clicks native', async () => {
    page.state = { postFeedOrigin: ORIGIN }
    await mountPage(loaded())
    const back = backAnchor()
    expect(back).toBeDefined()
    if (!back) return

    for (const modifier of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      navigation.goto.mockClear()
      expect(activate(back, modifier)).toBe(false)
      expect(navigation.goto).not.toHaveBeenCalled()
    }
  })

  it('uses a native root fallback without origin state', async () => {
    await mountPage(loaded())
    const back = backAnchor()
    expect(back).toBeDefined()
    if (!back) return

    expect(back.getAttribute('href')).toBe('/')
    expect(activate(back)).toBe(false)
    expect(navigation.goto).not.toHaveBeenCalled()
  })
})
