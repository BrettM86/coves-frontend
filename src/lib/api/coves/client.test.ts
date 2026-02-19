import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CovesClient, NSID } from './client'
import { XrpcClient } from './xrpc'
import type { DID } from '$lib/types/atproto'
import type { AtUri, CID } from './types'

// ---------------------------------------------------------------------------
// Setup: spy on XrpcClient prototype methods
// ---------------------------------------------------------------------------

let querySpy: ReturnType<typeof vi.spyOn>
let procedureSpy: ReturnType<typeof vi.spyOn>
let client: CovesClient

beforeEach(() => {
  querySpy = vi.spyOn(XrpcClient.prototype, 'query').mockResolvedValue({})
  procedureSpy = vi
    .spyOn(XrpcClient.prototype, 'procedure')
    .mockResolvedValue(undefined)
  client = new CovesClient({
    fetchFn: globalThis.fetch,
    baseUrl: 'https://api.coves.social',
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Feed methods
// ---------------------------------------------------------------------------

describe('Feed methods', () => {
  it('getDiscover() calls query with correct NSID', async () => {
    await client.getDiscover({ limit: 20 })

    expect(querySpy).toHaveBeenCalledWith(NSID.getDiscover, {
      limit: 20,
    })
  })

  it('getTimeline() calls query with correct NSID', async () => {
    await client.getTimeline({ cursor: 'abc' })

    expect(querySpy).toHaveBeenCalledWith(NSID.getTimeline, {
      cursor: 'abc',
    })
  })

  it('getCommunityFeed() calls query with correct NSID', async () => {
    await client.getCommunityFeed({ community: 'tech' })

    expect(querySpy).toHaveBeenCalledWith(NSID.getCommunityFeed, {
      community: 'tech',
    })
  })
})

// ---------------------------------------------------------------------------
// Comment methods
// ---------------------------------------------------------------------------

describe('Comment methods', () => {
  it('getComments() calls query with correct NSID', async () => {
    await client.getComments({ post: 'at://did:plc:abc/post/1' })

    expect(querySpy).toHaveBeenCalledWith(NSID.getComments, {
      post: 'at://did:plc:abc/post/1',
    })
  })

  it('createComment() calls procedure with correct NSID', async () => {
    const input = {
      reply: {
        root: {
          uri: 'at://did:plc:abc/post/1' as AtUri,
          cid: 'bafy1' as CID,
        },
        parent: {
          uri: 'at://did:plc:abc/post/1' as AtUri,
          cid: 'bafy1' as CID,
        },
      },
      content: 'Great post!',
    }
    await client.createComment(input)

    expect(procedureSpy).toHaveBeenCalledWith(NSID.createComment, input)
  })

  it('deleteComment() calls procedure with correct NSID', async () => {
    await client.deleteComment({
      uri: 'at://did:plc:abc/comment/1' as AtUri,
    })

    expect(procedureSpy).toHaveBeenCalledWith(NSID.deleteComment, {
      uri: 'at://did:plc:abc/comment/1',
    })
  })
})

// ---------------------------------------------------------------------------
// Vote methods
// ---------------------------------------------------------------------------

describe('Vote methods', () => {
  it('createVote() calls procedure with correct NSID', async () => {
    const input = {
      subject: {
        uri: 'at://did:plc:abc/post/1' as AtUri,
        cid: 'bafy1' as CID,
      },
      direction: 'up' as const,
    }
    await client.createVote(input)

    expect(procedureSpy).toHaveBeenCalledWith(NSID.createVote, input)
  })

  it('deleteVote() calls procedure with correct NSID', async () => {
    const input = {
      subject: {
        uri: 'at://did:plc:abc/post/1' as AtUri,
        cid: 'bafy1' as CID,
      },
    }
    await client.deleteVote(input)

    expect(procedureSpy).toHaveBeenCalledWith(NSID.deleteVote, input)
  })
})

// ---------------------------------------------------------------------------
// Actor methods
// ---------------------------------------------------------------------------

describe('Actor methods', () => {
  it('getProfile() calls query with correct NSID', async () => {
    await client.getProfile({ actor: 'did:plc:abc123' })

    expect(querySpy).toHaveBeenCalledWith(NSID.getProfile, {
      actor: 'did:plc:abc123',
    })
  })

  it('getActorPosts() calls query with correct NSID', async () => {
    await client.getActorPosts({ actor: 'did:plc:abc123', limit: 10 })

    expect(querySpy).toHaveBeenCalledWith(NSID.getActorPosts, {
      actor: 'did:plc:abc123',
      limit: 10,
    })
  })

  it('getActorComments() calls query with correct NSID', async () => {
    await client.getActorComments({ actor: 'did:plc:abc123' })

    expect(querySpy).toHaveBeenCalledWith(NSID.getActorComments, {
      actor: 'did:plc:abc123',
    })
  })

  it('blockUser() calls procedure with correct NSID', async () => {
    await client.blockUser({ did: 'did:plc:abc123' as DID })

    expect(procedureSpy).toHaveBeenCalledWith(NSID.blockUser, {
      did: 'did:plc:abc123',
    })
  })

  it('unblockUser() calls procedure with correct NSID', async () => {
    await client.unblockUser({ did: 'did:plc:abc123' as DID })

    expect(procedureSpy).toHaveBeenCalledWith(NSID.unblockUser, {
      did: 'did:plc:abc123',
    })
  })
})

// ---------------------------------------------------------------------------
// Community methods
// ---------------------------------------------------------------------------

describe('Community methods', () => {
  it('getCommunity() calls query with correct NSID', async () => {
    await client.getCommunity({ community: 'tech' })

    expect(querySpy).toHaveBeenCalledWith(NSID.getCommunity, {
      community: 'tech',
    })
  })

  it('listCommunities() calls query with correct NSID', async () => {
    await client.listCommunities({ limit: 25 })

    expect(querySpy).toHaveBeenCalledWith(NSID.listCommunities, {
      limit: 25,
    })
  })

  it('searchCommunities() calls query with correct NSID', async () => {
    await client.searchCommunities({ query: 'rust' })

    expect(querySpy).toHaveBeenCalledWith(NSID.searchCommunities, {
      query: 'rust',
    })
  })

  it('createCommunity() calls procedure with correct NSID', async () => {
    const input = {
      name: 'rust',
      description: 'Rust programming language',
      visibility: 'public' as const,
    }
    await client.createCommunity(input)

    expect(procedureSpy).toHaveBeenCalledWith(NSID.createCommunity, input)
  })

  it('subscribe() calls procedure with correct NSID', async () => {
    await client.subscribe({ community: 'tech' })

    expect(procedureSpy).toHaveBeenCalledWith(NSID.subscribe, {
      community: 'tech',
    })
  })

  it('unsubscribe() calls procedure with correct NSID', async () => {
    await client.unsubscribe({ community: 'tech' })

    expect(procedureSpy).toHaveBeenCalledWith(NSID.unsubscribe, {
      community: 'tech',
    })
  })

  it('blockCommunity() calls procedure with correct NSID', async () => {
    await client.blockCommunity({ community: 'spam' })

    expect(procedureSpy).toHaveBeenCalledWith(NSID.blockCommunity, {
      community: 'spam',
    })
  })

  it('unblockCommunity() calls procedure with correct NSID', async () => {
    await client.unblockCommunity({ community: 'spam' })

    expect(procedureSpy).toHaveBeenCalledWith(NSID.unblockCommunity, {
      community: 'spam',
    })
  })
})

// ---------------------------------------------------------------------------
// Post methods
// ---------------------------------------------------------------------------

describe('Post methods', () => {
  it('createPost() calls procedure with correct NSID', async () => {
    const input = {
      community: 'tech',
      title: 'Hello World',
      content: 'My first post',
    }
    await client.createPost(input)

    expect(procedureSpy).toHaveBeenCalledWith(NSID.createPost, input)
  })

  it('deletePost() calls procedure with correct NSID', async () => {
    await client.deletePost({ uri: 'at://did:plc:abc/post/1' as AtUri })

    expect(procedureSpy).toHaveBeenCalledWith(NSID.deletePost, {
      uri: 'at://did:plc:abc/post/1',
    })
  })
})
