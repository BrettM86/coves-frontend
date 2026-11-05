<script lang="ts" module>
  import { settings } from '$lib/app/state/settings.svelte'
  import { Globe, Icon } from '$lib/ui/kit/icon'
  import { type IframeType, streamableEmbedUrl } from '../helpers'
  import { withPreset } from '$lib/api/coves/image-proxy'
  import {
    YOUTUBE_EMBED_HOSTS,
    type YouTubeFrontend,
  } from '$lib/app/util/embed-hosts'
  import { isWebUrl, parseWebUrl } from '$lib/app/util/url'

  // Fixed allowlist shared with the server's CSP `frame-src`; a host outside
  // it would be blocked by the browser anyway.
  const youtubeDomain = (place: YouTubeFrontend) => YOUTUBE_EMBED_HOSTS[place]

  function youtubeVideoID(url: string): string | null {
    const regex =
      /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtu\.be\/|youtube\.com\/(?:embed\/|shorts\/|live\/|v\/|watch\?v=|watch\?.+&v=))((\w|-){11})(?:\S+)?$/
    const match = url.match(regex)

    if (match && match[1]) {
      return match[1]
    }

    return null
  }

  // Where a YouTube link with no thumbnail of its own borrows a poster from,
  // following the reader's frontend choice. Piped has no stable thumbnail
  // host, so it gets none.
  const YOUTUBE_POSTER_HOSTS: Record<YouTubeFrontend, string | null> = {
    youtube: 'i.ytimg.com',
    invidious: 'yewtu.be',
    piped: null,
  }

  function youtubePoster(url: string, place: YouTubeFrontend): string | null {
    const host = YOUTUBE_POSTER_HOSTS[place]
    const videoID = youtubeVideoID(url)
    return host && videoID
      ? `https://${host}/vi/${videoID}/hqdefault.jpg`
      : null
  }
</script>

<script lang="ts">
  // Total by construction: `url` is untrusted (a markdown href, or an embed URI
  // written straight to a PDS), and this runs in a $derived the template reads
  // during SSR — a throw here is a 500 on the whole page, not a broken embed.
  // `isYoutubeLink`'s regex makes the scheme optional, so `youtu.be/xxxxxxxxxxx`
  // arrives here as a *relative* string that bare `new URL()` cannot parse.
  // `parseWebUrl` returns null for that (and for any non-http(s) scheme) instead
  // of throwing; '' means "no embed", and the template then emits no iframe.
  const urlToEmbed = (inputUrl: string): string => {
    if (type == 'video') {
      // The one branch that never rewrites its input — the raw URL becomes a
      // `<source src>`, which is a fetch the browser performs — and `iframeType`
      // classifies by file extension alone, so `file:///share/clip.mp4` reaches
      // here. Gate it like every other src in this file.
      return isWebUrl(inputUrl) ? inputUrl : ''
    }

    if (type == 'youtube') {
      const url = parseWebUrl(inputUrl)
      if (!url) return ''

      const videoID = youtubeVideoID(inputUrl)

      if (videoID) {
        const embedUrl = new URL(
          `https://${youtubeDomain(settings.embeds.youtube)}/embed/${videoID}`,
        )

        embedUrl.searchParams.set('start', url.searchParams.get('t') ?? '')

        url.searchParams.forEach((value, key) => {
          embedUrl.searchParams.set(key, value)
        })

        if (autoplay) embedUrl.searchParams.set('autoplay', '1')

        return embedUrl.toString()
      }
    }

    if (type == 'streamable') {
      // No parseWebUrl hop here: the player URL is built from the captured id
      // on a fixed origin, so a scheme-less input needs no parsing to be safe,
      // and a non-Streamable one yields null -> '' -> no iframe.
      const embed = streamableEmbedUrl(inputUrl)
      if (!embed) return ''

      return autoplay ? `${embed}?autoplay=1` : embed
    }

    return ''
  }

  const typeLabel = (type: IframeType): string => {
    switch (type) {
      case 'youtube':
        return 'YouTube Video'
      case 'streamable':
        return 'Streamable Video'
      case 'video':
        return 'Video'
      default:
        return 'Embed'
    }
  }

  interface Props {
    type?: IframeType
    thumbnail?: string | undefined
    url: string
    opened?: boolean
    autoplay?: boolean
    class?: string
  }

  let {
    type = 'none',
    thumbnail = undefined,
    url,
    opened = $bindable(!settings.embeds.clickToView),
    autoplay = settings.embeds.clickToView,
    class: clazz,
  }: Props = $props()

  let thumbError = $state(false)
  // The tag names the link's host; a URL with no parseable host (a
  // scheme-less `youtu.be/...`) falls back to the type label.
  let tag = $derived(
    parseWebUrl(url)?.hostname.replace(/^www\./, '') || typeLabel(type),
  )
  let embedUrl = $derived(urlToEmbed(url))
  // `thumbnail` is a second untrusted sink alongside `url`, and its caller is
  // not guaranteed to have gated it. Anything that is not an absolute http(s)
  // address falls through to the plain no-poster fill instead of an img src,
  // unless it is a YouTube link, which can borrow the video's own poster. Only
  // the record's own thumbnail can be an image-proxy URL; the borrowed poster
  // is a third-party address that withPreset would only warn about.
  let previewThumbnail = $derived(
    thumbnail && isWebUrl(thumbnail)
      ? withPreset(thumbnail, 'embed_thumbnail')
      : type == 'youtube'
        ? (youtubePoster(url, settings.embeds.youtube) ?? undefined)
        : undefined,
  )
