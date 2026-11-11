/**
 * Dismissing the automatic offer must survive the page unloading (a close by
 * browser Back), so the request is sent with fetch keepalive.
 */
import { describe, expect, it, vi } from 'vitest'
import { dismissBlueskyProfileImport } from './dismiss'

describe('dismissBlueskyProfileImport', () => {
  it('POSTs the dismiss procedure through the proxy with keepalive and credentials', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }))

    await dismissBlueskyProfileImport(fetchFn)

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(String(url)).toBe(
      '/api/proxy/xrpc/social.coves.actor.dismissBlueskyProfileImport',
    )
    expect(init).toMatchObject({
      method: 'POST',
      keepalive: true,
      credentials: 'include',
    })
  })

  it('resolves without throwing when the request fails', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(dismissBlueskyProfileImport(fetchFn)).resolves.toBeUndefined()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
