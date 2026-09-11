import { describe, expect, it } from 'vitest'
import { loginUrl } from './login-url'

describe('loginUrl', () => {
  it.each([
    '/',
    '/explore/communities?sort=new#latest',
    '/c/orchids?tag=a%26b&sort=top#reply-2',
    '/profile/alice.example.invalid?tab=comments#recent',
  ])('returns to the exact current page %s', (path) => {
    const result = new URL(
      loginUrl(new URL(path, 'https://web.example.invalid')),
      'https://web.example.invalid',
    )
    expect(result.pathname).toBe('/login')
    expect(result.searchParams.get('redirect')).toBe(path)
    expect(result.hash).toBe('')
  })

  it('keeps the original destination when already on the login page', () => {
    const current = new URL(
      '/login?' +
        new URLSearchParams({
          redirect: '/c/orchids?sort=top#reply',
          error: 'access_denied',
        }),
      'https://web.example.invalid',
    )
    const result = new URL(loginUrl(current), current.origin)
    expect(result.pathname).toBe('/login')
    expect(result.searchParams.get('redirect')).toBe(
      '/c/orchids?sort=top#reply',
    )
  })

  it('does not create a login-to-login loop without a saved destination', () => {
    const current = new URL('https://web.example.invalid/login')
    const result = new URL(loginUrl(current), current.origin)
    expect(result.pathname).toBe('/login')
    expect(result.searchParams.get('redirect') ?? '/').toBe('/')
  })
})
