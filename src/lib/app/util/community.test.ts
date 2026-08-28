import { describe, expect, it } from 'vitest'
import {
  canonicalCommunityParam,
  communityAddress,
  communityMention,
  encodeCommunityParam,
} from './community'

describe('communityMention', () => {
  it('uses the structured origin field when present', () => {
    expect(
      communityMention({
        name: 'comicstrips',
        handle: 'comicstrips.lemmy-world.tdpl.io',
        origin: 'lemmy.world',
      }),
    ).toBe('!comicstrips@lemmy.world')
  })

  it('ignores a blank origin and derives from the handle instead', () => {
    expect(
      communityMention({
        name: 'nba',
        handle: 'c-nba.coves.social',
        origin: '  ',
      }),
    ).toBe('!nba@coves.social')
  })

  it('splits a c- handle on its first label', () => {
    expect(
      communityMention({ name: 'nba', handle: 'c-nba.coves.social' }),
    ).toBe('!nba@coves.social')
  })

  it('splits a four-label tdpl.io bridge handle', () => {
    expect(
      communityMention({ name: 'linux', handle: 'linux.lemmy-ml.tdpl.io' }),
    ).toBe('!linux@lemmy-ml.tdpl.io')
  })

  it('does not split a tdpl.io handle with a different label count', () => {
    expect(
      communityMention({ name: 'linux', handle: 'a.b.linux.lemmy-ml.tdpl.io' }),
    ).toBe('!a.b.linux.lemmy-ml.tdpl.io')
  })

  it('shows only !name for an unresolved or missing handle', () => {
    expect(communityMention({ name: 'nba', handle: 'handle.invalid' })).toBe(
      '!nba',
    )
    expect(communityMention({ name: 'nba' })).toBe('!nba')
  })
})

describe('communityAddress', () => {
  it('is the mention without the ! sigil', () => {
    expect(
      communityAddress({
        name: 'comicstrips',
        handle: 'comicstrips.lemmy-world.tdpl.io',
        origin: 'lemmy.world',
      }),
    ).toBe('comicstrips@lemmy.world')
    expect(
      communityAddress({ name: 'nba', handle: 'c-nba.coves.social' }),
    ).toBe('nba@coves.social')
  })

  it('shows only the name for an unresolved or missing handle', () => {
    expect(communityAddress({ name: 'nba', handle: 'handle.invalid' })).toBe(
      'nba',
    )
    expect(communityAddress({ name: 'nba' })).toBe('nba')
  })
})

describe('canonicalCommunityParam', () => {
  const local = 'coves.social'

  it('returns the bare name when the origin is the local instance', () => {
    expect(
      canonicalCommunityParam(
        { did: 'did:plc:x', name: 'gaming', origin: 'coves.social' },
        local,
      ),
    ).toBe('gaming')
  })

  it('compares origins case-insensitively and ignores padding', () => {
    expect(
      canonicalCommunityParam(
        { did: 'did:plc:x', name: 'gaming', origin: ' Coves.Social ' },
        local,
      ),
    ).toBe('gaming')
  })

  it('lower-cases the name so there is a single canonical spelling', () => {
    expect(
      canonicalCommunityParam(
        { did: 'did:plc:x', name: 'Gaming', origin: 'coves.social' },
        local,
      ),
    ).toBe('gaming')
    expect(
      canonicalCommunityParam(
        { did: 'did:plc:x', name: 'ComicStrips', origin: 'Lemmy.World' },
        local,
      ),
    ).toBe('comicstrips@lemmy.world')
  })

  it('returns name@origin for a bridged community', () => {
    expect(
      canonicalCommunityParam(
        {
          did: 'did:plc:x',
          name: 'comicstrips',
          handle: 'comicstrips.lemmy-world.tdpl.io',
          origin: 'lemmy.world',
        },
        local,
      ),
    ).toBe('comicstrips@lemmy.world')
  })

  it('returns name@origin for another Coves instance', () => {
    expect(
      canonicalCommunityParam(
        { did: 'did:plc:x', name: 'gaming', origin: 'other.coves.net' },
        local,
      ),
    ).toBe('gaming@other.coves.net')
  })

  it('treats every origin as remote when no local domain is configured', () => {
    expect(
      canonicalCommunityParam(
        { did: 'did:plc:x', name: 'gaming', origin: 'coves.social' },
        null,
      ),
    ).toBe('gaming@coves.social')
  })

  it('returns undefined when origin is absent or blank', () => {
    expect(
      canonicalCommunityParam({ did: 'did:plc:x', name: 'gaming' }, local),
    ).toBeUndefined()
    expect(
      canonicalCommunityParam(
        { did: 'did:plc:x', name: 'gaming', origin: '  ' },
        local,
      ),
    ).toBeUndefined()
  })

  it('returns undefined when the name would not survive the route matcher', () => {
    expect(
      canonicalCommunityParam(
        { did: 'did:plc:x', name: 'has space', origin: 'coves.social' },
        local,
      ),
    ).toBeUndefined()
    expect(
      canonicalCommunityParam(
        { did: 'did:plc:x', name: '', origin: 'coves.social' },
        local,
      ),
    ).toBeUndefined()
  })

  it('returns undefined when a remote origin is not a hostname', () => {
    expect(
      canonicalCommunityParam(
        { did: 'did:plc:x', name: 'gaming', origin: 'not a host' },
        local,
      ),
    ).toBeUndefined()
  })
})

describe('encodeCommunityParam', () => {
  it('keeps the @ of an address literal', () => {
    expect(encodeCommunityParam('gaming@coves.social')).toBe(
      'gaming@coves.social',
    )
  })

  it('still percent-encodes a DID', () => {
    expect(encodeCommunityParam('did:plc:abc')).toBe('did%3Aplc%3Aabc')
  })
})
