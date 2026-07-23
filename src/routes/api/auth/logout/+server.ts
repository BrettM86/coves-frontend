import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { validateRequestOrigin } from '$lib/server/csrf'

/**
 * POST /api/auth/logout
 *
 * Logs out the current user.
 * Forwards the coves_session cookie to Go's /oauth/logout for server-side revocation,
 * then clears the cookie locally.
 */
export const POST: RequestHandler = async ({
  request,
  cookies,
  locals,
  url,
}) => {
  // Validate Origin header (defense-in-depth against CSRF)
  const originResult = validateRequestOrigin(request, url.origin)
  if (!originResult.valid) {
    console.warn(
      '[auth/logout] Cross-origin request blocked:',
      originResult.reason,
    )
    return json({ error: 'Cross-origin requests not allowed' }, { status: 403 })
  }

  if (!locals.auth.authenticated) {
    // Session already expired or invalid — logout is idempotent. Clear any
    // stale cookie and report success so the client can drop its local state.
    cookies.delete('coves_session', { path: '/' })
    return json({ success: true, session: null })
  }

  // Call Go /oauth/logout to revoke the session on the backend (best effort).
  // Use locals.auth.authToken (already validated by hooks) instead of re-reading
  // the cookie, which avoids a race condition where another request could delete
  // the cookie mid-flight.
  let remoteLogoutFailed = false

  const authToken = locals.auth.authToken
  try {
    const logoutResponse = await fetch(
      `${locals.auth.account.instance}/oauth/logout`,
      {
        method: 'POST',
        headers: {
          Cookie: `coves_session=${authToken}`,
        },
        // Remote revocation is best-effort — don't let a hung backend stall logout.
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!logoutResponse.ok) {
      remoteLogoutFailed = true
      // Log full details server-side for debugging, but don't expose to client
      console.warn(
        '[auth/logout] Backend returned non-OK status:',
        logoutResponse.status,
      )
    }
  } catch (error) {
    remoteLogoutFailed = true
    // Log the full error server-side for debugging
    console.warn('[auth/logout] Failed to call backend logout endpoint:', error)
  }

  // Clear the coves_session cookie
  cookies.delete('coves_session', { path: '/' })

  return json({
    success: true,
    session: null,
    remoteLogoutFailed,
    // Return a generic message instead of leaking internal error details
    ...(remoteLogoutFailed && { remoteLogoutError: 'Remote logout failed' }),
  })
}
