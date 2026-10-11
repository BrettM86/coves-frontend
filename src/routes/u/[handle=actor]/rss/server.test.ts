/**
 * `/u/<handle>/rss` is the legacy profile path's feed; it permanently
 * redirects to `/profile/<handle>/rss`, query intact, as `/u/<handle>` does
 * for the page.
 */
import { isRedirect } from '@sveltejs/kit'
import { describe, expect, it } from 'vitest'
import { createMockEvent } from '$lib/test-utils/request-event'
import { GET } from './+server'

/** The redirect as a status and location, whether returned or thrown. */
async function redirectOf(
  path: string,
  handle: string,
): Promise<{ status: number; location: string | null }> {
  const event = createMockEvent({
    url: `https://coves.test${path}`,
    params: { handle },
    routeId: '/u/[handle=actor]/rss',
  })
  try {
    const response = await GET(event as unknown as Parameters<typeof GET>[0])
    return {
      status: response.status,
      location: response.headers.get('location'),
    }
  } catch (thrown) {
    if (!isRedirect(thrown)) throw thrown
    return { status: thrown.status, location: thrown.location }
  }
}

describe('GET /u/[handle]/rss', () => {
  it.each([
    [
      '/u/alice.coves.test/rss',
      '/profile/alice.coves.test/rss',
      'alice.coves.test',
    ],
    [
      '/u/alice.coves.test/rss?type=comments',
      '/profile/alice.coves.test/rss?type=comments',
      'alice.coves.test',
    ],
    [
      '/u/did:plc:abc123/rss',
      '/profile/did%3Aplc%3Aabc123/rss',
      'did:plc:abc123',
    ],
  ])('%s → 301 %s', async (path, location, handle) => {
    expect(await redirectOf(path, handle)).toEqual({ status: 301, location })
  })
})
