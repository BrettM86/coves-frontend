<script lang="ts">
  import { withPreset } from '$lib/api/coves/image-proxy'
  import { parseWebUrl } from '$lib/app/util/url'
  import { Icon, ExternalLink, Globe } from '$lib/ui/kit/icon'

  interface Props {
    uri: string
    /** The linked page's title; omit it when it repeats the post title. */
    title?: string
    thumbnail?: string
    /** A body bubble sits above: hold a three-line bubble's height. */
    fixedHeight?: boolean
  }

  let { uri, title, thumbnail, fixedHeight = false }: Props = $props()

  // The URI is untrusted post content. Only an absolute http(s) link becomes
  // an href, a favicon lookup or a thumbnail; anything else renders as an
  // inert card labelled with the raw text, so a stored javascript:/data: URI
  // cannot become a navigation.
  let url = $derived(parseWebUrl(uri.trim()))
  // Keyed by host and URL: a reused feed row showing another link retries.
  let failedFaviconHost = $state<string>()
  let failedThumbnail = $state<string>()
</script>

<!--
  @component
  The feed card's link: favicon, host and an external-link marker, the linked
  page's title when it adds something, and a small thumbnail on the right.
  The whole card opens the link in a new tab.
-->
{#snippet hostLine(label: string, favicon: boolean)}
  <span class="host">
    {#if favicon && url && url.hostname !== failedFaviconHost}
      <img
        src="https://www.google.com/s2/favicons?domain={url.hostname}&sz=32"
        alt=""
        width="15"
        height="15"
        class="shrink-0 rounded-[3px]"
        onerror={() => (failedFaviconHost = url?.hostname)}
      />
    {:else}
      <Icon src={Globe} size="15" class="shrink-0" />
    {/if}
    <span class="host-label">{label}</span>
    {#if favicon}
      <Icon src={ExternalLink} size="13" class="shrink-0 text-meta" />
    {/if}
  </span>
{/snippet}

{#if url}
  <a
    data-testid="link-card"
    href={url.href}
    target="_blank"
    rel="noopener noreferrer"
    class={['link-card group/link', fixedHeight && 'fixed-height']}
  >
    <span class="text">
      {@render hostLine(url.hostname, true)}
      {#if title}
        <span class="title">{title}</span>
      {/if}
    </span>
    {#if thumbnail && thumbnail !== failedThumbnail}
      <span class="thumb">
        <img
          src={withPreset(thumbnail, 'embed_thumbnail')}
          alt=""
          loading="lazy"
          onerror={() => (failedThumbnail = thumbnail)}
          class="group-hover/link:scale-[1.03]"
        />
      </span>
    {/if}
  </a>
{:else}
  <div data-testid="link-card" class="link-card inert">
    <span class="text">{@render hostLine(uri.trim(), false)}</span>
  </div>
{/if}

<style>
  .link-card {
    display: flex;
    align-items: center;
    min-height: 64px;
    min-width: 0;
    overflow: hidden;
    border-radius: 14px;
    border: 0.5px solid var(--color-inset-border);
    background-color: var(--color-inset-surface);
    color: inherit;
    transition:
      border-color 0.15s,
      background-color 0.15s;
  }

  a.link-card:hover {
    border-color: var(--color-muted);
    background-color: var(--color-inset-hover);
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    padding: 12px 16px;
  }

  .host {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    font-size: 15px;
    font-weight: 600;
  }

  .host-label {
    min-width: 0;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }

  .inert .host-label {
    -webkit-line-clamp: 1;
    line-clamp: 1;
  }

  .host > :global(svg:last-child) {
    margin-left: -4px;
  }

  .text:has(.title) .host {
    font-size: 13px;
    font-weight: 500;
    color: var(--color-muted);
  }

  .title {
    font-size: 15px;
    font-weight: 500;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }

  .thumb {
    display: block;
    flex: none;
    height: clamp(56px, 17.4cqi, 120px);
    aspect-ratio: 4 / 3;
    margin: 12px 12px 12px 0;
    border-radius: 10px;
    overflow: hidden;
  }

  .thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .fixed-height {
    align-items: stretch;
    height: calc(3 * 15px * 1.45 + 21px);
  }

  .fixed-height .thumb {
    position: relative;
    height: auto;
    max-width: 34%;
    margin: 8px 8px 8px 0;
  }

  .fixed-height .thumb img {
    position: absolute;
    inset: 0;
  }

  @container (max-width: 520px) {
    .thumb {
      margin: 10px 10px 10px 0;
    }

    .text {
      padding: 10px 12px;
    }

    .host {
      gap: 7px;
      font-size: 14px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .thumb img {
      transition: none;
    }
  }
</style>
