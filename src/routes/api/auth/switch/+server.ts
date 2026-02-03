import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { env } from '$env/dynamic/private'
import { switchAccount, encryptSession, isValidAccountId } from '$lib/server/session'
import { SESSION_COOKIE_OPTIONS } from '$lib/server/cookies'
import { validateRequestOrigin } from '$lib/server/csrf'

interface SwitchRequest {
  accountId: string
}

/**
 * POST /api/auth/switch
 *
 * Switches the active account in the session.
 *
 * Flow:
 * 1. Parse accountId from body
 * 2. Validate account exists in session
 * 3. Update activeAccountId
 * 4. Set updated kelp_session cookie
 */
export const POST: RequestHandler = async ({ request, cookies, locals, url }) => {
  // Validate Origin header (defense-in-depth against CSRF)
  const originResult = validateRequestOrigin(request, url.origin)
  if (!originResult.valid) {
    console.warn('[auth/switch] Cross-origin request blocked:', originResult.reason)
    return json({ error: 'Cross-origin requests not allowed' }, { status: 403 })
  }

  // Check authentication
  if (!locals.auth.authenticated) {
    return json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { session } = locals.auth

  // Parse request body
  let body: Partial<SwitchRequest>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { accountId } = body

  if (!accountId || typeof accountId !== 'string') {
    return json({ error: 'Missing or invalid accountId' }, { status: 400 })
  }

  // Validate accountId format (must be valid AccountId)
  if (!isValidAccountId(accountId)) {
    return json({ error: 'Invalid accountId format' }, { status: 400 })
  }

  // Try to switch account
  let updatedSession
  try {
    updatedSession = switchAccount(session, accountId)
  } catch (err) {
    // Log the actual error for debugging
    console.error('[auth/switch] Failed to switch account:', err)

    // Return specific error message based on the error type
    const errorMessage = err instanceof Error ? err.message : 'Unknown error during account switch'
    return json({ error: errorMessage }, { status: 400 })
  }

  // Get session secret
  const sessionSecret = env.SESSION_SECRET
  if (!sessionSecret) {
    console.error('SESSION_SECRET environment variable not set')
    return json({ error: 'Server configuration error' }, { status: 500 })
  }

  // Update session cookie
  const encryptedSession = encryptSession(updatedSession, sessionSecret)
  cookies.set('kelp_session', encryptedSession, SESSION_COOKIE_OPTIONS)

  return json({
    activeAccountId: updatedSession.activeAccountId,
    accounts: updatedSession.accounts.map((a) => ({
      id: a.id,
      did: a.did,
      handle: a.handle,
      instance: a.instance,
      avatar: a.avatar,
    })),
  })
}
