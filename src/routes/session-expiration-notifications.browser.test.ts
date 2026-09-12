// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AtUri,
  CID,
  CommentView,
  PostView,
  ProfileViewDetailed,
} from '$lib/api/coves/types'
import { XrpcError } from '$lib/api/coves/xrpc'
import { shownModal } from '$lib/ui/kit/modal/modal'
import { get } from 'svelte/store'
import type { DID } from '$lib/types/atproto'

const state = vi.hoisted(() => ({
  profile: {
    current: { jwt: 'authenticated', did: 'did:plc:viewer' },
    meta: { profile: 'viewer' },
    isAuthenticated: true,
    sessionExpired: false,
  },
  api: {
    createVote: vi.fn(),
    deleteVote: vi.fn(),
    blockUser: vi.fn(),
    subscribe: vi.fn(),
    blockCommunity: vi.fn(),
    deleteComment: vi.fn(),
  },
  toast: vi.fn(),
}))
vi.mock('$app/environment', () => ({
  browser: true,
  dev: true,
  building: false,
  version: 'test',
}))
vi.mock('$app/state', () => ({
  page: {
    url: new URL('http://localhost/c/community/post/author.test/1'),
    state: {},
  },
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn() }))
vi.mock('$lib/app/state/auth.svelte', () => ({ profile: state.profile }))
vi.mock('$lib/api/client.svelte', () => ({ coves: () => state.api }))
vi.mock('$lib/feature/feeds/feed.svelte', () => ({ feeds: new Map() }))
vi.mock('$lib/app/util/log', () => ({ log: { error: vi.fn() } }))
vi.mock('$lib/ui/kit', async (importOriginal) => {
  const kit = await importOriginal<typeof import('$lib/ui/kit')>()
  return {
    ...kit,
    toast: state.toast,
    // Confirmation modals run their destructive action straight away so a
    // delete control can be exercised without rendering the modal container.
    // The action wrapper still needs the dialog to be the shown one: it records
    // a thrown error on it (rendered inline by ModalContainer) or closes it.
    modal: (input: Parameters<typeof kit.modal>[0]) => {
      kit.modal(input)
      get(shownModal)
        ?.actions.find((a) => a.type === 'danger')
        ?.action()
    },
  }
})
// Positioning and menu focus are outside these notification tests. The real
// popover also cannot unmount under jsdom: floating-ui probes `:modal`, which
// nwsapi 2.2.27 takes ~200ms per call to answer.
vi.mock(
  '$lib/ui/kit/popover/Menu.svelte',
  () => import('$lib/feature/comment/CommentActions.menu-harness.svelte'),
)
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
  fly: () => ({ duration: 0 }),
  fade: () => ({ duration: 0 }),
  slide: () => ({ duration: 0 }),
  scale: () => ({ duration: 0 }),
}))

let client: typeof import('svelte')
let target: HTMLDivElement
let mounted: ReturnType<typeof client.mount> | undefined
beforeEach(async () => {
  vi.clearAllMocks()
  shownModal.set(undefined)
  state.profile.sessionExpired = false
  client = await import('svelte')
  const { loadTranslations, locale } = await import('$lib/app/state/i18n')
  await loadTranslations('en')
  locale.set('en')
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
  const { resetUserBlockingState } =
    await import('$lib/feature/user/blocking.svelte')
  resetUserBlockingState()
  const { resetSubscriptionState } =
    await import('$lib/feature/community/subscription.svelte')
  resetSubscriptionState()
  const { resetCommunityBlockingState } =
    await import('$lib/feature/community/blocking.svelte')
  resetCommunityBlockingState()
})

function pendingFailure() {
  let reject: (error: Error) => void = () => {
    throw new Error('Missing promise executor')
  }
  const promise = new Promise<never>((_resolve, rejectPromise) => {
    reject = rejectPromise
  })
  return { promise, reject }
}

