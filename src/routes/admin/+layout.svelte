<script>
  import { t } from '$lib/app/i18n'
  import { Tabs } from '$lib/ui/layout'

  let { children } = $props()
</script>

<!-- TODO: Re-enable application notification badge when Coves API provides it -->

<Tabs
  routes={[
    {
      href: '/admin/config',
      name: $t('routes.admin.config.title'),
    },
    {
      href: '/admin/applications',
      name: $t('routes.admin.applications.title'),
    },
    {
      href: '/admin/taglines',
      name: $t('routes.admin.taglines.title'),
    },
    {
      href: '/admin/team',
      name: $t('routes.admin.team.title'),
    },
    {
      href: '/admin/federation',
      name: $t('routes.admin.federation.title'),
    },
    {
      href: '/admin/media',
      name: $t('routes.admin.media.title'),
    },
  ]}
/>
<div class="flex flex-col gap-4 h-full">
  {@render children?.()}
</div>
