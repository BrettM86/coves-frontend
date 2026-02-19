import type { Handle, HandleServerError } from '@sveltejs/kit'
import { env } from '$env/dynamic/public'
import {
  parseApiMeResponse,
  asInstanceURL,
  asSealedToken,
} from '$lib/server/session'

function getInstanceUrl(): string {
  return env.PUBLIC_INTERNAL_INSTANCE || env.PUBLIC_INSTANCE_URL || ''
}

/**
 * Checks whether an error is a network-level failure (DNS, TLS, connection refused, etc.).
 * `fetch` throws `TypeError` for network failures in most runtimes, but some runtimes
 * wrap the cause in a generic `Error`. This helper inspects the message as a fallback.
 */
function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    return (
      msg.includes('fetch') ||
      msg.includes('network') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('etimedout') ||
      msg.includes('tls') ||
      msg.includes('ssl') ||
      msg.includes('dns')
    )
  }
  return false
}

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.auth = { authenticated: false }

  const covesSession = event.cookies.get('coves_session')
  if (!covesSession) {
    return resolve(event)
  }

  const instanceUrl = getInstanceUrl()
  if (!instanceUrl) {
    throw new Error(
      '[hooks] No instance URL configured. Set PUBLIC_INTERNAL_INSTANCE or PUBLIC_INSTANCE_URL.',
    )
  }

  // Validate configuration eagerly — these throw on invalid input and must
  // NOT be caught so that misconfiguration surfaces immediately on the first request.
  const instance = asInstanceURL(instanceUrl)
  const sealedToken = asSealedToken(covesSession)

  // TODO: Consider caching /api/me responses or skipping validation for proxy
  // requests to reduce latency. Currently /api/me is called on every request.
  try {
    const response = await fetch(`${instance}/api/me`, {
      headers: {
        Cookie: `coves_session=${covesSession}`,
      },
    })

    if (!response.ok) {
      if (response.status === 401) {
        // Session expired or revoked — clear the stale cookie so we don't
        // make a wasted /api/me round-trip on every subsequent request.
        event.cookies.delete('coves_session', { path: '/' })
        // Flag so the layout can show "Your session has expired" to the user
        event.locals.sessionExpired = true
      } else {
        console.warn(
          `[hooks] /api/me returned ${response.status} - treating as unauthenticated`,
        )
      }
      return resolve(event)
    }

    const data: unknown = await response.json()
    const account = parseApiMeResponse(data, instance, sealedToken)

    if (!account) {
      console.warn(
        '[hooks] /api/me response failed validation - treating as unauthenticated',
      )
      event.locals.authError = 'validation_error'
      return resolve(event)
    }

    event.locals.auth = {
      authenticated: true,
      account,
      authToken: sealedToken,
    }
  } catch (error) {
    // Distinguish network/infrastructure errors from validation errors.
    // Network errors (DNS, TLS, timeouts, connection refused) are likely
    // temporary — preserve the cookie so the user can retry.
    if (isNetworkError(error)) {
      console.warn(
        '[hooks] Network error calling /api/me - backend may be unreachable:',
        error,
      )
      event.locals.authError = 'network_error'
    } else if (error instanceof SyntaxError) {
      // JSON parse error from response.json() — the server returned
      // non-JSON content (e.g. HTML error page, empty body)
      console.warn(
        '[hooks] /api/me returned invalid JSON - treating as unauthenticated:',
        error,
      )
      event.locals.authError = 'validation_error'
    } else {
      console.warn(
        '[hooks] Unexpected error calling /api/me - treating as unauthenticated:',
        error,
      )
      event.locals.authError = 'network_error'
    }
  }

  return resolve(event)
}

export const handleError: HandleServerError = async ({
  error,
  event,
  status,
  message,
}) => {
  if (status == 404) {
    return { message: 'Not found' }
  }

  console.error(`An error was captured:`)
  console.error(error)
  console.error(`Event:`, event)
  console.error(`Status:`, status)
  console.error(`Message:`, message)

  return { message: 'An unexpected error occurred' }
}
