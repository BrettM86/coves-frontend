import { redirect } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { env } from '$env/dynamic/private'
import {
  createSession,
  addAccount,
  updateAccountByDid,
  encryptSession,
  decryptSession,
  asDID,
  asHandle,
  asInstanceURL,
  asSealedToken,
  asSessionId,
  type AppSession,
} from '$lib/server/session'
import { SESSION_COOKIE_OPTIONS } from '$lib/server/cookies'
import { validateOAuthState } from '$lib/server/csrf'

interface PendingAuth {
  instance: string
  redirect: string
  state: string
}

interface CovesMeResponse {
  did: string
  handle: string
  sessionId: string
  sealedToken: string
  avatar?: string
}

/**
 * GET /api/auth/callback
 *
 * OAuth callback handler. Called by Coves backend after successful authentication.
 *
 * Flow:
 * 1. Read coves_session cookie (set by Coves backend during OAuth)
 * 2. Use coves_session to call Coves /api/me to get user info
 * 3. Create or update kelp_session with the new account
 * 4. Redirect to stored redirect URL
 */
export const GET: RequestHandler = async ({ cookies, url }) => {
  // Read coves_session cookie set by Coves backend
  const covesSession = cookies.get('coves_session')

  if (!covesSession) {
    throw redirect(302, '/login?error=no_session')
  }

  // Read pending auth state
  const pendingAuthCookie = cookies.get('kelp_pending_auth')

  if (!pendingAuthCookie) {
    throw redirect(302, '/login?error=no_pending_auth')
  }

  let pendingAuth: PendingAuth
  try {
    pendingAuth = JSON.parse(pendingAuthCookie) as PendingAuth
  } catch (error) {
    console.error('[auth/callback] Failed to parse kelp_pending_auth cookie:', error)
    // Clean up corrupted cookie
    cookies.delete('kelp_pending_auth', { path: '/' })
    throw redirect(302, '/login?error=no_pending_auth')
  }

  // Clean up pending auth cookie
  cookies.delete('kelp_pending_auth', { path: '/'  })

  // If no instance in pending auth, we can't proceed
  if (!pendingAuth.instance) {
    throw redirect(302, '/login?error=no_pending_auth')
  }

  // Validate CSRF state parameter (RFC 6749 section 10.12)
  const callbackState = url.searchParams.get('state')
  if (!callbackState || !pendingAuth.state) {
    console.warn('[auth/callback] Missing state parameter - possible CSRF attack')
    throw redirect(302, '/login?error=invalid_state')
  }

  if (!validateOAuthState(pendingAuth.state, callbackState)) {
    console.warn('[auth/callback] State mismatch - possible CSRF attack', {
      expected: pendingAuth.state.substring(0, 8) + '...',
      received: callbackState.substring(0, 8) + '...',
    })
    throw redirect(302, '/login?error=invalid_state')
  }

  // Call Coves /api/me to get user info
  let userInfo: CovesMeResponse
  try {
    const response = await fetch(`${pendingAuth.instance}/api/me`, {
      method: 'GET',
      headers: {
        Cookie: `coves_session=${covesSession}`,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch user info: ${response.status}`)
    }

    userInfo = (await response.json()) as CovesMeResponse
  } catch (error) {
    console.error('Failed to fetch user info from Coves:', error)
    throw redirect(302, '/login?error=fetch_failed')
  }

  // Validate user info
  if (!userInfo.did || !userInfo.handle || !userInfo.sealedToken || !userInfo.sessionId) {
    console.error('[auth/callback] Invalid user info from /api/me:', {
      instance: pendingAuth.instance,
      hasDid: !!userInfo.did,
      hasHandle: !!userInfo.handle,
      hasSealedToken: !!userInfo.sealedToken,
      hasSessionId: !!userInfo.sessionId,
    })
    throw redirect(302, '/login?error=invalid_user_info')
  }

  // Validate and convert to branded types
  let did, handle, instance
  try {
    did = asDID(userInfo.did)
    handle = asHandle(userInfo.handle)
    instance = asInstanceURL(pendingAuth.instance)
  } catch (error) {
    console.error('Invalid credential format:', error)
    throw redirect(302, '/login?error=invalid_credential_format')
  }

  // Get session secret
  const sessionSecret = env.SESSION_SECRET
  if (!sessionSecret) {
    console.error('SESSION_SECRET environment variable not set')
    throw redirect(302, '/login?error=server_config')
  }

  // Get existing session or create new one
  let session: AppSession
  const existingSessionCookie = cookies.get('kelp_session')

  if (existingSessionCookie) {
    const existingSession = decryptSession(existingSessionCookie, sessionSecret)
    if (existingSession) {
      session = existingSession
    } else {
      session = createSession()
    }
  } else {
    session = createSession()
  }

  // Check if this account already exists (by DID) and update or add accordingly
  const updateResult = updateAccountByDid(session, did, {
    handle,
    sealedToken: asSealedToken(userInfo.sealedToken),
    sessionId: asSessionId(userInfo.sessionId),
    avatar: userInfo.avatar,
  })

  if (updateResult) {
    // Existing account was updated
    session = updateResult.session
  } else {
    // Add new account
    session = addAccount(session, {
      did,
      handle,
      instance,
      sealedToken: asSealedToken(userInfo.sealedToken),
      sessionId: asSessionId(userInfo.sessionId),
      avatar: userInfo.avatar,
    })
  }

  // Encrypt and store session
  const encryptedSession = encryptSession(session, sessionSecret)
  cookies.set('kelp_session', encryptedSession, SESSION_COOKIE_OPTIONS)

  // Redirect to stored URL or home
  const redirectUrl = pendingAuth.redirect || '/'
  throw redirect(302, redirectUrl)
}
