import { describe, it, expect } from 'vitest'
import {
  isValidAtUri,
  asAtUri,
  tryAsAtUri,
  parseAtUri,
  isValidCID,
  asCID,
  tryAsCID,
} from './types'
import type { AtUri } from './types'

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
