import { describe, expect, it } from 'vitest'
import { userLabel } from './helpers'

const did = 'did:plc:abc123'

describe('userLabel', () => {
  it('prefixes a resolvable handle with the sigil', () => {
    expect(userLabel({ did, handle: 'alice.coves.social' })).toBe(
      '@alice.coves.social',
    )
  })

  it('falls back to the DID when the handle is absent', () => {
    expect(userLabel({ did })).toBe(did)
  })

  it('falls back to the DID for the handle.invalid sentinel', () => {
    expect(userLabel({ did, handle: 'handle.invalid' })).toBe(did)
  })

  it('falls back to the DID for an empty handle', () => {
    expect(userLabel({ did, handle: '' })).toBe(did)
  })
})
