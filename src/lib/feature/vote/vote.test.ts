import { describe, it, expect } from 'vitest'
import { nextVoteState, toggleUpvote, type VoteCounts } from './vote'

// ---------------------------------------------------------------------------
// Optimistic vote state
//
// Migrated from the `computeVoteState` block in helpers.test.ts (find it with
// `git log -S 'computeVoteState'`). The score expectations there encoded the
// bug — `score = upvotes`, downvotes ignored — so the fixture is kept verbatim
// and only the oracles are corrected to the backend's invariant,
// `score = upvotes - downvotes` (Coves backend: tests/fixtures/fixtures.go:144,
// tests/e2e/journey_test.go:179).
//
// Every expectation is a literal number. Asserting `score === upvotes -
// downvotes` would be self-fulfilling: it holds for any implementation that is
// internally consistent, including one that moves the wrong counter.
// ---------------------------------------------------------------------------

const baseCounts: VoteCounts = {
  upvotes: 10,
  downvotes: 2,
  score: 8,
}

type VoteDirection = 'up' | 'down'
type DirectionalToggle = (
  counts: VoteCounts,
  currentVote: VoteDirection | undefined,
  requestedVote?: VoteDirection,
) => { counts: VoteCounts; vote: VoteDirection | undefined }
type DirectionalNextState = (
  currentVote: VoteDirection | undefined,
  requestedVote?: VoteDirection,
) => {
  vote: VoteDirection | undefined
  voteUri: ReturnType<typeof nextVoteState>['voteUri']
}

// Passing an optional direction is the smallest generalization of today's
// helpers. JavaScript lets the current implementation run by ignoring it, so
// RED fails on downvote behavior rather than on an absent export.
const toggleVote: DirectionalToggle = toggleUpvote
const nextDirectionalVoteState: DirectionalNextState = nextVoteState

describe('toggleUpvote', () => {
  // V1 — was "like from no vote increments upvotes and sets score to upvotes",
  // which expected score 11 against a fixture carrying two downvotes.
  // Corrected to 9.
  it('upvoting from no vote increments upvotes and the score', () => {
    const result = toggleUpvote(baseCounts, undefined)

    expect(result.counts).toEqual({ upvotes: 11, downvotes: 2, score: 9 })
    expect(result.vote).toBe('up')
  })

  // V2 — was "toggling off like decrements upvotes and sets score to upvotes",
  // which expected score 9. Corrected to 7.
  it('toggling off an existing upvote decrements upvotes and the score', () => {
    const result = toggleUpvote(baseCounts, 'up')

    expect(result.counts).toEqual({ upvotes: 9, downvotes: 2, score: 7 })
    expect(result.vote).toBeUndefined()
  })

  // V3 — the backend treats a direction switch as delete-then-create: the
  // replacement is a new record under a new key, so the old downvote is gone
  // (internal/core/votes/service_impl_test.go:343). The optimistic counts must
  // release the downvote, not merely add an upvote alongside it.
  it('switching from a downvote releases the downvote as it adds the upvote', () => {
    const result = toggleUpvote(baseCounts, 'down')

    expect(result.counts).toEqual({ upvotes: 11, downvotes: 1, score: 10 })
    expect(result.vote).toBe('up')
  })

  // V4 — a round trip. Mutation testing showed this kills nothing V1-V3 miss
  // (the ±2 mutant it was written for dies to V1, V2 and V3 alike); it is kept
  // only because composing the function with itself is how callers use it.
  it('upvoting and toggling straight back off restores the original counts', () => {
    const applied = toggleUpvote(baseCounts, undefined)
    const reverted = toggleUpvote(applied.counts, applied.vote)

    expect(reverted.counts).toEqual(baseCounts)
    expect(reverted.vote).toBeUndefined()
  })

  // Counters are rendered straight to the user, so they must never go negative
  // when the optimistic state disagrees with the server about what the viewer
  // had voted — a stale `viewer.vote` against zeroed counts otherwise produces
  // a downvote count of -1, which inflates the score above the upvote count.
  it('clamps downvotes at zero when switching from a stale downvote', () => {
    const result = toggleUpvote({ upvotes: 0, downvotes: 0, score: 0 }, 'down')

    expect(result.counts).toEqual({ upvotes: 1, downvotes: 0, score: 1 })
    expect(result.vote).toBe('up')
  })

  it('clamps upvotes at zero when toggling off a stale upvote', () => {
    const result = toggleUpvote({ upvotes: 0, downvotes: 0, score: 0 }, 'up')

    expect(result.counts).toEqual({ upvotes: 0, downvotes: 0, score: 0 })
    expect(result.vote).toBeUndefined()
  })

  // V5 — ported from "does not mutate the original stats". Callers hold the
  // pre-vote counts for rollback and re-read them when the request fails, so
  // the input must survive every branch, not just the fresh-vote one.
  it.each([undefined, 'up', 'down'] as const)(
    'does not mutate the counts it is given (current vote: %s)',
    (currentVote) => {
      const counts: VoteCounts = { ...baseCounts }

      toggleUpvote(counts, currentVote)

      expect(counts).toEqual({ upvotes: 10, downvotes: 2, score: 8 })
    },
  )
})

