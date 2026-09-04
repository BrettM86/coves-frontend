<script lang="ts">
  import { t } from '$lib/app/state/i18n'

  interface Props {
    children?: import('svelte').Snippet
  }

  let { children }: Props = $props()
</script>

<svelte:head>
  <title>{$t('profile.profile')}</title>
</svelte:head>

{@render children?.()}
