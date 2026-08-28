import { describe, it, expect } from 'vitest'
import { match } from './actor'

describe('actor param matcher', () => {
  it('matches a DNS handle', () => {
    expect(match('alice.coves.social')).toBe(true)
    expect(match('my-user.some-domain.co')).toBe(true)
  })

  it('matches a URL-encoded DID', () => {
    expect(match('did%3Aplc%3Aabc123')).toBe(true)
    expect(match('did%3Aweb%3Aexample.com')).toBe(true)
  })

  it('rejects a bare label so static /profile siblings keep routing', () => {
    for (const segment of ['alice', 'settings', 'blocks', 'media', 'voted']) {
      expect(match(segment)).toBe(false)
    }
  })

  it('rejects a community address', () => {
    expect(match('gaming@coves.social')).toBe(false)
    expect(match('gaming%40coves.social')).toBe(false)
  })

  it('rejects malformed strings', () => {
    expect(match('')).toBe(false)
    expect(match('-alice.example.com')).toBe(false)
    expect(match('alice .example.com')).toBe(false)
  })
})
