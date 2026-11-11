<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import { parseWebUrl } from '$lib/app/util/url'
  import { Button } from '$lib/ui/kit'
  import type { ClassValue } from 'svelte/elements'
  import CommunitySoftwareLogo from './CommunitySoftwareLogo.svelte'

  interface Props {
    /** Home instance host, used as the label when present. */
    origin?: string
    /** The community's page on its home instance. */
    originUrl: string
    /** Nodeinfo software name of the home instance. */
    software?: string
    class?: ClassValue
  }

  let { origin, originUrl, software, class: clazz = '' }: Props = $props()

  /** Only an absolute http(s) URL becomes a link. */
  const url = $derived(parseWebUrl(originUrl))
  /** Label host: the origin, else the URL's hostname. */
  const host = $derived(origin || url?.hostname)
</script>

<!--
  @component
  "View on <host>" link to a bridged community's page on its home instance.
  SidebarButton styling; an external link has no selected state. Renders
  nothing unless `originUrl` is an absolute http(s) URL.
-->
{#if url}
  <Button
    href={url.href}
    target="_blank"
    rel="noopener noreferrer"
    color="tertiary"
    alignment="left"
    rounding="xl"
    weight="none"
    shadow="none"
    class={[
      'text-slate-600 hover:text-slate-900 dark:text-zinc-400 hover:dark:text-zinc-50',
      clazz,
    ]}
  >
    {#snippet prefix()}
      <CommunitySoftwareLogo {software} />
    {/snippet}
    {$t('cards.community.viewOn', { host })}
  </Button>
{/if}
