// @vitest-environment jsdom
/**
 * Client render of the Likes tab's mixed list. A liked post and liked
 * comments under that same post share a root post URI, so each row must be
 * keyed by its own record; likes.render.test.ts cannot see key collisions
 * because the server render does not key rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'svelte'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.test' },
}))
const page = vi.hoisted(() => ({
  url: new URL('https://coves.test/profile/alice.coves.test?type=likes'),
  state: {} as App.PageState,
}))
vi.mock('$app/state', () => ({ page }))
const navigation = vi.hoisted(() => ({
  goto: vi.fn(
    async (
      _destination: string | URL,
      _options?: { state?: App.PageState },
    ) => {},
  ),
  replaceState: vi.fn(),
}))
vi.mock('$app/navigation', () => ({
  goto: navigation.goto,
  invalidateAll: vi.fn().mockResolvedValue(undefined),
  pushState: vi.fn(),
  replaceState: navigation.replaceState,
}))
const profile = vi.hoisted(() => ({
  isAuthenticated: true,
  meta: { profile: 'alice' },
  current: {
    type: 'authenticated',
    did: 'did:plc:alice',
    handle: 'alice.coves.test',
    jwt: 'authenticated',
    instance: 'https://coves.test',
  },
}))
vi.mock('$lib/app/state/auth.svelte', () => ({ profile }))
vi.mock('$lib/app/state/i18n', () => {
  const translate = (key: string) => key
  return {
    t: {
      get: translate,
      subscribe: (run: (translator: typeof translate) => void) => {
        run(translate)
        return () => {}
      },
    },
    locale: {
      set: () => {},
      subscribe: (run: (locale: string) => void) => {
        run('en')
        return () => {}
      },
    },
  }
})
const { createComment } = vi.hoisted(() => ({ createComment: vi.fn() }))
vi.mock('$lib/api/client.svelte', () => ({ coves: () => ({ createComment }) }))
vi.mock('svelte/transition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte/transition')>()),
  fade: () => ({ duration: 0 }),
  fly: () => ({ duration: 0 }),
  scale: () => ({ duration: 0 }),
  slide: () => ({ duration: 0 }),
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
vi.stubGlobal('__VERSION__', 'test')

const rootPost = {
  uri: 'at://did:plc:carol/social.coves.community.post/root1',
  cid: 'bafyreiroot1',
  rkey: 'root1',
  author: { did: 'did:plc:carol', handle: 'carol.coves.test' },
  community: { did: 'did:plc:sci', name: 'science' },
  record: {
    $type: 'social.coves.community.post',
    title: 'Root post P',
    createdAt: '2026-01-02T00:00:00.000Z',
  },
  createdAt: '2026-01-02T00:00:00.000Z',
  indexedAt: '2026-01-02T00:00:00.000Z',
  stats: { upvotes: 1, downvotes: 0, score: 1, commentCount: 2 },
}

/** A comment by Dave, liked by Alice, under the root post. */
function likedComment(rkey: string) {
  return {
    $type: 'social.coves.actor.getLikes#likedComment',
    comment: {
      uri: `at://did:plc:dave/social.coves.community.comment/${rkey}`,
      cid: `bafyrei${rkey}`,
      createdAt: '2026-01-03T00:00:00.000Z',
      indexedAt: '2026-01-03T00:00:00.000Z',
      author: { did: 'did:plc:dave', handle: 'dave.coves.test' },
      post: { uri: rootPost.uri, cid: rootPost.cid },
      record: { content: `comment body ${rkey}` },
      stats: { upvotes: 1, downvotes: 0, score: 1, replyCount: 0 },
    },
    post: rootPost,
  }
}

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')

