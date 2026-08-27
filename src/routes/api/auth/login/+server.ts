import { json } from '@sveltejs/kit'
import { log } from '$lib/server/log'
import type { RequestHandler } from './$types'
import { PENDING_AUTH_COOKIE_OPTIONS } from '$lib/server/cookies'
import { generateOAuthState } from '$lib/server/csrf'
import { normalizeInstanceUrl } from '$lib/app/state/instance/resolve'

interface LoginRequest {
  handle: string
  instance: string
  redirect?: string
}

/**
 * POST /api/auth/login
 *
 * Initiates OAuth login flow by:
 * 1. Storing pending auth state (instance, redirect URL) in a cookie
 * 2. Building and returning the OAuth redirect URL
 *
 * The client will navigate to this URL to begin OAuth with Coves.
 */
export const POST: RequestHandler = async ({
  request,
  cookies,
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

  // Normalize (https:// default) and validate the instance URL
  const normalizedInstance = normalizeInstanceUrl(instance)
  if (normalizedInstance === null) {
    return json({ error: 'Invalid instance URL' }, { status: 400 })
  }
  const instanceUrl = new URL(normalizedInstance)

  // Built once: all four logged rejections below share this request context.
  const logContext = {
    requestId: locals.requestId,
    method: request.method,
    path: url.pathname,
  }

  // Validate redirect URL to prevent open redirect attacks
  // Only allow relative URLs (starting with /) or same-origin URLs
  let safeRedirect = '/'
  if (redirect && typeof redirect === 'string') {
    const trimmedRedirect = redirect.trim()
    // Check for protocol-relative URLs (// or \\) which could redirect to external sites
    // Backslash can bypass validation as browsers may treat \\ as //
    if (
      trimmedRedirect.startsWith('/') &&
      !trimmedRedirect.startsWith('//') &&
      !trimmedRedirect.startsWith('/\\') &&
      !trimmedRedirect.startsWith('\\')
    ) {
      // Relative URL starting with single slash is safe
      safeRedirect = trimmedRedirect
    } else if (trimmedRedirect.startsWith('\\')) {
      // Reject backslash-prefixed URLs (potential bypass attempt)
      log.warn(
        `[auth/login] Rejected redirect URL with backslash prefix: ${trimmedRedirect}`,
        logContext,
      )
    } else if (trimmedRedirect.startsWith('//')) {
      // Reject protocol-relative URLs
      log.warn(
        `[auth/login] Rejected protocol-relative redirect URL: ${trimmedRedirect}`,
        logContext,
      )
    } else {
      // Try to parse as URL and check if same-origin
      try {
        const redirectUrl = new URL(trimmedRedirect, url.origin)
        if (redirectUrl.origin === url.origin) {
          safeRedirect =
            redirectUrl.pathname + redirectUrl.search + redirectUrl.hash
        } else {
          log.warn(
            `[auth/login] Rejected external redirect URL: ${trimmedRedirect}`,
            logContext,
          )
        }
      } catch {
        log.warn(
          `[auth/login] Rejected invalid redirect URL: ${trimmedRedirect}`,
          logContext,
        )
      }
    }
  }

  // Generate CSRF state for OAuth flow (RFC 6749 section 10.12)
  const state = generateOAuthState()

  // Store pending auth state in cookie
  const pendingAuth = {
    redirect: safeRedirect,
    state,
  }

  cookies.set(
    'kelp_pending_auth',
    JSON.stringify(pendingAuth),
    PENDING_AUTH_COOKIE_OPTIONS,
  )

  // Build OAuth redirect URL
  // Coves OAuth endpoint: {instance}/oauth/login?handle={handle}&redirect_uri={callback}&state={state}
  const callbackUrl = `${url.origin}/api/auth/callback`
  const oauthUrl = new URL('/oauth/login', instanceUrl.origin)
  oauthUrl.searchParams.set('handle', handle)
  oauthUrl.searchParams.set('redirect_uri', callbackUrl)
  oauthUrl.searchParams.set('state', state)

  return json({ redirectUrl: oauthUrl.toString() })
}
