<script lang="ts">
  import { page } from '$app/state'
  import { profile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { loginUrl } from '$lib/app/util/login-url'
  import { notificationPreferences } from '$lib/feature/notification/preferences.svelte'
  import { notificationSessionKey } from '$lib/feature/notification/session'
  import { Button, Spinner } from '$lib/ui/kit'
  import {
    AtSign,
    Heart,
    MessageSquare,
    MessageSquareReply,
  } from '$lib/ui/kit/icon'
  import { CommonList } from '$lib/ui/layout'
  import ToggleSetting from '../ToggleSetting.svelte'

  // Start only once the root layout has synced the session, so a profile
  // restored from storage does not load under a stale session. The store is
  // app-lifetime: its stop is never called, so queued saves outlive the page.
  $effect(() => {
    if (profile.sessionGeneration !== undefined) notificationPreferences.start()
  })

  const values = $derived(notificationPreferences.values)

  // Pressing Retry unmounts it, so focus goes to what replaces it once the
  // retry settles: the first toggle, or the next Retry on another failure.
  // Only while focus is still nowhere (the user did not move it), and only
  // for the session the retry was pressed in: the store drops a retry's
  // response when the session key changes.
  let retried = false
  $effect(() => {
    void notificationSessionKey()
    retried = false
  })
  function focusAfterRetry(target: () => HTMLElement | null) {
    if (!retried) return
    retried = false
    const active = document.activeElement
    if (active === null || active === document.body) target()?.focus()
  }
</script>

{#if !profile.isAuthenticated}
  <Button color="primary" href={loginUrl(page.url)}>
    {$t('account.login')}
  </Button>
{:else if notificationPreferences.status === 'ready' && values}
  <div
    class="contents"
    {@attach (node) => focusAfterRetry(() => node.querySelector('input'))}
  >
    <CommonList>
      <ToggleSetting
        bind:checked={
          () => values.postReply,
          (value) => notificationPreferences.set('postReply', value)
        }
        title={$t('settings.notifications.postReply')}
        icon={MessageSquare}
      />
      <ToggleSetting
        bind:checked={
          () => values.commentReply,
          (value) => notificationPreferences.set('commentReply', value)
        }
        title={$t('settings.notifications.commentReply')}
        icon={MessageSquareReply}
      />
      <ToggleSetting
        bind:checked={
          () => values.mention,
          (value) => notificationPreferences.set('mention', value)
        }
        title={$t('settings.notifications.mention')}
        icon={AtSign}
      />
      <ToggleSetting
        bind:checked={
          () => values.upvote,
          (value) => notificationPreferences.set('upvote', value)
        }
        title={$t('settings.notifications.upvote')}
        icon={Heart}
      />
    </CommonList>
  </div>
{:else if notificationPreferences.status === 'error'}
  <div class="flex flex-col items-start gap-2">
    <p role="alert">{$t('settings.notifications.loadFailed')}</p>
    <Button
      onclick={() => {
        retried = true
        notificationPreferences.retry()
      }}
      {@attach (node: HTMLElement) => focusAfterRetry(() => node)}
    >
      {$t('message.retry')}
    </Button>
  </div>
{:else}
  <Spinner width={24} />
  <span class="sr-only" role="status">
    {$t('settings.notifications.loading')}
  </span>
{/if}
