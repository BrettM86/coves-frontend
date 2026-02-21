import { describe, it, expect } from 'vitest'
import type { AuthorView, CommunityRef } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import {
  canParseUrl,
  communityHandleFromSlug,
  communityLink,
  communitySlug,
  escapeHtml,
  findClosestNumber,
  isImage,
  isVideo,
  userLink,
} from './util.svelte'

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

  it('returns /c/{name} for CommunityRef without handle', () => {
    const noHandle: CommunityRef = {
      did: 'did:plc:abc123' as DID,
      handle: '' as Handle,
      name: 'tech',
    }
    expect(communityLink(noHandle)).toBe('/c/tech')
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
// communityHandleFromSlug()
// ---------------------------------------------------------------------------

describe('communityHandleFromSlug', () => {
  it('prepends c- to a plain slug', () => {
    expect(communityHandleFromSlug('gaming.coves.social')).toBe(
      'c-gaming.coves.social',
    )
  })

  it('does not double-prefix a slug that already starts with c-', () => {
    expect(communityHandleFromSlug('c-gaming.coves.social')).toBe(
      'c-gaming.coves.social',
    )
  })

  it('prepends c- to a slug without dots', () => {
    expect(communityHandleFromSlug('gaming')).toBe('c-gaming')
  })

  it('handles an empty string by prepending c-', () => {
    expect(communityHandleFromSlug('')).toBe('c-')
  })
})

// ---------------------------------------------------------------------------
// communitySlug / communityHandleFromSlug round-trip
// ---------------------------------------------------------------------------

describe('communitySlug <-> communityHandleFromSlug round-trip', () => {
  it('round-trip: communityHandleFromSlug(communitySlug(handle)) === handle for c- prefixed handle', () => {
    const handle = 'c-gaming.coves.social'
    expect(communityHandleFromSlug(communitySlug(handle))).toBe(handle)
  })

  it('round-trip: communitySlug(communityHandleFromSlug(slug)) === slug for plain slug', () => {
    const slug = 'gaming.coves.social'
    expect(communitySlug(communityHandleFromSlug(slug))).toBe(slug)
  })

  it('round-trip preserves identity for handle without c- prefix', () => {
    const handle = 'tech.coves.social'
    // communitySlug('tech.coves.social') -> 'tech.coves.social' (no c- to strip)
    // communityHandleFromSlug('tech.coves.social') -> 'c-tech.coves.social'
    // This is NOT a round-trip identity for non-c- handles, which is expected
    // since the canonical handle form uses c- prefix
    expect(communityHandleFromSlug(communitySlug(handle))).toBe(
      'c-tech.coves.social',
    )
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

// ---------------------------------------------------------------------------
// isImage()
// ---------------------------------------------------------------------------

describe('isImage', () => {
  it('returns false for undefined', () => {
    expect(isImage(undefined)).toBe(false)
  })

  it('returns true for .jpg URL', () => {
    expect(isImage('https://example.com/photo.jpg')).toBe(true)
  })

  it('returns true for .png URL (case-insensitive)', () => {
    expect(isImage('https://example.com/PHOTO.PNG')).toBe(true)
  })

  it('returns false for .mp4 URL', () => {
    expect(isImage('https://example.com/video.mp4')).toBe(false)
  })

  it('returns false for URL without image extension', () => {
    expect(isImage('https://example.com/page')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isVideo()
// ---------------------------------------------------------------------------

describe('isVideo', () => {
  it('returns false for undefined', () => {
    expect(isVideo(undefined)).toBe(false)
  })

  it('returns true for .mp4 URL', () => {
    expect(isVideo('https://example.com/clip.mp4')).toBe(true)
  })

  it('returns true for .webm URL', () => {
    expect(isVideo('https://example.com/clip.webm')).toBe(true)
  })

  it('returns false for .jpg URL', () => {
    expect(isVideo('https://example.com/photo.jpg')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// findClosestNumber()
// ---------------------------------------------------------------------------

describe('findClosestNumber', () => {
  it('rounds up to nearest value at or above target', () => {
    expect(findClosestNumber([8, 16, 32, 64, 128], 76)).toBe(128)
  })

  it('returns exact match when present', () => {
    expect(findClosestNumber([8, 16, 32, 64, 128], 64)).toBe(64)
  })

  it('returns smallest value above target', () => {
    expect(findClosestNumber([128, 256, 512, 1024], 200)).toBe(256)
  })
})

// ---------------------------------------------------------------------------
// canParseUrl()
// ---------------------------------------------------------------------------

describe('canParseUrl', () => {
  it('returns true for valid URL', () => {
    expect(canParseUrl('https://example.com')).toBe(true)
  })

  it('returns false for invalid URL', () => {
    expect(canParseUrl('not a url')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// escapeHtml()
// ---------------------------------------------------------------------------

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    )
  })

  it('escapes ampersands and quotes', () => {
    expect(escapeHtml('rock & roll\'s "best"')).toBe(
      'rock &amp; roll&#39;s &quot;best&quot;',
    )
  })
})
