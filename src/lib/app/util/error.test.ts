import { beforeEach, describe, expect, it, vi } from 'vitest'
import { XrpcError } from '$lib/api/coves/xrpc'

// SSR: the server bundle is where structured JSON logging must happen.
vi.mock('$app/environment', () => ({
  browser: false,
  dev: false,
  building: false,
  version: 'test',
}))

// Under vitest no translations are loaded, so the real `t.get` returns '' and
// warns. Echoing the key back matches the "no translation exists" branch that
// errorMessage() is written against.
vi.mock('$lib/app/state/i18n', () => ({
  t: { get: (key: string): string => key },
}))

const { errorMessage } = await import('./error')

/**
 * An input whose formatting throws: `error?.message` at error.ts:33 detonates,
 * which is the only route into the catch at error.ts:51. The secret rides in
 * the thrown Error's message, so it reaches the logger the same way a real
 * upstream failure would.
 */
const throwingInput = (): unknown => ({
  get message(): never {
    throw new Error('boom password=hunter2')
  },
})

/** Inferring the spy type off this helper is what hooks.server.test.ts does. */
const spyOnError = () => vi.spyOn(console, 'error').mockImplementation(() => {})

describe('errorMessage on the server', () => {
  let errorSpy: ReturnType<typeof spyOnError>

  beforeEach(() => {
    // restoreMocks detaches both after each test.
    errorSpy = spyOnError()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('logs one scrubbed JSON line when formatting the error throws', () => {
    const returned = errorMessage(throwingInput())

    expect(errorSpy).toHaveBeenCalledTimes(1)
    // Deliberately assert on the ARITY as a number and never hand the call
    // array to expect(): the argument today is an object carrying the
    // throwing getter, and vitest's diff printer would detonate it and
    // replace the assertion failure with an opaque "boom" stack.
    const call = errorSpy.mock.calls[0] ?? []
    expect(call.length).toBe(1)

    const raw = call[0]
    expect(typeof raw).toBe('string')
    // Assert JSON shape before parsing so a plain-text log line fails with a
    // readable diff rather than an opaque SyntaxError.
    expect(raw).toMatch(/^\{[\s\S]*\}$/)
    const line: unknown = JSON.parse(raw as string)
    expect(line).toBeTypeOf('object')
    expect((line as Record<string, unknown>).level).toBe('error')

    // The secret must be gone from the RAW text, not merely from some parsed
    // field — a leak anywhere in the line still ships to the log sink.
    expect(raw as string).toContain('[REDACTED]')
    expect(raw as string).not.toContain('hunter2')

    // Callers render this straight into toasts and error pages.
    expect(typeof returned).toBe('string')
    expect(returned.length).toBeGreaterThan(0)
  })

  it('returns the message and logs nothing for an ordinary Error', () => {
    expect(errorMessage(new Error('nope'))).toBe('nope')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('uses a known XRPC error name before its generic transport message', () => {
    expect(
      errorMessage(
        new XrpcError(
          404,
          'PostNotFound',
          'XRPC request failed with status 404',
        ),
      ),
    ).toBe('error.couldnt_find_post')
  })

  it('recognizes a rate limit by its XRPC error name', () => {
    expect(
      errorMessage(new XrpcError(400, 'RateLimitExceeded', 'Request rejected')),
    ).toBe('error.rate_limit_error')
  })

  it('recognizes HTTP 429 even when the upstream omits its error name', () => {
    expect(
      errorMessage(new XrpcError(429, 'UnknownError', 'Too Many Requests')),
    ).toBe('error.rate_limit_error')
  })

  it.each([500, 502, 503, 504])(
    'gives readable feedback for HTTP %s',
    (status) => {
      expect(
        errorMessage(
          new XrpcError(
            status,
            'UnknownError',
            `XRPC request failed with status ${status}`,
          ),
        ),
      ).toBe('error.server_error')
    },
  )

  it.each([
    'Failed to fetch',
    'fetch failed',
    'NetworkError when attempting to fetch resource.',
    'Load failed',
  ])('explains an unreachable backend for %s', (message) => {
    expect(errorMessage(new TypeError(message))).toBe(
      'error.backend_unreachable',
    )
  })

  it('preserves an actionable message for an unknown validation error', () => {
    expect(
      errorMessage(
        new XrpcError(400, 'InvalidRequest', 'A post title is required.'),
      ),
    ).toBe('A post title is required.')
  })
})
