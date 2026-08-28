<script lang="ts" module>
  import { settings } from '$lib/app/state/settings.svelte'
  import Blobs from '$lib/ui/generic/Blobs.svelte'
  import {
    Icon,
    type IconSource,
    Play,
    PuzzlePiece,
    VideoCamera,
  } from '@xylightdev/svelte-hero-icons'
  import { type IframeType, streamableEmbedUrl } from '../helpers'
  import { withPreset } from '$lib/api/coves/image-proxy'
  import {
    YOUTUBE_EMBED_HOSTS,
    type YouTubeFrontend,
  } from '$lib/app/util/embed-hosts'
  import { parseWebUrl } from '$lib/app/util/url'

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
      return inputUrl
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

  const typeData = (
    type: IframeType,
  ): {
    icon: IconSource
    text: string
  } => {
    switch (type) {
      case 'youtube': {
        return {
          icon: VideoCamera,
          text: 'YouTube Video',
        }
      }
      case 'streamable': {
        return {
          icon: VideoCamera,
          text: 'Streamable Video',
        }
      }
      case 'video': {
        return {
          icon: VideoCamera,
          text: 'Video',
        }
      }
      default: {
        return {
          icon: PuzzlePiece,
          text: 'Embed',
        }
      }
    }
  }

  interface Props {
    type?: IframeType
    thumbnail?: string | undefined
    url: string
    opened?: boolean
    autoplay?: boolean
    title?: string
    class?: string
  }

  let {
    type = 'none',
    thumbnail = undefined,
    url,
    title,
    opened = $bindable(!settings.embeds.clickToView),
    autoplay = settings.embeds.clickToView,
    class: clazz,
  }: Props = $props()

  let thumbError = $state(false)
  let data = $derived(typeData(type))
  let embedUrl = $derived(urlToEmbed(url))
</script>

<!-- 
  @component
  Displays a video file or embedded video iframe.
-->
<div class={['iframe-container', clazz]}>
  {#if opened}
    <!--
      The `embedUrl` guard below is load-bearing: an empty one means urlToEmbed
      rejected the URL (unparseable, non-web scheme, or no video ID), and we
      emit nothing rather than an `<iframe src="">`. An empty src loads
      about:blank, which inherits this page's origin — precisely the frame in
      which `allow-scripts allow-same-origin` stops being a sandbox at all.
    -->
    {#if type == 'video'}
      <video {autoplay} controls>
        <source src={url} />
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
    <button onclick={() => (opened = true)} class="iframe-preview">
      <div role="presentation" class="preview-start">
        <div class="start-button">
          <Icon src={Play} size="32" mini />
        </div>
      </div>
      {#if thumbnail && !thumbError}
        <img
          src={withPreset(thumbnail, 'embed_thumbnail')}
          onerror={() => (thumbError = true)}
          class="absolute top-0 left-0 -z-10 w-full object-cover h-full mask-b-from-0 brightness-75"
          alt=""
        />
      {:else}
        <div class="absolute inset-0 w-full h-full scale-200 -z-10 opacity-50">
          <Blobs seed={title ?? data.text} />
        </div>
      {/if}
      <Icon src={data.icon} solid size="40" />
      <h1
        class="font-display text-xl md:text-2xl xl:text-3xl font-medium text-left overflow-hidden overflow-ellipsis line-clamp-2"
      >
        {title ?? data.text}
      </h1>
      <div class="text-slate-600 dark:text-zinc-400">
        {URL.parse?.(url)?.hostname ?? data.text}
      </div>
    </button>
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

    .iframe-preview {
      width: 100%;
      height: 100%;
      z-index: 0;
      overflow: hidden;
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: start;
      justify-content: end;
      padding: calc(var(--spacing) * 6);
      gap: calc(var(--spacing) * 1);
    }

    .preview-start {
      width: 100%;
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
    }

    .start-button {
      width: calc(var(--spacing) * 16);
      height: calc(var(--spacing) * 16);
      border-radius: 9999px;
      background-color: --alpha(var(--color-slate-100) / 50%);
      display: grid;
      place-items: center;
      backdrop-filter: blur(var(--blur-sm));
      cursor: pointer;
      position: relative;
      box-shadow:
        0 1px 3px 0 rgb(0 0 0 / 0.1),
        0 1px 2px -1px rgb(0 0 0 / 0.1);
      transition:
        background-color 300ms var(--ease-cubic),
        transform 300ms var(--ease-cubic);

      @variant hover {
        background-color: --alpha(var(--color-slate-200) / 50%);
      }

      @variant dark {
        background-color: --alpha(var(--color-zinc-900) / 50%);
        @variant hover {
          background-color: --alpha(var(--color-zinc-800) / 50%);
        }
      }

      @variant active {
        transform: scale(93%);
      }
    }
  }
</style>
