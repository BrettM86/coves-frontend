<script lang="ts">
  import type {
    AtUri,
    CID,
    CommentStats,
    CommentViewerState,
  } from '$lib/api/coves/types'
  import { coves } from '$lib/api/client.svelte'
  import { XrpcError } from '$lib/api/coves/xrpc'
  import { profile } from '$lib/app/auth.svelte'
  import { errorMessage } from '$lib/app/error'
  import { t } from '$lib/app/i18n'
  import FormattedNumber from '$lib/ui/util/FormattedNumber.svelte'
  import { toast } from 'mono-svelte'
  import { backOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import AnimatedHeart from '$lib/ui/icon/AnimatedHeart.svelte'
  import { nextVoteState, toggleUpvote } from '$lib/feature/post/vote'

  interface Props {
    uri: AtUri
    cid: CID
    stats: CommentStats | undefined
    viewer: CommentViewerState | undefined
  }

  let { uri, cid, stats = $bindable(), viewer = $bindable() }: Props = $props()

  let upvotes = $derived(stats?.upvotes ?? 0)
  let vote = $derived(viewer?.vote)
  let liked = $derived(vote === 'up')

  let voting = $state(false)

  const castVote = async () => {
    if (navigator.vibrate) navigator.vibrate(1)
    if (!profile.current?.jwt) {
      toast({ content: $t('toast.loginVoteGate'), type: 'warning' })
      return
    }
    if (voting) return
    voting = true

    const isToggleOff = viewer?.vote === 'up'

    // Save previous state for rollback
    const prevStats = stats ? { ...stats } : undefined
    const prevViewer = viewer ? { ...viewer } : undefined

    // Captured before the awaits: route components are reused, so by the time
    // a response settles this component can already represent a different
    // comment, with `stats`/`viewer` rebound to it. Every post-await write
    // below must be skipped when the subject has changed — committing would
    // write the old comment's outcome into the new comment's state.
    const subjectUri = uri
    const subjectCid = cid

    // Optimistically update local state. `toggleUpvote` owns the three vote
    // counters only, so spread it over a `CommentStats`-shaped base to carry
    // replyCount through untouched.
    const base: CommentStats = stats ?? {
      upvotes: 0,
      downvotes: 0,
      score: 0,
      replyCount: 0,
    }
    const { counts } = toggleUpvote(base, viewer?.vote)
    const { vote: newVote, voteUri } = nextVoteState(viewer?.vote)

    const nextViewer: CommentViewerState = {
      ...viewer,
      vote: newVote,
      voteUri,
    }

    stats = { ...base, ...counts }
    viewer = nextViewer

    try {
      if (isToggleOff) {
        await coves().deleteVote({
          subject: { uri: subjectUri, cid: subjectCid },
        })
      } else {
        const result = await coves().createVote({
          subject: { uri: subjectUri, cid: subjectCid },
          direction: 'up',
        })
        if (uri !== subjectUri) {
          console.warn(
            '[vote] discarding createVote result — component now shows a different comment',
            { subject: subjectUri, current: uri },
          )
          return
        }
        if (!result.uri) {
          // Create is itself a toggle: handed a vote that already matches the
          // requested direction the backend DELETES it and returns 200 with no
          // uri. Our `viewer.vote` was stale, so the optimistic +1 was wrong in
          // both directions — resync from the pre-press state rather than
          // guess. Best-effort: `stats` and `viewer` arrive in one response,
          // so a vote `prevViewer` never saw is also uncounted in `prevStats`;
          // only a stale 'down' leaves the restored counts off until the next
          // refetch, and the toast tells the user the view is out of sync.
          console.warn(
            '[vote] createVote toggled off an unseen existing vote',
            { uri: subjectUri },
          )
          stats = prevStats
          viewer = prevViewer
          toast({ content: $t('toast.voteOutOfSync'), type: 'warning' })
          return
        }
        // A fresh object, not a field write on `nextViewer`: that local is the
        // raw object, not the `$state` proxy `$bindable` wrapped it in, so
        // mutating it would never reach the parent.
        viewer = { ...nextViewer, voteUri: result.uri }
      }
    } catch (err) {
      if (
        isToggleOff &&
        err instanceof XrpcError &&
        err.status === 404 &&
        err.errorName === 'VoteNotFound'
      ) {
        // Deleting a vote that is already absent is the outcome the user asked
        // for. Rolling back would restore the filled heart and leave them
        // unable to ever reach un-voted. Scoped by errorName: the backend
        // names this case `VoteNotFound`, while an infrastructure 404 (proxy
        // misroute, stale AppView) arrives as `UnknownError` and is NOT
        // confirmation the vote is gone — that falls through to the rollback.
        console.warn(
          '[vote] deleteVote 404 — vote already absent, keeping optimistic state',
          { uri: subjectUri },
        )
        return
      }

      console.error(
        '[CommentVote] castVote failed',
        { uri: subjectUri, isToggleOff },
        err,
      )

      // Rollback on error — unless the component has moved to a different
      // comment, in which case `stats`/`viewer` now belong to the new comment
      // and the old comment's snapshot must not be written into them. The
      // toast is global, so the failure still surfaces either way.
      if (uri === subjectUri) {
        stats = prevStats
        viewer = prevViewer
      }

      if (err instanceof XrpcError && err.status === 401) {
        toast({ content: $t('toast.sessionExpired'), type: 'warning' })
      } else {
        toast({ content: errorMessage(err), type: 'error' })
      }
    } finally {
      voting = false
    }
  }
</script>

<button
  onclick={castVote}
  class={[
    'flex items-center gap-0.5 transition-colors cursor-pointer rounded-full px-1.5 py-1',
    liked ? 'text-[#FF0033]' : 'btn-tertiary',
  ]}
  aria-pressed={liked}
  aria-label={$t('post.actions.vote.upvote')}
>
  <AnimatedHeart {liked} size={18} />
  <div class="grid text-sm">
    {#key upvotes}
      <span
        style="grid-column: 1; grid-row: 1;"
        in:fly={{ duration: 400, y: -10, easing: backOut }}
        out:fly={{ duration: 400, y: 10, easing: backOut }}
        aria-label={$t('aria.vote.upvotes', { default: upvotes })}
      >
        <FormattedNumber number={upvotes} />
      </span>
    {/key}
  </div>
</button>
