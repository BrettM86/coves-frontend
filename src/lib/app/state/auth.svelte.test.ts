import { AsyncLocalStorage } from 'node:async_hooks'
import type { RequestEvent } from '@sveltejs/kit'
import { describe, it, expect, vi } from 'vitest'

// Mock browser environment and dependencies before importing the module
vi.mock('$app/environment', () => ({
  browser: false,
}))

vi.mock('./instance/env', () => ({
  DEFAULT_INSTANCE_URL: 'https://coves.social',
}))

vi.mock('$lib/server/session', () => ({
  // Types are re-exported as empty since they're only used for type checking
}))

// Import actual functions AFTER mocks are set up
import {
  isAuthenticated,
  profile,
  type ServerSession,
  type ProfileInfo,
  type GuestProfile,
  type AuthenticatedProfile,
} from './auth.svelte'

describe('isAuthenticated type guard', () => {
  it('should return true for authenticated profiles', () => {
    const profile: AuthenticatedProfile = {
      type: 'authenticated',
      id: 'test-id',
      instance: 'https://coves.social' as any,
      jwt: 'authenticated',
      did: 'did:plc:abc123' as any,
      handle: 'test.user' as any,
    }
    expect(isAuthenticated(profile)).toBe(true)
  })

  it('should return false for guest profiles', () => {
    const profile: GuestProfile = {
      type: 'guest',
      id: 'guest',
      instance: 'https://coves.social',
    }
    expect(isAuthenticated(profile)).toBe(false)
  })

  it('should narrow type to AuthenticatedProfile', () => {
    const profile: ProfileInfo = {
      type: 'authenticated',
      id: 'test-id',
      instance: 'https://coves.social' as any,
      jwt: 'authenticated',
      did: 'did:plc:abc123' as any,
      handle: 'test.user' as any,
    }

    if (isAuthenticated(profile)) {
      // TypeScript should narrow to AuthenticatedProfile
      expect(profile.did).toBe('did:plc:abc123')
      expect(profile.handle).toBe('test.user')
    } else {
      // This branch should not be reached
      expect.fail('Expected profile to be authenticated')
    }
  })
})

describe('ProfileInfo discriminated union', () => {
  it('should correctly narrow type based on type field', () => {
    const guestProfile: ProfileInfo = {
      type: 'guest',
      id: 'guest',
      instance: 'https://coves.social',
    }

    const authenticatedProfile: ProfileInfo = {
      type: 'authenticated',
      id: 'test-id',
      instance: 'https://coves.social' as any,
      jwt: 'authenticated',
      did: 'did:plc:abc123' as any,
      handle: 'test.user' as any,
    }

    // Type narrowing test using the actual type guards
    if (!isAuthenticated(guestProfile)) {
      expect(guestProfile.did).toBeUndefined()
    }

    if (isAuthenticated(authenticatedProfile)) {
      expect(authenticatedProfile.did).toBe('did:plc:abc123')
      expect(authenticatedProfile.handle).toBe('test.user')
    }
  })
})

