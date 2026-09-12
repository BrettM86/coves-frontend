import { describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ getProfile: vi.fn() }))
const coves = vi.hoisted(() => vi.fn(() => api))

vi.mock('$lib/api/client.svelte', () => ({ coves }))

import { load } from './+page'

describe('profile settings loader', () => {
  it('loads the authenticated actor profile with the route fetch', async () => {
    const userProfile = {
      did: 'did:plc:alice',
      handle: 'alice.coves.social',
      createdAt: '2026-09-01T00:00:00Z',
      displayName: 'Alice',
      description: 'Hello',
    }
    api.getProfile.mockResolvedValue(userProfile)
    const routeFetch = vi.fn<typeof fetch>()

    const result = await load({
      fetch: routeFetch,
      parent: vi.fn().mockResolvedValue({
        session: {
          authenticated: true,
          account: { did: 'did:plc:alice' },
        },
      }),
    } as unknown as Parameters<typeof load>[0])

    expect(coves).toHaveBeenCalledWith({ func: routeFetch })
    expect(api.getProfile).toHaveBeenCalledWith({ actor: 'did:plc:alice' })
    expect(result).toEqual({ profile: userProfile })
  })
})
