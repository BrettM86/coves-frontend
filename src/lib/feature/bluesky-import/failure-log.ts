import { XrpcError } from '$lib/api/coves/xrpc'
import { log } from '$lib/app/util/log'

/**
 * Logs a failed Bluesky import request with its status and error name only:
 * error messages can carry profile text.
 */
export function warnImportFailure(message: string, error: unknown): void {
  log.warn(
    message,
    undefined,
    error instanceof XrpcError
      ? { status: error.status, errorName: error.errorName }
      : { errorName: error instanceof Error ? error.name : typeof error },
  )
}
