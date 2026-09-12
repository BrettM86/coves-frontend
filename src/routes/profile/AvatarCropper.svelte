<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import { Button, Modal } from '$lib/ui/kit'
  import { onDestroy, tick } from 'svelte'
  import type Cropper from 'cropperjs'

  interface Props {
    file: File
    oncancel: () => void
    oncropped: (file: File) => void
  }

  let { file, oncancel, oncropped }: Props = $props()

  let open = $state(true)
  let ready = $state(false)
  let working = $state(false)
  let cropError = $state(false)
  let sourceUrl = $state<string>()
  let cropContainer: HTMLDivElement | undefined = $state()
  let cropImage: HTMLImageElement | undefined = $state()
  let cropper: Cropper | undefined
  let destroyed = false

  const cropperTemplate = `
    <cropper-canvas background>
      <cropper-image rotatable scalable skewable translatable></cropper-image>
      <cropper-shade hidden></cropper-shade>
      <cropper-handle action="select" plain></cropper-handle>
      <cropper-selection
        initial-aspect-ratio="1"
        aspect-ratio="1"
        initial-coverage="0.8"
        movable
        resizable
        keyboard
        outlined
      >
        <cropper-grid role="grid" bordered covered></cropper-grid>
        <cropper-crosshair centered></cropper-crosshair>
        <cropper-handle action="move" theme-color="rgba(255, 255, 255, 0.35)"></cropper-handle>
        <cropper-handle action="n-resize"></cropper-handle>
        <cropper-handle action="e-resize"></cropper-handle>
        <cropper-handle action="s-resize"></cropper-handle>
        <cropper-handle action="w-resize"></cropper-handle>
        <cropper-handle action="ne-resize"></cropper-handle>
        <cropper-handle action="nw-resize"></cropper-handle>
        <cropper-handle action="se-resize"></cropper-handle>
        <cropper-handle action="sw-resize"></cropper-handle>
      </cropper-selection>
    </cropper-canvas>
  `

  $effect(() => {
    if (typeof URL.createObjectURL !== 'function') return
    const url = URL.createObjectURL(file)
    sourceUrl = url
    return () => URL.revokeObjectURL(url)
  })

  onDestroy(() => {
    destroyed = true
    cropper?.destroy()
  })

  async function initializeCropper(): Promise<void> {
    if (!cropImage || !cropContainer || cropper) return
    try {
      const { default: CropperClass } = await import('cropperjs')
      if (destroyed || !cropImage || !cropContainer) return
      cropper = new CropperClass(cropImage, {
        container: cropContainer,
        template: cropperTemplate,
      })
      const selection = cropper.getCropperSelection()
      if (!selection) throw new Error('Crop selection is unavailable')
      selection.aspectRatio = 1
      selection.initialAspectRatio = 1
      selection.keyboard = true
      ready = true
    } catch {
      cropError = true
    }
  }

  function handleImageError(): void {
    ready = false
    cropError = true
  }

  function canvasBlob(
    canvas: HTMLCanvasElement,
    type: 'image/webp' | 'image/jpeg',
    quality: number,
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('The cropped image could not be encoded'))
        },
        type,
        quality,
      )
    })
  }

  async function close(callback: () => void): Promise<void> {
    if (destroyed) return
    open = false
    await tick()
    if (destroyed) return
    callback()
  }

  async function applyCrop(): Promise<void> {
    if (!cropper || working) return
    const selection = cropper.getCropperSelection()
    if (!selection) return

    working = true
    cropError = false
    try {
      const canvas = await selection.$toCanvas({ width: 1024, height: 1024 })
      let blob: Blob | undefined
      for (const type of ['image/webp', 'image/jpeg'] as const) {
        for (const quality of [0.9, 0.75, 0.6]) {
          blob = await canvasBlob(canvas, type, quality)
          if (destroyed) return
          if (blob.size <= 1_000_000) break
          // Safari returns PNG when WebP encoding is unavailable; quality has
          // no effect on that fallback, so move directly to JPEG.
          if (type === 'image/webp' && blob.type !== 'image/webp') break
        }
        if (blob && blob.size <= 1_000_000) break
      }
      if (!blob || blob.size > 1_000_000)
        throw new Error('The cropped image exceeds the upload limit')

      const baseName = file.name.replace(/\.[^.]+$/, '') || 'avatar'
      const outputType =
        blob.type === 'image/webp' || blob.type === 'image/jpeg'
          ? blob.type
          : 'image/png'
      const extension =
        outputType === 'image/webp'
          ? 'webp'
          : outputType === 'image/jpeg'
            ? 'jpg'
            : 'png'
      const cropped = new File([blob], `${baseName}-cropped.${extension}`, {
        type: outputType,
        lastModified: Date.now(),
      })
      await close(() => oncropped(cropped))
    } catch {
      if (destroyed) return
      cropError = true
      working = false
    }
  }
</script>

<Modal
  bind:open
  title={$t('form.profile.cropAvatar')}
  dismissable={!working}
  ondismissed={oncancel}
  class="max-w-xl"
>
  <p
    id="avatar-crop-instructions"
    class="text-sm text-slate-600 dark:text-zinc-400"
  >
    {$t('form.profile.cropInstructions')}
  </p>

  <div
    bind:this={cropContainer}
    role="group"
    aria-label={$t('form.profile.cropAvatar')}
    aria-describedby="avatar-crop-instructions"
    class="avatar-crop-stage mt-2 overflow-hidden rounded-xl bg-zinc-950"
  >
    {#if sourceUrl}
      <img
        bind:this={cropImage}
        src={sourceUrl}
        alt={$t('form.profile.cropSource')}
        onload={initializeCropper}
        onerror={handleImageError}
        class="block max-w-full"
      />
    {/if}
  </div>

  {#if cropError}
    <p role="alert" class="text-sm text-red-700 dark:text-red-300">
      {$t('form.profile.cropFailed')}
    </p>
  {/if}

  <div class="mt-2 flex gap-2">
    <Button
      size="lg"
      class="flex-1"
      disabled={working}
      onclick={() => void close(oncancel)}
    >
      {$t('common.cancel')}
    </Button>
    <Button
      size="lg"
      color="primary"
      class="flex-1"
      loading={working}
      disabled={!ready || working}
      onclick={applyCrop}
    >
      {$t('form.profile.applyCrop')}
    </Button>
  </div>
</Modal>

<style>
  .avatar-crop-stage {
    height: min(60vh, 26rem);
    min-height: 18rem;
  }

  .avatar-crop-stage :global(cropper-canvas) {
    width: 100%;
    height: 100%;
  }

  .avatar-crop-stage :global(cropper-selection) {
    border-radius: 9999px;
  }

  @media (max-height: 640px) {
    .avatar-crop-stage {
      height: 52vh;
      min-height: 12rem;
    }
  }
</style>
