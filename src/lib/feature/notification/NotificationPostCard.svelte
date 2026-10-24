<script lang="ts">
  import type { NotificationRootPost } from '$lib/api/coves/types'
  import { locale, t } from '$lib/app/state/i18n'
  import { isWebUrl } from '$lib/app/util/url'
  import { usableHandle } from '$lib/types/atproto'
  import Avatar from '$lib/ui/generic/Avatar.svelte'
  import AnimatedHeart from '$lib/ui/icon/AnimatedHeart.svelte'
  import { FileText, Icon, MessageSquare, ThumbsDown } from '$lib/ui/kit/icon'
  import FormattedNumber from '$lib/ui/util/FormattedNumber.svelte'
  import { formatRelativeDate } from '$lib/ui/util/RelativeDate.svelte'
  import { placeholderCopyKey } from './rows'
  import { usableDate } from './timestamp'

  /**
   * A notification's root post in the Kelp compact post look: author and time,
   * title, score and comment count, and a media tile. Static: it sits inside
   * the row's link, so it holds no links or buttons. A removed or deleted root
   * shows its placeholder copy in the title position and a text tile only, as
   * does a thumbnail that fails to load. The ThumbsDown icon is decorative,
   * matching the compact post design; it shows no count.
   */
  interface Props {
    post: NotificationRootPost
  }

  let { post }: Props = $props()

  // RelativeDate's default options, the same the notification rows use.
  const timeOptions: Intl.RelativeTimeFormatOptions = {
    numeric: 'always',
    style: 'narrow',
  }

  let placeholder = $derived(
    post.status ? $t(placeholderCopyKey(post.status)) : undefined,
  )

  let handle = $derived(
    post.status ? undefined : usableHandle(post.author?.handle),
  )
  let date = $derived(post.status ? undefined : usableDate(post.createdAt))
  // Reads `settings.absoluteDates` (inside formatRelativeDate) and `$locale`.
  let time = $derived(
    date ? formatRelativeDate(date, timeOptions, $locale) : '',
  )
  let stats = $derived(post.status ? undefined : post.stats)

  let thumbnail = $derived.by(() => {
    const url = post.thumbnail
    return !post.status && url && isWebUrl(url) ? url : undefined
  })

  let thumbnailFailed = $state(false)

  $effect(() => {
    // Reset the failure when the thumbnail changes.
    void thumbnail
    thumbnailFailed = false
  })

  let title = $derived(placeholder ?? post.title)
</script>

<div
  data-part="post-card"
  class="flex items-stretch gap-3 p-3 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/30"
>
  <div class="flex flex-col gap-1 min-w-0 flex-1">
    {#if handle || date}
      <div
        data-part="post-meta"
        class="flex items-center gap-1.5 min-w-0 text-xs text-slate-600 dark:text-zinc-400"
      >
        {#if handle && post.author}
          <Avatar
            url={post.author.avatar}
            alt={post.author.did}
            width={20}
            class="shrink-0"
          />
          <span class="font-medium truncate">@{handle}</span>
        {/if}
        {#if date}
          <time
            datetime={date.toISOString()}
            title={date.toLocaleString()}
            class="shrink-0"
          >
            {time}
          </time>
        {/if}
      </div>
    {/if}
    {#if title}
      <span
        data-part="post-title"
        class={[
          'text-base font-medium leading-snug line-clamp-2 break-words',
          placeholder
            ? 'italic text-slate-600 dark:text-zinc-400'
            : 'text-slate-900 dark:text-zinc-100',
        ]}
      >
        {title}
      </span>
    {/if}
    {#if stats}
      <div
        data-part="post-stats"
        class="flex items-center gap-4 h-7.5 mt-auto text-sm text-slate-600 dark:text-zinc-400"
      >
        <span class="inline-flex items-center gap-1">
          <AnimatedHeart liked={false} />
          <span data-part="post-score">
            <FormattedNumber number={stats.score} />
          </span>
        </span>
        <span class="inline-flex items-center gap-1">
          <Icon src={MessageSquare} size="16" />
          <span data-part="post-comments">
            <FormattedNumber number={stats.commentCount} />
          </span>
        </span>
        <Icon src={ThumbsDown} size="18" />
      </div>
    {/if}
  </div>
  <div
    data-part="post-media"
    class="w-22 h-22 sm:w-28 shrink-0 overflow-hidden rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-200 dark:bg-zinc-800"
  >
    {#if thumbnail && !thumbnailFailed}
      <img
        src={thumbnail}
        alt={post.thumbnailAlt ?? ''}
        loading="lazy"
        onerror={() => (thumbnailFailed = true)}
        class="h-full w-full object-cover"
      />
    {:else}
      <div
        data-part="post-media-text"
        class="bg-slate-100 dark:bg-zinc-900 w-full h-full grid place-items-center text-slate-600 dark:text-zinc-400"
      >
        <Icon src={FileText} size="32" />
      </div>
    {/if}
  </div>
</div>
