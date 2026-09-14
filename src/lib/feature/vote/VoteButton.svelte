<script
  lang="ts"
  generics="TStats extends VoteCounts, TViewer extends VoteViewer"
>
  import { untrack, type Snippet } from 'svelte'
  import type { AtUri, CID } from '$lib/api/coves/types'
  import { coves } from '$lib/api/client.svelte'
  import { profile } from '$lib/app/state/auth.svelte'
  import { errorMessage } from '$lib/app/util/error'
  import { isExpiredSessionError } from '$lib/app/util/session-expired-error'
  import { t } from '$lib/app/state/i18n'
  import FormattedNumber from '$lib/ui/util/FormattedNumber.svelte'
  import AnimatedHeart from '$lib/ui/icon/AnimatedHeart.svelte'
  import { toast } from '$lib/ui/kit'
  import { Icon, ThumbsDown } from '$lib/ui/kit/icon'
  import { backOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { castUpvote, type VoteViewer } from './cast'
  import type { VoteCounts } from './vote'

  interface Props {
    uri: AtUri
    cid: CID
    stats: TStats | undefined
    viewer: TViewer | undefined
    /** Bases used when the subject carries no stats/viewer yet. */
    emptyStats: TStats
    emptyViewer: TViewer
    /** Sizing preset: posts get the larger controls. */
    variant?: 'post' | 'comment'
    showCounts?: boolean
    children?: Snippet
  }

  let {
    uri,
    cid,
    stats = $bindable(),
    viewer = $bindable(),
    emptyStats,
    emptyViewer,
    variant = 'post',
    showCounts = true,
    children,
  }: Props = $props()

  let score = $derived(stats?.score ?? 0)
  let upvoted = $derived(viewer?.vote === 'up')
  let downvoted = $derived(viewer?.vote === 'down')

  let voting = $state(false)
  let thumbAnimating = $state(false)
  let previousDownvote = untrack(() => downvoted)
  let previousUri = untrack(() => uri)

  $effect(() => {
    thumbAnimating = uri === previousUri && downvoted && !previousDownvote
    previousDownvote = downvoted
    previousUri = uri
  })

  async function onPress(requestedDirection: 'up' | 'down'): Promise<void> {
    if (navigator.vibrate) navigator.vibrate(1)
    if (!profile.current?.jwt) {
      toast({ content: $t('toast.loginVoteGate'), type: 'warning' })
      return
    }
    if (voting) return
    voting = true

    // Captured before any await: the component may be rebound to another
    // subject while the request is in flight (see `isCurrent`).
    const subject = { uri, cid }

    try {
      const outcome = await castUpvote<TStats, TViewer>(
        {
          api: coves(),
          subject,
          emptyStats,
          emptyViewer,
          read: () => ({ stats, viewer }),
          write: (next) => {
            stats = next.stats
            viewer = next.viewer
          },
          isCurrent: () => uri === subject.uri,
        },
        requestedDirection,
      )

      switch (outcome.kind) {
        case 'out-of-sync':
          toast({ content: $t('toast.voteOutOfSync'), type: 'warning' })
          break
        case 'error':
          // The recovery banner already covers a 401 from the live session;
          // a stale one leaves the session live, so the toast is the feedback.
          if (isExpiredSessionError(outcome.error) && profile.sessionExpired)
            break
          toast({ content: errorMessage(outcome.error), type: 'error' })
          break
        default:
          break
      }
    } finally {
      voting = false
    }
  }
</script>

<div
  class={[
    'inline-flex shrink-0 items-center',
    variant === 'post' ? 'gap-2 self-stretch' : 'gap-0.5',
  ]}
  role="group"
  aria-label={$t('aria.vote.group')}
  aria-busy={voting}
>
  <button
    type="button"
    onclick={() => onPress('up')}
    disabled={voting}
    class={[
      'flex items-center justify-center transition-colors cursor-pointer disabled:cursor-default',
      variant === 'post'
        ? 'gap-1 rounded-xl px-2 py-1.5'
        : 'gap-0.5 rounded-full px-1.5 py-1',
      upvoted ? 'text-[#FF0033]' : 'btn-tertiary',
    ]}
    aria-pressed={upvoted}
    aria-label={$t('post.actions.vote.upvote')}
  >
    <AnimatedHeart liked={upvoted} size={variant === 'post' ? 20 : 18} />

    {#if showCounts}
      <div class="grid text-sm">
        {#key score}
          <span
            style="grid-column: 1; grid-row: 1;"
            in:fly={{ duration: 400, y: -10, easing: backOut }}
            out:fly={{ duration: 400, y: 10, easing: backOut }}
            aria-label={$t('aria.vote.score', { default: score })}
          >
            <FormattedNumber number={score} />
          </span>
        {/key}
      </div>
    {/if}
  </button>

  {@render children?.()}

  <button
    type="button"
    onclick={() => onPress('down')}
    disabled={voting}
    class={[
      'flex items-center justify-center transition-colors cursor-pointer disabled:cursor-default',
      variant === 'post'
        ? 'rounded-xl px-2 py-1.5'
        : 'rounded-full px-1.5 py-1',
      downvoted
        ? 'text-[#0F766E] dark:text-[#63B5B1]'
        : 'btn-tertiary text-slate-500 dark:text-zinc-400',
    ]}
    aria-pressed={downvoted}
    aria-label={$t('post.actions.vote.downvote')}
  >
    <span
      class="thumb-icon"
      class:thumb-tap={thumbAnimating}
      onanimationend={() => (thumbAnimating = false)}
    >
      <Icon
        src={ThumbsDown}
        size={variant === 'post' ? 20 : 18}
        strokeWidth={downvoted ? 2.5 : 2}
      />
    </span>
  </button>
</div>

<style>
  .thumb-icon {
    display: inline-flex;
    transform-origin: 60% 35%;
  }

  @media (prefers-reduced-motion: no-preference) {
    .thumb-tap {
      animation: thumb-tap 240ms ease-out;
    }
  }

  @keyframes thumb-tap {
    0%,
    100% {
      transform: translateY(0) rotate(0);
    }
    40% {
      transform: translateY(3px) rotate(-8deg);
    }
    72% {
      transform: translateY(-1px) rotate(3deg);
    }
  }
</style>
