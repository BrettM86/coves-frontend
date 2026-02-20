<script lang="ts">
  import type {
    AtUri,
    CID,
    CommentStats,
    CommentViewerState,
  } from '$lib/api/coves/types'
  import { coves } from '$lib/api/client.svelte'
  import { profile } from '$lib/app/auth.svelte'
  import { t } from '$lib/app/i18n'
  import { settings } from '$lib/app/settings.svelte'
  import FormattedNumber from '$lib/ui/util/FormattedNumber.svelte'
  import { toast } from 'mono-svelte'
  import { ChevronDown, ChevronUp, Icon } from 'svelte-hero-icons/dist'
  import { backOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { shouldShowVoteColor } from '../post/PostVote.svelte'

  interface Props {
    uri: AtUri
    cid: CID
    stats: CommentStats | undefined
    viewer: CommentViewerState | undefined
  }

  let { uri, cid, stats = $bindable(), viewer = $bindable() }: Props = $props()

  let upvotes = $derived(stats?.upvotes ?? 0)
  let downvotes = $derived(stats?.downvotes ?? 0)
  let vote = $derived(viewer?.vote)
  let voteRatio = $derived(
    Math.floor((upvotes / (upvotes + downvotes || 1)) * 100),
  )

  let voting = $state(false)

  const castVote = async (direction: 'up' | 'down') => {
    if (navigator.vibrate) navigator.vibrate(1)
    if (!profile.current?.jwt) {
      toast({ content: $t('toast.loginVoteGate'), type: 'warning' })
      return
    }
    if (voting) return
    voting = true

    const currentVote = viewer?.vote
    const isToggleOff = currentVote === direction

    // Save previous state for rollback
    const prevStats = stats ? { ...stats } : undefined
    const prevViewer = viewer ? { ...viewer } : undefined

    // Optimistically update local state
    const newStats = {
      ...(stats ?? { upvotes: 0, downvotes: 0, score: 0, replyCount: 0 }),
    }
    const newViewer = { ...(viewer ?? {}) }

    if (isToggleOff) {
      if (currentVote === 'up') newStats.upvotes--
      else if (currentVote === 'down') newStats.downvotes--
      newViewer.vote = undefined
      newViewer.voteUri = undefined
    } else {
      if (currentVote === 'up') newStats.upvotes--
      else if (currentVote === 'down') newStats.downvotes--
      if (direction === 'up') newStats.upvotes++
      else newStats.downvotes++
      newViewer.vote = direction
    }
    newStats.score = newStats.upvotes - newStats.downvotes

    stats = newStats
    viewer = newViewer

    try {
      if (isToggleOff) {
        await coves().deleteVote({ subject: { uri, cid } })
        newViewer.voteUri = undefined
      } else {
        if (currentVote) {
          await coves().deleteVote({ subject: { uri, cid } })
        }
        const result = await coves().createVote({
          subject: { uri, cid },
          direction,
        })
        newViewer.voteUri = result.uri
      }
    } catch (err) {
      // Rollback on error
      stats = prevStats
      viewer = prevViewer
      const errorMsg = err instanceof Error ? err.message : String(err)
      toast({ content: errorMsg, type: 'error' })
    } finally {
      voting = false
    }
  }
</script>

{#snippet voteButton(
  votes: number,
  target: 'upvote' | 'downvote',
  currentVote?: 'up' | 'down',
)}
  {@const direction = target === 'upvote' ? 'up' : 'down'}
  <button
    onclick={() => castVote(direction)}
    class={[
      'flex items-center gap-0.5 transition-colors relative cursor-pointer px-1.5 py-1',
      'first:rounded-l-3xl last:rounded-r-3xl',
      'last:flex-row-reverse',
      currentVote === direction
        ? shouldShowVoteColor(
            currentVote,
            target === 'upvote' ? 'upvotes' : 'downvotes',
          )
        : 'btn-tertiary',
    ]}
    aria-pressed={currentVote === direction}
    aria-label={$t(
      target === 'upvote'
        ? 'post.actions.vote.upvote'
        : 'post.actions.vote.downvote',
    )}
  >
    <Icon src={target === 'upvote' ? ChevronUp : ChevronDown} size="18" micro />
    <div class="grid text-sm z-20">
      {#key votes}
        <span
          style="grid-column: 1; grid-row: 1;"
          in:fly={{ duration: 400, y: -10, easing: backOut }}
          out:fly={{ duration: 400, y: 10, easing: backOut }}
          aria-label={$t(
            target === 'upvote' ? 'aria.vote.upvotes' : 'aria.vote.downvotes',
            { default: votes },
          )}
        >
          <FormattedNumber number={votes ?? 0} />
        </span>
      {/key}
    </div>
  </button>
{/snippet}

<div
  class={[
    'h-full relative flex items-center overflow-hidden rounded-full font-medium',
    voteRatio < 85 && settings.voteRatioBar && 'vote-ratio',
    'divide-x divide-slate-200 dark:divide-zinc-800 border border-slate-200 dark:border-zinc-800',
  ]}
  style="--vote-ratio: {voteRatio}%;"
>
  {@render voteButton(upvotes, 'upvote', vote)}
  {@render voteButton(downvotes, 'downvote', vote)}
</div>

<style>
  .vote-ratio {
    z-index: 0;
  }

  .vote-ratio::before {
    content: '';
    position: absolute;
    height: 100%;
    width: 100%;
    opacity: 10%;
    z-index: -10;
    left: 0;
    bottom: 0px;
    background: linear-gradient(
      to right,
      var(--color-indigo-500) calc(var(--vote-ratio) - 5%),
      var(--color-red-500) calc(var(--vote-ratio) + 5%)
    );
  }
</style>
