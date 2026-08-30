import { describe, expect, it } from 'vitest'
import { scrub } from './scrub'

/**
 * Secret shapes that carry no `key=value` at all. `scrub` keys off names, so a
 * credential that never names itself is exactly the case it can miss.
 */
describe('scrub on credentials with no key name', () => {
  it('redacts userinfo in a URL while keeping the host', () => {
    const result = scrub('fetch https://user:hunter2@api.example/x failed')

    // A password in the userinfo segment is announced by the `:`/`@` shape
    // alone. The host and path are the diagnostic and must survive.
    expect(result).not.toContain('hunter2')
    expect(result).toContain('api.example')
  })
})
