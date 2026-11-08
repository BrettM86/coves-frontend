<script lang="ts">
  import type { CommentView, PostView } from '$lib/api/coves/types'
  import { communityLink } from '$lib/app/util/links'
  import { deletedContentPlaceholder } from '$lib/feature/comment/comments.svelte'
  import Markdown from '$lib/feature/markdown/Markdown.svelte'
  import RichText from '$lib/feature/richtext/RichText.svelte'
  import { hasFacets } from '$lib/feature/richtext/facets'
  import { Heart, Icon, MessageSquare } from '$lib/ui/kit/icon'
  import { publishedToDate } from '$lib/ui/util/date'
  import FormattedNumber from '$lib/ui/util/FormattedNumber.svelte'
  import RelativeDate from '$lib/ui/util/RelativeDate.svelte'
  import { profileCommentHref } from './tabs'

  interface Props {
    comment: CommentView
    /** The hydrated parent post, when getPosts returned one. */
    parent?: PostView
  }

  let { comment, parent }: Props = $props()

  let href = $derived(profileCommentHref(comment, parent))
  let record = $derived(comment.isDeleted ? undefined : comment.record)
</script>

<article class="py-3 space-y-1.5">
  <!-- Every comment here is the profile owner's, so the context line names
       where it was written instead of who wrote it. -->
  <p
    class="flex items-center gap-1.5 text-xs text-slate-500 dark:text-zinc-400 min-w-0"
  >
    {#if parent}
      <a
        href={communityLink(parent.community)}
        class="font-medium shrink-0 hover:underline"
      >
        {parent.community.name}
      </a>
      {#if parent.record?.title}
        <span aria-hidden="true">·</span>
        <a {href} class="truncate hover:underline">{parent.record.title}</a>
      {/if}
      <span aria-hidden="true">·</span>
    {/if}
    <svelte:element
      this={href ? 'a' : 'span'}
      {href}
      class={['shrink-0', href && 'hover:underline']}
    >
      <RelativeDate date={publishedToDate(comment.createdAt)} />
    </svelte:element>
  </p>
  {#if record}
    {#if hasFacets(record.facets)}
      <RichText
        content={record.content}
        facets={record.facets}
        embed={comment.embed}
        noStyle
        class="text-[15px] text-slate-700 dark:text-zinc-300 break-words whitespace-pre-wrap"
      />
    {:else}
      <Markdown
        source={record.content}
        noStyle
        class="text-[15px] text-slate-700 dark:text-zinc-300 break-words"
      />
    {/if}
  {:else}
    <!-- The placeholder is Markdown (it arrives wrapped in *…*). -->
    <Markdown
      source={deletedContentPlaceholder(comment)}
      noStyle
      class="text-sm text-slate-500 dark:text-zinc-400"
    />
  {/if}
  <svelte:element
    this={href ? 'a' : 'div'}
    {href}
    class="inline-flex items-center gap-3 text-xs text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100"
  >
    <span class="inline-flex items-center gap-1">
      <Icon src={Heart} size="14" />
      <FormattedNumber number={comment.stats?.upvotes ?? 0} />
    </span>
    <span class="inline-flex items-center gap-1">
      <Icon src={MessageSquare} size="14" />
      <FormattedNumber number={comment.stats?.replyCount ?? 0} />
    </span>
  </svelte:element>
</article>
