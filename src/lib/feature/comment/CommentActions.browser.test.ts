// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { AtUri, CID, CommentView } from '$lib/api/coves/types'
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
const deleteComment = vi.hoisted(() => vi.fn())
vi.mock('$lib/api/client.svelte', () => ({ coves: () => ({ deleteComment }) }))
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
// Positioning and menu focus are outside these deletion component tests.
vi.mock(
  '$lib/ui/kit/popover/Menu.svelte',
  () => import('./CommentActions.menu-harness.svelte'),
)

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']>[]
let client: typeof import('svelte')
let comment: CommentView
let removeComment: () => void

beforeEach(async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  mounted = []
  deleteComment.mockReset()
  profile.current.jwt = 'authenticated'
  profile.current.type = 'authenticated'
  state.openModals = []
  vi.spyOn(window.history, 'back').mockImplementation(() => {})
  client = await import('svelte')
  const { shownModal } = await import('$lib/ui/kit/modal/modal')
  const { toasts } = await import('$lib/ui/kit/toast/toasts')
  shownModal.set(undefined)
  toasts.set([])
  const post = {
    uri: 'at://did:plc:author/social.coves.community.post/one' as AtUri,
    cid: 'bafypost' as CID,
  }
  comment = {
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
  const Actions = (await import('./CommentActions.test-harness.svelte')).default
  const Container = (await import('$lib/ui/kit/modal/ModalContainer.svelte'))
    .default
  const { errorMessage } = await import('$lib/app/util/error')
  const actions = client.mount(Actions, {
    target,
    props: { initialComment: comment },
    intro: false,
  })
  comment = actions.currentComment()
  removeComment = actions.removeComment
  mounted = [
    actions,
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
  vi.unstubAllGlobals()
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

function openDelete() {
  button('post.actions.more.delete').click()
  client.flushSync()
  const dialog = document.querySelector('[role="dialog"]')
  if (!dialog) throw new Error('Missing delete confirmation')
  return { dialog, confirm: button('post.actions.more.delete', dialog) }
}

describe('comment deletion confirmation', () => {
  it('finishes a successful delete without an error when refresh removes the comment in flight', async () => {
    let finish = () => {}
    deleteComment.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    const { confirm } = openDelete()
    confirm.click()
    client.flushSync()
    expect(deleteComment).toHaveBeenCalledTimes(1)
    removeComment()
    client.flushSync()
    finish()
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull(),
    )
    const { toasts } = await import('$lib/ui/kit/toast/toasts')
    expect(get(toasts).filter((toast) => toast.type === 'error')).toEqual([])
    expect(comment.isDeleted).toBe(true)
    expect(deleteComment).toHaveBeenCalledTimes(1)
  })

  it('shows one friendly inline error, preserves the comment, and lets deletion retry', async () => {
    deleteComment
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(undefined)
    const { confirm } = openDelete()
    confirm.click()
    const { toasts } = await import('$lib/ui/kit/toast/toasts')
    await vi.waitFor(() =>
      expect(
        document.querySelector('[role="dialog"] [role="alert"]')?.textContent,
      ).toBe('error.backend_unreachable'),
    )
    expect(get(toasts).filter((toast) => toast.type === 'error')).toEqual([])
    expect(comment.isDeleted).not.toBe(true)
    expect(comment.record?.content).toBe('The original comment')
    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) throw new Error('Missing retry confirmation')
    expect(button('post.actions.more.delete', dialog).disabled).toBe(false)
    button('post.actions.more.delete', dialog).click()
    await vi.waitFor(() => expect(deleteComment).toHaveBeenCalledTimes(2))
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull(),
    )
    expect(deleteComment).toHaveBeenLastCalledWith({ uri: comment.uri })
    expect(comment.isDeleted).toBe(true)
    expect(comment.record?.content).not.toBe('The original comment')
  })

  it('disables destructive confirmation and cancellation until the pending delete completes', async () => {
    let finish = () => {}
    deleteComment.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    const { confirm, dialog } = openDelete()
    confirm.click()
    // Dispatch before a DOM flush to exercise the action's pending guard.
    confirm.click()
    client.flushSync()
    expect(confirm.disabled).toBe(true)
    expect(button('common.cancel', dialog).disabled).toBe(true)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(deleteComment).toHaveBeenCalledTimes(1)
    expect(comment.isDeleted).not.toBe(true)
    finish()
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull(),
    )
    expect(comment.isDeleted).toBe(true)
  })

  it('keeps confirmation open with sign-in feedback if the session expires before confirming', async () => {
    const { confirm } = openDelete()
    profile.current.jwt = ''
    profile.current.type = 'anonymous'
    confirm.click()
    const { toasts } = await import('$lib/ui/kit/toast/toasts')
    await vi.waitFor(() => {
      const alert = document.querySelector('[role="dialog"] [role="alert"]')
      expect(alert).not.toBeNull()
      expect(alert?.textContent).toBe('toast.sessionExpired')
    })
    expect(deleteComment).not.toHaveBeenCalled()
    expect(comment.isDeleted).not.toBe(true)
    expect(get(toasts)).toEqual([])
  })
})
