import type {
  AtUri,
  ReportReason,
  SubmitReportInput,
} from '$lib/api/coves/types'
import { MAX_REPORT_EXPLANATION_LENGTH } from '$lib/api/coves/types'
import { XrpcError } from '$lib/api/coves/xrpc'

/**
 * Report reason options presented to the user.
 * Values and semantics match the backend enum and the mobile client's
 * ReportDialog so both clients send identical payloads.
 */
export interface ReportReasonOption {
  readonly value: ReportReason
  readonly label: string
  readonly description: string
}

export const REPORT_REASONS: readonly ReportReasonOption[] = [
  {
    value: 'spam',
    label: 'Spam',
    description: 'Unsolicited advertising or repetitive content',
  },
  {
    value: 'harassment',
    label: 'Harassment',
    description: 'Bullying, threats, or targeted attacks',
  },
  {
    value: 'doxing',
    label: 'Doxing',
    description: 'Sharing private information without consent',
  },
  {
    value: 'illegal',
    label: 'Illegal Content',
    description: 'Content that violates laws or regulations',
  },
  {
    value: 'csam',
    label: 'Child Safety',
    description: 'Content exploiting or endangering minors',
  },
  {
    value: 'other',
    label: 'Other',
    description: 'Other policy violations',
  },
] as const

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
  if (!targetUri.startsWith('at://')) {
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
 * The rate limiter (10 reports/minute) responds with a plain-text 429 that
 * the XRPC client cannot parse into an error name, so it is matched by
 * status code. Backend validation errors arrive as XRPC JSON errors with
 * readable messages, which are shown as-is.
 */
export function reportErrorMessage(error: unknown): string {
  if (error instanceof XrpcError) {
    if (error.status === 429) {
      return 'You are submitting reports too quickly. Please wait a minute and try again.'
    }
    if (error.status === 401) {
      return 'You must be logged in to submit a report.'
    }
    // Backend messages for validation errors are already human-readable
    // (e.g. "Explanation exceeds maximum length of 1000 characters").
    if (error.message && error.errorName !== 'UnknownError') {
      return error.message
    }
    return 'Failed to submit report. Please try again later.'
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return 'Failed to submit report. Please try again later.'
}
