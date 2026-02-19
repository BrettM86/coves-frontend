/**
 * Shared cookie configuration options for authentication endpoints.
 *
 * These constants ensure consistent cookie settings across all auth endpoints
 * and reduce the risk of configuration drift.
 */

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
