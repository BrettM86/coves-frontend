// ---------------------------------------------------------------------------
// Vote orchestration
//
// The optimistic-write / request / reconcile-or-rollback sequence for a
// vote press, shared by every vote button. `vote.ts` owns the pure counter
// math; this module owns the side-effect sequence around it so a behavioural
// fix lands once instead of once per component.
//
// The function is written against a tiny `VoteApi` and a read/write pair
// rather than Svelte state so it is unit-testable with a fake client.
// ---------------------------------------------------------------------------

import type {
  AtUri,
  CreateVoteInput,
  CreateVoteOutput,
  DeleteVoteInput,
  StrongRef,
} from '$lib/api/coves/types'
import { XrpcError } from '$lib/api/coves/xrpc'
import { log } from '$lib/app/util/log'
import { nextVoteState, toggleUpvote, type VoteCounts } from './vote'

export interface VoteViewer {
  vote?: 'up' | 'down'
  voteUri?: AtUri
}

export interface VoteApi {
  createVote(input: CreateVoteInput): Promise<CreateVoteOutput>
  deleteVote(input: DeleteVoteInput): Promise<void>
}

export interface VoteSnapshot<TStats, TViewer> {
  stats: TStats | undefined
  viewer: TViewer | undefined
}

export interface CastUpvoteContext<
  TStats extends VoteCounts,
  TViewer extends VoteViewer,
> {
  api: VoteApi
  /** The post/comment being voted on, captured at press time. */
  subject: StrongRef
  /** Base objects used when `stats`/`viewer` are absent on the subject. */
  emptyStats: TStats
  emptyViewer: TViewer
  /** Current state of the component. */
  read(): VoteSnapshot<TStats, TViewer>
  /** Commits state back to the component. */
  write(snapshot: VoteSnapshot<TStats, TViewer>): void
  /**
   * Whether the component still represents `subject`. Route components are
   * reused, so by the time a response settles the component can already
   * show a different post with `stats`/`viewer` rebound to it; every
   * post-await write is skipped when this returns false.
   */
  isCurrent(): boolean
}

export type CastUpvoteOutcome =
  /** Optimistic state confirmed by the server. */
  | { kind: 'ok' }
  /** The component moved on; the response was discarded. */
  | { kind: 'stale-subject' }
  /** Server toggled off an unseen vote; counts restored and viewer vote cleared. */
  | { kind: 'out-of-sync' }
  /** Deleting an already-absent vote; optimistic (un-voted) state kept. */
  | { kind: 'already-absent' }
  /** Any other failure — rolled back. */
  | { kind: 'error'; error: unknown }

/**
 * Applies a vote press optimistically, sends it, and reconciles.
 *
 * Toggle-off deletes; anything else creates the requested direction. A switch
 * atomically replaces the record on the backend; see `toggleUpvote`.
 */
export async function castUpvote<
  TStats extends VoteCounts,
  TViewer extends VoteViewer,
>(
  ctx: CastUpvoteContext<TStats, TViewer>,
  requestedDirection: 'up' | 'down' = 'up',
): Promise<CastUpvoteOutcome> {
  const { subject } = ctx
  const before = ctx.read()
  const isToggleOff = before.viewer?.vote === requestedDirection

  // Saved for rollback — shallow copies so later writes cannot alias them.
  const prevStats = before.stats ? { ...before.stats } : undefined
  const prevViewer = before.viewer ? { ...before.viewer } : undefined

  // `toggleUpvote` owns the three vote counters only; spread it over the
  // caller's typed base to carry commentCount/replyCount etc. through.
  const baseStats: TStats = before.stats ?? ctx.emptyStats
  const { counts } = toggleUpvote(
    baseStats,
    before.viewer?.vote,
    requestedDirection,
  )
  const { vote, voteUri } = nextVoteState(
    before.viewer?.vote,
    requestedDirection,
  )
  const nextViewer: TViewer = {
    ...(before.viewer ?? ctx.emptyViewer),
    vote,
    voteUri,
  }
  ctx.write({ stats: { ...baseStats, ...counts }, viewer: nextViewer })

  try {
    if (isToggleOff) {
      await ctx.api.deleteVote({ subject })
      return { kind: 'ok' }
    }

    const result = await ctx.api.createVote({
      subject,
      direction: requestedDirection,
    })
    if (!ctx.isCurrent()) {
      log.warn(
        '[vote] discarding createVote result — component now shows a different subject',
        undefined,
        { subject: subject.uri },
      )
      return { kind: 'stale-subject' }
    }
    if (!result.uri) {
      // Create is itself a toggle: handed a vote that already matches the
      // requested direction the backend DELETES it and returns 200 with no
      // uri. Our `viewer.vote` was stale, so the optimistic increment was wrong
      // — resync from the pre-press state rather than guess.
      // Best-effort: a vote `prevViewer` never saw is also uncounted in
      // `prevStats`; an uncounted stale vote leaves the restored counts off
      // until the next refetch, which is why callers surface an out-of-sync
      // notice.
      log.warn(
        '[vote] createVote toggled off an unseen existing vote',
        undefined,
        { uri: subject.uri },
      )
      ctx.write({
        stats: prevStats,
        viewer: prevViewer
          ? { ...prevViewer, vote: undefined, voteUri: undefined }
          : undefined,
      })
      return { kind: 'out-of-sync' }
    }
    // A fresh object rather than a field write on `nextViewer`: the component
    // holds the `$state` proxy, not this raw object, so mutation would not
    // propagate.
    ctx.write({
      stats: ctx.read().stats,
      viewer: { ...nextViewer, voteUri: result.uri },
    })
    return { kind: 'ok' }
  } catch (err) {
    if (
      isToggleOff &&
      err instanceof XrpcError &&
      err.status === 404 &&
      err.errorName === 'VoteNotFound'
    ) {
      // Deleting a vote that is already absent is the outcome the user asked
      // for; rolling back would restore the selected vote and leave them
      // unable to ever reach un-voted. Scoped by errorName: an infrastructure
      // 404 (proxy misroute, stale AppView) arrives as `UnknownError` and is
      // NOT confirmation the vote is gone — that falls through to rollback.
      log.warn(
        '[vote] deleteVote 404 — vote already absent, keeping optimistic state',
        undefined,
        { uri: subject.uri },
      )
      return { kind: 'already-absent' }
    }

    log.error('[vote] cast failed', err, {
      uri: subject.uri,
      isToggleOff,
    })

    // Rollback — unless the component has moved to a different subject, in
    // which case `stats`/`viewer` belong to the new one and the old snapshot
    // must not be written into them. The caller's toast is global, so the
    // failure still surfaces either way.
    if (ctx.isCurrent()) {
      ctx.write({ stats: prevStats, viewer: prevViewer })
    }

    return { kind: 'error', error: err }
  }
}
