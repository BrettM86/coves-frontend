import { redirect } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { validateOAuthState } from '$lib/server/csrf'

interface PendingAuth {
  redirect: string
  state: string
}

/**
 * Runtime validation for parsed PendingAuth cookie values.
 * Returns the validated PendingAuth if the shape is correct, or null if invalid.
 * This guards against cookie values like "null", "42", "[]", or objects
 * missing required fields.
 */
function validatePendingAuth(parsed: unknown): PendingAuth | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null
  }
  const obj = parsed as Record<string, unknown>
  if (typeof obj.state !== 'string' || typeof obj.redirect !== 'string') {
    return null
  }
  return { state: obj.state, redirect: obj.redirect }
}

/**
 * GET /api/auth/callback
 *
 * OAuth callback handler. Called after Coves backend completes authentication.
 * The Go backend has already set the coves_session cookie during OAuth.
 * This endpoint just validates the CSRF state and redirects.
 */
export const GET: RequestHandler = async ({ cookies, url }) => {
  const pendingAuthCookie = cookies.get('kelp_pending_auth')

  if (!pendingAuthCookie) {
    throw redirect(302, '/login?error=no_pending_auth')
  }

  let pendingAuth: PendingAuth
  try {
    const parsed: unknown = JSON.parse(pendingAuthCookie)
    const validated = validatePendingAuth(parsed)
    if (!validated) {
      console.warn(
        '[auth/callback] Pending auth cookie has invalid shape:',
        typeof parsed,
      )
      cookies.delete('kelp_pending_auth', { path: '/' })
      throw redirect(302, '/login?error=invalid_pending_auth')
    }
    pendingAuth = validated
  } catch (error) {
    // Re-throw SvelteKit redirects (they use throw for control flow)
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      'location' in error
    ) {
      throw error
    }
    console.warn('[auth/callback] Failed to parse pending auth cookie', error)
    cookies.delete('kelp_pending_auth', { path: '/' })
    throw redirect(302, '/login?error=no_pending_auth')
  }

  // Clean up pending auth cookie
  cookies.delete('kelp_pending_auth', { path: '/' })

  // Validate CSRF state parameter (RFC 6749 section 10.12)
  const callbackState = url.searchParams.get('state')
  if (!callbackState || !pendingAuth.state) {
    console.warn(
      '[auth/callback] Missing state parameter - possible CSRF attack',
    )
    throw redirect(302, '/login?error=invalid_state')
  }

  if (!validateOAuthState(pendingAuth.state, callbackState)) {
    console.warn('[auth/callback] State mismatch - possible CSRF attack', {
      expected: `${pendingAuth.state.substring(0, 8)}...`,
      received: `${callbackState.substring(0, 8)}...`,
    })
    throw redirect(302, '/login?error=invalid_state')
  }

  // Verify the Go backend actually set the coves_session cookie during OAuth.
  // If it's missing, the user would appear silently logged out with no feedback.
  if (!cookies.get('coves_session')) {
    throw redirect(302, '/login?error=no_session')
  }

  // Redirect to stored URL or home
  // The hook will handle authentication on the next request via /api/me
  throw redirect(302, pendingAuth.redirect || '/')
}
