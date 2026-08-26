import { t } from '$lib/app/state/i18n'

/**
 * Turns anything an API call or loader can throw into a user-facing string.
 * Consumers render the result directly (toasts, error pages), so this must
 * always return a readable message — never a raw object or "undefined".
 */
// eslint-disable-next-line
export function errorMessage(error: any, instance?: string): string {
  try {
    if (typeof error == 'string') {
      try {
        error = JSON.parse(error)
      } catch {
        /* try without catch would be cool imo */
      }
    }

    if (error?.body?.message) {
      // Lemmy-style errors nest a JSON document in `body.message`; a plain
      // text message there is already the message.
      try {
        error = JSON.parse(error.body.message)
      } catch {
        error = error.body.message
      }

      if (typeof error?.message == 'string') {
        // probably piefed weird error format
        error = error.message
      }
    }
    if (error?.message) {
      error = error?.message
    }
    if (error?.error && typeof error?.error === 'string') {
      error = error.error
    }
    if (!error) return t.get('error.unknown')

    // Only key-shaped messages (error codes like "couldnt_find_post") can be
    // translation keys — free-text messages would just make t.get log a
    // missing-translation warning on every error page.
    if (!/^[\w-]+$/.test(String(error))) return String(error)

    // t.get returns the key itself when no translation exists — fall back
    // to the raw error message instead of showing "error.<message>"
    const key = `error.${error}`
    const translated = t.get(key)
    return translated === key ? String(error) : translated
  } catch (formatError) {
    console.error('[errorMessage] failed to format error', {
      error,
      formatError,
    })
    if (typeof error === 'string') return error
    if (error instanceof Error) return error.message
    return t.get('error.unknown')
  }
}
