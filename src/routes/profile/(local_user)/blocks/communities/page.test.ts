import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AtUri, CID } from '$lib/api/coves/types'
import type { DID } from '$lib/types/atproto'

const mockCovesMethods = vi.hoisted(() => ({
  getBlockedCommunities: vi.fn(),
  getCommunity: vi.fn(),
}))

vi.mock('$lib/api/client.svelte', () => ({
  coves: () => mockCovesMethods,
}))

import { load } from './+page'

function loadArgs(): Parameters<typeof load>[0] {
  // SvelteKit's generated load event contains framework fields the loader does
  // not consume; this fixture intentionally supplies only the fetch boundary.
  return { fetch: vi.fn() } as unknown as Parameters<typeof load>[0]
}

function block(communityDid: string) {
  return {
    communityDid: communityDid as DID,
    recordUri:
      `at://did:plc:viewer/social.coves.community.block/${communityDid}` as AtUri,
    recordCid: `bafy-${communityDid}` as CID,
    blockedAt: '2026-09-02T12:00:00Z',
  }
}

describe('blocked communities loader', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('loads every cursor page and hydrates each community', async () => {
    mockCovesMethods.getBlockedCommunities
      .mockResolvedValueOnce({
        blocks: [block('did:plc:first')],
        cursor: '100',
      })
      .mockResolvedValueOnce({
        blocks: [block('did:plc:second')],
      })
    mockCovesMethods.getCommunity.mockImplementation(
      ({ community }: { community: DID }) =>
        Promise.resolve({ did: community, name: community }),
    )

    const data = await load(loadArgs())

    expect(mockCovesMethods.getBlockedCommunities).toHaveBeenNthCalledWith(1, {
      limit: 100,
    })
    expect(mockCovesMethods.getBlockedCommunities).toHaveBeenNthCalledWith(2, {
      limit: 100,
      cursor: '100',
    })
    expect(data.blockedCommunities.value).toHaveLength(2)
    expect(data.blockedCommunities.value[1]).toMatchObject({
      block: { communityDid: 'did:plc:second' },
      community: { did: 'did:plc:second' },
    })
  })

  it('keeps a DID-only row when community hydration fails', async () => {
    mockCovesMethods.getBlockedCommunities.mockResolvedValue({
      blocks: [block('did:plc:gone')],
    })
    mockCovesMethods.getCommunity.mockRejectedValue(new Error('not indexed'))

    const data = await load(loadArgs())

    expect(data.blockedCommunities.value).toEqual([
      {
        block: expect.objectContaining({ communityDid: 'did:plc:gone' }),
      },
    ])
  })

  it('bounds detail hydration for large block lists', async () => {
    const blocks = Array.from({ length: 9 }, (_, index) =>
      block(`did:plc:community-${index}`),
    )
    let releaseFirstBatch: () => void = () => undefined
    const firstBatch = new Promise<void>((resolve) => {
      releaseFirstBatch = resolve
    })

    mockCovesMethods.getBlockedCommunities.mockResolvedValue({ blocks })
    mockCovesMethods.getCommunity.mockImplementation(
      async ({ community }: { community: DID }) => {
        if (mockCovesMethods.getCommunity.mock.calls.length <= 8) {
          await firstBatch
        }
        return { did: community, name: community }
      },
    )

    const result = load(loadArgs())
    await vi.waitFor(() => {
      expect(mockCovesMethods.getCommunity).toHaveBeenCalledTimes(8)
    })

    releaseFirstBatch()
    const data = await result

    expect(mockCovesMethods.getCommunity).toHaveBeenCalledTimes(9)
    expect(
      data.blockedCommunities.value.map(({ block }) => block.communityDid),
    ).toEqual(blocks.map(({ communityDid }) => communityDid))
  })

  it('rejects a repeated cursor instead of looping forever', async () => {
    mockCovesMethods.getBlockedCommunities
      .mockResolvedValueOnce({ blocks: [], cursor: 'same' })
      .mockResolvedValueOnce({ blocks: [], cursor: 'same' })

    await expect(load(loadArgs())).rejects.toThrow(/repeated cursor/)
  })
})
