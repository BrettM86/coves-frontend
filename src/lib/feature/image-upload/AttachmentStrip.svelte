<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import { errorMessage } from '$lib/app/util/error'
  import { Button, Label, TextInput } from '$lib/ui/kit'
  import {
    ChevronLeft,
    ChevronRight,
    Image,
    RefreshCw,
    X,
  } from '$lib/ui/kit/icon'
  import type { Attachments } from './attachments.svelte'
  import {
    checkAltText,
    countGraphemes,
    MAXIMUM_ALT_TEXT_GRAPHEMES,
  } from './image-file'

  interface Props {
    attachments: Attachments
    /** True while the form uploads or creates: the strip cannot change then. */
    busy?: boolean
    /** Retries the submit after a failed upload. */
    onretry?: () => void
  }

  let { attachments, busy = false, onretry }: Props = $props()

  const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'
  const MAXIMUM_ATTACHMENTS = 8
  /** The alt text counter shows from this many graphemes on. */
  const COUNTER_FROM = MAXIMUM_ALT_TEXT_GRAPHEMES - 100

  let input = $state<HTMLInputElement>()

  function onchange(event: Event & { currentTarget: HTMLInputElement }) {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (files.length > 0) void attachments.add(files)
  }
</script>

<div class="flex flex-col gap-2">
  <div class="flex flex-row items-center gap-2">
    <Label>{$t('form.post.images')}</Label>
    <Button
      size="sm"
      icon={Image}
      disabled={busy || attachments.items.length >= MAXIMUM_ATTACHMENTS}
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
  {#if attachments.message}
    <p class="text-sm text-red-600 dark:text-red-400" role="alert">
      {attachments.message}
    </p>
  {/if}
  {#if attachments.processing > 0}
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
  {#if attachments.items.length > 0}
    <ol class="flex flex-col gap-3">
      {#each attachments.items as item, index (item.id)}
        {@const number = index + 1}
        {@const graphemes = countGraphemes(item.alt)}
        {@const altValid = checkAltText(item.alt).ok}
        <li
          class="flex flex-row gap-3 p-2 rounded-xl border border-slate-200 dark:border-zinc-800"
        >
          <div class="relative shrink-0 w-24 h-24">
            <img
              src={item.previewUrl}
              alt={item.alt}
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
            <TextInput
              size="sm"
              value={item.alt}
              placeholder={$t('form.post.altText')}
              aria-label={$t('form.post.imageAltText', { number })}
              aria-invalid={!altValid}
              oninput={(event: Event & { currentTarget: HTMLInputElement }) =>
                attachments.setAlt(item.id, event.currentTarget.value)}
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
            {:else if item.status === 'failed'}
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
            <div class="flex flex-row gap-1 mt-auto">
              <Button
                size="square-sm"
                color="ghost"
                icon={ChevronLeft}
                disabled={busy || index === 0}
                aria-label={$t('form.post.moveImageEarlier', { number })}
                title={$t('form.post.moveImageEarlier', { number })}
                onclick={() => attachments.moveEarlier(item.id)}
              />
              <Button
                size="square-sm"
                color="ghost"
                icon={ChevronRight}
                disabled={busy || index === attachments.items.length - 1}
                aria-label={$t('form.post.moveImageLater', { number })}
                title={$t('form.post.moveImageLater', { number })}
                onclick={() => attachments.moveLater(item.id)}
              />
              <Button
                size="square-sm"
                color="ghost"
                icon={X}
                class="ml-auto"
                disabled={busy}
                aria-label={$t('form.post.removeImage', { number })}
                title={$t('form.post.removeImage', { number })}
                onclick={() => attachments.remove(item.id)}
              />
            </div>
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</div>
