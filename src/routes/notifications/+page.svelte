<script lang="ts">
  import { page } from '$app/state'
  import { profile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { loginUrl } from '$lib/app/util/login-url'
  import NotificationList from '$lib/feature/notification/NotificationList.svelte'
  import { notificationListReturn } from '$lib/feature/notification/return.svelte'
  import { Button } from '$lib/ui/kit'
  import { Icon, Settings } from '$lib/ui/kit/icon'
  import { Header } from '$lib/ui/layout'

  // Taken once per entry: a return from a followed row's thread restores the
  // saved list, any other entry loads page one.
  const restore = notificationListReturn.take()
</script>

<svelte:head>
  <title>{$t('routes.notifications.title')}</title>
</svelte:head>

<Header pageHeader class="items-center justify-between">
  <span>{$t('routes.notifications.title')}</span>
  <Button
    href="/settings/notifications"
    size="custom"
    color="ghost"
    rounding="xl"
    class="size-11"
    title={$t('routes.notifications.settingsLink')}
    aria-label={$t('routes.notifications.settingsLink')}
  >
    <Icon src={Settings} size="24" />
  </Button>
</Header>

<!-- The session can drop while the page is open (the cookie is gone): a
     signed-out reader gets the login link. An expired session keeps the list
     for the recovery prompt. -->
{#if !profile.isAuthenticated && !profile.sessionExpired}
  <Button color="primary" href={loginUrl(page.url)}>
    {$t('account.login')}
  </Button>
{:else}
  <NotificationList {restore} />
{/if}
