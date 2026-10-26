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
  viewer: {},
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
      leading: ['post.actions.more.share'],
    },
    {
      who: 'signed-in',
      current: {
        type: 'authenticated',
        did: 'did:plc:viewer',
        handle: 'viewer.test',
        jwt: 'authenticated',
      },
      leading: ['post.actions.more.label', 'post.actions.more.share'],
    },
  ])(
    '$who: renders $leading | comments, upvote, downvote in two sibling groups',
    ({ current, leading }) => {
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
      const trailing = [
        'post.actions.comments',
        'post.actions.vote.upvote',
        'post.actions.vote.downvote',
      ]
      expect(controls.map(accessibleName)).toEqual([...leading, ...trailing])

      const leadingControls = controls.slice(0, leading.length)
      const trailingControls = controls.slice(leading.length)
      const leadingGroup = groupOf(leadingControls[0], trailingControls, bar)
      const trailingGroup = groupOf(trailingControls[0], leadingControls, bar)
      expect(leadingGroup).not.toBe(trailingGroup)
      expect(leadingGroup.parentElement).toBe(trailingGroup.parentElement)
      for (const control of leadingControls)
        expect(leadingGroup.contains(control)).toBe(true)
      for (const control of trailingControls)
        expect(trailingGroup.contains(control)).toBe(true)

      expect(trailingControls[0].textContent?.trim()).toBe('4')
      expect(trailingGroup.textContent).toContain('36')
    },
  )
})
