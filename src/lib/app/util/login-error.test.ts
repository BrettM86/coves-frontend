import { describe, expect, it } from 'vitest'
import { consumeLoginError } from './login-error'

const origin = 'https://web.example.invalid'

describe('consumeLoginError', () => {
  it('returns the error code and a URL with only the error removed', () => {
    const arrival = new URL(
      '/login?error=access_denied&redirect=%2Fc%2Forchids%3Fsort%3Dtop',
      origin,
    )
    const result = consumeLoginError(arrival)
    expect(result.errorCode).toBe('access_denied')
    expect(result.replaceUrl).not.toBeNull()
    const replaced = result.replaceUrl as URL
    expect(replaced.pathname).toBe('/login')
    expect(replaced.searchParams.has('error')).toBe(false)
    expect(replaced.searchParams.get('redirect')).toBe('/c/orchids?sort=top')
  })

  it('does not mutate the arrival URL', () => {
    const arrival = new URL('/login?error=server_error', origin)
    consumeLoginError(arrival)
    expect(arrival.searchParams.get('error')).toBe('server_error')
  })

  it('returns no error and no replacement when the URL carries no error', () => {
    const result = consumeLoginError(new URL('/login?redirect=%2F', origin))
    expect(result).toEqual({ errorCode: null, replaceUrl: null })
  })

  it('treats an empty error value as a consumed, unknown error', () => {
    const result = consumeLoginError(new URL('/login?error=', origin))
    expect(result.errorCode).toBe('')
    expect(result.replaceUrl?.searchParams.has('error')).toBe(false)
  })
})
