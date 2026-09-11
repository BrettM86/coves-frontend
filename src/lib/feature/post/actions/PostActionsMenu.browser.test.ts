// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { AtUri, CID, PostView } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
const state = vi.hoisted(() => ({ openModals: [] as string[] }))
vi.mock('$app/state', () => ({
  page: {
    state,
    url: new URL('http://localhost/c/community.test/post/author.test/one'),
  },
}))
vi.mock('$app/navigation', () => ({
  goto: vi.fn().mockResolvedValue(undefined),
  invalidateAll: vi.fn().mockResolvedValue(undefined),
  pushState: (_url: string, next: typeof state) => Object.assign(state, next),
  replaceState: (_url: string, next: typeof state) =>
    Object.assign(state, next),
}))
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: {
    isAuthenticated: true,
    meta: { profile: 'author' },
    current: {
      type: 'authenticated',
      did: 'did:plc:author',
      handle: 'author.test',
      jwt: 'authenticated',
    },
  },
}))
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
    locale: { set: () => {} },
  }
})
const deletePost = vi.hoisted(() => vi.fn())
vi.mock('$lib/api/client.svelte', () => ({ coves: () => ({ deletePost }) }))
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
let mounted: ReturnType<(typeof import('svelte'))['mount']>[]
let client: typeof import('svelte')
const post: PostView = {
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
  record: {
    $type: 'social.coves.community.post',
    author: 'did:plc:author' as DID,
    community: 'did:plc:community' as DID,
    title: 'A post',
    createdAt: '2026-09-01T00:00:00Z',
  },
}

beforeEach(async () => {
  mounted = []
  deletePost.mockReset()
  const { goto } = await import('$app/navigation')
  vi.mocked(goto).mockReset().mockResolvedValue(undefined)
  state.openModals = []
  vi.spyOn(window.history, 'back').mockImplementation(() => {})
  client = await import('svelte')
  const { shownModal } = await import('$lib/ui/kit/modal/modal')
  const { toasts } = await import('$lib/ui/kit/toast/toasts')
  shownModal.set(undefined)
  toasts.set([])
  target = document.createElement('div')
  document.body.appendChild(target)
  const Menu = (await import('./PostActionsMenu.svelte')).default
  const Container = (await import('$lib/ui/kit/modal/ModalContainer.svelte'))
    .default
  const { errorMessage } = await import('$lib/app/util/error')
  mounted = [
    client.mount(Menu, { target, props: { post }, intro: false }),
    client.mount(Container, {
      target,
      props: { formatError: errorMessage },
      intro: false,
    }),
  ]
  client.flushSync()
})
afterEach(async () => {
  for (const component of mounted)
    await client.unmount(component, { outro: false })
  target.remove()
  const { feeds } = await import('$lib/feature/feeds/feed.svelte')
  feeds.clear()
})

function button(
  label: string,
  scope: ParentNode = document,
): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === label,
  )
  if (!found) throw new Error(`Missing button ${label}`)
  return found
}

function confirmDelete() {
  button('post.actions.more.delete', target).click()
  client.flushSync()
  const dialog = document.querySelector('[role="dialog"]')
  if (!dialog) throw new Error('Missing delete confirmation')
  const confirm = button('post.actions.more.delete', dialog)
  confirm.click()
  return { dialog, confirm }
}

describe('post deletion feedback', () => {
  it('reloads the community feed before navigating away from a deleted post', async () => {
    const { feed, feeds } = await import('$lib/feature/feeds/feed.svelte')
    const { goto } = await import('$app/navigation')
    feeds.clear()
    const params = { community: 'community.test' }
    const community = {
      did: post.community.did,
      name: 'Community',
      subscriberCount: 1,
      memberCount: 1,
      postCount: 1,
      createdAt: post.createdAt,
      allowExternalDiscovery: true,
    }
    const cached = await feed('/c/[handle=handle]', async () => ({
      feed: [{ post }],
      community,
      params,
    })).load(params)
    expect(cached.feed).toHaveLength(1)

    const loadCommunity = vi.fn(async () => ({ feed: [], community, params }))
    let destinationPostUris: AtUri[] | undefined
    vi.mocked(goto).mockImplementation(async () => {
      // A SvelteKit invalidation invokes the loader again. Its feed factory
      // still uses the shared browser cache when the request params match.
      const loaded = await feed('/c/[handle=handle]', loadCommunity).load(
        params,
      )
      destinationPostUris = loaded.feed.map(({ post }) => post.uri)
    })
    deletePost.mockResolvedValue(undefined)
    confirmDelete()

    await vi.waitFor(() => expect(destinationPostUris).toBeDefined())
    expect(destinationPostUris).toEqual([])
    expect(loadCommunity).toHaveBeenCalledTimes(1)
  })

  it('retries navigation without deleting the post again when navigation fails after success', async () => {
    const { goto } = await import('$app/navigation')
    vi.mocked(goto)
      .mockRejectedValueOnce(new Error('Navigation failed'))
      .mockResolvedValue(undefined)
    deletePost.mockResolvedValue(undefined)
    confirmDelete()
    await vi.waitFor(() =>
      expect(document.querySelector('[role="alert"]')).not.toBeNull(),
    )
    client.flushSync()
    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) throw new Error('Missing retry confirmation')
    button('post.actions.more.delete', dialog).click()
    await vi.waitFor(() => expect(goto).toHaveBeenCalledTimes(2))
    expect(deletePost).toHaveBeenCalledTimes(1)
  })

  it('announces successful deletion and replaces the deleted post with its community', async () => {
    deletePost.mockResolvedValue(undefined)
    confirmDelete()
    const { goto } = await import('$app/navigation')
    const { toasts } = await import('$lib/ui/kit/toast/toasts')
    await vi.waitFor(() =>
      expect(get(toasts)).toContainEqual(
        expect.objectContaining({
          content: 'toast.deletedPost',
          type: 'success',
        }),
      ),
    )
    expect(goto).toHaveBeenCalledWith('/c/community.test', {
      replaceState: true,
      invalidateAll: true,
    })
    expect(window.history.back).not.toHaveBeenCalled()
  })

  it('keeps destructive confirmation disabled while deletion is in flight', async () => {
    let finish = () => {}
    deletePost.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    const { confirm } = confirmDelete()
    client.flushSync()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(confirm.disabled).toBe(true)
    expect(button('common.cancel').disabled).toBe(true)
    confirm.click()
    expect(deletePost).toHaveBeenCalledTimes(1)
    finish()
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull(),
    )
  })

  it('shows one friendly inline error and leaves the confirmation retryable after deletion fails', async () => {
    deletePost
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(undefined)
    confirmDelete()
    const { toasts } = await import('$lib/ui/kit/toast/toasts')
    await vi.waitFor(() =>
      expect(
        document.querySelector('[role="dialog"] [role="alert"]')?.textContent,
      ).toBe('error.backend_unreachable'),
    )
    expect(get(toasts).filter((toast) => toast.type === 'error')).toEqual([])
    client.flushSync()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    if (!dialog) throw new Error('Missing retry confirmation')
    button('post.actions.more.delete', dialog).click()
    await vi.waitFor(() => expect(deletePost).toHaveBeenCalledTimes(2))
  })
})
