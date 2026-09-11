// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toggleCommunityBlock: vi.fn(),
  toggleSubscription: vi.fn(),
  unblockUser: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('$app/environment', () => ({
  browser: true,
  dev: true,
  building: false,
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$lib/api/client.svelte', () => ({ coves: () => mocks }))
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: { current: { jwt: 'authenticated' } },
}))
vi.mock('$lib/app/state/i18n', () => ({
  locale: { set: vi.fn() },
  t: {
    subscribe: (run: (translate: (key: string) => string) => void) => {
      run((key) => key)
      return () => {}
    },
  },
}))
vi.mock('$lib/app/util/error', () => ({
  errorMessage: () => 'Request failed',
}))
vi.mock('$lib/feature/community/blocking.svelte', () => ({
  isCommunityBlocked: () => false,
  isCommunityBlockPending: () => false,
  reconcileCommunityBlockState: vi.fn(),
  toggleCommunityBlock: mocks.toggleCommunityBlock,
}))
vi.mock('$lib/feature/community/subscription.svelte', () => ({
  isSubscribed: () => false,
  isSubscriptionPending: () => false,
  toggleSubscription: mocks.toggleSubscription,
}))
vi.mock('$lib/ui/kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/ui/kit')>()),
  toast: mocks.toast,
}))

vi.mock('svelte', async () => {
  const { createRequire } = await import('node:module')
  const require_ = createRequire(import.meta.url)
  return await import(
    /* @vite-ignore */
    require_
      .resolve('svelte/package.json')
      .replace('package.json', 'src/index-client.js')
  )
})

const { mount, unmount, flushSync } = await import('svelte')
const [blockMenu, subscription, blockedUsers, blockedCommunities] =
  await Promise.all([
    import('$lib/feature/community/CommunityBlockMenuItem.svelte'),
    import('$lib/feature/community/SubscribeButton.svelte'),
    import('./(local_user)/blocks/users/+page.svelte'),
    import('./(local_user)/blocks/communities/+page.svelte'),
  ])

const did = 'did:plc:abcdefghijklmnopqrstuvwx'
const surfaces = [
  {
    name: 'community block menu',
    component: blockMenu.default,
    props: () => ({ community: { did } }),
    selector: 'button',
    request: mocks.toggleCommunityBlock,
    success: { kind: 'ok', blocked: true },
    message: 'toast.blockedCommunity',
  },
  {
    name: 'subscribe button',
    component: subscription.default,
    props: () => ({ community: { did }, variant: 'header' }),
    selector: 'button',
    request: mocks.toggleSubscription,
    success: { kind: 'ok', subscribed: true },
    message: 'toast.subscribedCommunity',
  },
  {
    name: 'blocked users page',
    component: blockedUsers.default,
    props: () => ({
      data: { blockedUsers: { value: [{ block: { blockedDid: did } }] } },
    }),
    selector: 'button[title="account.unblock"]',
    request: mocks.unblockUser,
    success: undefined,
    message: 'toast.unblockUser',
  },
  {
    name: 'blocked communities page',
    component: blockedCommunities.default,
    props: () => ({
      data: {
        blockedCommunities: { value: [{ block: { communityDid: did } }] },
      },
    }),
    selector: 'button[title="cards.community.unblock"]',
    request: mocks.toggleCommunityBlock,
    success: { kind: 'ok', blocked: false },
    message: 'toast.unblockedCommunity',
  },
]

let mounted: ReturnType<typeof mount> | undefined
let target: HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
})

function press(surface: (typeof surfaces)[number]) {
  // Each component receives only the props it reads; these are unit fixtures.
  mounted = mount(surface.component as Parameters<typeof mount>[0], {
    target,
    props: surface.props(),
    intro: false,
  })
  flushSync()
  const button = target.querySelector<HTMLButtonElement>(surface.selector)
  expect(button).not.toBeNull()
  button?.click()
  expect(surface.request).toHaveBeenCalledOnce()
}

describe.each(surfaces)('$name success feedback', (surface) => {
  it('shows success only after the request succeeds', async () => {
    const request = Promise.withResolvers<unknown>()
    surface.request.mockReturnValueOnce(request.promise)
    press(surface)

    expect(mocks.toast).not.toHaveBeenCalled()
    request.resolve(surface.success)
    await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce())
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ content: surface.message, type: 'success' }),
    )
  })

  it('retains error feedback without a success toast when the request fails', async () => {
    const error = new Error('Request failed')
    if (surface.request === mocks.unblockUser) {
      surface.request.mockRejectedValueOnce(error)
    } else {
      surface.request.mockResolvedValueOnce({ kind: 'error', error })
    }
    press(surface)

    await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce())
    expect(mocks.toast).toHaveBeenCalledWith({
      content: 'Request failed',
      type: 'error',
    })
  })

  if (surface.request !== mocks.unblockUser) {
    it('shows no toast for an already pending action', async () => {
      surface.request.mockResolvedValueOnce({ kind: 'pending' })
      press(surface)
      await Promise.resolve()

      expect(mocks.toast).not.toHaveBeenCalled()
    })
  }
})

it.each([
  [surfaces[0], { kind: 'ok', blocked: false }, 'toast.unblockedCommunity'],
  [
    surfaces[1],
    { kind: 'ok', subscribed: false },
    'toast.unsubscribedCommunity',
  ],
] as const)(
  'reports the completed reverse action (case %#)',
  async (surface, outcome, message) => {
    surface.request.mockResolvedValueOnce(outcome)
    press(surface)

    await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce())
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ content: message, type: 'success' }),
    )
  },
)
