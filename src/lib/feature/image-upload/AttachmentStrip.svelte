<script lang="ts">
  import { imageUrl } from '$lib/api/coves/image-proxy'
  import type { EmbedImage } from '$lib/api/coves/types'
  import { t } from '$lib/app/state/i18n'
  import { errorMessage, isUploadSignInError } from '$lib/app/util/error'
  import { Button, Label, TextInput } from '$lib/ui/kit'
  import {
    ChevronLeft,
    ChevronRight,
    Image,
    RefreshCw,
    TextCursorInput,
    X,
  } from '$lib/ui/kit/icon'
  import type { Attachments } from './attachments.svelte'
  import {
    removePlacementToken,
    reorderPlacementTokens,
  } from './placement-tokens'
  import {
    checkAltText,
    countGraphemes,
    MAXIMUM_ALT_TEXT_GRAPHEMES,
  } from './image-file'

  interface Props {
    /** The editable strip; without it, `images` shows read-only tiles. */
    attachments?: Attachments
    /** A saved comment's images, numbered, offering only Insert in text. */
    images?: EmbedImage[]
    /** The body text, whose placement tokens follow removes and moves. */
    text?: string
    /** Puts image `number`'s placement token in the body. */
    oninsert?: (number: number, alt: string) => void
    /** True while the form uploads or creates: the strip cannot change then. */
    busy?: boolean
    /** Retries the submit after a failed upload. */
    onretry?: () => void
    /** Saves the composer text and signs in again after an upload refusal. */
    onsignin?: () => void
  }

  let {
    attachments,
    images = [],
    text = $bindable(),
    oninsert,
    busy = false,
    onretry,
    onsignin,
  }: Props = $props()

  const signInNeeded = $derived(
    !!onsignin &&
      !!attachments?.items.some(
        (item) => item.status === 'failed' && isUploadSignInError(item.error),
      ),
  )

  const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'
  const MAXIMUM_ATTACHMENTS = 8
  /** The alt text counter shows from this many graphemes on. */
  const COUNTER_FROM = MAXIMUM_ALT_TEXT_GRAPHEMES - 100

  let input = $state<HTMLInputElement>()

  function onchange(event: Event & { currentTarget: HTMLInputElement }) {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (files.length > 0) void attachments?.add(files)
  }

  function remove(strip: Attachments, id: string, number: number) {
    const count = strip.items.length
    strip.remove(id)
    if (text !== undefined) text = removePlacementToken(text, number, count)
  }

  /** Swaps image `number` with its neighbour `by` away, renumbering tokens. */
  function move(strip: Attachments, id: string, number: number, by: -1 | 1) {
    if (number + by < 1 || number + by > strip.items.length) return
    if (by < 0) strip.moveEarlier(id)
    else strip.moveLater(id)
    const order = strip.items.map((_, index) => index + 1)
    order[number - 1] = number + by
    order[number - 1 + by] = number
    if (text !== undefined) text = reorderPlacementTokens(text, order)
  }
</script>

{#snippet tile(
  number: number,
  src: string | undefined,
  alt: string | undefined,
  controls: import('svelte').Snippet,
)}
  <li
    class="flex flex-row gap-3 p-2 rounded-xl border border-slate-200 dark:border-zinc-800"
  >
    <div class="relative shrink-0 w-24 h-24">
      <img
        {src}
        {alt}
        class="w-24 h-24 object-cover rounded-lg bg-slate-100 dark:bg-zinc-900"
      />
      <span
        class="absolute top-1 left-1 min-w-5 h-5 px-1 rounded-full text-xs font-medium
        flex items-center justify-center bg-slate-900/80 text-white"
      >
        {number}
      </span>
    </div>
    <div class="flex flex-col gap-2 min-w-0 flex-1">
      {@render controls()}
    </div>
  </li>
{/snippet}

