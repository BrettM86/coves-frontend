import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { env } from '$env/dynamic/private'
import { removeAccount, encryptSession, isValidAccountId, asAccountId } from '$lib/server/session'
import { SESSION_COOKIE_OPTIONS } from '$lib/server/cookies'
import { validateRequestOrigin } from '$lib/server/csrf'

interface LogoutRequest {
  accountId?: string
}

/**
 * POST /api/auth/logout
 *
 * Logs out an account from the session.
 *
 * Flow:
 * 1. Parse accountId from body (defaults to active account)
 * 2. Call Coves /oauth/logout endpoint (best effort)
 * 3. Remove account from session
 * 4. Update or clear kelp_session cookie
 */
export const POST: RequestHandler = async ({ request, cookies, locals, url }) => {
  // Validate Origin header (defense-in-depth against CSRF)
  const originResult = validateRequestOrigin(request, url.origin)
  if (!originResult.valid) {
    console.warn('[auth/logout] Cross-origin request blocked:', originResult.reason)
    return json({ error: 'Cross-origin requests not allowed' }, { status: 403 })
  }

  // Check authentication
  if (!locals.auth.authenticated) {
    return json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { session } = locals.auth

  // Parse request body
  let body: LogoutRequest = {}
  try {
    const text = await request.text()
    if (text.trim()) {
      body = JSON.parse(text)
    }
    // Empty body is valid - will logout active account
  } catch (error) {
    console.warn('Failed to parse logout request body as JSON, defaulting to active account logout:', error)
  }

  // Determine which account to logout
  const rawAccountId = body.accountId ?? session.activeAccountId
  if (!rawAccountId) {
    return json({ error: 'No account to logout' }, { status: 400 })
  }

  // Validate accountId format (must be valid AccountId)
  if (!isValidAccountId(rawAccountId)) {
    return json({ error: 'Invalid accountId format' }, { status: 400 })
  }
  const accountId = asAccountId(rawAccountId)

  // Find the account to logout
  const account = session.accounts.find((a) => a.id === accountId)
  if (!account) {
    return json({ error: 'Account not found' }, { status: 400 })
  }

  // Call Coves /oauth/logout endpoint to revoke the session on the backend.
  // The Coves backend expects the sealed token in a `coves_session` cookie,
  // which it unseals to extract the DID and session ID for revocation.
  // See: Coves/internal/atproto/oauth/handlers.go HandleLogout()
  //
  // Track whether remote revocation succeeded for user notification
  let remoteLogoutFailed = false
  let remoteLogoutError: string | undefined
  try {
    const logoutResponse = await fetch(`${account.instance}/oauth/logout`, {
      method: 'POST',
      headers: {
        Cookie: `coves_session=${account.sealedToken}`,
      },
    })
    if (!logoutResponse.ok) {
      remoteLogoutFailed = true
      remoteLogoutError = `Backend returned status ${logoutResponse.status}`
      console.warn('Coves logout endpoint returned non-OK status:', logoutResponse.status)
    }
  } catch (error) {
    // Log but don't fail - we still want to clear the local session
    remoteLogoutFailed = true
    remoteLogoutError = error instanceof Error ? error.message : 'Network error'
    console.warn('Failed to call Coves logout endpoint:', error)
  }

  // Remove account from session
  const updatedSession = removeAccount(session, accountId)

  // Get session secret
  const sessionSecret = env.SESSION_SECRET
  if (!sessionSecret) {
    console.error('SESSION_SECRET environment variable not set')
    return json({ error: 'Server configuration error' }, { status: 500 })
  }

  // Update or clear session cookie
  if (updatedSession.accounts.length === 0) {
    // No accounts left - clear the session
    cookies.delete('kelp_session', { path: '/' })
    return json({
      success: true,
      session: null,
      remoteLogoutFailed,
      remoteLogoutError,
    })
  } else {
    // Update session with remaining accounts
    // If active account was removed, set it to first remaining account
    if (updatedSession.activeAccountId === null) {
      updatedSession.activeAccountId = updatedSession.accounts[0].id
    }

    const encryptedSession = encryptSession(updatedSession, sessionSecret)
    cookies.set('kelp_session', encryptedSession, SESSION_COOKIE_OPTIONS)

    return json({
      success: true,
      activeAccountId: updatedSession.activeAccountId,
      accounts: updatedSession.accounts.map((a) => ({
        id: a.id,
        did: a.did,
        handle: a.handle,
        instance: a.instance,
        avatar: a.avatar,
      })),
      remoteLogoutFailed,
      remoteLogoutError,
    })
  }
}
