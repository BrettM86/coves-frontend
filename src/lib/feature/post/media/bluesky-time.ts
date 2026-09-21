/** Matches social-app's short feed timestamps, including its 30-day months. */
export function formatBlueskyTime(
  value: string,
  now: number,
  language: string,
): string {
  const date = new Date(value)
  const seconds = Math.floor((now - date.getTime()) / 1000)

  if (seconds < 5) return 'now'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d`
  if (seconds < 31104000) return `${Math.floor(seconds / 2592000)}mo`
  return new Intl.DateTimeFormat(language).format(date)
}

/** Keep SSR and initial hydration in UTC; use local time only after mounting. */
export function formatBlueskyTimestamp(
  value: string,
  now: number | null,
  language: string,
): { text: string; label: string } {
  const date = new Date(value)
  const timeZone = now === null ? 'UTC' : undefined
  return {
    text:
      now === null
        ? new Intl.DateTimeFormat(language, { timeZone }).format(date)
        : formatBlueskyTime(value, now, language),
    label: new Intl.DateTimeFormat(language, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(date),
  }
}
