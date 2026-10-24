import { XrpcError } from '$lib/api/coves'
import { log } from '$lib/app/util/log'

const message = 'Notification request failed'

/**
 * Logs a failed notification request with only the NSID and, for an
 * `XrpcError`, its HTTP status and error name. The error itself is never
 * passed on: its message or cause can carry a request URL, a cursor, a
 * notification URI or a response body.
 */
export function logNotificationFailure(nsid: string, error: unknown): void {
  if (error instanceof XrpcError) {
    log.warn(message, undefined, {
      nsid,
      status: error.status,
      errorName: error.errorName,
    })
    return
  }
  log.warn(message, undefined, { nsid, kind: 'non-xrpc' })
}
