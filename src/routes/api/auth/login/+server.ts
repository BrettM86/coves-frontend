import { json } from '@sveltejs/kit'
import { DidNotFoundError } from '@atcute/identity-resolver'
import { isHandle } from '@atcute/lexicons/syntax'
import { resolveLoginHandle } from '$lib/server/resolve-login-handle'
import { log } from '$lib/server/log'
import type { RequestHandler } from './$types'
import { normalizeInstanceUrl } from '$lib/app/state/instance/resolve'
import { loginLockedOrigin } from '$lib/server/instance'

interface LoginRequest {
  handle: string
  instance: string
  redirect?: string
}

/**
 * POST /api/auth/login
 *
 * Initiates OAuth login flow by:
 * 1. Checking that the handle resolves to an atProto identity
 * 2. Validating the local return destination
 * 3. Returning the Go-owned OAuth login URL
 *
 * The client will navigate to this URL to begin OAuth with Coves.
 */
export const POST: RequestHandler = async ({
  request,
  getClientAddress,
  locals,
  url,
}) => {
  let body: Partial<LoginRequest>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { handle, instance, redirect } = body

  // Validate required fields
  if (!handle || typeof handle !== 'string') {
    return json({ error: 'Missing or invalid handle' }, { status: 400 })
  }

  if (!instance || typeof instance !== 'string') {
    return json({ error: 'Missing or invalid instance' }, { status: 400 })
  }

  const normalizedHandle = handle.trim().toLowerCase()
  if (!isHandle(normalizedHandle)) {
    return json({ error: 'invalid_handle' }, { status: 400 })
  }

  // Normalize (https:// default) and validate the instance URL
  const normalizedInstance = normalizeInstanceUrl(instance)
  if (normalizedInstance === null) {
    return json({ error: 'Invalid instance URL' }, { status: 400 })
  }
  const instanceUrl = new URL(normalizedInstance)

  // Built once: every logged rejection below shares this request context.
  const logContext = {
    requestId: locals.requestId,
    method: request.method,
    path: url.pathname,
  }

  // PUBLIC_LOCK_TO_INSTANCE is a deployment policy, not a UI preference: the
  // login form hides the instance field, but this endpoint is reachable
  // directly, so refuse to start OAuth against any other origin.
  const lockedOrigin = loginLockedOrigin()
  if (lockedOrigin !== null && instanceUrl.origin !== lockedOrigin) {
    log.warn(
      `[auth/login] Rejected login to non-locked instance: ${instanceUrl.origin}`,
      logContext,
    )
    return json(
      { error: 'This deployment only allows login to its own instance' },
      { status: 403 },
    )
  }

  // Go owns OAuth state and completion. Send only a safe local destination.
  let safeRedirect = '/'
  if (redirect && typeof redirect === 'string') {
    const trimmedRedirect = redirect.trim()
    const hasUnsafeCharacter = Array.from(redirect).some(
      (character) =>
        character === '\\' ||
        character.charCodeAt(0) < 32 ||
        character.charCodeAt(0) === 127,
    )
    try {
      const destination = new URL(trimmedRedirect, url.origin)
      if (
        hasUnsafeCharacter ||
        trimmedRedirect.startsWith('//') ||
        destination.origin !== url.origin ||
        destination.pathname.startsWith('//')
      ) {
        log.warn('[auth/login] Rejected unsafe redirect URL', logContext)
      } else {
        safeRedirect =
          destination.pathname + destination.search + destination.hash
      }
    } catch {
      log.warn('[auth/login] Rejected invalid redirect URL', logContext)
    }
  }

  // Keep resolution failures on the login form, before creating OAuth state.
  try {
    await resolveLoginHandle(normalizedHandle, getClientAddress)
  } catch (error) {
    // A handle with no account is the visitor's own typo, not an operator's
    // problem; at error level it would drown the lines that need someone.
    if (error instanceof DidNotFoundError) {
      return json({ error: 'account_not_found' }, { status: 404 })
    }
    // The 503 body is deliberately opaque, so without this line an AppView
    // that is down, unreachable, or rate-limiting the frontend looks the same
    // as every other cause in the operator's logs.
    log.error(
      `[auth/login] Handle resolution failed: ${describeFailure(error)}`,
      logContext,
    )
    return json({ error: 'handle_resolution_failed' }, { status: 503 })
  }

  const oauthUrl = new URL('/oauth/login', instanceUrl.origin)
  oauthUrl.searchParams.set('handle', normalizedHandle)
  oauthUrl.searchParams.set('redirect', safeRedirect)

  return json({ redirectUrl: oauthUrl.toString() })
}

/**
 * Names a resolution failure for the log without repeating its message.
 *
 * atcute embeds the submitted handle in `DidNotFoundError` and
 * `FailedHandleResolutionError` messages, and the handle is the visitor's
 * identity, so only the class name is taken from the error itself. The cause
 * is the underlying transport failure and says what actually went wrong.
 */
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return typeof error
  const { cause } = error
  if (cause instanceof Error) {
    return `${error.name} (cause: ${cause.name}: ${cause.message})`
  }
  return error.name
}
