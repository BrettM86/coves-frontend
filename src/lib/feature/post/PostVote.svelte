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
  import { computeVoteState } from './helpers'
  import FormattedNumber from '$lib/ui/util/FormattedNumber.svelte'
  import { toast } from 'mono-svelte'
  import { backOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import AnimatedHeart from '$lib/ui/icon/AnimatedHeart.svelte'

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
  let vote = $derived(viewer?.vote)
  let liked = $derived(vote === 'up')

  const castVote = async () => {
    if (navigator.vibrate) navigator.vibrate(1)
    if (!profile.current?.jwt) {
      toast({ content: $t('toast.loginVoteGate'), type: 'warning' })
      return
    }

    const isToggleOff = viewer?.vote === 'up'

    // Save previous state for rollback
    const prevStats = stats ? { ...stats } : undefined
    const prevViewer = viewer ? { ...viewer } : undefined

    // Optimistically update local state via pure function
    const newState = computeVoteState(stats, viewer, 'up')
    const newStats = newState.stats
    const newViewer = newState.viewer

    stats = newStats
    viewer = newViewer

    try {
      if (isToggleOff) {
        await coves().deleteVote({ subject: { uri, cid } })
        newViewer.voteUri = undefined
      } else {
        const result = await coves().createVote({
          subject: { uri, cid },
          direction: 'up',
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

{#if children}{@render children({ vote, score: stats?.score })}{:else}
  <button
    onclick={castVote}
    class={[
      'flex items-center gap-1 transition-colors cursor-pointer rounded-xl px-2 py-1.5 shadow-xs',
      liked ? 'text-[#FF0033]' : 'btn-tertiary',
    ]}
    aria-pressed={liked}
    aria-label={$t('post.actions.vote.upvote')}
  >
    <AnimatedHeart {liked} size={20} />
    {#if showCounts}
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
    {/if}
  </button>
{/if}
