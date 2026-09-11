/**
 * `syncFromServer` in the browser.
 *
 * Two places turn a server session into a client profile: the SSR render
 * (through `profileFromSession`) and this method, which adopts the session the
 * server put in page data. If they disagree by even one field the page changes
 * under the reader at hydration. These pin that they agree.
 *
 * Separate file because `auth.svelte.test.ts` mocks `browser: false`
 * file-wide, and the browser path is what stores a profile.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerSession } from './auth.svelte'

vi.mock('$app/environment', () => ({
  browser: true,
  dev: false,
  building: false,
  version: 'test',
}))

vi.mock('./instance/env', () => ({
  DEFAULT_INSTANCE_URL: 'https://coves.social',
  LINKED_INSTANCE_URL: undefined,
}))

vi.mock('$lib/server/session', () => ({}))

/** The module reads and writes localStorage at import time on the browser path. */
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value)
  },
  removeItem: (key: string) => {
    store.delete(key)
  },
})

const session = (avatar?: string): ServerSession =>
  ({
    authenticated: true,
    activeAccountId: 'did:plc:abcdefghijklmnopqrstuvwx',
    account: {
      id: 'did:plc:abcdefghijklmnopqrstuvwx',
      did: 'did:plc:abcdefghijklmnopqrstuvwx',
      handle: 'mari.test',
      instance: 'https://coves.social',
      avatar,
    },
  }) as unknown as ServerSession

async function freshAuth() {
  vi.resetModules()
  store.clear()
  return await import('./auth.svelte')
}

beforeEach(() => {
  vi.resetModules()
  store.clear()
})

describe('syncFromServer', () => {
  it('adopts exactly the profile profileFromSession maps', async () => {
    const { profile, profileFromSession } = await freshAuth()
    const incoming = session('https://cdn.example/avatar.png')

    profile.syncFromServer(incoming)

    // Deep equality against the shared mapper, so the two paths cannot drift
    // apart field by field.
    expect(profile.meta.profiles).toEqual([profileFromSession(incoming)])
    expect(profile.meta.profile).toBe(incoming.activeAccountId)
  })

  it('agrees with profileFromSession when the account has no avatar', async () => {
    const { profile, profileFromSession } = await freshAuth()
    const incoming = session(undefined)

    profile.syncFromServer(incoming)

    expect(profile.meta.profiles).toEqual([profileFromSession(incoming)])
  })

  it('drops to the guest profileFromSession maps for no session', async () => {
    const { profile, profileFromSession } = await freshAuth()
    profile.syncFromServer(session())

    profile.syncFromServer(undefined)

    expect(profile.meta.profiles).toEqual([profileFromSession(undefined)])
    expect(profile.meta.profile).toBe('guest')
  })
})

describe('syncFromServer without a session', () => {
  const guest = (id: string, instance: string) => ({
    type: 'guest',
    id,
    instance,
  })

  it('collapses a legacy multi-guest list to the single canonical guest', async () => {
    // Photon let readers keep several guest profiles pointed at different
    // instances. The switcher that managed them is gone, so a persisted list
    // like this would otherwise be stuck forever.
    store.set(
      'profileData',
      JSON.stringify({
        profile: 'guest-2',
        profiles: [
          guest('guest', 'https://coves.social'),
          guest('guest-2', 'https://other.example'),
        ],
      }),
    )
    const { profile } = await import('./auth.svelte')

    profile.syncFromServer(undefined)

    expect(profile.meta.profiles).toEqual([
      guest('guest', 'https://coves.social'),
    ])
    expect(profile.meta.profile).toBe('guest')
    expect(profile.current.instance).toBe('https://coves.social')
  })

  it('leaves an already-canonical guest untouched', async () => {
    store.set(
      'profileData',
      JSON.stringify({
        profile: 'guest',
        profiles: [guest('guest', 'https://coves.social')],
      }),
    )
    const { profile } = await import('./auth.svelte')
    const before = profile.meta.profiles[0]

    profile.syncFromServer(undefined)

    expect(profile.meta.profiles[0]).toBe(before)
    expect(profile.meta.profile).toBe('guest')
  })
})

describe('failed root session validation', () => {
  it('keeps a live session live when the server could not check it', async () => {
    const { profile } = await freshAuth()
    profile.syncFromServer({
      ...session(),
      sessionGeneration: 'generation-1',
    } as ServerSession)
    expect(profile.isAuthenticated).toBe(true)

    // /api/me failed (5xx, rate limit, network): no session in page data, the
    // cookie's generation still present, and no expiration reported.
    profile.syncFromServer(undefined, {
      sessionGeneration: 'generation-1',
      sessionExpired: false,
    })

    expect(profile.isAuthenticated).toBe(true)
    expect(profile.sessionExpired).toBe(false)
  })
})

describe('initial root session validation', () => {
  it('clears a persisted authenticated profile when the initial root confirms no cookie', async () => {
    store.set(
      'profileData',
      JSON.stringify({
        profile: 'did:plc:abcdefghijklmnopqrstuvwx',
        profiles: [
          {
            type: 'authenticated',
            id: 'did:plc:abcdefghijklmnopqrstuvwx',
            did: 'did:plc:abcdefghijklmnopqrstuvwx',
            handle: 'mari.test',
            instance: 'https://coves.social',
            jwt: 'authenticated',
          },
        ],
      }),
    )
    const { profile } = await import('./auth.svelte')
    expect(profile.isAuthenticated).toBe(true)
    profile.syncFromServer(undefined, {
      sessionGeneration: undefined,
      sessionExpired: false,
    })
    expect(profile.isAuthenticated).toBe(false)
    expect(profile.current.type).toBe('guest')
    expect(profile.sessionExpired).toBe(false)
  })
})
