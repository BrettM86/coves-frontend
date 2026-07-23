<script lang="ts">
  import { t } from '$lib/app/i18n'
  import { Header } from '$lib/ui/layout'

  let { children } = $props()
</script>

<!-- TODO(coves-migration): No tabs here: /users is the only live blocks page
     (and /profile/blocks redirects to it); /communities and /instances are
     404-gated until their Coves APIs exist — see their +page.ts gates.
     Reintroduce Tabs when a second page comes back. -->
<Header pageHeader>
  {$t('routes.profile.blocks.title')}
</Header>

{@render children?.()}
