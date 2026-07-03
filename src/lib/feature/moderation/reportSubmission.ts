import type {
  AtUri,
  ReportReason,
  SubmitReportInput,
} from '$lib/api/coves/types'
import {
  isValidAtUri,
  MAX_REPORT_EXPLANATION_LENGTH,
} from '$lib/api/coves/types'
import { XrpcError } from '$lib/api/coves/xrpc'

// Re-exported so UI code can import the display-order reason list alongside
// the other report helpers. The list lives in types.ts next to ReportReason
// so the type is derived from a single source of truth.
export { REPORT_REASONS } from '$lib/api/coves/types'

/**
 * Builds the `social.coves.admin.submitReport` payload.
 *
 * Trims the explanation and omits it entirely when empty (matching the
 * mobile client). Throws on inputs the backend would reject so programming
 * errors surface early instead of as opaque 400s.
 */
export function buildReportInput(
  targetUri: AtUri,
  reason: ReportReason,
  explanation?: string,
): SubmitReportInput {
  if (!isValidAtUri(targetUri)) {
    throw new Error(`Invalid report target URI: ${targetUri}`)
  }

  const trimmed = explanation?.trim() ?? ''
  if ([...trimmed].length > MAX_REPORT_EXPLANATION_LENGTH) {
    throw new Error(
      `Explanation exceeds maximum length of ${MAX_REPORT_EXPLANATION_LENGTH} characters`,
    )
  }

  const input: SubmitReportInput = { targetUri, reason }
  if (trimmed.length > 0) {
    input.explanation = trimmed
  }
  return input
}

/**
 * Maps a report submission failure to a human-readable message.
 *
 * Fixed messages are resolved through the passed i18n translator `t` (keys
 * under `moderation.reportModal.errors`); raw backend/Error messages pass
 * through untranslated. The rate limiter (10 reports/minute) responds with a
 * plain-text 429 that the XRPC client cannot parse into an error name, so it
 * is matched by status code. Backend validation errors arrive as XRPC JSON
 * errors with readable messages, which are shown as-is.
 */
export function reportErrorMessage(
  error: unknown,
  t: (key: string) => string,
): string {
  if (error instanceof XrpcError) {
    if (error.status === 429) {
      return t('moderation.reportModal.errors.rateLimited')
    }
    if (error.status === 401) {
      return t('moderation.reportModal.errors.notLoggedIn')
    }
    // A 2xx response whose body failed to parse means the report was most
    // likely recorded server-side; warn the user instead of inviting a
    // resubmit that burns the rate limit.
    if (
      error.errorName === 'ParseError' &&
      error.status >= 200 &&
      error.status < 300
    ) {
      return t('moderation.reportModal.errors.maybeSubmitted')
    }
    // Backend messages for validation errors are already human-readable
    // (e.g. "Explanation exceeds maximum length of 1000 characters").
    // ParseError messages are technical, so they fall through to generic.
    if (
      error.message &&
      error.errorName !== 'UnknownError' &&
      error.errorName !== 'ParseError'
    ) {
      return error.message
    }
    return t('moderation.reportModal.errors.generic')
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return t('moderation.reportModal.errors.generic')
}
