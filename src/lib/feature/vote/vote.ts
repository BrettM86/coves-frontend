// ---------------------------------------------------------------------------
// Optimistic vote state
//
// Pure counter math for a vote press; `cast.ts` sequences it with the
// request. Post and comment stats differ only in the counter they carry
// alongside (`commentCount` vs `replyCount`), so this module owns the three
// vote counters and the viewer's vote and callers spread the result over
// their own typed base to keep the fields it does not know about.
// ---------------------------------------------------------------------------

import type { AtUri, VoteCounts } from '$lib/api/coves/types'
import { log } from '$lib/app/util/log'

type VoteDirection = 'up' | 'down'

// Re-exported so vote logic imports its counter type from the module that
// operates on it. It is declared in the API types module because `PostStats`
// and `CommentStats` extend it there, and this module already depends on that
// one for `AtUri`.
export type { VoteCounts }

/**
 * Decrements a counter, refusing to go below zero.
 *
 * A negative counter is reachable whenever the viewer state we hold disagrees
 * with the server about what was voted — a stale `viewer.vote` against zeroed
 * counts. The counters are rendered verbatim, and a downvote count of -1
 * inflates the score above the upvote count, so the clamp prevents visible
 * corruption. The warning is what keeps the clamp from also hiding the desync
 * that caused it.
 */
function decrement(count: number, counter: string): number {
  if (count <= 0) {
    log.warn(
      `[vote] refusing to decrement ${counter} below zero — optimistic state is out of sync with the server`,
      undefined,
      { count },
    )
    return 0
  }
  return count - 1
}

/**
 * Applies a vote press to `counts`, returning the optimistic counters.
 *
 * `score` is always recomputed as `upvotes - downvotes`, the backend's
 * invariant. Stating it is deliberate: the implementation this replaced set
 * `score = upvotes` and dropped downvotes from the display entirely. The
 * invariant is pinned locally by `vote.test.ts`; upstream it is visible in the
 * Coves backend's vote fixtures and end-to-end journey assertions.
 *
 * Switching direction releases the old vote and adds the new one. The
 * backend atomically replaces the record under a new rkey, so a rejected
 * replacement leaves the original vote intact for the caller's rollback.
 *
 * Pure: `counts` is never mutated.
 */
export function toggleUpvote(
  counts: VoteCounts,
  currentVote: VoteDirection | undefined,
  requestedDirection: VoteDirection = 'up',
): { counts: VoteCounts; vote: VoteDirection | undefined } {
  const isToggleOff = currentVote === requestedDirection
  let upvotes = counts.upvotes
  let downvotes = counts.downvotes

  if (currentVote === 'up') upvotes = decrement(upvotes, 'upvotes')
  if (currentVote === 'down') downvotes = decrement(downvotes, 'downvotes')

  if (!isToggleOff) {
    if (requestedDirection === 'up') upvotes += 1
    if (requestedDirection === 'down') downvotes += 1
  }

  return {
    counts: { upvotes, downvotes, score: upvotes - downvotes },
    vote: isToggleOff ? undefined : requestedDirection,
  }
}

/**
 * The viewer half of a vote press: the vote it leaves behind, and the record
 * URI that vote is backed by.
 *
 * `voteUri` is undefined on every branch, and that is the substance of this
 * function rather than an oversight. Toggling off deletes the record; switching
 * from the opposite direction atomically replaces it under a different rkey; a first vote never had one. In all three cases the URI the
 * caller was holding is stale the moment the press is made, and the replacement
 * is not knowable until the server answers. Carrying the old one forward —
 * which the pre-extraction components did inline — leaves the optimistic state
 * claiming a vote backed by a record the backend has already deleted, and that
 * is the URI a subsequent toggle-off would send.
 *
 * The caller's current URI is therefore not a parameter: there is no branch on
 * which it could be returned, so taking it would only imply otherwise.
 */
export function nextVoteState(
  currentVote: VoteDirection | undefined,
  requestedDirection: VoteDirection = 'up',
): {
  vote: VoteDirection | undefined
  voteUri: AtUri | undefined
} {
  return {
    vote: currentVote === requestedDirection ? undefined : requestedDirection,
    voteUri: undefined,
  }
}