{#snippet insertButton(number: number, alt: string)}
  <Button
    size="sm"
    color="ghost"
    icon={TextCursorInput}
    disabled={busy || !oninsert}
    aria-label={$t('form.post.insertImage', { number })}
    title={$t('form.post.insertImage', { number })}
    onclick={() => oninsert?.(number, alt)}
  >
    {$t('form.post.insertInText')}
  </Button>
{/snippet}

{#if !attachments}
  {#if images.length > 0}
    <div class="flex flex-col gap-2">
      <Label>{$t('form.post.images')}</Label>
      <ol class="flex flex-col gap-3">
        {#each images as image, index (index)}
          {@const number = index + 1}
          {#snippet controls()}
            {@render insertButton(number, image.alt ?? '')}
          {/snippet}
          {@render tile(number, imageUrl(image), image.alt, controls)}
        {/each}
      </ol>
    </div>
  {/if}
{:else}
  {@const strip = attachments}
  <div class="flex flex-col gap-2">
    <div class="flex flex-row items-center gap-2">
      <Label>{$t('form.post.images')}</Label>
      <Button
        size="sm"
        icon={Image}
        disabled={busy || strip.items.length >= MAXIMUM_ATTACHMENTS}
        onclick={() => input?.click()}
      >
        {$t('form.post.addImages')}
      </Button>
      <input
        bind:this={input}
        type="file"
        accept={ACCEPT}
        multiple
        class="sr-only"
        tabindex="-1"
        aria-hidden="true"
        {onchange}
      />
    </div>
    {#if strip.message}
      <p class="text-sm text-red-600 dark:text-red-400" role="alert">
        {strip.message}
      </p>
    {/if}
    {#if signInNeeded}
      <div
        role="alert"
        class="flex flex-row flex-wrap items-center gap-2 p-2 rounded-xl border border-slate-200 dark:border-zinc-800"
      >
        <div class="flex flex-col flex-1 min-w-0 text-sm">
          <p>{$t('error.upload_sign_in_again')}</p>
          <p class="text-slate-600 dark:text-zinc-400">
            {$t('error.upload_sign_in_again_note')}
          </p>
        </div>
        <Button size="sm" color="primary" onclick={() => onsignin?.()}>
          {$t('error.upload_sign_in_again_action')}
        </Button>
      </div>
    {/if}
    {#if strip.processing > 0}
      <div
        role="status"
        class="flex flex-row items-center gap-3 p-2 rounded-xl border border-slate-200 dark:border-zinc-800
      text-sm text-slate-600 dark:text-zinc-400"
      >
        <div
          class="shrink-0 w-24 h-24 rounded-lg bg-slate-100 dark:bg-zinc-900 animate-pulse"
        ></div>
        {$t('form.post.processingImage')}
      </div>
    {/if}
    {#if strip.items.length > 0}
      <ol class="flex flex-col gap-3">
        {#each strip.items as item, index (item.id)}
          {@const number = index + 1}
          {@const graphemes = countGraphemes(item.alt)}
          {@const altValid = checkAltText(item.alt).ok}
          {#snippet controls()}
            <TextInput
              size="sm"
              value={item.alt}
              placeholder={$t('form.post.altText')}
              aria-label={$t('form.post.imageAltText', { number })}
              aria-invalid={!altValid}
              oninput={(event: Event & { currentTarget: HTMLInputElement }) =>
                strip.setAlt(item.id, event.currentTarget.value)}
            />
            {#if graphemes >= COUNTER_FROM || !altValid}
              <span
                class={[
                  'text-xs self-end',
                  altValid
                    ? 'text-slate-600 dark:text-zinc-400'
                    : 'text-red-600 dark:text-red-400',
                ]}
              >
                {graphemes}/{MAXIMUM_ALT_TEXT_GRAPHEMES}
              </span>
            {/if}
            {#if item.status === 'uploading'}
              <progress
                class="w-full h-1"
                aria-label={$t('form.post.uploadingImage', { number })}
              ></progress>
            {:else if item.status === 'failed' && !(onsignin && isUploadSignInError(item.error))}
              <!-- A sign-in refusal shows once, in the strip's sign-in banner. -->
              <div class="flex flex-row items-center gap-2">
                <p class="text-sm text-red-600 dark:text-red-400 flex-1">
                  {errorMessage(item.error)}
                </p>
                <Button
                  size="sm"
                  icon={RefreshCw}
                  disabled={busy}
                  onclick={() => onretry?.()}
                >
                  {$t('form.post.retryUpload')}
                </Button>
              </div>
            {/if}
            <div class="flex flex-row flex-wrap gap-1 mt-auto">
              {@render insertButton(number, item.alt)}
              <Button
                size="square-sm"
                color="ghost"
                icon={ChevronLeft}
                disabled={busy || index === 0}
                aria-label={$t('form.post.moveImageEarlier', { number })}
                title={$t('form.post.moveImageEarlier', { number })}
                onclick={() => move(strip, item.id, number, -1)}
              />
              <Button
                size="square-sm"
                color="ghost"
                icon={ChevronRight}
                disabled={busy || index === strip.items.length - 1}
                aria-label={$t('form.post.moveImageLater', { number })}
                title={$t('form.post.moveImageLater', { number })}
                onclick={() => move(strip, item.id, number, 1)}
              />
              <Button
                size="square-sm"
                color="ghost"
                icon={X}
                class="ml-auto"
                disabled={busy}
                aria-label={$t('form.post.removeImage', { number })}
                title={$t('form.post.removeImage', { number })}
                onclick={() => remove(strip, item.id, number)}
              />
            </div>
          {/snippet}
          {@render tile(number, item.previewUrl, item.alt, controls)}
        {/each}
      </ol>
    {/if}
  </div>
{/if}
