import { describe, expect, it } from 'vitest'
import { XrpcError } from '$lib/api/coves/xrpc'
import { isExpiredSessionError } from './session-expired-error'

describe('isExpiredSessionError', () => {
  it('recognises a 401 XrpcError', () => {
    expect(
      isExpiredSessionError(new XrpcError(401, 'AuthRequired', 'expired')),
    ).toBe(true)
  })

  it('rejects other statuses and other error shapes', () => {
    expect(isExpiredSessionError(new XrpcError(403, 'Forbidden', 'nope'))).toBe(
      false,
    )
    expect(isExpiredSessionError(new Error('401'))).toBe(false)
    expect(isExpiredSessionError({ status: 401 })).toBe(false)
    expect(isExpiredSessionError(undefined)).toBe(false)
  })
})
