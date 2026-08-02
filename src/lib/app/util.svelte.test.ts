import { describe, it, expect } from 'vitest'
import type { AuthorView, CommunityRef } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import {
  canParseUrl,
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
