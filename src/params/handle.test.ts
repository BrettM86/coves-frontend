import { describe, it, expect } from 'vitest'
import { match } from './handle'

describe('handle param matcher', () => {
  describe('valid handles', () => {
    it('matches a standard handle', () => {
      expect(match('alice.coves.social')).toBe(true)
    })

    it('matches a two-segment handle', () => {
      expect(match('bob.example.com')).toBe(true)
    })

    it('matches a handle with hyphens', () => {
      expect(match('my-user.some-domain.co')).toBe(true)
    })

    it('matches a handle with numeric segments', () => {
      expect(match('user1.test123.org')).toBe(true)
    })
  })

  describe('valid DIDs (URL-encoded)', () => {
    it('matches a URL-encoded did:plc', () => {
      expect(match('did%3Aplc%3Aabc123')).toBe(true)
    })

    it('matches a URL-encoded did:web', () => {
      expect(match('did%3Aweb%3Aexample.com')).toBe(true)
    })
  })

  describe('community addresses (name@origin)', () => {
    it('matches a local-style address', () => {
      expect(match('gaming@coves.social')).toBe(true)
    })

    it('matches a bridged Lemmy address', () => {
      expect(match('comicstrips@lemmy.world')).toBe(true)
    })

    it('matches a URL-encoded @', () => {
      expect(match('gaming%40coves.social')).toBe(true)
    })

    it('rejects a name with underscores, as the AppView resolver does', () => {
      expect(match('linux_gaming@lemmy.ml')).toBe(false)
    })

    it('rejects an address whose origin is not a hostname', () => {
      expect(match('gaming@coves')).toBe(false)
    })

    it('rejects an empty name', () => {
      expect(match('@coves.social')).toBe(false)
    })

    it('rejects an empty origin', () => {
      expect(match('gaming@')).toBe(false)
    })

    it('rejects the display sigil', () => {
      expect(match('!gaming@coves.social')).toBe(false)
    })

    it('rejects a second @', () => {
      expect(match('gaming@coves@social.net')).toBe(false)
    })
  })

  describe('bare community names', () => {
    it('matches a single label', () => {
      expect(match('gaming')).toBe(true)
    })

    it('matches a label with interior hyphens', () => {
      expect(match('retro-gaming-2')).toBe(true)
    })

    it('rejects a label longer than a DNS label', () => {
      expect(match('a'.repeat(63))).toBe(true)
      expect(match('a'.repeat(64))).toBe(false)
    })

    it('rejects a leading or trailing hyphen', () => {
      expect(match('-gaming')).toBe(false)
      expect(match('gaming-')).toBe(false)
    })

    it('rejects whitespace', () => {
      expect(match('gam ing')).toBe(false)
      expect(match('gaming ')).toBe(false)
    })

    it('rejects a leading sigil', () => {
      expect(match('!gaming')).toBe(false)
    })
  })

  describe('static sibling names', () => {
    it('does not reserve any bare name: /c has no static siblings', () => {
      expect(match('settings')).toBe(true)
      expect(match('media')).toBe(true)
    })
  })

  describe('invalid strings', () => {
    it('rejects empty string', () => {
      expect(match('')).toBe(false)
    })

    it('rejects a string with spaces', () => {
      expect(match('alice .example.com')).toBe(false)
    })

    it('rejects a string starting with a hyphen', () => {
      expect(match('-alice.example.com')).toBe(false)
    })

    it('rejects a string with only dots', () => {
      expect(match('...')).toBe(false)
    })

    it('rejects a malformed percent-escape instead of throwing', () => {
      expect(match('%E0%A4%A')).toBe(false)
      expect(match('gaming%')).toBe(false)
    })
  })
})
