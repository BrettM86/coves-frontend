import { describe, it, expect } from 'vitest'
import { redirect } from '@sveltejs/kit'
import { createMockCookies, createMockEvent, isRedirect } from './request-event'

describe('createMockCookies', () => {
  it('exposes initial cookies through get and getAll', () => {
    const cookies = createMockCookies({ session: 'abc', theme: 'dark' })

    expect(cookies.get('session')).toBe('abc')
    expect(cookies.getAll()).toEqual([
      { name: 'session', value: 'abc' },
      { name: 'theme', value: 'dark' },
    ])
  })

  it('round-trips set and delete', () => {
    const cookies = createMockCookies()

    cookies.set('a', '1', { path: '/' })
    expect(cookies.get('a')).toBe('1')

    cookies.delete('a', { path: '/' })
    expect(cookies.get('a')).toBeUndefined()
  })

  it('records calls for assertion', () => {
    const cookies = createMockCookies()

    cookies.set('a', '1', { path: '/' })

    expect(cookies.set).toHaveBeenCalledWith('a', '1', { path: '/' })
  })

  it('serialize returns a name=value string, not undefined', () => {
    const cookies = createMockCookies()

    expect(cookies.serialize('a', '1', { path: '/' })).toBe('a=1')
  })
})

describe('createMockEvent', () => {
  it('defaults to an unauthenticated GET to http://localhost:5173/ with no Content-Type', () => {
    const event = createMockEvent()

    expect(event.request.method).toBe('GET')
    expect(event.url.href).toBe('http://localhost:5173/')
    expect(event.locals.auth.authenticated).toBe(false)
    expect(event.params).toEqual({})
    expect(event.request.headers.get('content-type')).toBeNull()
  })

  it('JSON-serializes body, defaults method to POST, and sets Content-Type', async () => {
    const event = createMockEvent({ body: { handle: 'user.example.com' } })

    expect(event.request.method).toBe('POST')
    expect(event.request.headers.get('content-type')).toBe('application/json')
    expect(await event.request.json()).toEqual({ handle: 'user.example.com' })
  })

  it.each([
    [0, '0'],
    [false, 'false'],
    [null, 'null'],
    ['', '""'],
  ])('preserves falsy body %j instead of dropping it', async (body, wire) => {
    const event = createMockEvent({ body })

    expect(await event.request.text()).toBe(wire)
  })

  it('respects an explicit method alongside a body', () => {
    const event = createMockEvent({ method: 'PUT', body: { a: 1 } })

    expect(event.request.method).toBe('PUT')
  })

  it('merges caller headers over defaults', () => {
    const event = createMockEvent({
      body: { a: 1 },
      headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.com' },
    })

    expect(event.request.headers.get('content-type')).toBe('text/plain')
    expect(event.request.headers.get('origin')).toBe('https://evil.com')
  })

  it('accepts a URL instance and preserves it', () => {
    const url = new URL('https://kelp.example.com/api/auth/callback?state=x')
    const event = createMockEvent({ url })

    expect(event.url).toBe(url)
    expect(event.url.searchParams.get('state')).toBe('x')
  })

  it('defaults route.id to the pathname and honors routeId', () => {
    expect(createMockEvent({ url: 'http://localhost:5173/c/x' }).route.id).toBe(
      '/c/x',
    )
    expect(createMockEvent({ routeId: '/c/[handle=handle]' }).route.id).toBe(
      '/c/[handle=handle]',
    )
  })

  it('rejects loudly when event.fetch is used without being mocked', async () => {
    const event = createMockEvent()

    await expect(event.fetch('http://localhost/api')).rejects.toThrow(
      /event\.fetch called but not mocked/,
    )
  })
})

describe('isRedirect', () => {
  it('recognizes a thrown SvelteKit redirect', () => {
    let caught: unknown
    try {
      redirect(302, '/login')
    } catch (error) {
      caught = error
    }

    expect(isRedirect(caught)).toBe(true)
  })

  it('rejects redirect-shaped plain objects (instanceof semantics)', () => {
    expect(isRedirect({ status: 302, location: '/login' })).toBe(false)
  })

  it('rejects ordinary errors', () => {
    expect(isRedirect(new Error('boom'))).toBe(false)
  })
})
