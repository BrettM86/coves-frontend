<script lang="ts" module>
  const CLOCK_SKEW_TOLERANCE_MS = 60 * 1000

  export function formatRelativeDate(
    date: Date,
    options: Intl.RelativeTimeFormatOptions,
    locale?: string,
    relativeTo?: Date,
    absolute?: boolean,
  ): string {
    try {
      // A NaN time compares false against every threshold and would fall
      // through to "Now" — the one answer an invalid date must never give.
      if (Number.isNaN(date.getTime())) return 'Invalid Date'

      const now = relativeTo?.getTime() ?? Date.now()

      const diffInMillis = now - date.getTime()

      // Server timestamps routinely sit a few seconds ahead of the client
      // clock; that skew must read as "now", not "in 3 seconds".
      if (diffInMillis < 0 && -diffInMillis < CLOCK_SKEW_TOLERANCE_MS) {
        return 'Now'
      }

      const thresholds = [
        { unit: 'second', threshold: 1000 },
        { unit: 'minute', threshold: 60 * 1000 },
        { unit: 'hour', threshold: 60 * 60 * 1000 },
        { unit: 'day', threshold: 24 * 60 * 60 * 1000 },
        { unit: 'week', threshold: 7 * 24 * 60 * 60 * 1000 },
        { unit: 'month', threshold: 30 * 24 * 60 * 60 * 1000 },
        { unit: 'year', threshold: 365 * 24 * 60 * 60 * 1000 },
      ]

      for (let i = thresholds.length - 1; i >= 0; i--) {
        if (Math.abs(diffInMillis) >= thresholds[i].threshold) {
          const value = Math.round(diffInMillis / thresholds[i].threshold)

          const language = locale ?? 'en'

          if (absolute) {
            const rtf = new Intl.DateTimeFormat(language, {
              ...options,
              timeStyle: 'short',
              dateStyle: 'short',
            })
            return rtf.format(date)
          } else {
            const rtf = new Intl.RelativeTimeFormat(language, options)
            return rtf.format(-value, thresholds[i].unit as 'second')
          }
        }
      }
      return 'Now'
    } catch {
      return 'Invalid Date'
    }
  }
</script>

<script lang="ts">
  const toLocaleDateString = (date: Date): string => {
    try {
      return date.toLocaleString()
    } catch {
      return 'Invalid Date'
    }
  }

  interface Props {
    date: Date
    relativeTo?: Date | undefined
    options?: Intl.RelativeTimeFormatOptions
    /** BCP 47 tag used for formatting; defaults to English. */
    locale?: string
    /** Render an absolute date/time instead of "3 hours ago". */
    absolute?: boolean
    style?: string
    class?: string
  }

  let {
    date,
    relativeTo = undefined,
    options = {
      numeric: 'always',
      style: 'narrow',
    },
    locale = undefined,
    absolute = false,
    style = '',
    class: clazz = '',
  }: Props = $props()

  let dateTime = $derived(toLocaleDateString(date))
</script>

<time datetime={dateTime} title={dateTime} class={clazz} {style}>
  {formatRelativeDate(date, options, locale, relativeTo, absolute)}
</time>
