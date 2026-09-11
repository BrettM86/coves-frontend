import { isRedirect } from '@sveltejs/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayoutLoad, LayoutLoadEvent } from './$types'

const mockProfile = vi.hoisted(() => ({
  current: { type: 'guest' as 'guest' | 'authenticated' },
}))

vi.mock('$lib/app/state/auth.svelte', () => ({ profile: mockProfile }))

import { load } from './+layout'

const loadLayout: LayoutLoad = load

function makeEvent(
  session: { authenticated: boolean } | null | undefined,
  pathname = '/profile/settings',
): LayoutLoadEvent {
  return {
    parent: vi.fn().mockResolvedValue({ session }),
    url: new URL(pathname, 'https://coves.test'),
  } as unknown as LayoutLoadEvent
}

async function expectLoginRedirect(event: LayoutLoadEvent) {
  const thrown = await Promise.resolve()
    .then(() => loadLayout(event))
    .then(
      () => expect.fail('Expected a login redirect'),
      (error: unknown) => error,
    )

  expect(isRedirect(thrown)).toBe(true)
  expect(thrown).toMatchObject({ status: 302, location: '/login' })
}

describe('authenticated profile layout', () => {
  beforeEach(() => {
    mockProfile.current.type = 'guest'
  })

  it.each(['/profile/settings', '/profile/blocks'])(
    'redirects signed-out visits to %s to login',
    async (pathname) => {
      await expectLoginRedirect(makeEvent(null, pathname))
    },
  )

  it('redirects when the parent has no session', async () => {
    await expectLoginRedirect(makeEvent(undefined))
  })

  it('redirects an explicitly unauthenticated session', async () => {
    await expectLoginRedirect(makeEvent({ authenticated: false }))
  })

  it('allows an authenticated session before the client profile initializes', async () => {
    await expect(
      Promise.resolve().then(() =>
        loadLayout(makeEvent({ authenticated: true })),
      ),
    ).resolves.toEqual({ my_user: undefined })
  })

  it('redirects a signed-out session even with stale authenticated client state', async () => {
    mockProfile.current.type = 'authenticated'

    await expectLoginRedirect(makeEvent(null))
  })

  it('redirects when the parent session becomes signed out after logout', async () => {
    mockProfile.current.type = 'authenticated'
    const event = makeEvent({ authenticated: true })
    expect(await loadLayout(event)).toEqual({ my_user: undefined })

    vi.mocked(event.parent).mockResolvedValueOnce({
      session: null,
    } as Awaited<ReturnType<LayoutLoadEvent['parent']>>)

    await expectLoginRedirect(event)
  })
})
