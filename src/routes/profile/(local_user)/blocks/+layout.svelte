<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import { Header, Tabs } from '$lib/ui/layout'
  import { Button } from '$lib/ui/kit'
  import { ArrowLeft, Icon } from '$lib/ui/kit/icon'

  interface Props {
    children?: import('svelte').Snippet
  }

  let { children }: Props = $props()
</script>

<svelte:head>
  <title>{$t('routes.profile.blocks.title')}</title>
</svelte:head>

<Header pageHeader class="items-center">
  <Button
    href="/settings"
    size="custom"
    color="ghost"
    rounding="xl"
    class="-ml-2 p-2"
    title={$t('settings.moderation.blocks.back')}
    aria-label={$t('settings.moderation.blocks.back')}
  >
    <Icon src={ArrowLeft} size="24" />
  </Button>
  <span>{$t('routes.profile.blocks.title')}</span>

  {#snippet extended()}
    <Tabs
      routes={[
        {
          href: '/profile/blocks/users',
          name: $t('content.users'),
        },
        {
          href: '/profile/blocks/communities',
          name: $t('content.communities'),
        },
      ]}
      style="subpage"
      margin={false}
    />
  {/snippet}
</Header>

{@render children?.()}
