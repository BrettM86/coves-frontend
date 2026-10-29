import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CovesClient, NSID } from '$lib/api/coves/client'
import { XrpcError } from '$lib/api/coves/xrpc'
import type { DID } from '$lib/types/atproto'
import english from '$lib/app/state/i18n/en.json'

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
// The upload error-mapping tests swap in an English translator read from
// en.json; every other test keeps the key echo.
const translation = vi.hoisted(() => ({
  get: (key: string): string => key,
}))
vi.mock('$lib/app/state/i18n', () => ({
  t: { get: (key: string): string => translation.get(key) },
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

/** The English string at a dotted en.json key, or a marker naming the missing key. */
function englishAt(key: string): string {
  let node: unknown = english
  for (const part of key.split('.')) {
    node =
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined
  }
  return typeof node === 'string' ? node : `missing en.json key ${key}`
}

/** A real CovesClient whose fetch answers every request with one JSON error. */
function failingClient(status: number, body: unknown): CovesClient {
  const fetchFn = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch
  return new CovesClient({ fetchFn, baseUrl: 'https://api.coves.social' })
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (rejection: unknown) => rejection,
  )
}

const SIGN_IN_TO_UPLOAD = 'Sign in again to upload images'

describe('errorMessage for image upload and image post errors', () => {
  beforeEach(() => {
    translation.get = (key) => {
      const text = englishAt(key)
      return text.startsWith('missing en.json key') ? key : text
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    translation.get = (key) => key
  })

  it.each([
    ['RequestTimeout', 408, 'error.request_timeout'],
    ['ImageTooLarge', 413, 'error.image_too_large'],
    ['UnsupportedImageFormat', 400, 'error.unsupported_image_format'],
    ['ImageDimensionsTooLarge', 400, 'error.image_dimensions_too_large'],
    ['InvalidImage', 400, 'error.invalid_image'],
    ['UploadRateLimited', 429, 'error.upload_rate_limited'],
    ['PDSUploadFailed', 502, 'error.pds_upload_failed'],
    ['PayloadTooLarge', 413, 'error.payload_too_large'],
    ['SessionBusy', 503, 'error.session_busy'],
    ['ServiceUnavailable', 503, 'error.service_unavailable'],
    ['NoAuthorCredentials', 503, 'error.no_author_credentials'],
    ['Timeout', 504, 'error.timeout'],
    ['RequestCanceled', 400, 'error.request_canceled'],
  ])(
    'maps %s (%s) from uploadImage to the English text at its key',
    (name, status, key) => {
      expect(
        errorMessage(
          new XrpcError(
            status,
            name,
            `XRPC request failed with status ${status}`,
            undefined,
            NSID.uploadImage,
          ),
        ),
      ).toBe(englishAt(key))
    },
  )

  it.each([
    ['SessionBusy', 503, 'error.server_error'],
    ['ServiceUnavailable', 503, 'error.server_error'],
    ['Timeout', 504, 'error.server_error'],
    ['PayloadTooLarge', 413, 'error.unknown'],
    ['RequestCanceled', 400, 'error.unknown'],
    ['SessionBusy', 429, 'error.rate_limit_error'],
  ])(
    'gives %s (%s) from a non-upload call the generic message, not upload wording',
    (name, status, key) => {
      const message = errorMessage(
        new XrpcError(
          status,
          name,
          `XRPC request failed with status ${status}`,
          undefined,
          NSID.createVote,
        ),
      )
      expect(message).toBe(englishAt(key))
      expect(message.toLowerCase()).not.toMatch(/upload|image/)
    },
  )

  it.each([
    ['InvalidEmbed', 400, 'error.invalid_embed'],
    ['TooManyImages', 400, 'error.too_many_images'],
    ['InvalidImageFacet', 400, 'error.invalid_image_facet'],
    ['ContentEmpty', 400, 'error.content_empty'],
  ])('maps %s (%s) to the English text at its key', (name, status, key) => {
    expect(
      errorMessage(
        new XrpcError(
          status,
          name,
          `XRPC request failed with status ${status}`,
        ),
      ),
    ).toBe(englishAt(key))
  })

  it('says an UploadRateLimited 429 clears within ten minutes', () => {
    expect(
      errorMessage(
        new XrpcError(
          429,
          'UploadRateLimited',
          'Too many uploads',
          undefined,
          NSID.uploadImage,
        ),
      ),
    ).toContain('ten minutes')
  })

  it('says a RateLimitExceeded 429 is to be retried later, without ten minutes', () => {
    const message = errorMessage(
      new XrpcError(429, 'RateLimitExceeded', 'Rate limited'),
    )

    expect(message).toContain('later')
    expect(message).not.toContain('ten minutes')
  })

  it('asks the user to sign in again for a MissingBlobScope upload refusal', async () => {
    const error = await rejectionOf(
      failingClient(403, {
        error: 'MissingBlobScope',
        message: 'The session was not granted the blob scope',
      }).uploadImage(new Blob(['pixels']), 'image/png'),
    )

    const message = errorMessage(error)
    expect(message).toBe(englishAt('error.upload_sign_in_again'))
    expect(message).toContain(SIGN_IN_TO_UPLOAD)
  })

  it('asks the user to sign in again for PermissionDenied from an upload, not from createPost', async () => {
    const body = {
      error: 'PermissionDenied',
      message: 'Your PDS refused the request',
    }
    const uploadError = await rejectionOf(
      failingClient(403, body).uploadImage(new Blob(['pixels']), 'image/png'),
    )
    const createPostError = await rejectionOf(
      failingClient(403, body).createPost({
        community: 'did:plc:community' as DID,
        title: 'A post',
      }),
    )

    const uploadMessage = errorMessage(uploadError)
    expect(uploadMessage).toBe(englishAt('error.upload_sign_in_again'))
    expect(uploadMessage).toContain(SIGN_IN_TO_UPLOAD)
    expect(errorMessage(createPostError)).not.toContain(SIGN_IN_TO_UPLOAD)
  })
})
