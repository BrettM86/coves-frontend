<script lang="ts">
  import { profile } from '$lib/app/auth.svelte'
  import { t } from '$lib/app/i18n'
  import { Tabs } from '$lib/ui/layout'

  let { children } = $props()

  const profileHref = $derived(
    profile.current.type === 'authenticated'
      ? `/profile/${encodeURIComponent(profile.current.handle)}`
      : '/login',
  )
</script>

<svelte:head>
  <title>{$t('profile.profile')}</title>
</svelte:head>

<div class="flex flex-row justify-between">
  <!-- TODO(coves-migration): the settings tab and the media / voted-history
       menu were removed because their routes are gated 404s until the Coves
       APIs exist (see the respective +page.ts gates). Restore them here when
       the pages are migrated. -->
  <Tabs
    routes={[
      {
        href: profileHref,
        name: $t('routes.profile.submissions'),
      },
      {
        href: '/profile/blocks',
        name: $t('routes.profile.blocks.title'),
      },
    ]}
  />
</div>
{@render children?.()}