describe('requested downvote transitions', () => {
  it.each([
    [
      'adds a downvote from no vote',
      baseCounts,
      undefined,
      { upvotes: 10, downvotes: 3, score: 7 },
      'down',
    ],
    [
      'toggles off an existing downvote',
      baseCounts,
      'down',
      { upvotes: 10, downvotes: 1, score: 9 },
      undefined,
    ],
    [
      'switches an upvote to a downvote',
      baseCounts,
      'up',
      { upvotes: 9, downvotes: 3, score: 6 },
      'down',
    ],
    [
      'clamps a stale downvote at zero when toggling off',
      { upvotes: 0, downvotes: 0, score: 0 },
      'down',
      { upvotes: 0, downvotes: 0, score: 0 },
      undefined,
    ],
  ] as const)('%s', (_, initial, currentVote, expectedCounts, expectedVote) => {
    const counts: VoteCounts = { ...initial }

    const result = toggleVote(counts, currentVote, 'down')

    expect(counts).toEqual(initial)
    expect(result.counts).toEqual(expectedCounts)
    expect(result.vote).toBe(expectedVote)
  })
})

// ---------------------------------------------------------------------------
// nextVoteState()
//
// The viewer half of a vote press, previously split between computeVoteState
// (PostVote's path, tested in helpers.test.ts) and inline code in CommentVote.
// The switch-from-downvote path — the one that carried the deleted record's
// URI forward — had no coverage in either home.
// ---------------------------------------------------------------------------

describe('nextVoteState', () => {
  it('drops the vote and its record URI when toggling off an upvote', () => {
    expect(nextVoteState('up')).toEqual({
      vote: undefined,
      voteUri: undefined,
    })
  })

  it('records an upvote when there was no previous vote', () => {
    expect(nextVoteState(undefined)).toEqual({
      vote: 'up',
      voteUri: undefined,
    })
  })

  // The switch is delete-then-create on the backend, so the downvote's record
  // is already gone. Carrying its URI forward — what the components do today —
  // leaves the optimistic state claiming a vote of 'up' backed by a record the
  // backend has deleted, which is the URI a subsequent toggle-off would send.
  it('does not carry the old downvote record URI into the switched upvote', () => {
    const result = nextVoteState('down')

    expect(result.vote).toBe('up')
    expect(result.voteUri).toBeUndefined()
  })

  it('uses the requested downvote direction and always drops the old vote URI', () => {
    expect(
      ([undefined, 'down', 'up'] as const).map((currentVote) =>
        nextDirectionalVoteState(currentVote, 'down'),
      ),
    ).toEqual([
      { vote: 'down', voteUri: undefined },
      { vote: undefined, voteUri: undefined },
      { vote: 'down', voteUri: undefined },
    ])
  })
})
