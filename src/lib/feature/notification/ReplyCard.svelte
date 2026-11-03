<script lang="ts">
  import { locale, t } from '$lib/app/state/i18n'
  import { settings } from '$lib/app/state/settings.svelte'
  import { communityMention } from '$lib/app/util/community'
  import Avatar from '$lib/ui/generic/Avatar.svelte'
  import { formatRelativeDate } from '$lib/ui/util/RelativeDate.svelte'
  import CommentForm from '$lib/feature/comment/CommentForm.svelte'
  import { Button } from '$lib/ui/kit'
  import { MessageSquare } from '$lib/ui/kit/icon'
  import { usableHandle } from '$lib/types/atproto'
  import { tick } from 'svelte'
  import {
    isCommentUri,
    isSensitiveRow,
    notificationAuthor,
    notificationHref,
    notificationIdentity,
    notificationLinkName,
    notificationRootRef,
    placeholderCopyKey,
    repliedToComment,
    replyRecordText,
    type ReplyNotificationRow,
  } from './rows'
  import NotificationPostCard from './NotificationPostCard.svelte'
  import SensitiveRowBanner from './SensitiveRowBanner.svelte'
  import { usableDate } from './timestamp'

  interface Props {
    row: ReplyNotificationRow
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

  // The record's creation time when it is a usable date, else the sort time;
  // undefined when neither is, which drops the time from the card.
  let date = $derived(
    usableDate(row.record.createdAt) ?? usableDate(row.sortAt),
  )
  // Reads `settings.absoluteDates` (inside formatRelativeDate) and `$locale`,
  // so the shown time and the link name follow both live.
  let time = $derived(
    date ? formatRelativeDate(date, timeOptions, $locale) : '',
  )

  // A sensitive row under the blur setting gets the banner, concealed or
  // revealed; its texts and post card render only once the list reveals it.
  let blurred = $derived(isSensitiveRow(row) && settings.nsfwBlur)
  let concealed = $derived(blurred && !revealed)
  let linkName = $derived(notificationLinkName(row, { time, concealed }))

  // Same community rule as the link name: a status root or an unusable
  // community hides the community avatar and `!community` line.
  let community = $derived(notificationRootRef(row).community)
  let showCommunity = $derived(!row.rootPost.status && community.name !== '')
  let communityAvatar = $derived.by(() => {
    const avatar: unknown = row.rootPost.community?.avatar
    return typeof avatar === 'string' ? avatar : undefined
  })

  let author = $derived(notificationAuthor(row))

  // The element holding the root post card and the quoted reply bubble, named
  // by the Show button's `aria-controls`; it stays in the DOM while concealed.
  const bodyId = $props.id()

  // The root's placeholder copy, which the post card's title position shows
  // when the root is removed or deleted.
  let titlePlaceholder = $derived(
    row.rootPost.status ? $t(placeholderCopyKey(row.rootPost.status)) : '',
  )

  // Quick Reply: replies in place to the record, under the root post. Not
  // offered for a removed or deleted root or record, while concealed, or when
  // a strong ref the create sends lacks its cid (the row's boundary check only
  // validates uris): the root's always, the record's when it is the parent.
  let canReply = $derived(
    !row.rootPost.status &&
      !row.record.status &&
      !concealed &&
      isNonEmptyString(row.rootPost.cid) &&
      (!isCommentUri(row.record.uri) || isNonEmptyString(row.record.cid)),
  )
  let replying = $state(false)
  // Counts composer openings. CommentForm reads `oncomment` when a submit
  // starts, so each create is tied to the opening that sent it, and a create
  // that resolves after its composer closed leaves a newer composer open.
  let composerOpening = $state(0)
  // Whether the open composer's create is in flight. The Reply toggle is
  // disabled meanwhile, so it cannot hide a reply that still posts. Only the
  // current opening's composer writes it, and each opening resets it: a
  // composer dropped by concealment mid-submit must neither keep a later
  // composer's toggle disabled nor re-enable it when its own create settles.
  let submitting = $state(false)
  // A row that stops being repliable (concealed, removed) drops its composer,
  // so a later reveal shows the collapsed Reply button.
  $effect(() => {
    if (!canReply) replying = false
  })
  const replyButtonId = `${bodyId}-reply`
  // Shared by the quoted reply bubble and the Reply row continuing it below
  // the link. The row's ms-7 is the link's p-3 plus the bubble's ml-4.
  const bubbleClasses =
    'border-l-2 border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3'
  let postRef = $derived({ uri: row.rootPost.uri, cid: row.rootPost.cid })
  // A post record (a post mention) is replied to at the top level, which
  // CommentForm sends as a parent equal to the root.
  let parentRef = $derived(
    isCommentUri(row.record.uri)
      ? { uri: row.record.uri, cid: row.record.cid }
      : undefined,
  )

  function isNonEmptyString(value: unknown): boolean {
    return typeof value === 'string' && value !== ''
  }

  function toggleComposer(): void {
    if (!replying) {
      composerOpening += 1
      submitting = false
    }
    replying = !replying
  }

  function replyCreatedBy(opening: number): () => void {
    return () => {
      if (replying && opening === composerOpening) void closeComposer()
    }
  }

  function submittingChangedBy(opening: number): (loading: boolean) => void {
    return (loading) => {
      if (opening === composerOpening) submitting = loading
    }
  }

  async function closeComposer(): Promise<void> {
    replying = false
    await tick()
    document.getElementById(replyButtonId)?.focus()
  }

  // On a reply to the viewer's comment, that comment is quoted above the reply
  // in place of the root post card. Not for a removed or deleted root, whose
  // card's placeholder is the only sign of it (the header is hidden too).
  let yourComment = $derived.by(() => {
    void $locale
    return row.rootPost.status ? undefined : repliedToComment(row)
  })

  // The bubble text, the same text the link name uses, unless it is the
  // placeholder copy the root post card's title position already shows.
  // `replyRecordText` reads the locale through `t.get`, so `$locale` is read
  // here to follow it live.
  let excerpt = $derived.by(() => {
    void $locale
    const text = replyRecordText(row)
    return row.record.status && text === titlePlaceholder ? undefined : text
  })

  // A post that mentions the viewer is itself the root post card, which
  // already names its author, so its bubble is dropped unless it adds text.
  // It stays whenever the card does not show the author: while concealed, for
  // a removed root, or for a root author without a usable handle (the card's
  // own rule).
  let rootCardShowsAuthor = $derived(
    !concealed &&
      !row.rootPost.status &&
      usableHandle(row.rootPost.author?.handle) !== undefined,
  )
  let showBubble = $derived(
    isCommentUri(row.record.uri) || Boolean(excerpt) || !rootCardShowsAuthor,
  )
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
    class={[
      'flex flex-col gap-3 p-3 rounded-xl',
      canReply && showBubble && 'pb-0',
    ]}
  >
    {#if !row.rootPost.status}
      <div data-part="header" class="flex items-center gap-2.5 min-w-0">
        {#if showCommunity}
          <Avatar
            url={communityAvatar}
            alt={community.did}
            width={32}
            class="shrink-0"
          />
        {/if}
        <div class="flex flex-col min-w-0 flex-1">
          <span class="text-sm font-medium text-slate-900 dark:text-zinc-100">
            {$t(`routes.notifications.reason.${row.reason}`)}
          </span>
          {#if showCommunity}
            <span class="text-xs text-slate-600 dark:text-zinc-400 truncate">
              {communityMention(community)}
            </span>
          {/if}
        </div>
        {#if date}
          <time
            datetime={date.toISOString()}
            title={date.toLocaleString()}
            class="text-xs text-slate-600 dark:text-zinc-400 shrink-0 self-start"
          >
            {time}
          </time>
        {/if}
      </div>
    {/if}
    <div id={bodyId} class="flex flex-col gap-3">
      {#if concealed}
        <!-- Nothing from the root post or the viewer's comment shows. -->
      {:else if yourComment}
        <div
          data-part="your-comment"
          class="border-l-2 border-slate-200 dark:border-zinc-800 ps-3"
        >
          <p
            class={[
              'text-sm break-words line-clamp-3',
              yourComment.placeholder
                ? 'italic text-slate-600 dark:text-zinc-400'
                : 'text-slate-700 dark:text-zinc-300',
            ]}
          >
            {yourComment.text}
          </p>
        </div>
      {:else}
        <NotificationPostCard post={row.rootPost} />
      {/if}
      <!-- With Quick Reply, the bubble continues below the link as the row
           holding the Reply button, which a link may not contain. -->
      {#if showBubble}
        <div
          class={[
            'ml-4 pt-2',
            bubbleClasses,
            canReply ? 'rounded-t-lg' : 'rounded-lg pb-2',
          ]}
        >
          <div data-part="author" class="flex items-center gap-2 min-w-0">
            <Avatar
              url={author.avatarUrl}
              did={author.did}
              alt={author.avatarSeed}
              width={24}
              class="shrink-0"
            />
            <div class="flex flex-col min-w-0 leading-tight">
              <span
                class="text-sm font-medium text-slate-900 dark:text-zinc-100 truncate"
              >
                {author.name}
              </span>
              {#if author.handle}
                <span
                  class="text-xs text-slate-600 dark:text-zinc-400 truncate"
                >
                  @{author.handle}
                </span>
              {/if}
            </div>
          </div>
          {#if !concealed && excerpt}
            <p
              data-part="excerpt"
              class={[
                'mt-1.5 text-sm break-words whitespace-pre-line',
                row.record.status
                  ? 'italic text-slate-600 dark:text-zinc-400'
                  : 'text-slate-800 dark:text-zinc-200',
              ]}
            >
              {excerpt}
            </p>
          {/if}
        </div>
      {/if}
    </div>
  </a>
  {#if canReply}
    <div
      data-part="reply-row"
      class={[
        'flex justify-end me-3 mb-3',
        showBubble ? ['ms-7 rounded-b-lg pt-2 pb-2.5', bubbleClasses] : 'ms-3',
      ]}
    >
      <Button
        id={replyButtonId}
        color="primary"
        icon={MessageSquare}
        aria-label={$t('routes.notifications.replyTo', { name: author.name })}
        aria-expanded={replying}
        disabled={replying && submitting}
        onclick={toggleComposer}
      >
        {$t('comment.reply')}
      </Button>
    </div>
    {#if replying}
      <div
        class="mx-3 mb-3 pt-3 border-t border-slate-200 dark:border-zinc-800"
      >
        <CommentForm
          label={$t('routes.notifications.replyTo', { name: author.name })}
          {postRef}
          {parentRef}
          rows={3}
          onloadingchange={submittingChangedBy(composerOpening)}
          oncomment={replyCreatedBy(composerOpening)}
          oncancel={() => void closeComposer()}
        />
      </div>
    {/if}
  {/if}
  {#if blurred}
    <SensitiveRowBanner
      expanded={revealed}
      controls={bodyId}
      onshow={() => onreveal(notificationIdentity(row))}
    />
  {/if}
</div>
