<script lang="ts" module>
  export const voteColor = (vote: 'up' | 'down' | undefined) =>
    vote === 'up'
      ? `btn-primary border-0!`
      : vote === 'down'
        ? `bg-red-500 text-slate-50 dark:bg-red-400 dark:text-zinc-900`
        : ''

  export const shouldShowVoteColor = (
    vote: 'up' | 'down' | undefined,
    type: 'upvotes' | 'downvotes',
  ): string =>
    (vote === 'down' && type == 'downvotes') ||
    (vote === 'up' && type == 'upvotes')
      ? voteColor(vote)
      : ''
</script>

<script lang="ts">
  import type {
    AtUri,
    CID,
    PostStats,
    PostViewerState,
  } from '$lib/api/coves/types'
  import { coves } from '$lib/api/client.svelte'
  import { profile } from '$lib/app/auth.svelte'
  import { t } from '$lib/app/i18n'
  import { settings } from '$lib/app/settings.svelte'
  import { computeVoteState } from './helpers'
  import FormattedNumber from '$lib/ui/util/FormattedNumber.svelte'
  import { buttonColor, toast } from 'mono-svelte'
  import { ChevronDown, ChevronUp, Icon } from 'svelte-hero-icons/dist'
  import { backOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'

  interface Props {
    uri: AtUri
    cid: CID
    stats: PostStats | undefined
    viewer: PostViewerState | undefined
    showCounts?: boolean
    children?: import('svelte').Snippet<
      [{ vote?: 'up' | 'down'; score?: number }]
    >
  }

  let {
    uri,
    cid,
    stats = $bindable(),
    viewer = $bindable(),
    showCounts = true,
    children,
  }: Props = $props()

  let upvotes = $derived(stats?.upvotes ?? 0)
  let downvotes = $derived(stats?.downvotes ?? 0)
  let vote = $derived(viewer?.vote)

  const castVote = async (direction: 'up' | 'down') => {
    if (navigator.vibrate) navigator.vibrate(1)
    if (!profile.current?.jwt) {
      toast({ content: $t('toast.loginVoteGate'), type: 'warning' })
      return
    }

    const currentVote = viewer?.vote
    const isToggleOff = currentVote === direction

    // Save previous state for rollback
    const prevStats = stats ? { ...stats } : undefined
    const prevViewer = viewer ? { ...viewer } : undefined

    // Optimistically update local state via pure function
    const newState = computeVoteState(stats, viewer, direction)
    const newStats = newState.stats
    const newViewer = newState.viewer

    stats = newStats
    viewer = newViewer

    try {
      if (isToggleOff) {
        // Removing existing vote
        await coves().deleteVote({ subject: { uri, cid } })
        newViewer.voteUri = undefined
      } else {
        // Creating or changing vote
        if (currentVote) {
          // Remove old vote first
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
      'flex items-center gap-0.5 transition-colors relative cursor-pointer h-full p-2',
      'first:rounded-l-[inherit] last:rounded-r-[inherit]',
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
    <Icon src={target === 'upvote' ? ChevronUp : ChevronDown} size="20" micro />
    {#if showCounts}
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
    {/if}
  </button>
{/snippet}

{#if children}{@render children({ vote, score: stats?.score })}{:else}
  {@const voteRatio = Math.floor((upvotes / (upvotes + downvotes || 1)) * 100)}
  <div
    class={[
      buttonColor.secondary,
      'rounded-xl h-full font-medium flex relative hover:bg-transparent! shadow-xs',
      voteRatio < 85 && settings.voteRatioBar && 'vote-ratio',
    ]}
    aria-label={$t('aria.vote.group')}
    style="--vote-ratio: {voteRatio}%;"
  >
    {@render voteButton(upvotes, 'upvote', vote)}
    <div
      class="h-full p-0! border-l border-slate-200 dark:border-zinc-800"
    ></div>
    {@render voteButton(downvotes, 'downvote', vote)}
  </div>
{/if}

<style>
  .vote-ratio {
    z-index: 0;
  }

  .vote-ratio::before {
    border-radius: var(--radius-3xl);
    content: '';
    position: absolute;
    height: 100%;
    opacity: 10%;
    width: 100%;
    left: 0;
    bottom: 0px;
    z-index: -10;
    background: linear-gradient(
      to right,
      var(--color-indigo-500) calc(var(--vote-ratio) - 4%),
      var(--color-red-500) calc(var(--vote-ratio) + 4%)
    );
  }
</style>
