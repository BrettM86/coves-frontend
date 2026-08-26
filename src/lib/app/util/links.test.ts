import { describe, it, expect } from 'vitest'
import type { AuthorView, CommunityRef } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import { communityLink, communitySlug, userLink } from './links'

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