</script>

<!-- 
  @component
  Displays a video file or embedded video iframe.
-->
<div class={['iframe-container', !opened && 'preview', clazz]}>
  {#if opened}
    <!--
      The `embedUrl` guard below is load-bearing: an empty one means urlToEmbed
      rejected the URL (unparseable, non-web scheme, or no video ID), and we
      emit nothing rather than an `<iframe src="">`. An empty src loads
      about:blank, which inherits this page's origin — precisely the frame in
      which `allow-scripts allow-same-origin` stops being a sandbox at all.
    -->
    {#if type == 'video' && embedUrl}
      <video {autoplay} controls>
        <source src={embedUrl} />
      </video>
    {:else if embedUrl}
      <!--
        allow-scripts + allow-same-origin together are normally an escape hatch
        (a framed document can reach into its own sandbox and remove it), but
        they are safe here because `src` is never user-controlled: the origin
        always comes from a fixed table (YOUTUBE_EMBED_HOSTS, or
        STREAMABLE_EMBED_ORIGIN), and the only user-derived part is an id
        matched by youtubeVideoID() or isStreamableLink() — 11 URL-safe
        characters, or alphanumerics. Since those origins are cross-origin to us,
        allow-same-origin only grants the player its own storage and cookies,
        which it needs to play. allow-popups-to-escape-sandbox keeps the
        player's "watch on YouTube" popup from opening as a sandboxed window
        (which would leave the user on a page that cannot log in), while
        withholding allow-top-navigation means the embed can never redirect the
        Coves tab itself.
      -->
      <iframe
        src={embedUrl}
        title="Embed player"
        frameborder="0"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
      ></iframe>
    {/if}
  {:else}
    {#if previewThumbnail && !thumbError}
      <!-- No referrer: a borrowed poster would otherwise tell YouTube or
           Invidious which Coves page the reader is on before any click. -->
      <img
        src={previewThumbnail}
        referrerpolicy="no-referrer"
        loading="lazy"
        decoding="async"
        onerror={() => (thumbError = true)}
        class="poster"
        alt=""
      />
    {/if}
    <button
      type="button"
      onclick={() => (opened = true)}
      class="play"
      aria-label="Play video"
    >
      <span class="play-chip">
        <svg
          viewBox="0 0 24 24"
          width="26"
          height="26"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M7 4.5v15l12-7.5z" />
        </svg>
      </span>
    </button>
    <span class="tag">
      <Icon src={Globe} size="15" class="shrink-0" />
      {tag}
    </span>
  {/if}
</div>

<style>
  @reference '../../../../app.css';

  .iframe-container {
    border-radius: var(--radius-2xl);
    aspect-ratio: 16 / 9;
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border: 1px solid var(--color-slate-200);

    @variant dark {
      border-color: var(--color-zinc-900);
    }

    & > * {
      width: 100%;
      height: 100%;
    }
  }

  /* The unopened preview: a 2:1 poster with a play chip and a host tag. */
  .iframe-container.preview {
    aspect-ratio: 2 / 1;
    height: auto;
    border: none;
    border-radius: 12px;
    background-color: var(--color-slate-200);
    box-shadow: inset 0 0 0 1px var(--color-image-edge);

    @variant dark {
      background-color: var(--color-zinc-800);
    }

    .poster {
      position: absolute;
      inset: 0;
      object-fit: cover;
      outline: 1px solid var(--color-image-edge);
      outline-offset: -1px;
    }

    .play {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      cursor: pointer;
      border-radius: inherit;

      &:focus-visible {
        outline: 2px solid var(--color-primary-900);
        outline-offset: -2px;

        @variant dark {
          outline-color: var(--color-primary-100);
        }
      }

      &:hover .play-chip,
      &:focus-visible .play-chip {
        transform: scale(1.08);
      }
    }

    .play-chip {
      width: 60px;
      height: 60px;
      border-radius: 9999px;
      display: grid;
      place-items: center;
      background-color: rgb(10 21 23 / 0.72);
      color: white;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);

      @media (prefers-reduced-motion: reduce) {
        transition: none;
      }
    }

    .tag {
      position: absolute;
      left: 12px;
      bottom: 12px;
      width: auto;
      height: auto;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      max-width: calc(100% - 24px);
      padding: 4px 9px 4px 6px;
      border-radius: 999px;
      background-color: rgb(10 21 23 / 0.72);
      color: white;
      font-size: 0.75rem;
      font-weight: 600;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
    }
  }
</style>
