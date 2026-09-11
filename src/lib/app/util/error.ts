import { t } from '$lib/app/state/i18n'
import { log } from '$lib/app/util/log'

const xrpcMessages: Record<string, string> = {
  PostNotFound: 'couldnt_find_post',
  CommentNotFound: 'couldnt_find_comment',
  ParentNotFound: 'couldnt_find_comment',
  CommunityNotFound: 'couldnt_find_community',
  ActorNotFound: 'couldnt_find_person',
  RateLimitExceeded: 'rate_limit_error',
  AuthenticationRequired: 'authentication_required',
  AuthRequired: 'authentication_required',
  InvalidToken: 'authentication_required',
  ExpiredToken: 'authentication_required',
  Forbidden: 'permission_denied',
}

/** Fetch failures and temporary upstream outages, not arbitrary TypeErrors. */
export function isBackendUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ('status' in error && [502, 503, 504].includes(Number(error.status))) {
    return true
  }
  if (!(error instanceof Error)) return false
  return (
    error.name === 'TimeoutError' ||
    /^(failed to fetch|fetch failed|load failed|NetworkError when attempting to fetch resource\.?)$/i.test(
      error.message,
    )
  )
}

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

    // Preserve structured XRPC metadata before unwrapping its message.
    if (error?.status === 429) return t.get('error.rate_limit_error')
    const code = error?.errorName ?? error?.error
    if (typeof code === 'string' && Object.hasOwn(xrpcMessages, code)) {
      return t.get(`error.${xrpcMessages[code]}`)
    }
    if (error?.status >= 500) return t.get('error.server_error')
    if (isBackendUnavailable(error)) return t.get('error.backend_unreachable')

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
    if (typeof error !== 'string') return t.get('error.unknown')
    if (/^XRPC request failed with status \d+$/.test(error)) {
      return t.get('error.unknown')
    }

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
    // `error` is whatever a caller threw — an API body, a Response, anything —
    // so it rides as a field rather than in the message. On the server the
    // logger reduces it to a class tag and key names, so values that may carry
    // a token or a cookie never reach stderr; in the browser it is handed to
    // devtools raw, which is the point of having it there.
    log.error('[errorMessage] failed to format error', formatError, {
      input: error,
    })
    if (typeof error === 'string') return error
    if (error instanceof Error) return error.message
    return t.get('error.unknown')
  }
}
