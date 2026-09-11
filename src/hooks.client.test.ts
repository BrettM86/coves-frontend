import { beforeEach, describe, expect, it, vi } from 'vitest'
import { XrpcError } from '$lib/api/coves/xrpc'
import { handleError } from './hooks.client'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('client error classification', () => {
  it.each([
    new TypeError('Failed to fetch'),
    new TypeError('NetworkError when attempting to fetch resource.'),
    new XrpcError(503, 'UnknownError', 'XRPC request failed with status 503'),
  ])(
    'marks temporary backend failures for the recoverable error page',
    async (error) => {
      const result = await handleError({
        error,
        status: 500,
        message: 'Internal Error',
        event: {} as Parameters<typeof handleError>[0]['event'],
      })
      expect(result).toEqual({
        message: 'The server is temporarily unreachable. Please try again.',
        code: 'BackendUnavailable',
      })
    },
  )

  it('keeps the sanitized message for unrelated client errors', async () => {
    const result = await handleError({
      error: new TypeError('Cannot read properties of undefined'),
      status: 500,
      message: 'Internal Error',
      event: {} as Parameters<typeof handleError>[0]['event'],
    })
    expect(result).toEqual({ message: 'Internal Error' })
  })
})
