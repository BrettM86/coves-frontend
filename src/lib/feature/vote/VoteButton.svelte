<script
  lang="ts"
  generics="TStats extends VoteCounts, TViewer extends VoteViewer"
>
  import type { AtUri, CID } from '$lib/api/coves/types'
  import { coves } from '$lib/api/client.svelte'
  import { profile } from '$lib/app/state/auth.svelte'
  import { errorMessage } from '$lib/app/util/error'
  import { t } from '$lib/app/state/i18n'
  import FormattedNumber from '$lib/ui/util/FormattedNumber.svelte'
  import AnimatedHeart from '$lib/ui/icon/AnimatedHeart.svelte'
  import { toast } from '$lib/ui/kit'
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
    /** Sizing preset: posts get the larger heart and pill. */
    variant?: 'post' | 'comment'
    showCounts?: boolean
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
  }: Props = $props()

  let upvotes = $derived(stats?.upvotes ?? 0)
  let liked = $derived(viewer?.vote === 'up')

  let voting = $state(false)

  async function onPress(): Promise<void> {
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
      const outcome = await castUpvote<TStats, TViewer>({
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
      })

      switch (outcome.kind) {
        case 'out-of-sync':
          toast({ content: $t('toast.voteOutOfSync'), type: 'warning' })
          break
        case 'session-expired':
          toast({ content: $t('toast.sessionExpired'), type: 'warning' })
          break
        case 'error':
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

<button
  onclick={onPress}
  class={[
    'flex items-center transition-colors cursor-pointer',
    variant === 'post'
      ? 'gap-1 rounded-xl px-2 py-1.5 shadow-xs'
      : 'gap-0.5 rounded-full px-1.5 py-1',
    liked ? 'text-[#FF0033]' : 'btn-tertiary',
  ]}
  aria-pressed={liked}
  aria-label={$t('post.actions.vote.upvote')}
>
  <AnimatedHeart {liked} size={variant === 'post' ? 20 : 18} />
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
