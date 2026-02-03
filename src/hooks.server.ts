import type { Handle, HandleServerError } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { decryptSession } from '$lib/server/session'

/**
 * Validates that SESSION_SECRET is configured.
 * Throws a fatal error at startup if not set, preventing the app from running
 * in an insecure state where all users appear logged out.
 */
function requireSessionSecret(): string {
  const secret = env.SESSION_SECRET
  if (!secret) {
    throw new Error(
      '[FATAL] SESSION_SECRET environment variable is not set. ' +
        'Authentication cannot function without this. ' +
        'Please set SESSION_SECRET to a 64-character hex string (32 bytes).'
    )
  }
  return secret
}

/**
 * Handle hook - runs for every request
 * Loads the user session from the encrypted cookie
 */
export const handle: Handle = async ({ event, resolve }) => {
  // Default to unauthenticated state
  event.locals.auth = { authenticated: false }

  const sessionCookie = event.cookies.get('kelp_session')

  if (!sessionCookie) {
    // No session cookie present - user is not logged in (this is normal)
    return resolve(event)
  }

  // This will throw a fatal error if SESSION_SECRET is not configured,
  // preventing the app from silently treating all users as logged out.
  const sessionSecret = requireSessionSecret()

  const session = decryptSession(sessionCookie, sessionSecret)

  if (!session) {
    // Session decryption failed - this could be due to:
    // - Corrupt cookie data
    // - Key rotation (SESSION_SECRET changed)
    // - Tampering attempt
    // Log at ERROR level and clear the bad cookie to prevent repeated failures
    console.error(
      '[hooks] Session decryption failed - clearing corrupt cookie and proceeding as unauthenticated'
    )
    event.cookies.set('kelp_session', '', {
      path: '/',
      maxAge: 0,
    })
    // Set a flash message cookie to inform the user they were logged out
    // This cookie is NOT httpOnly so the client can read and display it
    event.cookies.set('kelp_flash', JSON.stringify({
      type: 'session_expired',
      message: 'Your session has expired. Please log in again.',
    }), {
      path: '/',
      maxAge: 60, // Short-lived - just needs to survive until the page loads
      httpOnly: false, // Client needs to read this to display the message
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    })
    return resolve(event)
  }

  if (!session.activeAccountId) {
    console.warn('[hooks] Session has no active account ID - proceeding as unauthenticated')
    return resolve(event)
  }

  const activeAccount = session.accounts.find((a) => a.id === session.activeAccountId)

  if (!activeAccount) {
    console.warn(
      `[hooks] Active account ID "${session.activeAccountId}" not found in session accounts - proceeding as unauthenticated`
    )
    return resolve(event)
  }

  // Set authenticated state with all required fields
  event.locals.auth = {
    authenticated: true,
    session,
    activeAccount,
    authToken: activeAccount.sealedToken,
  }

  return resolve(event)
}

export const handleError: HandleServerError = async ({
  error,
  event,
  status,
  message,
}) => {
  if (status == 404) {
    return { message: 'Not found' }
  }

  console.error(`An error was captured:`)
  console.error(error)
  console.error(`Event:`, event)
  console.error(`Status:`, status)
  console.error(`Message:`, message)

  // Return a generic error message to the client (don't expose internal details)
  return { message: 'An unexpected error occurred' }
}
