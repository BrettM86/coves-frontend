import type { CommunityRef, CommunityView } from '$lib/api/coves/types'
import { describe, expect, it } from 'vitest'
import {
  communityDisplayName,
  communityHandleOrName,
  communityIdentifier,
} from './helpers'

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
  it('strips the c- prefix from the handle', () => {
    expect(communityIdentifier(makeCommunity())).toBe('science.coves.social')
  })

  it('falls back to the did when the handle is missing', () => {
    expect(communityIdentifier(makeCommunity({ handle: undefined }))).toBe(
      'did:plc:community123',
    )
  })

  it('falls back to the did for the unresolved-handle sentinel', () => {
    expect(
      communityIdentifier(makeCommunity({ handle: 'handle.invalid' })),
    ).toBe('did:plc:community123')
  })
})

describe('communityHandleOrName', () => {
  it('strips the c- prefix so display copy shows the canonical handle', () => {
    expect(communityHandleOrName(makeCommunity())).toBe('science.coves.social')
  })

  it('passes through a handle without the c- prefix unchanged', () => {
    expect(
      communityHandleOrName(
        makeCommunity({ handle: 'linux.lemmy-ml.tdpl.io' }),
      ),
    ).toBe('linux.lemmy-ml.tdpl.io')
  })

  it('only strips a c- at the very beginning', () => {
    expect(
      communityHandleOrName(
        makeCommunity({ handle: 'myc-thing.coves.social' }),
      ),
    ).toBe('myc-thing.coves.social')
  })

  it('falls back to the name when the handle is missing', () => {
    expect(communityHandleOrName(makeCommunity({ handle: undefined }))).toBe(
      'science',
    )
  })

  it('falls back to the name for the unresolved-handle sentinel', () => {
    expect(
      communityHandleOrName(makeCommunity({ handle: 'handle.invalid' })),
    ).toBe('science')
  })

  it('never returns a did', () => {
    const ref: CommunityRef = {
      did: 'did:plc:community123',
      name: 'science',
    } as CommunityRef
    expect(communityHandleOrName(ref)).toBe('science')
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
