<script lang="ts">
  import { withPreset } from '$lib/api/coves/image-proxy'
  import { createAvatar } from '@dicebear/core'
  import * as initials from '@dicebear/initials'
  import type { ClassValue } from 'svelte/elements'

  interface Props {
    url: string | undefined
    alt?: string
    title?: string
    circle?: boolean | null
    width: number
    style?: string
    class?: ClassValue
  }

  let {
    url,
    alt = '',
    title = '',
    circle = true,
    width,
    style = '',
    class: clazz = '',
    ...rest
  }: Props = $props()

  // `avatar_small` is 360px square: enough for a 120px avatar even on a 3x
  // screen. Only bigger ones offer the 1000px `avatar` to dense screens; the
  // 20–48px avatars in feeds and threads used to download it on every 2x
  // display, roughly ten times the bytes for no visible difference.
  const LARGE_AVATAR_MIN_WIDTH = 121
  let smallURL = $derived(withPreset(url ?? '', 'avatar_small'))
  let srcset = $derived(
    width >= LARGE_AVATAR_MIN_WIDTH
      ? `${smallURL} 1x, ${withPreset(url ?? '', 'avatar')} 2x`
      : undefined,
  )

  let imgError = $state(false)

  $effect(() => {
    // Reset error state when url changes
    void url
    imgError = false
  })
</script>

{#if url && !imgError}
  <img
    {...rest}
    loading="lazy"
    decoding="async"
    {srcset}
    src={smallURL}
    onerror={() => (imgError = true)}
    alt=""
    {width}
    {title}
    class={[
      'aspect-square object-cover overflow-hidden shrink-0',
      circle === true ? 'rounded-full' : circle === false ? 'rounded-lg' : '',

      clazz,
    ]}
    style="width: {width}px; height: {width}px; {style}"
  />
{:else}
  <div
    style="width: {width}px; height: {width}px;"
    class={[
      'aspect-square object-cover overflow-hidden shrink-0',
      circle === true ? 'rounded-full' : circle === false ? 'rounded-lg' : '',
      clazz,
    ]}
  >
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- DiceBear-generated SVG; the library XML-escapes its seed input -->
    {@html createAvatar(initials, {
      seed: alt,
      backgroundType: ['gradientLinear'],
      fontWeight: 800,
      randomizeIds: true,
      chars: 1,
      scale: 125,
      textColor: ['fff', '000'],
      backgroundColor: [
        '7B68EE',
        'FF6347',
        '20B2AA',
        'DDA0DD',
        'F0E68C',
        'FF1493',
        '4682B4',
        '32CD32',
        'FFB6C1',
        '8B4513',
        '00CED1',
        '9370DB',
        'FFA500',
        '2E8B57',
        'DC143C',
        'BA55D3',
        '708090',
        'ADFF2F',
        'CD853F',
        '48D1CC',
      ],
    }).toString()}
  </div>
{/if}
