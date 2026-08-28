import { describe, it, expect, vi } from 'vitest'
import type { AuthorView, CommunityRef } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import {
  communityLink,
  communityRouteParam,
  communitySlug,
  userLink,
} from './links'

// Pins the local instance so the "is this community local?" branch of
// communityLink is deterministic regardless of the developer's shell env.
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.social' },
}))

// ---------------------------------------------------------------------------
// communityLink()
// ---------------------------------------------------------------------------

describe('communityLink', () => {
  const community: CommunityRef = {
    did: 'did:plc:abc123' as DID,
    handle: 'tech.coves.social' as Handle,
    name: 'tech',
  }

  it('returns /c/{handle} for CommunityRef with handle', () => {
    expect(communityLink(community)).toBe('/c/tech.coves.social')
  })

  it('falls back to /c/{did} for CommunityRef without handle', () => {
    // A bare name is not matcher-valid for the [handle=handle] route;
    // the DID keeps the generated URL routable.
    const noHandle: CommunityRef = {
      did: 'did:plc:abc123' as DID,
      handle: '' as Handle,
      name: 'tech',
    }
    expect(communityLink(noHandle)).toBe('/c/did%3Aplc%3Aabc123')
  })

  it('prepends prefix when provided', () => {
    expect(communityLink(community, '/prefix')).toBe(
      '/prefix/c/tech.coves.social',
    )
  })

  it('strips c- prefix from handle in the URL slug', () => {
    const cPrefixCommunity: CommunityRef = {
      did: 'did:plc:abc123' as DID,
      handle: 'c-gaming.coves.social' as Handle,
      name: 'gaming',
    }
    expect(communityLink(cPrefixCommunity)).toBe('/c/gaming.coves.social')
  })

  it('uses the bare name when origin is the local instance', () => {
    const local: CommunityRef = {
      did: 'did:plc:abc123' as DID,
      handle: 'c-gaming.coves.social' as Handle,
      name: 'gaming',
      origin: 'coves.social',
    }
    expect(communityLink(local)).toBe('/c/gaming')
    expect(communityLink(local, '/app')).toBe('/app/c/gaming')
  })

  it('uses name@origin for a remote origin, with a literal @', () => {
    const bridged: CommunityRef = {
      did: 'did:plc:abc123' as DID,
      handle: 'comicstrips.lemmy-world.tdpl.io' as Handle,
      name: 'comicstrips',
      origin: 'lemmy.world',
    }
    expect(communityLink(bridged)).toBe('/c/comicstrips@lemmy.world')
  })

  it('falls back to the handle slug when origin is absent', () => {
    expect(communityLink(community)).toBe('/c/tech.coves.social')
  })

  it('falls back to the DID for the unresolved-handle sentinel', () => {
    const unresolved: CommunityRef = {
      did: 'did:plc:abc123' as DID,
      handle: 'handle.invalid' as Handle,
      name: 'tech',
    }
    expect(communityLink(unresolved)).toBe('/c/did%3Aplc%3Aabc123')
  })

  it('strips c- prefix from handle when prefix is provided', () => {
    const cPrefixCommunity: CommunityRef = {
      did: 'did:plc:abc123' as DID,
      handle: 'c-science.coves.social' as Handle,
      name: 'science',
    }
    expect(communityLink(cPrefixCommunity, '/app')).toBe(
      '/app/c/science.coves.social',
    )
  })
})

// ---------------------------------------------------------------------------
// communityRouteParam()
// ---------------------------------------------------------------------------

describe('communityRouteParam', () => {
  const gaming = {
    did: 'did:plc:abc123',
    handle: 'c-gaming.coves.social',
    name: 'gaming',
    origin: 'coves.social',
  }

  it('returns the unencoded canonical param', () => {
    expect(communityRouteParam(gaming)).toBe('gaming')
    expect(communityRouteParam({ ...gaming, origin: 'lemmy.world' })).toBe(
      'gaming@lemmy.world',
    )
  })

  it('honours an explicit local domain', () => {
    expect(communityRouteParam(gaming, 'other.example')).toBe(
      'gaming@coves.social',
    )
    expect(communityRouteParam(gaming, null)).toBe('gaming@coves.social')
  })

  it('returns the handle slug, then the DID, when origin is absent', () => {
    expect(communityRouteParam({ ...gaming, origin: undefined })).toBe(
      'gaming.coves.social',
    )
    expect(communityRouteParam({ did: 'did:plc:abc123', name: 'gaming' })).toBe(
      'did:plc:abc123',
    )
  })
})

// ---------------------------------------------------------------------------
// communitySlug()
// ---------------------------------------------------------------------------

describe('communitySlug', () => {
  it('strips c- prefix from handle', () => {
    expect(communitySlug('c-gaming.coves.social')).toBe('gaming.coves.social')
  })

  it('passes through handle without c- prefix unchanged', () => {
    expect(communitySlug('nocprefix.social')).toBe('nocprefix.social')
  })

  it('only strips "c-" at the very beginning', () => {
    expect(communitySlug('myc-handle.social')).toBe('myc-handle.social')
  })

  it('handles a handle that is exactly "c-"', () => {
    expect(communitySlug('c-')).toBe('')
  })

  it('handles an empty string', () => {
    expect(communitySlug('')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// communitySlug() — slug stability
//
// A slug goes to the API verbatim, so slugifying an already-slugified handle
// must be a no-op. There is no inverse function: reconstructing the handle by
// re-adding "c-" is what used to 404 every bridged community, whose stored
// handle never had the prefix to begin with.
// ---------------------------------------------------------------------------

describe('communitySlug stability', () => {
  it('is idempotent for a prefixed handle', () => {
    const handle = 'c-gaming.coves.social'
    expect(communitySlug(communitySlug(handle))).toBe(communitySlug(handle))
  })

  it('leaves a bridged handle untouched through repeated slugging', () => {
    const bridged = 'selfhosted.lemmy-world.tdpl.io'
    expect(communitySlug(bridged)).toBe(bridged)
    expect(communitySlug(communitySlug(bridged))).toBe(bridged)
  })

  it('passes a did:plc DID through unchanged', () => {
    expect(communitySlug('did:plc:abc123xyz')).toBe('did:plc:abc123xyz')
  })

  it('passes a did:web DID through unchanged', () => {
    expect(communitySlug('did:web:coves.social')).toBe('did:web:coves.social')
  })
})

// ---------------------------------------------------------------------------
// userLink()
// ---------------------------------------------------------------------------

describe('userLink', () => {
  const author: AuthorView = {
    did: 'did:plc:user1' as DID,
    handle: 'alice.coves.social' as Handle,
  }

  it('returns /profile/{handle} for AuthorView with handle', () => {
    expect(userLink(author)).toBe('/profile/alice.coves.social')
  })

  it('returns /profile/{did} for AuthorView without handle', () => {
    const noHandle: AuthorView = {
      did: 'did:plc:user1' as DID,
      handle: '' as Handle,
    }
    expect(userLink(noHandle)).toBe('/profile/did%3Aplc%3Auser1')
  })

  it('prepends prefix when provided', () => {
    expect(userLink(author, '/app')).toBe('/app/profile/alice.coves.social')
  })
})
