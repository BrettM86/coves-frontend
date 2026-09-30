// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AtUri, CID, CommentView } from '$lib/api/coves/types'
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
  },
}))
vi.mock('$app/navigation', () => ({
  goto: vi.fn().mockResolvedValue(undefined),
  invalidateAll: vi.fn().mockResolvedValue(undefined),
  pushState: vi.fn(),
  replaceState: vi.fn(),
}))
const profile = vi.hoisted(() => ({
  isAuthenticated: true,
  meta: { profile: 'author' },
  current: {
    type: 'authenticated',
    did: 'did:plc:author',
    handle: 'author.test',
    jwt: 'authenticated',
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
vi.mock('$lib/api/client.svelte', () => ({
  coves: () => ({ deleteComment: vi.fn() }),
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
  fade: () => ({ duration: 0 }),
  scale: () => ({ duration: 0 }),
}))

let target: HTMLDivElement
let client: typeof import('svelte')
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

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
  const post = {
    uri: 'at://did:plc:author/social.coves.community.post/one' as AtUri,
    cid: 'bafypost' as CID,
  }
  const comment: CommentView = {
    uri: 'at://did:plc:author/social.coves.community.comment/reply' as AtUri,
    cid: 'bafycomment' as CID,
    author: { did: 'did:plc:author' as DID, handle: 'author.test' as Handle },
    createdAt: '2026-09-01T00:00:00Z',
    indexedAt: '2026-09-01T00:00:00Z',
    post,
    parent: post,
    stats: { upvotes: 0, downvotes: 0, score: 0, replyCount: 0 },
    record: {
      $type: 'social.coves.community.comment',
      content: 'The original comment',
      reply: { root: post, parent: post },
      createdAt: '2026-09-01T00:00:00Z',
    },
  }
  target = document.createElement('div')
  document.body.appendChild(target)
  // Imported and mounted here so first-import compile cost stays off the clock.
  const Actions = (await import('./CommentActions.test-harness.svelte')).default
  mounted = client.mount(Actions, {
    target,
    props: { initialComment: comment },
    intro: false,
  })
  client.flushSync()
}, 30_000)
afterEach(async () => {
  const component = mounted
  mounted = undefined
  if (component) await client.unmount(component, { outro: false })
  target.remove()
  vi.unstubAllGlobals()
})

function menuTrigger(): HTMLButtonElement {
  const found = target.querySelector<HTMLButtonElement>(
    'button[title="comment.actions.label"]',
  )
  if (!found) throw new Error('Missing comment actions menu trigger')
  return found
}

function portaledDeleteButton(): HTMLButtonElement | undefined {
  return [
    ...document.body.querySelectorAll<HTMLButtonElement>(
      '.portal-mount button',
    ),
  ].find(
    (element) => element.textContent?.trim() === 'post.actions.more.delete',
  )
}

describe('comment actions menu', () => {
  it('opens the real menu and unmounts in under a second', async () => {
    const trigger = menuTrigger()
    const component = mounted
    if (!component) throw new Error('Missing mounted comment actions')

    const started = performance.now()
    trigger.click()
    await vi.waitFor(() => expect(portaledDeleteButton()).toBeDefined(), {
      timeout: 5_000,
      interval: 5,
    })
    mounted = undefined
    await client.unmount(component, { outro: false })
    const elapsed = performance.now() - started

    expect(elapsed).toBeLessThan(1000)
    expect(document.body.querySelector('.portal-mount')).toBeNull()
    expect(portaledDeleteButton()).toBeUndefined()
    // Only needs to exceed the 5 s waitFor; cannot preempt the synchronous regressed block.
  }, 30_000)
})
