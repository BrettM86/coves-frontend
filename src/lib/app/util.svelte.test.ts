import { describe, it, expect } from 'vitest'
import type { AuthorView, CommunityRef } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import {
  canParseUrl,
  communityLink,
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
})

// ---------------------------------------------------------------------------
// userLink()
// ---------------------------------------------------------------------------

describe('userLink', () => {
  const author: AuthorView = {
    did: 'did:plc:user1' as DID,
    handle: 'alice.coves.social' as Handle,
  }

  it('returns /u/{handle} for AuthorView with handle', () => {
    expect(userLink(author)).toBe('/u/alice.coves.social')
  })

  it('returns /u/{did} for AuthorView without handle', () => {
    const noHandle: AuthorView = {
      did: 'did:plc:user1' as DID,
      handle: '' as Handle,
    }
    expect(userLink(noHandle)).toBe('/u/did:plc:user1')
  })

  it('prepends prefix when provided', () => {
    expect(userLink(author, '/app')).toBe('/app/u/alice.coves.social')
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
