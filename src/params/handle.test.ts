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

  describe('reserved route segments', () => {
    it('rejects "settings"', () => {
      expect(match('settings')).toBe(false)
    })

    it('rejects "blocks"', () => {
      expect(match('blocks')).toBe(false)
    })

    it('rejects "media"', () => {
      expect(match('media')).toBe(false)
    })

    it('rejects "voted"', () => {
      expect(match('voted')).toBe(false)
    })

    it('rejects "saved"', () => {
      expect(match('saved')).toBe(false)
    })
  })

  describe('invalid strings', () => {
    it('rejects empty string', () => {
      expect(match('')).toBe(false)
    })

    it('rejects a single word without dots', () => {
      expect(match('alice')).toBe(false)
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
  })
})
