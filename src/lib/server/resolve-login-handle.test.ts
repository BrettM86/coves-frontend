import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DidNotFoundError,
  FailedHandleResolutionError,
} from '@atcute/identity-resolver'
import { resolveLoginHandle } from './resolve-login-handle'

const mockFetch = vi.fn<typeof fetch>()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})
afterEach(() => vi.unstubAllGlobals())

describe('resolveLoginHandle', () => {
  it('resolves a handle through the public XRPC service with a bounded request', async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({ did: 'did:plc:ewvi7nxzyoun6zhxrhs64oiz' }),
    )

    await expect(
      resolveLoginHandle('jerry.bsky.social'),
    ).resolves.toBeUndefined()

    expect(mockFetch).toHaveBeenCalledOnce()
    const [input, options] = mockFetch.mock.calls[0]
    expect(String(input)).toBe(
      'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=jerry.bsky.social',
    )
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })

  it('exposes a missing account as DidNotFoundError', async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json(
        { error: 'InvalidRequest', message: 'Unable to resolve handle' },
        { status: 400 },
      ),
    )

    await expect(
      resolveLoginHandle('jerry.coves.social'),
    ).rejects.toBeInstanceOf(DidNotFoundError)
  })

  it.each([
    [
      'service outage',
      () => Response.json({ error: 'Unavailable' }, { status: 503 }),
    ],
    ['invalid DID', () => Response.json({ did: 'not-a-did' })],
    ['missing DID', () => Response.json({})],
    [
      'malformed JSON',
      () =>
        new Response('{', { headers: { 'content-type': 'application/json' } }),
    ],
  ] as const)(
    'keeps %s distinct from account not found',
    async (_name, response) => {
      mockFetch.mockResolvedValueOnce(response())

      await expect(
        resolveLoginHandle('jerry.bsky.social'),
      ).rejects.toBeInstanceOf(FailedHandleResolutionError)
    },
  )

  it('keeps network failures distinct from account not found', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(
      resolveLoginHandle('jerry.bsky.social'),
    ).rejects.toBeInstanceOf(FailedHandleResolutionError)
  })

  it('rejects invalid handles without sending a request', async () => {
    await expect(resolveLoginHandle('jerry@bsky.social')).rejects.toThrow()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
