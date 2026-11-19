<script lang="ts">
  import type { PostView } from '$lib/api/coves/types'
  import { profile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { settings } from '$lib/app/state/settings.svelte'
  import FormattedNumber from '$lib/ui/util/FormattedNumber.svelte'
  import { Button, Menu, Spinner, toast } from '$lib/ui/kit'
  import { Icon, Bug, Ellipsis, MessageSquare, Forward } from '$lib/ui/kit/icon'
  import {
    EMPTY_POST_STATS,
    EMPTY_POST_VIEWER,
    VoteButton,
  } from '$lib/feature/vote'
  import { postLink } from '../helpers'

  interface Props {
    post: PostView
    debug?: boolean
    style?: string
  }

  let {
    post = $bindable(),
    debug = $bindable(false),
    style = '',
  }: Props = $props()
  const buttonSquare = 'w-9 h-9'
  // The bar reverses below sm; reverseActions flips either direction.
  let direction = $derived(
    settings.posts.reverseActions
      ? 'flex-row-reverse max-sm:flex-row'
      : 'flex-row max-sm:flex-row-reverse',
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
      color="tertiary"
      rounding="lg"
      class="{buttonSquare} text-inherit!"
      icon={Bug}
    ></Button>
  {/if}
{/snippet}

{#snippet shareButton()}
  <Button
    rounding="lg"
    color="tertiary"
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

<!--
  @component
  A post's action bar: flat icon buttons, votes and comments on the left,
  share and the menu on the right. Phones mirror it, as the app does.
-->
<footer
  class={[
    'post-actions flex items-center shrink-0 h-9 gap-1 -mx-2 text-muted',
    direction,
  ]}
  {style}
>
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
  <Button
    size="custom"
    href="{postLink(post)}#comments"
    color="tertiary"
    class="text-inherit! h-full px-2 gap-1"
    rounding="lg"
    target={settings.openLinksInNewTab ? '_blank' : ''}
    aria-label={$t('post.actions.comments')}
  >
    <Icon src={MessageSquare} size="16" />
    <FormattedNumber
      number={post.stats?.commentCount ?? 0}
      class="text-[13px]"
    />
  </Button>
  <div class="flex-1"></div>
  {@render debugButton()}
  {@render shareButton()}
  {@render moreMenu()}
</footer>

<style>
  /* 36px targets with the bubble fill on hover. */
  .post-actions :global(:is(a, button)) {
    min-width: 36px;
    min-height: 36px;
    border-radius: 10px;
  }

  .post-actions :global(:is(a, button):hover) {
    background-color: var(--color-inset-surface);
  }
</style>
