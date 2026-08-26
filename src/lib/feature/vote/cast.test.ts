import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AtUri,
  CID,
  PostStats,
  PostViewerState,
} from '$lib/api/coves/types'
import { XrpcError } from '$lib/api/coves/xrpc'
import { castUpvote, type VoteApi, type VoteSnapshot } from './cast'

const SUBJECT = {
  uri: 'at://did:plc:a/social.coves.post/1' as AtUri,
  cid: 'bafy1' as CID,
}
const NEW_VOTE_URI = 'at://did:plc:me/social.coves.vote/9' as AtUri
const OLD_VOTE_URI = 'at://did:plc:me/social.coves.vote/1' as AtUri

const EMPTY_STATS: PostStats = {
  upvotes: 0,
  downvotes: 0,
  score: 0,
  commentCount: 0,
}
const EMPTY_VIEWER: PostViewerState = { saved: false }

type Snap = VoteSnapshot<PostStats, PostViewerState>

/** A component stand-in: state, plus a flag for "moved to another subject". */
function harness(initial: Snap, api: Partial<VoteApi> = {}) {
  let state: Snap = initial
  let current = true
  const writes: Snap[] = []
  const createVote = vi.fn(
    api.createVote ?? (async () => ({ uri: NEW_VOTE_URI })),
  )
  const deleteVote = vi.fn(api.deleteVote ?? (async () => undefined))
  return {
    createVote,
    deleteVote,
    writes,
    get state() {
      return state
    },
    moveAway() {
      current = false
    },
    run: () =>
      castUpvote<PostStats, PostViewerState>({
        api: { createVote, deleteVote },
        subject: SUBJECT,
        emptyStats: EMPTY_STATS,
        emptyViewer: EMPTY_VIEWER,
        read: () => state,
        write: (s) => {
          writes.push(s)
          state = s
        },
        isCurrent: () => current,
      }),
  }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('castUpvote', () => {
  it('first upvote: optimistic +1, then commits the returned vote uri', async () => {
    const h = harness({
      stats: { upvotes: 3, downvotes: 1, score: 2, commentCount: 7 },
      viewer: { saved: true },
    })
    const outcome = await h.run()

    expect(outcome).toEqual({ kind: 'ok' })
    // Optimistic write happened before the request settled.
    expect(h.writes[0]?.viewer).toEqual({
      saved: true,
      vote: 'up',
      voteUri: undefined,
    })
    expect(h.createVote).toHaveBeenCalledWith({
      subject: SUBJECT,
      direction: 'up',
    })
    expect(h.state.stats).toEqual({
      upvotes: 4,
      downvotes: 1,
      score: 3,
      commentCount: 7,
    })
    expect(h.state.viewer).toEqual({
      saved: true,
      vote: 'up',
      voteUri: NEW_VOTE_URI,
    })
  })

  it('uses the empty bases when the subject carries no stats/viewer', async () => {
    const h = harness({ stats: undefined, viewer: undefined })
    await h.run()
    expect(h.state.stats).toEqual({
      upvotes: 1,
      downvotes: 0,
      score: 1,
      commentCount: 0,
    })
    expect(h.state.viewer).toEqual({
      saved: false,
      vote: 'up',
      voteUri: NEW_VOTE_URI,
    })
  })

  it('toggle-off deletes and clears the vote uri', async () => {
    const h = harness({
      stats: { upvotes: 3, downvotes: 0, score: 3, commentCount: 0 },
      viewer: { saved: false, vote: 'up', voteUri: OLD_VOTE_URI },
    })
    const outcome = await h.run()

    expect(outcome).toEqual({ kind: 'ok' })
    expect(h.deleteVote).toHaveBeenCalledWith({ subject: SUBJECT })
    expect(h.createVote).not.toHaveBeenCalled()
    expect(h.state.stats?.upvotes).toBe(2)
    expect(h.state.viewer).toEqual({
      saved: false,
      vote: undefined,
      voteUri: undefined,
    })
  })

  it('switching from a downvote releases it and creates an upvote', async () => {
    const h = harness({
      stats: { upvotes: 3, downvotes: 2, score: 1, commentCount: 0 },
      viewer: { saved: false, vote: 'down', voteUri: OLD_VOTE_URI },
    })
    await h.run()
    expect(h.createVote).toHaveBeenCalled()
    expect(h.state.stats).toEqual({
      upvotes: 4,
      downvotes: 1,
      score: 3,
      commentCount: 0,
    })
    expect(h.state.viewer?.voteUri).toBe(NEW_VOTE_URI)
  })

  it('create returning no uri restores the pre-press state', async () => {
    const before: Snap = {
      stats: { upvotes: 3, downvotes: 0, score: 3, commentCount: 0 },
      viewer: { saved: false },
    }
    const h = harness(before, { createVote: async () => ({}) })
    const outcome = await h.run()

    expect(outcome).toEqual({ kind: 'out-of-sync' })
    expect(h.state).toEqual(before)
  })

  it('discards a create result after the component moved to another subject', async () => {
    const h = harness({ stats: undefined, viewer: undefined })
    h.moveAway()
    const outcome = await h.run()

    expect(outcome).toEqual({ kind: 'stale-subject' })
    // Only the optimistic write; nothing written after the response.
    expect(h.writes).toHaveLength(1)
  })

  it('VoteNotFound on toggle-off keeps the un-voted state', async () => {
    const h = harness(
      {
        stats: { upvotes: 1, downvotes: 0, score: 1, commentCount: 0 },
        viewer: { saved: false, vote: 'up', voteUri: OLD_VOTE_URI },
      },
      {
        deleteVote: async () => {
          throw new XrpcError(404, 'VoteNotFound', 'gone')
        },
      },
    )
    const outcome = await h.run()

    expect(outcome).toEqual({ kind: 'already-absent' })
    expect(h.state.viewer?.vote).toBeUndefined()
    expect(h.state.stats?.upvotes).toBe(0)
  })

  it('an infrastructure 404 on toggle-off is NOT treated as confirmation', async () => {
    const before: Snap = {
      stats: { upvotes: 1, downvotes: 0, score: 1, commentCount: 0 },
      viewer: { saved: false, vote: 'up', voteUri: OLD_VOTE_URI },
    }
    const h = harness(before, {
      deleteVote: async () => {
        throw new XrpcError(404, 'UnknownError', 'not found')
      },
    })
    const outcome = await h.run()

    expect(outcome.kind).toBe('error')
    expect(h.state).toEqual(before)
  })

  it('401 rolls back and reports session-expired', async () => {
    const before: Snap = { stats: EMPTY_STATS, viewer: EMPTY_VIEWER }
    const h = harness(before, {
      createVote: async () => {
        throw new XrpcError(401, 'AuthRequired', 'expired')
      },
    })
    const outcome = await h.run()
    expect(outcome).toEqual({ kind: 'session-expired' })
    expect(h.state).toEqual(before)
  })

  it('generic failure rolls back and returns the error', async () => {
    const boom = new Error('boom')
    const before: Snap = { stats: EMPTY_STATS, viewer: EMPTY_VIEWER }
    const h = harness(before, {
      createVote: async () => {
        throw boom
      },
    })
    const outcome = await h.run()
    expect(outcome).toEqual({ kind: 'error', error: boom })
    expect(h.state).toEqual(before)
  })

  it('does not roll back into a different subject after failure', async () => {
    const h = harness(
      { stats: EMPTY_STATS, viewer: EMPTY_VIEWER },
      {
        createVote: async () => {
          throw new Error('boom')
        },
      },
    )
    h.moveAway()
    const outcome = await h.run()
    expect(outcome.kind).toBe('error')
    expect(h.writes).toHaveLength(1)
    expect(h.state.viewer?.vote).toBe('up')
  })
})
