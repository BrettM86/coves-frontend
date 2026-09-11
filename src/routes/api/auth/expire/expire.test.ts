import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { POST } from './+server'
import { sessionGenerationOf } from '$lib/server/session'
import {
  createMockCookies,
  createMockEvent,
} from '$lib/test-utils/request-event'

const cookie = 'sealed-session-cookie'
const generation = createHash('sha256').update(cookie).digest('hex')

function expire(body: unknown, cookies = createMockCookies()) {
  return POST(
    createMockEvent({
      method: 'POST',
      body,
      cookies,
      url: 'http://localhost:5173/api/auth/expire',
    }),
  )
}

describe('sessionGenerationOf', () => {
  it('matches the digest hooks.server.ts stamps on locals', () => {
    expect(sessionGenerationOf(cookie)).toBe(generation)
  })
})

describe('POST /api/auth/expire', () => {
  it('deletes the cookie whose generation the client reports as dead', async () => {
    const cookies = createMockCookies({ coves_session: cookie })

    const response = await expire({ generation }, cookies)

    expect(response.status).toBe(204)
    expect(cookies.delete).toHaveBeenCalledWith('coves_session', { path: '/' })
  })

  it('refuses to touch a cookie a newer login owns', async () => {
    const cookies = createMockCookies({ coves_session: 'newer-login-cookie' })

    const response = await expire({ generation }, cookies)

    expect(response.status).toBe(409)
    expect(cookies.delete).not.toHaveBeenCalled()
  })

  it('has nothing to do without a cookie', async () => {
    const cookies = createMockCookies()

    const response = await expire({ generation }, cookies)

    expect(response.status).toBe(204)
    expect(cookies.delete).not.toHaveBeenCalled()
  })

  it.each([
    ['no body', undefined],
    ['non-object body', 'generation'],
    ['missing generation', {}],
    ['non-string generation', { generation: 42 }],
    ['empty generation', { generation: '' }],
  ])('rejects a request with %s', async (_label, body) => {
    const cookies = createMockCookies({ coves_session: cookie })

    const response =
      body === undefined
        ? await POST(
            createMockEvent({
              method: 'POST',
              cookies,
              url: 'http://localhost:5173/api/auth/expire',
            }),
          )
        : await expire(body, cookies)

    expect(response.status).toBe(400)
    expect(cookies.delete).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON', async () => {
    const cookies = createMockCookies({ coves_session: cookie })
    const event = createMockEvent({
      method: 'POST',
      cookies,
      url: 'http://localhost:5173/api/auth/expire',
    })
    Object.assign(event, {
      request: new Request(event.url, {
        method: 'POST',
        body: '{not json',
        headers: { 'Content-Type': 'application/json' },
      }),
    })

    const response = await POST(event)

    expect(response.status).toBe(400)
    expect(cookies.delete).not.toHaveBeenCalled()
  })

  it('blocks cross-origin requests', async () => {
    const cookies = createMockCookies({ coves_session: cookie })

    const response = await POST(
      createMockEvent({
        method: 'POST',
        body: { generation },
        cookies,
        url: 'http://localhost:5173/api/auth/expire',
        headers: { Origin: 'https://evil.com' },
      }),
    )

    expect(response.status).toBe(403)
    expect(cookies.delete).not.toHaveBeenCalled()
  })
})
