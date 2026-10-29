<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import { Icon, ImageOff } from '$lib/ui/kit/icon'

  let { class: clazz = '' }: { class?: string } = $props()
</script>

<!--
  @component
  Stands in for an image that failed to load. It fills the box it is put in,
  so the box keeps the size it reserved for the image. There is no retry:
  reloading the page retries.
-->
<div
  class={[
    'flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center text-xs',
    'bg-slate-100 text-slate-500 dark:bg-zinc-900 dark:text-zinc-400',
    clazz,
  ]}
>
  <Icon src={ImageOff} size="20" />
  <span>{$t('common.imageUnavailable')}</span>
</div>
