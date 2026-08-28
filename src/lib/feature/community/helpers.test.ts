import type { CommunityRef, CommunityView } from '$lib/api/coves/types'
import { describe, expect, it, vi } from 'vitest'
import {
  communityDisplayName,
  communityMention,
  communityIdentifier,
} from './helpers'

vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.social' },
}))

type CommunityOverrides = Partial<Omit<CommunityView, 'handle'>> & {
  handle?: string
}

function makeCommunity(overrides: CommunityOverrides = {}): CommunityView {
  return {
    did: 'did:plc:community123',
    name: 'science',
    handle: 'c-science.coves.social',
    ...overrides,
  } as CommunityView
}

describe('communityIdentifier', () => {
  it('uses the bare name for a community on the local instance', () => {
    expect(communityIdentifier(makeCommunity({ origin: 'coves.social' }))).toBe(
      'science',
    )
  })

  it('uses name@origin for a remote community', () => {
    expect(
      communityIdentifier(
        makeCommunity({
          name: 'linux',
          handle: 'linux.lemmy-ml.tdpl.io',
          origin: 'lemmy.ml',
        }),
      ),
    ).toBe('linux@lemmy.ml')
  })

  it('strips the c- prefix from the handle when origin is absent', () => {
    expect(communityIdentifier(makeCommunity())).toBe('science.coves.social')
  })

  it('falls back to the encoded did when the handle is missing', () => {
    expect(communityIdentifier(makeCommunity({ handle: undefined }))).toBe(
      'did%3Aplc%3Acommunity123',
    )
  })

  it('falls back to the encoded did for the unresolved-handle sentinel', () => {
    expect(
      communityIdentifier(makeCommunity({ handle: 'handle.invalid' })),
    ).toBe('did%3Aplc%3Acommunity123')
  })
})

describe('communityMention', () => {
  it('renders !name@origin when the appview serves origin', () => {
    expect(communityMention(makeCommunity({ origin: 'coves.social' }))).toBe(
      '!science@coves.social',
    )
  })

  it('prefers origin over the handle for bridged communities', () => {
    expect(
      communityMention(
        makeCommunity({
          name: 'linux',
          handle: 'linux.lemmy-ml.tdpl.io',
          origin: 'lemmy.ml',
        }),
      ),
    ).toBe('!linux@lemmy.ml')
  })

  it('derives name@origin from a c- handle when origin is absent', () => {
    expect(communityMention(makeCommunity())).toBe('!science@coves.social')
  })

  it('derives name@origin from a tdpl.io bridge handle when origin is absent', () => {
    expect(
      communityMention(
        makeCommunity({ name: 'linux', handle: 'linux.lemmy-ml.tdpl.io' }),
      ),
    ).toBe('!linux@lemmy-ml.tdpl.io')
  })

  it('falls back to the canonical slug for a handle it cannot split', () => {
    expect(
      communityMention(makeCommunity({ handle: 'myc-thing.coves.social' })),
    ).toBe('!myc-thing.coves.social')
  })

  it('falls back to !name when the handle is missing', () => {
    expect(communityMention(makeCommunity({ handle: undefined }))).toBe(
      '!science',
    )
  })

  it('falls back to !name for the unresolved-handle sentinel', () => {
    expect(communityMention(makeCommunity({ handle: 'handle.invalid' }))).toBe(
      '!science',
    )
  })

  it('never returns a did', () => {
    const ref: CommunityRef = {
      did: 'did:plc:community123',
      name: 'science',
    } as CommunityRef
    expect(communityMention(ref)).toBe('!science')
  })
})

describe('communityDisplayName', () => {
  it('prefers displayName over name', () => {
    expect(
      communityDisplayName(makeCommunity({ displayName: 'Science' })),
    ).toBe('Science')
  })

  it('falls back to name when displayName is absent', () => {
    expect(communityDisplayName(makeCommunity())).toBe('science')
  })
})
