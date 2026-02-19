import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { PENDING_AUTH_COOKIE_OPTIONS } from '$lib/server/cookies'
import { generateOAuthState } from '$lib/server/csrf'

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
export const POST: RequestHandler = async ({ request, cookies, url }) => {
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

  // Normalize and validate instance URL
  // If the instance doesn't have a protocol, prepend https://
  let normalizedInstance = instance.trim()
  if (
    !normalizedInstance.startsWith('http://') &&
    !normalizedInstance.startsWith('https://')
  ) {
    normalizedInstance = `https://${normalizedInstance}`
  }

  let instanceUrl: URL
  try {
    instanceUrl = new URL(normalizedInstance)
  } catch {
    return json({ error: 'Invalid instance URL' }, { status: 400 })
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
      console.warn(
        '[auth/login] Rejected redirect URL with backslash prefix:',
        trimmedRedirect,
      )
    } else if (trimmedRedirect.startsWith('//')) {
      // Reject protocol-relative URLs
      console.warn(
        '[auth/login] Rejected protocol-relative redirect URL:',
        trimmedRedirect,
      )
    } else {
      // Try to parse as URL and check if same-origin
      try {
        const redirectUrl = new URL(trimmedRedirect, url.origin)
        if (redirectUrl.origin === url.origin) {
          safeRedirect =
            redirectUrl.pathname + redirectUrl.search + redirectUrl.hash
        } else {
          console.warn(
            '[auth/login] Rejected external redirect URL:',
            trimmedRedirect,
          )
        }
      } catch {
        console.warn(
          '[auth/login] Rejected invalid redirect URL:',
          trimmedRedirect,
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
