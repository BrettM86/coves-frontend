<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import { Bell, Icon } from '$lib/ui/kit/icon'
  import NavButton from '$lib/ui/navbar/NavButton.svelte'
  import type { ClassValue } from 'svelte/elements'

  interface Props {
    count: number
    class?: ClassValue
  }

  let { count, class: clazz = '' }: Props = $props()

  let badgeText = $derived(
    count > 99 ? '99+' : count > 0 ? String(count) : undefined,
  )
</script>

<NavButton
  href="/notifications"
  label={$t('nav.notifications')}
  adaptive={false}
  aria-label={badgeText
    ? $t('nav.notificationsUnread', { count: badgeText })
    : $t('nav.notifications')}
  isSelectedFilter={(path) => path === '/notifications'}
  class={clazz}
>
  {#snippet customIcon()}
    <!-- Icon-only, so the bell keeps the 20px size at every width. The badge
         overlaps the bell's upper right as Bluesky's does: its left edge sits
         at the icon's centre for one digit, further left for longer counts. -->
    <div class="relative grid place-items-center">
      <Icon src={Bell} size="20" />
      {#if badgeText}
        <span
          data-part="badge"
          aria-hidden="true"
          class={[
            'absolute -top-1 min-w-4 h-[15px] px-1 rounded-full',
            badgeText.length === 1 ? 'left-1/2' : 'left-1/3',
            'grid place-items-center text-[11px] leading-none font-semibold tabular-nums',
            'bg-red-600 text-white dark:bg-red-500',
          ]}
        >
          {badgeText}
        </span>
      {/if}
    </div>
  {/snippet}
</NavButton>
