import { XrpcError } from '$lib/api/coves/xrpc'

/**
 * A 401 from the Coves API. The client transport reacts to these by expiring
 * the session and showing the recovery banner, so a caller checks
 * `profile.sessionExpired` alongside this to decide whether its own error
 * toast would only repeat the banner. A 401 from a session that has already
 * been replaced leaves the current session live, and then the caller's toast
 * is the only feedback the user gets.
 */
export function isExpiredSessionError(error: unknown): boolean {
  return error instanceof XrpcError && error.status === 401
}
