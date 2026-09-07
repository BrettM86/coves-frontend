<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import { Header } from '$lib/ui/layout'

  let { children } = $props()
</script>

<Header pageHeader>
  {$t('nav.create.label')}
</Header>

{@render children?.()}
