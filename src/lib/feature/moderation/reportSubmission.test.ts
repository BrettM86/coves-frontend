import { describe, expect, it } from 'vitest'
import type { AtUri } from '$lib/api/coves/types'
import { MAX_REPORT_EXPLANATION_LENGTH } from '$lib/api/coves/types'
import { XrpcError } from '$lib/api/coves/xrpc'
import {
  buildReportInput,
  REPORT_REASONS,
  reportErrorMessage,
} from './reportSubmission'

const TARGET = 'at://did:plc:abc123/social.coves.community.post/xyz' as AtUri

describe('REPORT_REASONS', () => {
  it('matches the backend reason enum exactly', () => {
    expect(REPORT_REASONS.map((r) => r.value).sort()).toEqual(
      ['csam', 'doxing', 'harassment', 'illegal', 'other', 'spam'].sort(),
    )
  })

  it('has a label and description for every reason', () => {
    for (const reason of REPORT_REASONS) {
      expect(reason.label.length).toBeGreaterThan(0)
      expect(reason.description.length).toBeGreaterThan(0)
    }
  })
})

describe('buildReportInput', () => {
  it('builds a payload with targetUri and reason', () => {
    expect(buildReportInput(TARGET, 'spam')).toEqual({
      targetUri: TARGET,
      reason: 'spam',
    })
  })

  it('includes a trimmed explanation when provided', () => {
    expect(
      buildReportInput(TARGET, 'harassment', '  targeted abuse  '),
    ).toEqual({
      targetUri: TARGET,
      reason: 'harassment',
      explanation: 'targeted abuse',
    })
  })

  it('omits the explanation key entirely when empty', () => {
    expect(buildReportInput(TARGET, 'other', '')).not.toHaveProperty(
      'explanation',
    )
    expect(buildReportInput(TARGET, 'other', '   ')).not.toHaveProperty(
      'explanation',
    )
    expect(buildReportInput(TARGET, 'other', undefined)).not.toHaveProperty(
      'explanation',
    )
  })

  it('accepts an explanation at exactly the maximum length', () => {
    const max = 'x'.repeat(MAX_REPORT_EXPLANATION_LENGTH)
    expect(buildReportInput(TARGET, 'spam', max).explanation).toBe(max)
  })

  it('rejects an explanation over the maximum length', () => {
    const tooLong = 'x'.repeat(MAX_REPORT_EXPLANATION_LENGTH + 1)
    expect(() => buildReportInput(TARGET, 'spam', tooLong)).toThrow(
      /maximum length/,
    )
  })

  it('counts explanation length in characters, not UTF-16 code units', () => {
    // 1000 emoji = 1000 characters (2000 UTF-16 code units); the backend
    // counts runes, so this must be accepted.
    const emoji = '\u{1F600}'.repeat(MAX_REPORT_EXPLANATION_LENGTH)
    expect(buildReportInput(TARGET, 'spam', emoji).explanation).toBe(emoji)
  })

  it('rejects a target that is not an AT-URI', () => {
    expect(() =>
      buildReportInput('https://example.com/post/1' as AtUri, 'spam'),
    ).toThrow(/Invalid report target URI/)
  })
})

describe('reportErrorMessage', () => {
  it('maps 429 rate-limit errors to a friendly message', () => {
    const err = new XrpcError(
      429,
      'UnknownError',
      'XRPC request failed with status 429',
    )
    expect(reportErrorMessage(err)).toBe(
      'You are submitting reports too quickly. Please wait a minute and try again.',
    )
  })

  it('maps 401 errors to a login prompt', () => {
    const err = new XrpcError(401, 'AuthRequired', 'Authentication required')
    expect(reportErrorMessage(err)).toBe(
      'You must be logged in to submit a report.',
    )
  })

  it('passes through readable backend validation messages', () => {
    const err = new XrpcError(
      400,
      'ExplanationTooLong',
      'Explanation exceeds maximum length of 1000 characters',
    )
    expect(reportErrorMessage(err)).toBe(
      'Explanation exceeds maximum length of 1000 characters',
    )
  })

  it('falls back to a generic message for unparseable XRPC errors', () => {
    const err = new XrpcError(
      500,
      'UnknownError',
      'XRPC request failed with status 500',
    )
    expect(reportErrorMessage(err)).toBe(
      'Failed to submit report. Please try again later.',
    )
  })

  it('uses the message of plain Errors', () => {
    expect(reportErrorMessage(new Error('network down'))).toBe('network down')
  })

  it('falls back to a generic message for non-Error values', () => {
    expect(reportErrorMessage('boom')).toBe(
      'Failed to submit report. Please try again later.',
    )
    expect(reportErrorMessage(undefined)).toBe(
      'Failed to submit report. Please try again later.',
    )
  })
})
