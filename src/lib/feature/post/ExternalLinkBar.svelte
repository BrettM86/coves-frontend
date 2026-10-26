<script lang="ts">
  import { parseWebUrl } from '$lib/app/util/url'
  import { Icon, ExternalLink, Globe } from '$lib/ui/kit/icon'

  let { uri }: { uri: string } = $props()

  // The URI is untrusted post content. Only an absolute http(s) link becomes
  // an href (and a favicon lookup); anything else renders as an inert bar
  // labelled with the raw text so a stored javascript:/data: URI cannot
  // become a navigation.
  let url = $derived(parseWebUrl(uri.trim()))
  let faviconFailed = $state(false)
</script>

<!--
  @component
  The feed card's link row: favicon, hostname and an external-link marker,
  the whole bar opening the post's URL in a new tab.
-->
{#if url}
  <a
    data-testid="external-link-bar"
    href={url.href}
    target="_blank"
    rel="noopener noreferrer"
    aria-label="Open link to {url.hostname}"
    class="link-bar hover:brightness-95 dark:hover:brightness-125 transition"
  >
    {#if faviconFailed}
      <Icon src={Globe} size="18" class="shrink-0" />
    {:else}
      <img
        src="https://www.google.com/s2/favicons?domain={url.hostname}&sz=32"
        alt=""
        width="18"
        height="18"
        class="shrink-0 rounded-[4px]"
        onerror={() => (faviconFailed = true)}
      />
    {/if}
    <span class="link-bar-label">{url.hostname}</span>
    <Icon src={ExternalLink} size="14" class="shrink-0 opacity-70" />
  </a>
{:else}
  <div data-testid="external-link-bar" class="link-bar">
    <Icon src={Globe} size="18" class="shrink-0" />
    <span class="link-bar-label">{uri.trim()}</span>
  </div>
{/if}

<style>
  @reference '../../../app.css';

  .link-bar {
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 2);
    min-width: 0;
    padding: 10px;
    border-radius: 8px;
    background-color: var(--color-inset-surface);
    color: var(--color-slate-900);

    @variant dark {
      color: var(--color-zinc-100);
    }
  }

  .link-bar-label {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    opacity: 0.7;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
