import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'

vi.stubGlobal('__VERSION__', 'test')
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: {
    current: {
      type: 'authenticated',
      did: 'did:plc:alice',
      handle: 'alice.coves.social',
      jwt: 'authenticated',
      instance: 'https://coves.test',
    },
  },
}))

import ProfileMenu from './navbar/Profile.svelte'

describe('profile settings navigation', () => {
  it('keeps profile editing out of the account menu', () => {
    const body = render(ProfileMenu, {
      context: new Map([
        ['__request__', { page: { url: new URL('https://coves.test/') } }],
      ]),
    }).body

    expect(body).not.toContain('href="/profile/settings"')
    expect(body).toContain('href="/profile/alice.coves.social"')
    expect(body).toContain('href="/profile/blocks"')
  })
})
