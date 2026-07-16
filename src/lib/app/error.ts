import { t } from './i18n'

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
      error = JSON.parse(error?.body?.message)

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
    if (!error) throw error

    // Only key-shaped messages (error codes like "couldnt_find_post") can be
    // translation keys — free-text messages would just make t.get log a
    // missing-translation warning on every error page.
    if (!/^[\w-]+$/.test(String(error))) return String(error)

    // t.get returns the key itself when no translation exists — fall back
    // to the raw error message instead of showing "error.<message>"
    const key = `error.${error}`
    const translated = t.get(key)
    return translated === key ? String(error) : translated
  } catch {
    // Consumers render this (e.g. inside toast markdown), so it must always
    // be a string — a raw object here crashes the toast into an empty box.
    if (typeof error === 'string') return error
    if (error instanceof Error) return error.message
    try {
      return JSON.stringify(error) ?? String(error)
    } catch {
      return String(error)
    }
  }
}
