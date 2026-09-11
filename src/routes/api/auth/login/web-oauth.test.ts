import { expect, it, vi } from 'vitest'
import { createMockEvent } from '$lib/test-utils/request-event'
import { POST } from './+server'

const resolveLoginHandle = vi.hoisted(() =>
  vi.fn<(handle: string, getClientAddress: () => string) => Promise<void>>(),
)
vi.mock('$lib/server/resolve-login-handle', () => ({ resolveLoginHandle }))
vi.mock('$env/dynamic/private', () => ({ env: {} }))
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'http://localhost:8080' },
}))

it('hands web OAuth to Go after preflight, preserving the local return destination', async () => {
  resolveLoginHandle.mockResolvedValue(undefined)
  const redirect = '/c/gardening.local?sort=new&time=week#comments'
  const event = createMockEvent({
    url: 'http://localhost:8080/api/auth/login',
    body: {
      handle: '  Gardener.Local  ',
      instance: 'http://localhost:8080',
      redirect,
    },
  })

  const response = await POST(event)

  expect(response.status).toBe(200)
  expect(resolveLoginHandle).toHaveBeenCalledExactlyOnceWith(
    'gardener.local',
    event.getClientAddress,
  )
  const body = await response.json()
  const destination = new URL(body.redirectUrl)
  expect(destination.origin).toBe('http://localhost:8080')
  expect(destination.pathname).toBe('/oauth/login')
  expect(destination.searchParams.get('handle')).toBe('gardener.local')
  expect(destination.searchParams.get('redirect')).toBe(redirect)
  expect(destination.searchParams.has('redirect_uri')).toBe(false)
  expect(destination.searchParams.has('state')).toBe(false)
  expect(event.cookies.get('kelp_pending_auth')).toBeUndefined()
  expect(event.cookies.set).not.toHaveBeenCalled()
})
