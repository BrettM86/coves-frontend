<script lang="ts">
  import type { PostView } from '$lib/api/coves/types'
  import { profile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { settings, type View } from '$lib/app/state/settings.svelte'
  import FormattedNumber from '$lib/ui/util/FormattedNumber.svelte'
  import { Button, Menu, Spinner, toast } from '$lib/ui/kit'
  import {
    Icon,
    Bookmark,
    BookmarkX,
    Bug,
    Ellipsis,
    MessageSquare,
    Forward,
  } from '$lib/ui/kit/icon'
  import {
    EMPTY_POST_STATS,
    EMPTY_POST_VIEWER,
    VoteButton,
  } from '$lib/feature/vote'
  import { postLink } from '../helpers'

  let saving = $state(false)

  interface Props {
    post: PostView
    view?: View
    /**
     * Feed-card action bar: flat icon buttons, votes and comments on the
     * left, share and the menu on the right, no save button. Phones mirror
     * it, as the app does.
     */
    feed?: boolean
    debug?: boolean
    style?: string
  }

  let {
    post = $bindable(),
    view = 'cozy',
    feed = false,
    debug = $bindable(false),
    style = '',
  }: Props = $props()
  let buttonHeight = $derived(
    feed ? 'h-9' : view == 'compact' ? 'h-7.5' : 'h-8',
  )
  let buttonSquare = $derived(
    feed ? 'w-9 h-9' : view == 'compact' ? 'w-7.5 h-7.5' : 'w-8 h-8',
  )
  // The feed bar reverses below sm; reverseActions flips either direction.
  let direction = $derived(
    feed
      ? settings.posts.reverseActions
        ? 'flex-row-reverse max-sm:flex-row'
        : 'flex-row max-sm:flex-row-reverse'
      : settings.posts.reverseActions
        ? 'flex-row-reverse'
        : 'flex-row',
  )

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

{#snippet commentsButton(clazz: string, rounding: 'xl' | 'lg')}
  <Button
    size="custom"
    href="{postLink(post)}#comments"
    color={feed ? 'tertiary' : 'secondary'}
    class={['text-inherit!', clazz]}
    {rounding}
    target={settings.openLinksInNewTab ? '_blank' : ''}
    aria-label={$t('post.actions.comments')}
  >
    <Icon src={MessageSquare} size="16" />
    <FormattedNumber
      number={post.stats?.commentCount ?? 0}
      class={feed ? 'text-[13px]' : ''}
    />
  </Button>
{/snippet}

{#snippet debugButton()}
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
      icon={Bug}
    ></Button>
  {/if}
{/snippet}

{#snippet shareButton()}
  <Button
    rounding={feed ? 'lg' : 'xl'}
    color={feed ? 'tertiary' : 'secondary'}
    size="custom"
    class={buttonSquare}
    onclick={() => share()}
    icon={Forward}
    title={$t('post.actions.more.share')}
  />
{/snippet}

{#snippet moreMenu()}
  {#if profile.current?.jwt}
    <Menu placement="bottom-end">
      {#snippet target(popover)}
        {#if feed}
          <Button
            {@attach popover}
            title={$t('post.actions.more.label')}
            color="tertiary"
            rounding="lg"
            size="custom"
            class="{buttonSquare} text-inherit!"
          >
            <Icon src={Ellipsis} size="20" />
          </Button>
        {:else}
          <Button
            {@attach popover}
            title={$t('post.actions.more.label')}
            rounding="xl"
            size="custom"
            class={buttonSquare}
            icon={Ellipsis}
          ></Button>
        {/if}
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
{/snippet}

<footer
  class={[
    'flex items-center shrink-0',
    feed
      ? 'feed-actions gap-1 -mx-2 text-muted'
      : 'gap-2 text-slate-600 dark:text-zinc-400',
    direction,
    buttonHeight,
  ]}
  {style}
>
  {#if feed}
    <!-- One flat row, so the phone's reversed bar keeps up before down. -->
    <VoteButton
      uri={post.uri}
      cid={post.cid}
      bind:stats={post.stats}
      bind:viewer={post.viewer}
      emptyStats={EMPTY_POST_STATS}
      emptyViewer={EMPTY_POST_VIEWER}
      variant="post"
    />
    {@render commentsButton('h-full px-2 gap-1', 'lg')}
    <div class="flex-1"></div>
    {@render debugButton()}
    {@render shareButton()}
    {@render moreMenu()}
  {:else}
    <VoteButton
      uri={post.uri}
      cid={post.cid}
      bind:stats={post.stats}
      bind:viewer={post.viewer}
      emptyStats={EMPTY_POST_STATS}
      emptyViewer={EMPTY_POST_VIEWER}
      variant="post"
    >
      {@render commentsButton('h-full px-3 relative', 'xl')}
    </VoteButton>
    <div class="flex-1"></div>

    {@render debugButton()}

    {#if profile.current?.jwt}
      <Button
        onclick={async () => {
          if (!profile.current?.jwt) return
          toast({
            content: 'Saving posts is not yet available',
            type: 'warning',
          })
        }}
        size="custom"
        class={buttonSquare}
        rounding="xl"
        loading={saving}
        disabled={saving}
        title={post.viewer?.saved
          ? $t('post.actions.unsave')
          : $t('post.actions.save')}
        icon={post.viewer?.saved ? BookmarkX : Bookmark}
      ></Button>
    {/if}

    {@render shareButton()}

    {@render moreMenu()}
  {/if}
</footer>

<style>
  /* Feed bar: 36px targets with the bubble fill on hover. */
  .feed-actions :global(:is(a, button)) {
    min-width: 36px;
    min-height: 36px;
    border-radius: 10px;
  }

  .feed-actions :global(:is(a, button):hover) {
    background-color: var(--color-inset-surface);
  }
</style>
