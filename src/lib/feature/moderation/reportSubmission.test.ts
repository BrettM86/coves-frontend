import { describe, expect, it } from 'vitest'
import type { AtUri } from '$lib/api/coves/types'
import { MAX_REPORT_EXPLANATION_LENGTH } from '$lib/api/coves/types'
import { XrpcError } from '$lib/api/coves/xrpc'
import en from '$lib/app/i18n/en.json'
import {
  buildReportInput,
  REPORT_REASONS,
  reportErrorMessage,
} from './reportSubmission'

const TARGET = 'at://did:plc:abc123/social.coves.community.post/xyz' as AtUri

// Resolves a dotted i18n key against the real en.json, so assertions can pin
// the English copy while proving every key exists in the catalog.
const t = (key: string): string => {
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      en,
    )
  if (typeof value !== 'string') {
    throw new Error(`Missing i18n key: ${key}`)
  }
  return value
}

describe('REPORT_REASONS', () => {
  it('matches the backend reason enum exactly', () => {
    expect([...REPORT_REASONS].sort()).toEqual(
      ['csam', 'doxing', 'harassment', 'illegal', 'other', 'spam'].sort(),
    )
  })

  it('has an i18n label and description for every reason', () => {
    for (const reason of REPORT_REASONS) {
      const entry = en.moderation.reportModal.reasons[reason]
      expect(entry, `missing i18n entry for reason "${reason}"`).toBeDefined()
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.description.length).toBeGreaterThan(0)
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

  it('trims before validating length, so max-length text wrapped in whitespace is accepted', () => {
    const max = 'x'.repeat(MAX_REPORT_EXPLANATION_LENGTH)
    expect(buildReportInput(TARGET, 'spam', `  ${max}  `).explanation).toBe(max)
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
    expect(reportErrorMessage(err, t)).toBe(
      'You are submitting reports too quickly. Please wait a minute and try again.',
    )
  })

  it('maps 401 errors to a login prompt', () => {
    const err = new XrpcError(401, 'AuthRequired', 'Authentication required')
    expect(reportErrorMessage(err, t)).toBe(
      'You must be logged in to submit a report.',
    )
  })

  it('passes through readable backend validation messages', () => {
    const err = new XrpcError(
      400,
      'ExplanationTooLong',
      'Explanation exceeds maximum length of 1000 characters',
    )
    expect(reportErrorMessage(err, t)).toBe(
      'Explanation exceeds maximum length of 1000 characters',
    )
  })

  it('warns about a possibly-submitted report when a 2xx body fails to parse', () => {
    // A 200 with an unparseable body means the report was likely recorded
    // server-side; the user must not be told to blindly resubmit.
    const err = new XrpcError(
      200,
      'ParseError',
      'Failed to parse response body: Unexpected token < in JSON',
    )
    expect(reportErrorMessage(err, t)).toBe(
      "Your report may have been submitted, but we couldn't confirm it. Please check before reporting again.",
    )
  })

  it('does not pass through technical ParseError messages on non-2xx statuses', () => {
    const err = new XrpcError(
      400,
      'ParseError',
      'Failed to parse response body: Unexpected token < in JSON',
    )
    expect(reportErrorMessage(err, t)).toBe(
      'Failed to submit report. Please try again later.',
    )
  })

  it('falls back to a generic message for a named error with an empty message', () => {
    const err = new XrpcError(400, 'InvalidRequest', '')
    expect(reportErrorMessage(err, t)).toBe(
      'Failed to submit report. Please try again later.',
    )
  })

  it('falls back to a generic message for unparseable XRPC errors', () => {
    const err = new XrpcError(
      500,
      'UnknownError',
      'XRPC request failed with status 500',
    )
    expect(reportErrorMessage(err, t)).toBe(
      'Failed to submit report. Please try again later.',
    )
  })

  it('uses the message of plain Errors', () => {
    expect(reportErrorMessage(new Error('network down'), t)).toBe(
      'network down',
    )
  })

  it('falls back to a generic message for non-Error values', () => {
    expect(reportErrorMessage('boom', t)).toBe(
      'Failed to submit report. Please try again later.',
    )
    expect(reportErrorMessage(undefined, t)).toBe(
      'Failed to submit report. Please try again later.',
    )
  })
})