beforeEach(async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  client = await import('svelte')
  page.state = {}
  createComment.mockReset()
  navigation.goto.mockClear()
  navigation.replaceState.mockClear()
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('LikedFeed', () => {
  it('renders a liked post and two liked comments under that post', async () => {
    const { default: LikedFeed } = await import('./LikedFeed.svelte')
    mounted = client.mount(LikedFeed, {
      target,
      props: {
        items: [
          { $type: 'social.coves.actor.getLikes#likedPost', post: rootPost },
          likedComment('commentA'),
          likedComment('commentB'),
        ],
      } as unknown as ComponentProps<typeof LikedFeed>,
    })
    client.flushSync()

    const rows = [...target.querySelectorAll('ul > li')]
    expect(
      rows.map((row) =>
        row.getAttribute('data-post-uri') !== null
          ? row.getAttribute('data-post-uri')
          : row.textContent?.match(/comment body \w+/)?.[0],
      ),
    ).toEqual([
      'at://did:plc:carol/social.coves.community.post/root1',
      'comment body commentA',
      'comment body commentB',
    ])
    expect(rows[0].textContent).toContain('Root post P')
  })

  // Post rows are PostFeed rows: a post permalink click navigates with the
  // Likes page as the return origin, and coming back with that captured
  // origin re-aligns the clicked link, then consumes the origin.
  it('navigates from a liked post with the likes origin and restores it on return', async () => {
    const { default: LikedFeed } = await import('./LikedFeed.svelte')
    const postHref = '/c/did%3Aplc%3Asci/post/carol.coves.test/root1'
    // The clicked link's top in document coordinates; content above it
    // grows by 160px while the reader is away.
    let linkDocumentTop = 600
    let scrollY = 481
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => scrollY,
    })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: Element) {
        const top =
          this.getAttribute('href') === postHref ? linkDocumentTop - scrollY : 0
        return {
          x: 0,
          y: top,
          top,
          right: 300,
          bottom: top + 24,
          left: 0,
          width: 300,
          height: 24,
          toJSON: () => ({}),
        }
      },
    )
    // The liked comment comes last, so restoration must search the whole
    // list for the clicked post link.
    const props = {
      items: [
        { $type: 'social.coves.actor.getLikes#likedPost', post: rootPost },
        likedComment('commentA'),
      ],
    } as unknown as ComponentProps<typeof LikedFeed>
    mounted = client.mount(LikedFeed, { target, props })
    client.flushSync()

    const titleLink = target.querySelector<HTMLAnchorElement>(
      `[data-post-uri] a[href="${postHref}"]`,
    )
    if (!titleLink) throw new Error('Missing liked post permalink')
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    titleLink.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(navigation.goto).toHaveBeenCalledTimes(1)
    const [destination, options] = navigation.goto.mock.calls[0]
    expect(destination).toBe(postHref)
    expect(options?.state?.postFeedOrigin).toEqual({
      url: '/profile/alice.coves.test?type=likes',
      scrollY: 481,
      anchor: { postUri: rootPost.uri, href: postHref, viewportTop: 119 },
    })

    await client.unmount(mounted, { outro: false })
    mounted = undefined
    target.replaceChildren()

    scrollY = 0
    linkDocumentTop = 760
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      scrollY = options.top ?? scrollY
    })
    vi.stubGlobal('scrollTo', scrollTo)
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    )
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const runFrame = (timestamp: number) =>
      frames.splice(0).forEach((callback) => callback(timestamp))
    page.state = options?.state ?? {}
    mounted = client.mount(LikedFeed, { target, props })
    client.flushSync()

    runFrame(16)
    expect(scrollY).toBe(641)
    expect(
      target
        .querySelector(`[data-post-uri] a[href="${postHref}"]`)
        ?.getBoundingClientRect().top,
    ).toBe(119)
    expect(navigation.replaceState).not.toHaveBeenCalled()

    // Consumed once the link has held its place past the stable interval.
    runFrame(32)
    expect(navigation.replaceState).not.toHaveBeenCalled()
    runFrame(200)
    expect(scrollY).toBe(641)
    expect(navigation.replaceState).toHaveBeenCalledTimes(1)
    expect(navigation.replaceState).toHaveBeenCalledWith(
      '/profile/alice.coves.test?type=likes',
      {},
    )
  })

  // A deleted comment's share URL would name its author, by handle or by the
  // DID in its URI, so its menu offers no Share; a live row's menu still does.
  it('offers Share on a live liked comment but not on a deleted one', async () => {
    const { default: LikedFeed } = await import('./LikedFeed.svelte')
    const deleted = likedComment('commentGone')
    mounted = client.mount(LikedFeed, {
      target,
      props: {
        items: [
          {
            ...deleted,
            comment: {
              ...deleted.comment,
              isDeleted: true,
              record: { content: '' },
            },
          },
          likedComment('commentLive'),
        ],
      } as unknown as ComponentProps<typeof LikedFeed>,
    })
    client.flushSync()

    menuTrigger('comment-commentGone').click()
    await vi.waitFor(() =>
      expect(menuItemTexts()).toContain('moderation.report'),
    )
    expect(menuItemTexts()).not.toContain('post.actions.more.share')

    menuTrigger('comment-commentLive').click()
    await vi.waitFor(() =>
      expect(menuItemTexts()).toContain('post.actions.more.share'),
    )
  })

  it('shows a reply created on a liked comment under that comment', async () => {
    const { default: LikedFeed } = await import('./LikedFeed.svelte')
    createComment.mockResolvedValue({
      uri: 'at://did:plc:alice/social.coves.community.comment/reply1',
      cid: 'bafyreireply1',
    })
    mounted = client.mount(LikedFeed, {
      target,
      props: {
        items: [likedComment('commentA')],
      } as unknown as ComponentProps<typeof LikedFeed>,
    })
    client.flushSync()

    const row = target.querySelector('#comment-commentA')
    if (!row) throw new Error('Missing liked comment row')
    const reply = [...row.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'comment.reply',
    )
    if (!reply) throw new Error('Missing Reply button')
    reply.click()
    client.flushSync()
    const textarea = row.querySelector('textarea')
    const form = row.querySelector('form')
    if (!textarea || !form) throw new Error('Missing reply form')
    textarea.value = 'A reply from Alice'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    client.flushSync()
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    await vi.waitFor(() => expect(createComment).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => {
      const shown = renderedTextElement('A reply from Alice')
      expect(shown).toBeDefined()
      expect(
        row.compareDocumentPosition(shown as Element) &
          (Node.DOCUMENT_POSITION_CONTAINED_BY |
            Node.DOCUMENT_POSITION_FOLLOWING),
      ).not.toBe(0)
    })
  })
})

function menuTrigger(rowId: string): HTMLButtonElement {
  const found = target.querySelector<HTMLButtonElement>(
    `#${rowId} button[title="comment.actions.label"]`,
  )
  if (!found) throw new Error(`Missing actions menu trigger in ${rowId}`)
  return found
}

/** The texts of every open comment actions menu's items. */
function menuItemTexts(): string[] {
  return [
    ...document.body.querySelectorAll<HTMLButtonElement>(
      '.portal-mount button',
    ),
  ].map((element) => element.textContent?.trim() ?? '')
}

/** An element outside any form whose own text holds `text`. */
function renderedTextElement(text: string): Element | undefined {
  return [...target.querySelectorAll('*')].find(
    (element) =>
      !element.closest('form') &&
      [...element.childNodes].some(
        (child) =>
          child.nodeType === Node.TEXT_NODE &&
          child.textContent?.includes(text),
      ),
  )
}
