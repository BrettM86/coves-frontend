<script lang="ts">
  import { withPreset } from '$lib/feature/post/image-proxy'
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

  let optimizedURLs = $derived([
    withPreset(url ?? '', 'avatar_small'),
    withPreset(url ?? '', 'avatar'),
  ])

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
    srcset="{optimizedURLs[0]} 1x, {optimizedURLs[1]} 2x"
    src={optimizedURLs[0]}
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
