import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { XrpcError } from '$lib/api/coves'
import { log } from '$lib/app/util/log'
import { logNotificationFailure } from './log'

const url =
  'https://coves.example.invalid/xrpc/social.coves.notification.listNotifications?cursor=c2VjcmV0LWN1cnNvcg'
const cursor = 'c2VjcmV0LWN1cnNvcg'
const atUri = 'at://did:plc:secretauthor/social.coves.community.post/3kprivate'
const body = '{"text":"private reply body"}'

let error: MockInstance<typeof log.error>
let warn: MockInstance<typeof log.warn>

beforeEach(() => {
  error = vi.spyOn(log, 'error').mockImplementation(() => {})
  warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
})

/** Every log line, whichever level the helper chose. */
function logCalls() {
  return [...error.mock.calls, ...warn.mock.calls]
}

describe('logNotificationFailure', () => {
  it('logs only the NSID, status and error name of an XrpcError', () => {
    const failure = new XrpcError(
      400,
      'InvalidCursor',
      `Bad cursor ${cursor} for ${url} on ${atUri}: ${body}`,
    )
    failure.cause = new Error(`upstream ${url} ${cursor} ${atUri} ${body}`)

    logNotificationFailure(
      'social.coves.notification.listNotifications',
      failure,
    )

    const calls = logCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toStrictEqual([
      expect.any(String),
      undefined,
      {
        nsid: 'social.coves.notification.listNotifications',
        status: 400,
        errorName: 'InvalidCursor',
      },
    ])
    const [message] = calls[0]
    for (const secret of [
      'coves.example.invalid',
      cursor,
      'did:plc:secretauthor',
      'private reply body',
    ]) {
      expect(message).not.toContain(secret)
    }
  })

  it('logs only the NSID and a fixed kind for a non-XRPC error', () => {
    logNotificationFailure(
      'social.coves.notification.getPreferences',
      new TypeError(`Failed to fetch ${url}`),
    )

    const calls = logCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toStrictEqual([
      expect.any(String),
      undefined,
      { nsid: 'social.coves.notification.getPreferences', kind: 'non-xrpc' },
    ])
    const [message] = calls[0]
    for (const secret of ['coves.example.invalid', cursor]) {
      expect(message).not.toContain(secret)
    }
  })
})
