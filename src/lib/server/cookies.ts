/**
 * Shared cookie configuration options for authentication endpoints.
 *
 * These constants ensure consistent cookie settings across all auth endpoints
 * and reduce the risk of configuration drift.
 */

/**
 * Cookie options for the session cookie (kelp_session).
 *
 * NOTE: sameSite is set to 'lax' (not 'strict') because the OAuth callback endpoint
 * is reached via a cross-site redirect from the Coves OAuth server. With 'strict',
 * the browser would not send the pending_auth cookie on the redirect, breaking
 * the OAuth flow. 'lax' allows cookies on top-level navigations (like OAuth redirects)
 * while still protecting against CSRF on cross-site POST requests.
 */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: import.meta.env.PROD,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30, // 30 days
}

/**
 * Cookie options for pending auth state (kelp_pending_auth).
 *
 * This cookie stores temporary state during the OAuth flow (instance URL, redirect target).
 * It has a short TTL since the OAuth flow should complete within minutes.
 */
export const PENDING_AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: import.meta.env.PROD,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 10, // 10 minutes
}
