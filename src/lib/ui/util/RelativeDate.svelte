<script lang="ts" module>
  import { locale } from '$lib/app/state/i18n'
  import { settings } from '$lib/app/state/settings.svelte'
  import KitRelativeDate, {
    formatRelativeDate as formatKitRelativeDate,
  } from '$lib/ui/kit/util/RelativeDate.svelte'

  /**
   * The kit's `formatRelativeDate`, bound to the "absolute dates" setting.
   *
   * `locale` is a parameter rather than read from the store here so that a
   * template call site (`{formatRelativeDate(d, opts, $locale)}`) re-renders
   * on a language switch — a store read inside this function would not
   * register a dependency for the caller.
   */
  export function formatRelativeDate(
    date: Date,
    options: Intl.RelativeTimeFormatOptions,
    locale: string | null | undefined,
    relativeTo?: Date,
  ): string {
    return formatKitRelativeDate(
      date,
      options,
      locale ?? undefined,
      relativeTo,
      settings.absoluteDates,
    )
  }
</script>

<script lang="ts">
  import type { ComponentProps } from 'svelte'

  type Props = Omit<ComponentProps<typeof KitRelativeDate>, 'locale'>

  // `absolute` falls back in the template, not in `$props()`: a prop fallback
  // is evaluated once and untracked, so it would never follow the setting.
  let { absolute, ...rest }: Props = $props()
</script>

<KitRelativeDate
  {...rest}
  absolute={absolute ?? settings.absoluteDates}
  locale={$locale ?? undefined}
/>