describe('LogoutResult interface', () => {
  it('should support success result', () => {
    const result: { success: boolean; error?: string } = {
      success: true,
    }
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('should support failure result with error', () => {
    const result = {
      success: false,
      error: 'Network error',
    }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Network error')
  })

  it('should support remote logout failure warning', () => {
    const result = {
      success: true,
      remoteLogoutFailed: true,
      remoteLogoutError: 'Token revocation failed',
    }
    expect(result.success).toBe(true)
    expect(result.remoteLogoutFailed).toBe(true)
    expect(result.remoteLogoutError).toBe('Token revocation failed')
  })
})

describe('Profile.syncFromServer', () => {
  const authed: AuthenticatedProfile = {
    type: 'authenticated',
    id: 'did:plc:abc123',
    instance: 'https://coves.social' as any,
    jwt: 'authenticated',
    did: 'did:plc:abc123' as any,
    handle: 'test.user' as any,
  }

  const seedAuthenticated = () => {
    profile.meta.profiles = [authed]
    profile.meta.profile = authed.id
  }

  it('adopts the server account when authenticated', () => {
    profile.syncFromServer({
      authenticated: true,
      activeAccountId: 'did:plc:xyz',
      account: {
        id: 'did:plc:xyz',
        did: 'did:plc:xyz',
        handle: 'other.user',
        instance: 'https://coves.social',
      },
    } as any)

    expect(profile.meta.profile).toBe('did:plc:xyz')
    expect(profile.meta.profiles).toHaveLength(1)
    expect(isAuthenticated(profile.meta.profiles[0])).toBe(true)
  })

  it('drops a persisted authenticated profile when the server has no session', () => {
    seedAuthenticated()

    profile.syncFromServer({ authenticated: false } as any)

    expect(profile.meta.profile).toBe('guest')
    expect(profile.meta.profiles).toHaveLength(1)
    expect(profile.meta.profiles[0].type).toBe('guest')
  })

  it('drops a persisted authenticated profile when session data is missing', () => {
    seedAuthenticated()

    profile.syncFromServer(undefined)

    expect(profile.meta.profile).toBe('guest')
    expect(profile.meta.profiles[0].type).toBe('guest')
  })

  it('leaves an existing guest profile untouched when unauthenticated', () => {
    profile.syncFromServer(undefined)
    const before = profile.meta.profiles[0]

    profile.syncFromServer({ authenticated: false } as any)

    expect(profile.meta.profiles[0]).toBe(before)
    expect(profile.meta.profile).toBe('guest')
  })
})

/**
 * Profile during a server render.
 *
 * One Node process renders every request, so `profile` cannot answer from
 * module state: `meta` is one visitor's localStorage, and on the server there
 * is no such thing. Reads must resolve against the request that is executing,
 * and writes must not reach across requests — a logged-in render must never
 * leave its account visible to the anonymous render running beside it.
 *
 * `browser: false` is mocked file-wide at the top, which is the server path.
 */
const SEALED_TOKEN = 'sealed-token-must-never-leak'

// Deliberately NOT the mocked DEFAULT_INSTANCE_URL ('https://coves.social'):
// a profile carrying this value can only have come from the request, never
// from the guest default.
const ACCOUNT_INSTANCE = 'https://upstream.internal.example'

const account = (handle: string, did: string) => ({
  did,
  handle,
  instance: ACCOUNT_INSTANCE,
  sealedToken: SEALED_TOKEN,
  avatar: 'https://cdn.example/avatar.png',
})

const MARI = account('mari.test', 'did:plc:abcdefghijklmnopqrstuvwx')
const ALEX = account('alex.test', 'did:plc:zyxwvutsrqponmlkjihgfedc')

const authedLocals = (who: typeof MARI) => ({
  authenticated: true,
  account: who,
  authToken: SEALED_TOKEN,
})

const anonLocals = () => ({ authenticated: false })

const eventFor = (auth: unknown): RequestEvent =>
  ({ locals: { auth } }) as unknown as RequestEvent

/**
 * A fresh module registry per test. `request-event` is imported from the SAME
 * registry as `auth.svelte`, otherwise the accessor lands on a different copy
 * of the module than the one Profile reads through and every test silently
 * sees a guest.
 */
async function freshAuth() {
  vi.resetModules()
  const { installRequestEventAccessor } =
    await import('$lib/app/util/request-event')
  const authModule = await import('./auth.svelte')
  return { ...authModule, installRequestEventAccessor }
}

describe('Profile — server render', () => {
  it('resolves the current profile from the in-flight request', async () => {
    const { profile, installRequestEventAccessor } = await freshAuth()
    installRequestEventAccessor(() => eventFor(authedLocals(MARI)))

    expect(profile.current.type).toBe('authenticated')
    expect(profile.current.handle).toBe('mari.test')
    expect(profile.current.did).toBe(MARI.did)
    expect(profile.current.avatar).toBe(MARI.avatar)
    expect(profile.current.instance).toBe(ACCOUNT_INSTANCE)
    // Legacy marker the navbar and sidebar still gate on
    // (`{#if profile.current?.jwt}`); it is not a token.
    expect(profile.current.jwt).toBe('authenticated')
    expect(profile.isAuthenticated).toBe(true)
    expect(profile.isDefaultProfile).toBe(false)
  })

  it('resolves a guest for an unauthenticated request', async () => {
    const { profile, installRequestEventAccessor } = await freshAuth()
    installRequestEventAccessor(() => eventFor(anonLocals()))

    expect(profile.current.type).toBe('guest')
    expect(profile.isAuthenticated).toBe(false)
  })

  it('resolves a guest when there is no request at all', async () => {
    // Module evaluation, a unit test, a background job: reads must degrade to
    // a guest rather than throw or hand back the last request's account.
    const { profile } = await freshAuth()

    expect(profile.current.type).toBe('guest')
    expect(profile.isAuthenticated).toBe(false)
  })

  it('never exposes the sealed token on the profile', async () => {
    const { profile, installRequestEventAccessor } = await freshAuth()
    installRequestEventAccessor(() => eventFor(authedLocals(MARI)))

    const serialized = JSON.stringify(profile.current)
    expect(serialized).not.toContain(SEALED_TOKEN)
    expect(serialized).toContain('mari.test')
  })

  describe('concurrent requests do not share a profile', () => {
    it('reports each request its own account from the same profile object', async () => {
      const { profile, installRequestEventAccessor } = await freshAuth()

      const als = new AsyncLocalStorage<RequestEvent>()
      installRequestEventAccessor(() => als.getStore())

      // Captured outside every context: all three renders below read this
      // very same object and must still disagree.
      const shared = profile

      const ROUNDS = 10
      const render = (auth: unknown): Promise<string[]> =>
        als.run(eventFor(auth), async () => {
          const seen: string[] = []
          for (let round = 0; round < ROUNDS; round++) {
            seen.push(
              `${shared.current.type}:${shared.current.handle ?? '-'}:${shared.isAuthenticated}`,
            )
            // Yield, so the other contexts run between two reads of ours.
            await Promise.resolve()
          }
          return seen
        })

      const [mari, anon, alex] = await Promise.all([
        render(authedLocals(MARI)),
        render(anonLocals()),
        render(authedLocals(ALEX)),
      ])

      expect(mari).toEqual(
        Array<string>(ROUNDS).fill('authenticated:mari.test:true'),
      )
      expect(anon).toEqual(Array<string>(ROUNDS).fill('guest:-:false'))
      expect(alex).toEqual(
        Array<string>(ROUNDS).fill('authenticated:alex.test:true'),
      )
    })
  })

  describe('writes cannot reach across requests', () => {
    it('syncFromServer during one render does not change another', async () => {
      const { profile, installRequestEventAccessor } = await freshAuth()
      const als = new AsyncLocalStorage<RequestEvent>()
      installRequestEventAccessor(() => als.getStore())

      als.run(eventFor(authedLocals(MARI)), () => {
        // A component calling this during SSR must not publish its account to
        // the process.
        profile.syncFromServer({
          authenticated: true,
          activeAccountId: MARI.did,
          account: {
            id: MARI.did,
            did: MARI.did,
            handle: MARI.handle,
            instance: ACCOUNT_INSTANCE,
            avatar: MARI.avatar,
          },
        } as unknown as ServerSession)
      })

      const anonymous = als.run(eventFor(anonLocals()), () => ({
        type: profile.current.type,
        authenticated: profile.isAuthenticated,
      }))

      expect(anonymous).toEqual({ type: 'guest', authenticated: false })
    })

    it('assigning profile.current during a render is a no-op', async () => {
      const { profile, installRequestEventAccessor } = await freshAuth()
      installRequestEventAccessor(() => eventFor(anonLocals()))

      // id 'guest' deliberately COLLIDES with the profile already in `meta`.
      // The setter overwrites by id, so an implementation that still writes
      // through to module state on the server really does corrupt the render
      // here — an id that matched nothing would let the test pass for the
      // wrong reason.
      const impostor = {
        type: 'authenticated',
        id: 'guest',
        instance: ACCOUNT_INSTANCE,
        jwt: 'authenticated',
        did: MARI.did,
        handle: MARI.handle,
      } as unknown as AuthenticatedProfile

      profile.current = impostor

      expect(profile.current.type).toBe('guest')
      expect(profile.isAuthenticated).toBe(false)
    })
  })
})

describe('profileFromSession', () => {
  it('maps an authenticated session onto an authenticated profile', async () => {
    const { profileFromSession } = await freshAuth()

    const mapped = profileFromSession({
      authenticated: true,
      activeAccountId: MARI.did,
      account: {
        id: MARI.did,
        did: MARI.did,
        handle: MARI.handle,
        instance: ACCOUNT_INSTANCE,
        avatar: MARI.avatar,
      },
    } as unknown as ServerSession)

    expect(mapped).toEqual({
      type: 'authenticated',
      id: MARI.did,
      instance: ACCOUNT_INSTANCE,
      jwt: 'authenticated',
      did: MARI.did,
      handle: MARI.handle,
      avatar: MARI.avatar,
    })
  })

  it('maps an unauthenticated session, and no session at all, onto a guest', async () => {
    const { profileFromSession } = await freshAuth()

    expect(
      profileFromSession({
        authenticated: false,
      } as unknown as ServerSession).type,
    ).toBe('guest')
    expect(profileFromSession(undefined).type).toBe('guest')
  })
})

describe('Profile.meta — server render', () => {
  it('describes only the account of the request being rendered', async () => {
    const { profile, installRequestEventAccessor } = await freshAuth()
    installRequestEventAccessor(() => eventFor(authedLocals(MARI)))

    // `meta.profiles` is what the shell renders the signed-in account from.
    // On the server it must describe this request, not whatever the process
    // last wrote.
    expect(profile.meta.profiles).toHaveLength(1)
    expect(profile.meta.profiles[0]).toEqual(profile.current)
    expect(profile.meta.profile).toBe(MARI.did)
  })

  it('describes a lone guest for an anonymous request', async () => {
    const { profile, installRequestEventAccessor } = await freshAuth()
    installRequestEventAccessor(() => eventFor(anonLocals()))

    expect(profile.meta.profiles).toHaveLength(1)
    expect(profile.meta.profiles[0].type).toBe('guest')
    expect(profile.meta.profile).toBe('guest')
  })

  it('does not leak one request’s account list into another', async () => {
    const { profile, installRequestEventAccessor } = await freshAuth()
    const als = new AsyncLocalStorage<RequestEvent>()
    installRequestEventAccessor(() => als.getStore())

    const shared = profile
    const ROUNDS = 10
    const render = (auth: unknown): Promise<string[]> =>
      als.run(eventFor(auth), async () => {
        const seen: string[] = []
        for (let round = 0; round < ROUNDS; round++) {
          seen.push(
            `${shared.meta.profile}:${shared.meta.profiles.map((p) => p.handle ?? '-').join(',')}`,
          )
          await Promise.resolve()
        }
        return seen
      })

    const [mari, anon, alex] = await Promise.all([
      render(authedLocals(MARI)),
      render(anonLocals()),
      render(authedLocals(ALEX)),
    ])

    expect(mari).toEqual(Array<string>(ROUNDS).fill(`${MARI.did}:mari.test`))
    expect(anon).toEqual(Array<string>(ROUNDS).fill('guest:-'))
    expect(alex).toEqual(Array<string>(ROUNDS).fill(`${ALEX.did}:alex.test`))
  })
})

describe('sessionFromLocals — shape parity with the server’s own mapper', () => {
  it('builds the same account fields the server sends to the client', async () => {
    const { sessionFromLocals } = await freshAuth()
    // The REAL server module, not the file-wide `{}` mock: these two mappers
    // describe the same account from different sides, and a field added to
    // one and not the other is a silent divergence between what SSR renders
    // and what the client hydrates with.
    const { toClientAccount } = await vi.importActual<
      typeof import('$lib/server/session')
    >('$lib/server/session')

    const mapped = sessionFromLocals(authedLocals(MARI) as never)
    // Narrowing rather than `!`: `ClientSession` is a discriminated union, and
    // only the authenticated arm carries an account.
    if (!mapped?.authenticated) {
      throw new Error('expected an authenticated session')
    }

    expect(Object.keys(mapped.account).sort()).toEqual(
      Object.keys(toClientAccount(MARI as never)).sort(),
    )
    expect(mapped.account).toEqual(toClientAccount(MARI as never))
  })

  it('maps an unauthenticated request to no session at all', async () => {
    const { sessionFromLocals } = await freshAuth()

    expect(sessionFromLocals(anonLocals() as never)).toBeUndefined()
    expect(sessionFromLocals(undefined)).toBeUndefined()
  })
})