describe('session expiration notifications from actual controls', () => {
  it.each([true, false])(
    'vote rolls back a 401 with global expiration %s',
    async (globallyExpired) => {
      const pending = pendingFailure()
      state.api.createVote.mockReturnValue(pending.promise)
      const Component = (await import('$lib/feature/vote/VoteButton.svelte'))
        .default
      mounted = client.mount(Component, {
        target,
        intro: false,
        props: {
          uri: 'at://did:plc:subject/social.coves.post/1' as AtUri,
          cid: 'bafytest' as CID,
          stats: { upvotes: 4, downvotes: 0, score: 4 },
          viewer: {},
          emptyStats: { upvotes: 0, downvotes: 0, score: 0 },
          emptyViewer: {},
        },
      })
      client.flushSync()
      const upvote = target.querySelector<HTMLButtonElement>('button')
      if (!upvote) throw new Error('Missing vote control')
      upvote.click()
      client.flushSync()
      expect(upvote.getAttribute('aria-pressed')).toBe('true')
      expect(upvote.disabled).toBe(true)
      // A current failed session is globally expired and the recovery banner
      // owns the feedback. A late old response after a newer login leaves the
      // current session live, so the control's own error toast is the only
      // feedback for the rollback.
      state.profile.sessionExpired = globallyExpired
      pending.reject(new XrpcError(401, 'AuthRequired', 'Session expired'))
      await vi.waitFor(() => {
        client.flushSync()
        expect(upvote.disabled).toBe(false)
        expect(upvote.getAttribute('aria-pressed')).toBe('false')
        expect(
          target.querySelector('[role=group]')?.getAttribute('aria-busy'),
        ).toBe('false')
      })
      expect(state.api.createVote).toHaveBeenCalledTimes(1)
      expectToastUnlessBannerShown(globallyExpired)
    },
  )

  it.each([true, false])(
    'user block clears pending state and rolls back a 401 with global expiration %s',
    async (globallyExpired) => {
      const pending = pendingFailure()
      state.api.blockUser.mockReturnValue(pending.promise)
      const Component = (
        await import('./profile/[handle=actor]/UserActions.svelte')
      ).default
      const user = {
        did: 'did:plc:subject',
        handle: 'subject.test',
      } as ProfileViewDetailed
      const { isUserBlocked, isUserBlockPending } =
        await import('$lib/feature/user/blocking.svelte')
      mounted = client.mount(Component, {
        target,
        intro: false,
        props: { profile: user },
      })
      client.flushSync()
      const block = document.querySelector<HTMLButtonElement>('[role=menuitem]')
      if (!block) throw new Error('Missing block control')
      block.click()
      client.flushSync()
      expect(isUserBlockPending(user)).toBe(true)
      expect(isUserBlocked(user)).toBe(true)
      state.profile.sessionExpired = globallyExpired
      pending.reject(new XrpcError(401, 'AuthRequired', 'Session expired'))
      await vi.waitFor(() => {
        client.flushSync()
        expect(isUserBlockPending(user)).toBe(false)
        expect(isUserBlocked(user)).toBe(false)
      })
      expect(state.api.blockUser).toHaveBeenCalledTimes(1)
      expectToastUnlessBannerShown(globallyExpired)
    },
  )

  it.each([true, false])(
    'community subscribe rolls back a 401 with global expiration %s',
    async (globallyExpired) => {
      const pending = pendingFailure()
      state.api.subscribe.mockReturnValue(pending.promise)
      const Component = (
        await import('$lib/feature/community/SubscribeButton.svelte')
      ).default
      const community = { did: 'did:plc:community' as DID, viewer: {} }
      const { isSubscribed, isSubscriptionPending } =
        await import('$lib/feature/community/subscription.svelte')
      mounted = client.mount(Component, {
        target,
        intro: false,
        props: { community, variant: 'header' },
      })
      client.flushSync()
      const subscribe = target.querySelector<HTMLButtonElement>('button')
      if (!subscribe) throw new Error('Missing subscribe control')
      subscribe.click()
      client.flushSync()
      expect(isSubscriptionPending(community)).toBe(true)
      expect(isSubscribed(community)).toBe(true)
      state.profile.sessionExpired = globallyExpired
      pending.reject(new XrpcError(401, 'AuthRequired', 'Session expired'))
      await vi.waitFor(() => {
        client.flushSync()
        expect(isSubscriptionPending(community)).toBe(false)
        expect(isSubscribed(community)).toBe(false)
      })
      expect(state.api.subscribe).toHaveBeenCalledTimes(1)
      expectToastUnlessBannerShown(globallyExpired)
    },
  )

  it.each([true, false])(
    'post menu community block rolls back a 401 with global expiration %s',
    async (globallyExpired) => {
      const pending = pendingFailure()
      state.api.blockCommunity.mockReturnValue(pending.promise)
      const Component = (
        await import('$lib/feature/post/actions/PostActionsMenu.svelte')
      ).default
      const post = {
        uri: 'at://did:plc:author/social.coves.post/1',
        cid: 'bafypost',
        author: { did: 'did:plc:author', handle: 'author.test' },
        community: { did: 'did:plc:community', viewer: {} },
        record: { title: 'A post', content: '' },
      } as unknown as PostView
      const { isCommunityBlocked, isCommunityBlockPending } =
        await import('$lib/feature/community/blocking.svelte')
      mounted = client.mount(Component, {
        target,
        intro: false,
        props: { post },
      })
      client.flushSync()
      const items = target.querySelectorAll<HTMLButtonElement>(
        'button[role=menuitem]',
      )
      const block = Array.from(items).find((item) =>
        item.textContent?.includes('community'),
      )
      if (!block) throw new Error('Missing block community control')
      block.click()
      client.flushSync()
      expect(isCommunityBlockPending(post.community)).toBe(true)
      expect(isCommunityBlocked(post.community)).toBe(true)
      state.profile.sessionExpired = globallyExpired
      pending.reject(new XrpcError(401, 'AuthRequired', 'Session expired'))
      await vi.waitFor(() => {
        client.flushSync()
        expect(isCommunityBlockPending(post.community)).toBe(false)
        expect(isCommunityBlocked(post.community)).toBe(false)
      })
      expect(state.api.blockCommunity).toHaveBeenCalledTimes(1)
      expectToastUnlessBannerShown(globallyExpired)
    },
  )

  it.each([true, false])(
    'comment delete keeps the comment on a 401 with global expiration %s',
    async (globallyExpired) => {
      const pending = pendingFailure()
      state.api.deleteComment.mockReturnValue(pending.promise)
      const Component = (
        await import('$lib/feature/comment/CommentActions.svelte')
      ).default
      const comment = {
        uri: 'at://did:plc:viewer/social.coves.comment/1',
        cid: 'bafycomment',
        author: { did: 'did:plc:viewer', handle: 'viewer.test' },
        record: { content: 'hello' },
        stats: { upvotes: 0, downvotes: 0, score: 0 },
        viewer: {},
        isDeleted: false,
      } as unknown as CommentView
      mounted = client.mount(Component, {
        target,
        intro: false,
        props: { comment },
      })
      client.flushSync()
      const items =
        document.querySelectorAll<HTMLButtonElement>('[role=menuitem]')
      const remove = Array.from(items).find((item) =>
        item.textContent?.toLowerCase().includes('delete'),
      )
      if (!remove) throw new Error('Missing delete control')
      remove.click()
      client.flushSync()
      state.profile.sessionExpired = globallyExpired
      pending.reject(new XrpcError(401, 'AuthRequired', 'Session expired'))
      await vi.waitFor(() => {
        expect(state.api.deleteComment).toHaveBeenCalledTimes(1)
        if (globallyExpired) expect(get(shownModal)).toBeUndefined()
        else expect(get(shownModal)?.error).toBeInstanceOf(XrpcError)
      })
      expect(comment.isDeleted).toBe(false)
      expect(comment.record?.content).toBe('hello')
      // A confirmation reports its failure inline instead of toasting; with
      // the banner up it closes quietly rather than repeating the message.
      expect(state.toast).not.toHaveBeenCalled()
    },
  )
})

function expectToastUnlessBannerShown(bannerShown: boolean): void {
  if (bannerShown) {
    expect(state.toast).not.toHaveBeenCalled()
  } else {
    expect(state.toast).toHaveBeenCalledTimes(1)
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    )
  }
}
