<script lang="ts">
  import { locale, t } from '$lib/app/state/i18n'
  import { settings } from '$lib/app/state/settings.svelte'
  import { isWebUrl } from '$lib/app/util/url'
  import Avatar from '$lib/ui/generic/Avatar.svelte'
  import AnimatedHeart from '$lib/ui/icon/AnimatedHeart.svelte'
  import { formatRelativeDate } from '$lib/ui/util/RelativeDate.svelte'
  import {
    isCommentUri,
    isSensitiveRow,
    notificationHref,
    notificationIdentity,
    notificationLinkName,
    upvoteNames,
    upvoteSubjectText,
    type UpvoteNotificationRow,
  } from './rows'
  import NotificationPostCard from './NotificationPostCard.svelte'
  import SensitiveRowBanner from './SensitiveRowBanner.svelte'
  import { usableDate } from './timestamp'

  interface Props {
    row: UpvoteNotificationRow
    /** Whether the viewer chose to show this row's sensitive content. */
    revealed: boolean
    /** Asks the list to reveal the row with this identity (Show). */
    onreveal: (identity: string) => void
  }

  let { row, revealed, onreveal }: Props = $props()

  // RelativeDate's default options, so the text matches its other uses.
  const timeOptions: Intl.RelativeTimeFormatOptions = {
    numeric: 'always',
    style: 'narrow',
  }

  // The lexicon caps recentUpvoters at three; the stack never shows more.
  const maximumAvatars = 3

  // Undefined when sortAt is not a usable date, which drops the time.
  let date = $derived(usableDate(row.sortAt))
  // Reads `settings.absoluteDates` (inside formatRelativeDate) and `$locale`,
  // so the shown time and the link name follow both live.
  let time = $derived(
    date ? formatRelativeDate(date, timeOptions, $locale) : '',
  )

  // A sensitive row under the blur setting gets the banner, concealed or
  // revealed; its body renders only once the list reveals it.
  let blurred = $derived(isSensitiveRow(row) && settings.nsfwBlur)
  let concealed = $derived(blurred && !revealed)

  // The element holding the row's body, named by the Show button's
  // `aria-controls`; it stays in the DOM while concealed.
  const bodyId = $props.id()

  // The subject's placeholder copy when it is removed or deleted, else its
  // preview. The helper reads the locale through `t.get`, so `$locale` is read
  // here to follow it live.
  let preview = $derived.by(() => {
    void $locale
    return upvoteSubjectText(row)
  })

  // The subject's thumbnail, only when it is a web URL.
  let thumbnail = $derived.by(() => {
    const url = row.subject.thumbnail
    return url && isWebUrl(url) ? url : undefined
  })

  // An upvote on the root post itself shows the post card as its body; an
  // upvote on a comment shows the comment's preview and thumbnail.
  let isPostUpvote = $derived(row.subject.uri === row.rootPost.uri)

  // When a body renders the time stands apart, top right; otherwise it ends
  // the sentence.
  let showBody = $derived(
    !concealed && (isPostUpvote || Boolean(preview || thumbnail)),
  )

  // Both helpers read the locale through `t.get`, so `$locale` is read here to
  // follow it live.
  let names = $derived.by(() => {
    void $locale
    return upvoteNames(row)
  })
  let linkName = $derived.by(() => {
    void $locale
    return notificationLinkName(row, { time, concealed })
  })

  let upvoters = $derived(row.recentUpvoters.slice(0, maximumAvatars))
</script>

<div
  data-unread={row.isRead === false ? 'true' : undefined}
  class={[
    'rounded-xl border border-slate-200 dark:border-zinc-800 transition-colors',
    'hover:border-slate-300 dark:hover:border-zinc-700',
    row.isRead === false && 'bg-primary-900/5 dark:bg-primary-100/5',
  ]}
>
  <a
    href={notificationHref(row)}
    aria-label={linkName}
    class="flex flex-col gap-3 p-3 rounded-xl"
  >
    <div data-part="header" class="flex items-center gap-2.5 min-w-0">
      {#if upvoters.length > 0}
        <div data-part="avatars" class="flex -space-x-2 shrink-0">
          {#each upvoters as upvoter}
            <Avatar
              url={upvoter.avatar}
              alt={upvoter.did}
              width={32}
              class="ring-2 ring-slate-50 dark:ring-zinc-950"
            />
          {/each}
        </div>
      {/if}
      <div data-part="sentence" class="flex flex-col min-w-0 flex-1">
        <span
          data-part="title"
          class="flex items-center gap-1 text-sm font-medium text-slate-900 dark:text-zinc-100"
        >
          <AnimatedHeart liked={true} size={14} />
          {$t(
            isCommentUri(row.subject.uri)
              ? 'routes.notifications.upvote.titleComment'
              : 'routes.notifications.upvote.titlePost',
          )}
        </span>
        <span
          data-part="names"
          class="text-xs text-slate-600 dark:text-zinc-400 truncate"
        >
          {#each names as part}{part.text}{/each}
        </span>
      </div>
      {#if date}
        <time
          data-part="row-time"
          datetime={date.toISOString()}
          title={date.toLocaleString()}
          class="shrink-0 self-start text-xs text-slate-600 dark:text-zinc-400"
        >
          {time}
        </time>
      {/if}
    </div>
    <div id={bodyId} class={['flex items-start gap-3', !showBody && 'hidden']}>
      {#if !concealed && isPostUpvote}
        <div class="flex-1 min-w-0">
          <NotificationPostCard post={row.rootPost} />
        </div>
      {:else if !concealed}
        {#if preview}
          <div
            data-part="preview-quote"
            class="flex-1 min-w-0 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/30 px-3 py-2.5"
          >
            <p
              data-part="preview"
              class="text-sm text-slate-600 dark:text-zinc-400 line-clamp-3 break-words"
            >
              {preview}
            </p>
          </div>
        {/if}
        {#if thumbnail}
          <img
            data-part="thumbnail"
            src={thumbnail}
            alt={row.subject.thumbnailAlt ?? ''}
            loading="lazy"
            class="ml-auto size-16 shrink-0 rounded-lg object-cover"
          />
        {/if}
      {/if}
    </div>
  </a>
  {#if blurred}
    <SensitiveRowBanner
      expanded={revealed}
      controls={bodyId}
      onshow={() => onreveal(notificationIdentity(row))}
    />
  {/if}
</div>
