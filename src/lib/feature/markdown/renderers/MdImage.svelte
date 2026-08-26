<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import { canParseUrl, isImage, isVideo } from '$lib/app/util/url'
  import {
    iframeType,
    isYoutubeLink,
    type MediaType,
    PostIframe,
  } from '$lib/feature/post'
  import { parseProxyUrl, withPreset } from '$lib/api/coves/image-proxy'
  import { showImage } from '$lib/ui/generic/ExpandableImage.svelte'
  import { getContext } from 'svelte'
  import { ArrowDownTray, Icon } from 'svelte-hero-icons/dist'
  import { isSafeHref } from './plugins'

  let loaded: boolean = $state(
    (getContext('options') as { autoloadImages: boolean })?.autoloadImages ??
      true,
  )

  interface Props {
    href: string | undefined
    title?: string | undefined
    text?: string
  }

  let { href, title = undefined, text = '' }: Props = $props()

  function urlMediaType(url: string): MediaType {
    if (isImage(url)) return 'image'
    if (isVideo(url)) return 'iframe'
    if (isYoutubeLink(url)) return 'iframe'
    if (canParseUrl(url)) return 'embed'
    return 'none'
  }

  // The href comes straight from untrusted markdown, so enforce the protocol
  // allowlist before picking a media branch — every branch below ends in a
  // URL-bearing sink, and this component owns the untrusted input.
  let safe = $derived(isSafeHref(href ?? ''))
  let type = $derived(href && safe ? urlMediaType(href) : 'none')
</script>

{#if href && safe}
  <div
    class="w-auto h-auto max-h-96 rounded-2xl border border-slate-200 dark:border-zinc-800 inline-block group"
  >
    {#if loaded}
      {#if type == 'video' || type == 'embed' || type == 'iframe'}
        <PostIframe
          type={iframeType(href)}
          url={href}
          opened={true}
          autoplay={false}
          class="w-auto h-auto max-h-80 inline-block rounded-[inherit] cursor-pointer"
        />
      {:else}
        <button
          class="inline cursor-pointer bg-slate-200 dark:bg-zinc-900 rounded-[inherit]"
          onclick={() =>
            showImage(
              parseProxyUrl(href) ? withPreset(href, 'content_full') : href,
            )}
        >
          <img
            src={parseProxyUrl(href)
              ? withPreset(href, 'content_preview')
              : href}
            {title}
            alt={text}
            width={300}
            height={300}
            class={[
              'object-contain w-auto h-auto max-h-80 inline rounded-[inherit] group-hover:scale-98 group-active:scale-95',
              'transition-transform ease-cubic duration-300',
            ]}
          />
        </button>
      {/if}
    {:else}
      <button
        onclick={() => (loaded = true)}
        class="w-40 h-40 flex flex-col justify-center items-center gap-4 p-2 group cursor-pointer"
        title={$t('common.download')}
      >
        <Icon
          src={ArrowDownTray}
          size="24"
          class="text-primary-900 dark:text-primary-100"
        />
      </button>
    {/if}
  </div>
{:else if text}
  <!--
    Blocked, or no href at all. Degrade the way MdLink does — it renders its
    children as plain text rather than dropping them — so the alt text of
    `![alt](vbscript:…)` survives instead of the image vanishing silently.
    Text only: no URL and no media element, so the gate above is unaffected.
  -->
  {text}
{/if}
