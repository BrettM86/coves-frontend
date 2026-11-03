// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AtUri, CID, PostView } from '$lib/api/coves/types'
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
    url: new URL('http://localhost/c/community.test'),
  },
}))
vi.mock('$app/navigation', () => ({
  goto: vi.fn().mockResolvedValue(undefined),
  invalidateAll: vi.fn().mockResolvedValue(undefined),
  pushState: vi.fn(),
  replaceState: vi.fn(),
}))
const auth = vi.hoisted(() => ({
  profile: {
    isAuthenticated: false,
    meta: { profile: 'guest' },
    current: undefined as
      { type: string; did: string; handle: string; jwt: string } | undefined,
  },
}))
vi.mock('$lib/app/state/auth.svelte', () => auth)
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
      subscribe: (run: (value: string) => void) => {
        run('en')
        return () => {}
      },
    },
  }
})
vi.mock('$lib/api/client.svelte', () => ({
  coves: () => ({ createVote: vi.fn(), deleteVote: vi.fn() }),
}))
const svelteClientEntry = async (subpath: string): Promise<unknown> => {
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

let target: HTMLDivElement | undefined
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')
let PostActions: (typeof import('./PostActions.svelte'))['default']

beforeAll(async () => {
  client = await import('svelte')
  PostActions = (await import('./PostActions.svelte')).default
}, 60_000)

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target?.remove()
  target = undefined
})

const post = (): PostView => ({
  rkey: 'one',
  uri: 'at://did:plc:author/social.coves.community.post/one' as AtUri,
  cid: 'bafypost' as CID,
  author: { did: 'did:plc:author' as DID, handle: 'author.test' as Handle },
  community: {
    did: 'did:plc:community' as DID,
    handle: 'community.test' as Handle,
    name: 'Community',
  },
  indexedAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
  stats: { upvotes: 40, downvotes: 4, score: 36, commentCount: 4 },
  viewer: { saved: false },
  record: {
    $type: 'social.coves.community.post',
    author: 'did:plc:author' as DID,
    community: 'did:plc:community' as DID,
    title: 'A post',
    createdAt: '2026-09-01T00:00:00Z',
  },
})

const isVisible = (element: Element): boolean => {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false
  if (!(element instanceof HTMLElement)) return true
  return (
    element.style.display !== 'none' && element.style.visibility !== 'hidden'
  )
}

const accessibleName = (element: Element): string =>
  element.getAttribute('aria-label') ?? element.getAttribute('title') ?? ''

/**
 * The outermost ancestor of `control` (inside `root`) that holds none of
 * `others` — the group that control sits in.
 */
function groupOf(control: Element, others: Element[], root: Element): Element {
  let group = control
  while (
    group.parentElement &&
    group.parentElement !== root &&
    !others.some((other) => group.parentElement?.contains(other))
  )
    group = group.parentElement
  return group
}

describe('PostActions feed mode', () => {
  it.each([
    {
      who: 'guest',
      current: undefined,
      expected: [
        'post.actions.vote.upvote',
        'post.actions.vote.downvote',
        'post.actions.comments',
        'post.actions.more.share',
      ],
    },
    {
      who: 'signed-in',
      current: {
        type: 'authenticated',
        did: 'did:plc:viewer',
        handle: 'viewer.test',
        jwt: 'authenticated',
      },
      expected: [
        'post.actions.vote.upvote',
        'post.actions.vote.downvote',
        'post.actions.comments',
        'post.actions.more.share',
        'post.actions.more.label',
      ],
    },
  ])(
    '$who: renders $expected with upvote and downvote in one group',
    ({ current, expected }) => {
      auth.profile.current = current
      auth.profile.isAuthenticated = current !== undefined
      Object.assign(Element.prototype, {
        animate: () => ({
          cancel: () => {},
          finish: () => {},
          play: () => {},
          pause: () => {},
          onfinish: null,
          effect: { getComputedTiming: () => ({ duration: 0 }) },
        }),
        getAnimations: () => [],
      })

      target = document.createElement('div')
      document.body.appendChild(target)
      mounted = client.mount(PostActions, {
        target,
        props: { post: post(), view: 'cozy', feed: true },
        intro: false,
      })
      client.flushSync()

      const bar = target.querySelector('footer')
      expect(bar).not.toBeNull()
      if (!bar) return

      const controls = [...bar.querySelectorAll('a, button')].filter(isVisible)
      expect(controls.map(accessibleName)).toEqual(expected)

      // The phone footer reverses its children; up and down must stay
      // together in one child so they keep their order there.
      const [upvote, downvote, comments, ...rest] = controls
      const voteGroup = groupOf(upvote, [comments, ...rest], bar)
      expect(voteGroup).toBe(groupOf(downvote, [comments, ...rest], bar))
      expect(voteGroup.contains(downvote)).toBe(true)
      expect(voteGroup.contains(comments)).toBe(false)
      expect(voteGroup.textContent).toContain('36')
      expect(comments.textContent?.trim()).toBe('4')
    },
  )
})
