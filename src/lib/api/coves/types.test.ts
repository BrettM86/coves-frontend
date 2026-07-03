import { describe, it, expect } from 'vitest'
import {
  isValidAtUri,
  asAtUri,
  tryAsAtUri,
  parseAtUri,
  isValidCID,
  asCID,
  tryAsCID,
  isHydratedPost,
  isCommentView,
} from './types'
import type { AtUri, CID, CommentView, PostView, PostViewUnion } from './types'

// ---------------------------------------------------------------------------
// isValidAtUri
// ---------------------------------------------------------------------------

describe('isValidAtUri', () => {
  it('accepts a valid AT-URI with DID only', () => {
    expect(isValidAtUri('at://did:plc:abc123')).toBe(true)
  })

  it('accepts a valid AT-URI with collection', () => {
    expect(isValidAtUri('at://did:plc:abc123/app.bsky.feed.post')).toBe(true)
  })

  it('accepts a valid AT-URI with collection and rkey', () => {
    expect(isValidAtUri('at://did:plc:abc123/app.bsky.feed.post/3jui7kd')).toBe(
      true,
    )
  })

  it('accepts a DID with web method', () => {
    expect(isValidAtUri('at://did:web:example.com')).toBe(true)
  })

  it('rejects an empty string', () => {
    expect(isValidAtUri('')).toBe(false)
  })

  it('rejects a plain URL', () => {
    expect(isValidAtUri('https://example.com')).toBe(false)
  })

  it('rejects a string without at:// prefix', () => {
    expect(isValidAtUri('did:plc:abc123')).toBe(false)
  })

  it('rejects an AT-URI with missing DID method', () => {
    expect(isValidAtUri('at://did:')).toBe(false)
  })

  it('rejects a random string', () => {
    expect(isValidAtUri('hello world')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// asAtUri
// ---------------------------------------------------------------------------

describe('asAtUri', () => {
  it('returns the branded type for a valid AT-URI', () => {
    const uri = asAtUri('at://did:plc:abc123/post/1')
    expect(uri).toBe('at://did:plc:abc123/post/1')
  })

  it('throws on an invalid AT-URI', () => {
    expect(() => asAtUri('not-an-at-uri')).toThrow('Invalid AT-URI format')
  })
})

// ---------------------------------------------------------------------------
// tryAsAtUri
// ---------------------------------------------------------------------------

describe('tryAsAtUri', () => {
  it('returns the branded type for a valid AT-URI', () => {
    const uri = tryAsAtUri('at://did:plc:abc123/post/1')
    expect(uri).toBe('at://did:plc:abc123/post/1')
  })

  it('returns null for an invalid AT-URI', () => {
    expect(tryAsAtUri('not-valid')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parseAtUri
// ---------------------------------------------------------------------------

describe('parseAtUri', () => {
  it('parses a standard 3-segment AT-URI into did, collection, and rkey', () => {
    const uri = 'at://did:plc:abc123/social.coves.community.post/abc' as AtUri
    const result = parseAtUri(uri)
    expect(result.did).toBe('did:plc:abc123')
    expect(result.collection).toBe('social.coves.community.post')
    expect(result.rkey).toBe('abc')
  })

  it('parses an AT-URI with a web DID method', () => {
    const uri = 'at://did:web:example.com/app.bsky.feed.post/3jui7kd' as AtUri
    const result = parseAtUri(uri)
    expect(result.did).toBe('did:web:example.com')
    expect(result.collection).toBe('app.bsky.feed.post')
    expect(result.rkey).toBe('3jui7kd')
  })

  it('parses an AT-URI with a longer rkey', () => {
    const uri =
      'at://did:plc:xyz789/social.coves.community.post/3jui7kd2xsabcdef' as AtUri
    const result = parseAtUri(uri)
    expect(result.did).toBe('did:plc:xyz789')
    expect(result.collection).toBe('social.coves.community.post')
    expect(result.rkey).toBe('3jui7kd2xsabcdef')
  })

  it('throws on AT-URI with only did and collection (2 segments)', () => {
    const uri = 'at://did:plc:abc123/social.coves.community.post' as AtUri
    expect(() => parseAtUri(uri)).toThrow('Malformed AT-URI')
  })

  it('throws on AT-URI with only did (1 segment)', () => {
    const uri = 'at://did:plc:abc123' as AtUri
    expect(() => parseAtUri(uri)).toThrow('Malformed AT-URI')
  })
})

// ---------------------------------------------------------------------------
// isValidCID
// ---------------------------------------------------------------------------

describe('isValidCID', () => {
  it('accepts a valid base32 CID', () => {
    expect(isValidCID('bafyreib2rxk3rybsftg4qpz')).toBe(true)
  })

  it('accepts a valid base64 CID', () => {
    expect(isValidCID('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG')).toBe(
      true,
    )
  })

  it('rejects an empty string', () => {
    expect(isValidCID('')).toBe(false)
  })

  it('rejects a string with spaces', () => {
    expect(isValidCID('invalid cid')).toBe(false)
  })

  it('rejects a string with special characters', () => {
    expect(isValidCID('bafy!@#$')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// asCID
// ---------------------------------------------------------------------------

describe('asCID', () => {
  it('returns the branded type for a valid CID', () => {
    const cid = asCID('bafyreib2rxk3rybsftg4qpz')
    expect(cid).toBe('bafyreib2rxk3rybsftg4qpz')
  })

  it('throws on an invalid CID', () => {
    expect(() => asCID('')).toThrow('Invalid CID format')
  })
})

// ---------------------------------------------------------------------------
// tryAsCID
// ---------------------------------------------------------------------------

describe('tryAsCID', () => {
  it('returns the branded type for a valid CID', () => {
    const cid = tryAsCID('bafyreib2rxk3rybsftg4qpz')
    expect(cid).toBe('bafyreib2rxk3rybsftg4qpz')
  })

  it('returns null for an invalid CID', () => {
    expect(tryAsCID('')).toBeNull()
  })

  it('returns null for a string with invalid characters', () => {
    expect(tryAsCID('bafy!invalid')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// isHydratedPost
// ---------------------------------------------------------------------------

describe('isHydratedPost', () => {
  const postView = {
    uri: 'at://did:plc:abc/social.coves.community.post/1' as AtUri,
    cid: 'bafyreib2rxk3rybsftg4qpz' as CID,
  } as PostView

  it('accepts a hydrated post view', () => {
    expect(isHydratedPost(postView)).toBe(true)
  })

  it('rejects a notFound sentinel', () => {
    const el: PostViewUnion = {
      uri: 'at://did:plc:abc/social.coves.community.post/2' as AtUri,
      notFound: true,
    }
    expect(isHydratedPost(el)).toBe(false)
  })

  it('rejects a blocked sentinel', () => {
    const el: PostViewUnion = {
      uri: 'at://did:plc:abc/social.coves.community.post/3' as AtUri,
      blocked: true,
    }
    expect(isHydratedPost(el)).toBe(false)
  })

  it('treats an element without a known unavailable flag as a post', () => {
    // Flag-negative discrimination: only the documented sentinels
    // (notFound/blocked) are unavailable. A real-but-malformed post that arrives
    // missing `cid` is still a post — it must not be silently reclassified as
    // removed (the failure mode of probing for a positive `cid` shape).
    const el = {
      uri: 'at://did:plc:abc/social.coves.community.post/4' as AtUri,
    } as unknown as PostViewUnion
    expect(isHydratedPost(el)).toBe(true)
  })

  it('rejects null and undefined', () => {
    expect(isHydratedPost(null)).toBe(false)
    expect(isHydratedPost(undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isCommentView
// ---------------------------------------------------------------------------

describe('isCommentView', () => {
  it('identifies a CommentView by its required post back-reference', () => {
    const comment = {
      uri: 'at://did:plc:abc/social.coves.community.comment/1' as AtUri,
      post: {
        uri: 'at://did:plc:abc/social.coves.community.post/1' as AtUri,
        cid: 'bafyreib2rxk3rybsftg4qpz' as CID,
      },
    } as CommentView
    expect(isCommentView(comment)).toBe(true)
  })

  it('rejects a PostView, which carries no post field', () => {
    // Pins the guard's invariant: PostView must never gain a `post` field
    // without isCommentView being updated alongside it.
    const post = {
      uri: 'at://did:plc:abc/social.coves.community.post/1' as AtUri,
      cid: 'bafyreib2rxk3rybsftg4qpz' as CID,
    } as PostView
    expect(isCommentView(post)).toBe(false)
  })
})
