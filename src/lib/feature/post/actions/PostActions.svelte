<script lang="ts">
  import type { PostView } from '$lib/api/coves/types'
  import { profile } from '$lib/app/auth.svelte'
  import { t } from '$lib/app/i18n'
  import { settings, type View } from '$lib/app/settings.svelte'
  import FormattedNumber from '$lib/ui/util/FormattedNumber.svelte'
  import { Button, Menu, Spinner, toast } from 'mono-svelte'
  import {
    Bookmark,
    BookmarkSlash,
    BugAnt,
    ChatBubbleOvalLeft,
    EllipsisHorizontal,
    Icon,
    Share,
  } from 'svelte-hero-icons/dist'
  import { PostVote } from '..'
  import { postLink } from '../helpers'

  let saving = $state(false)

  interface Props {
    post: PostView
    view?: View
    debug?: boolean
    style?: string
  }

  let {
    post = $bindable(),
    view = 'cozy',
    debug = $bindable(false),
    style = '',
  }: Props = $props()
  let buttonHeight = $derived(view == 'compact' ? 'h-7.5' : 'h-8')
  let buttonSquare = $derived(view == 'compact' ? 'w-7.5 h-7.5' : 'w-8 h-8')

  function share(): void {
    const link = new URL(postLink(post), location.origin).toString()

    if (navigator.share)
      navigator.share?.({
        url: link,
      })
    else {
      navigator.clipboard.writeText(link)
      toast({ content: $t('toast.copied') })
    }
  }
</script>

<footer
  class={[
    'flex flex-row gap-2 items-center shrink-0 text-slate-600 dark:text-zinc-400',
    buttonHeight,
  ]}
  class:flex-row-reverse={settings.posts.reverseActions}
  {style}
>
  <PostVote
    uri={post.uri}
    cid={post.cid}
    bind:stats={post.stats}
    bind:viewer={post.viewer}
  />

  <Button
    size="custom"
    href="{postLink(post)}#comments"
    class="text-inherit! h-full px-3 relative"
    rounding="xl"
    target={settings.openLinksInNewTab ? '_blank' : ''}
    aria-label={$t('post.actions.comments')}
  >
    <Icon src={ChatBubbleOvalLeft} size="16" mini />
    <FormattedNumber number={post.stats?.commentCount ?? 0} />
  </Button>
  <div class="flex-1"></div>

  {#if settings.debugInfo}
    {#if debug}
      {#await import('$lib/ui/util/debug/DebugObject.svelte') then { default: DebugObject }}
        <DebugObject object={post} bind:open={debug} />
      {/await}
    {/if}
    <Button
      onclick={() => (debug = true)}
      title="Debug"
      size="custom"
      rounding="xl"
      class={buttonSquare}
      icon={BugAnt}
    ></Button>
  {/if}

  {#if profile.current?.jwt}
    <Button
      onclick={async () => {
        if (!profile.current?.jwt) return
        toast({ content: 'Saving posts is not yet available', type: 'warning' })
      }}
      size="custom"
      class={buttonSquare}
      rounding="xl"
      loading={saving}
      disabled={saving}
      title={post.viewer?.saved
        ? $t('post.actions.unsave')
        : $t('post.actions.save')}
      icon={post.viewer?.saved ? BookmarkSlash : Bookmark}
    ></Button>
  {/if}

  <Button
    rounding="xl"
    size="custom"
    class={buttonSquare}
    onclick={() => share()}
    icon={Share}
    title={$t('post.actions.more.share')}
  />

  {#if profile.current?.jwt}
    <Menu placement="bottom-end">
      {#snippet target(popover)}
        <Button
          {@attach popover}
          title={$t('post.actions.more.label')}
          rounding="xl"
          size="custom"
          class={buttonSquare}
          icon={EllipsisHorizontal}
        ></Button>
      {/snippet}
      {#snippet children(open)}
        {#if open}
          {#await import('./PostActionsMenu.svelte')}
            <div class="p-8 w-full h-full grid place-items-center">
              <Spinner width={20} />
            </div>
          {:then { default: PostActionsMenu }}
            <PostActionsMenu bind:post />
          {/await}
        {/if}
      {/snippet}
    </Menu>
  {/if}
</footer>
