import type { RequestEvent } from '@sveltejs/kit'
import type { LogFields } from './index'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mutable so a single test can flip to browser mode. A getter (rather than a
// literal) is what lets the value change after the mock factory has run.
let mockBrowser = false

vi.mock('$app/environment', () => ({
  get browser() {
    return mockBrowser
  },
  dev: false,
  building: false,
  version: 'test',
}))

/**
 * Both modules hold singletons — the stack policy and the request-event
 * accessor — so every test loads its own module graph. Importing them in the
 * same test after `vi.resetModules()` keeps them on the SAME graph, which is
 * what makes an installed accessor visible to the logger.
 */
const freshLog = async (): Promise<typeof import('./index')> =>
  import('./index')

const freshRequestEvent = async (): Promise<
  typeof import('$lib/app/util/request-event')
> => import('$lib/app/util/request-event')

/**
 * Asserts a console spy took exactly one call carrying exactly one string
 * argument, and returns it raw and parsed. Leak assertions must run against
 * the RAW text: a secret hiding in a key name or an unexpected field still
 * ships to the log sink.
 */
function soleLine(calls: unknown[][]): {
  raw: string
  line: Record<string, unknown>
} {
  expect(calls.length).toBe(1)
  expect(calls[0]?.length).toBe(1)
  const raw = calls[0]?.[0]
  expect(typeof raw).toBe('string')
  // Assert JSON shape before parsing so a plain-text line fails with a
  // readable diff rather than an opaque SyntaxError.
  expect(raw as string).toMatch(/^\{[\s\S]*\}$/)
  return {
    raw: raw as string,
    line: JSON.parse(raw as string) as Record<string, unknown>,
  }
}

/** Narrows a nested member of a parsed line to an object. */
function objectAt(
  line: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = line[key]
  expect(value).toBeTypeOf('object')
  expect(value).not.toBeNull()
  return value as Record<string, unknown>
}

const spyOnError = () => vi.spyOn(console, 'error').mockImplementation(() => {})
const spyOnWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {})

const eventFor = (url: string, requestId: string, method = 'GET') =>
  ({
    locals: { requestId },
    request: { method },
    url: new URL(url),
  }) as unknown as RequestEvent

// vitest's restoreMocks detaches the spies after each test; resetModules gives
// the next test a logger with no policy and no accessor installed.
beforeEach(() => {
  vi.resetModules()
  mockBrowser = false
})

describe('log on the server', () => {
  it('writes one JSON line to console.error with a scrubbed error', async () => {
    const errorSpy = spyOnError()
    const { log } = await freshLog()

    log.error('msg', new Error('token=abc'))

    const { raw, line } = soleLine(errorSpy.mock.calls)
    expect(line.level).toBe('error')
    expect(line.msg).toBe('msg')
    expect(typeof line.ts).toBe('string')
    expect(Number.isNaN(Date.parse(line.ts as string))).toBe(false)

    const err = objectAt(line, 'err')
    expect(err.message).toContain('[REDACTED]')
    expect(raw).not.toContain('abc')
  })

  it('sends warn to console.warn at level warn', async () => {
    const errorSpy = spyOnError()
    const warnSpy = spyOnWarn()
    const { log } = await freshLog()

    log.warn('careful')

    expect(errorSpy).not.toHaveBeenCalled()
    const { line } = soleLine(warnSpy.mock.calls)
    expect(line.level).toBe('warn')
    expect(line.msg).toBe('careful')
  })

  it('scrubs the message itself, not only the error', async () => {
    const errorSpy = spyOnError()
    const { log } = await freshLog()

    log.error('password=hunter2')

    const { raw, line } = soleLine(errorSpy.mock.calls)
    expect(line.msg).toContain('[REDACTED]')
    expect(raw).not.toContain('hunter2')
  })
})

describe('log request context', () => {
  it('takes requestId, method and path from the installed accessor', async () => {
    const errorSpy = spyOnError()
    const { installRequestEventAccessor } = await freshRequestEvent()
    const { log } = await freshLog()
    installRequestEventAccessor(() => eventFor('http://x/p?token=q', 'r1'))

    log.error('msg')

    const { raw, line } = soleLine(errorSpy.mock.calls)
    expect(line.requestId).toBe('r1')
    expect(line.method).toBe('GET')
    // The path only — a query string is where tokens live.
    expect(line.path).toBe('/p')
    expect(raw).not.toContain('token=q')
  })

  it('omits the context keys entirely when no accessor is installed', async () => {
    const errorSpy = spyOnError()
    const { log } = await freshLog()

    log.error('msg')

    const { line } = soleLine(errorSpy.mock.calls)
    expect('requestId' in line).toBe(false)
    expect('method' in line).toBe(false)
    expect('path' in line).toBe(false)
  })

  it('omits requestId when the event carries an empty one', async () => {
    const errorSpy = spyOnError()
    const { installRequestEventAccessor } = await freshRequestEvent()
    const { log } = await freshLog()
    installRequestEventAccessor(() => eventFor('http://x/p', ''))

    log.error('msg')

    const { line } = soleLine(errorSpy.mock.calls)
    expect('requestId' in line).toBe(false)
  })
})

describe('log fields', () => {
  it('keeps primitives, scrubs strings and describes objects by key name', async () => {
    const errorSpy = spyOnError()
    const { log } = await freshLog()

    log.error('msg', undefined, {
      did: 'did:plc:1',
      n: 2,
      ok: true,
      secret: 'password=hunter2',
      obj: { token: 'z', a: 1 },
      gone: undefined,
    })

    const { raw, line } = soleLine(errorSpy.mock.calls)
    const fields = objectAt(line, 'fields')
    expect(fields.did).toBe('did:plc:1')
    expect(fields.n).toBe(2)
    expect(fields.ok).toBe(true)
    expect(fields.secret).toContain('[REDACTED]')
    expect(raw).not.toContain('hunter2')
    // Key NAMES say what was carried; values are what leaks.
    expect(fields.obj).toBeTypeOf('string')
    expect(fields.obj as string).toContain('a, token')
    expect(raw).not.toContain('"z"')
    expect('gone' in fields).toBe(false)
  })

  it('omits the fields key when no fields are passed', async () => {
    const errorSpy = spyOnError()
    const { log } = await freshLog()

    log.error('msg')

    const { line } = soleLine(errorSpy.mock.calls)
    expect('fields' in line).toBe(false)
  })

  it('survives a throwing getter on the fields object', async () => {
    const errorSpy = spyOnError()
    const { log } = await freshLog()

    expect(() => {
      log.error('msg', undefined, {
        safe: 'kept',
        get hostile(): never {
          throw new Error('boom')
        },
      })
    }).not.toThrow()

    const { line } = soleLine(errorSpy.mock.calls)
    const fields = objectAt(line, 'fields')
    expect(fields.safe).toBe('kept')
    // Marked, not dropped: a silently missing key reads as "the caller never
    // passed it", which sends whoever is debugging down the wrong path.
    expect(fields.hostile).toBe('[unserializable]')
  })

  it('marks the whole fields bag when its keys cannot be listed', async () => {
    const errorSpy = spyOnError()
    const { log } = await freshLog()
    const hostile = new Proxy(
      { a: 1 },
      {
        ownKeys(): never {
          throw new Error('no keys for you')
        },
      },
    )

    expect(() => {
      log.error('msg', undefined, hostile as LogFields)
    }).not.toThrow()

    const { line } = soleLine(errorSpy.mock.calls)
    expect(line.msg).toBe('msg')
    expect(line.fields).toBe('[unserializable]')
  })

  it('cannot forge envelope keys from fields', async () => {
    const errorSpy = spyOnError()
    const { log } = await freshLog()

    log.error('m', new Error('real'), {
      ts: 'x',
      level: 'fake',
      msg: 'y',
      err: 'z',
      requestId: 'spoof',
    })

    const { line } = soleLine(errorSpy.mock.calls)
    expect(line.level).toBe('error')
    expect(line.msg).toBe('m')
    expect(line.ts).not.toBe('x')
    expect(typeof line.ts).toBe('string')
    expect(objectAt(line, 'err').message).toContain('real')
    expect('requestId' in line).toBe(false)

    const fields = objectAt(line, 'fields')
    expect(fields.ts).toBe('x')
    expect(fields.level).toBe('fake')
    expect(fields.msg).toBe('y')
    expect(fields.err).toBe('z')
    expect(fields.requestId).toBe('spoof')
  })
})

describe('log non-Error throwables', () => {
  it('describes a plain object by tag and key names without dumping values', async () => {
    const errorSpy = spyOnError()
    const { log } = await freshLog()

    log.error('m', { password: 'hunter2', marker: 'X' })

    const { raw, line } = soleLine(errorSpy.mock.calls)
    expect(objectAt(line, 'err').message).toContain('marker, password')
    expect(raw).not.toContain('hunter2')
    expect(raw).not.toContain('X')
  })

  it('serializes an explicit null err rather than dropping it', async () => {
    const errorSpy = spyOnError()
    const { log } = await freshLog()

    log.error('m', null)

    const { line } = soleLine(errorSpy.mock.calls)
    expect('err' in line).toBe(true)
  })

  it('omits err when it is undefined', async () => {
    const errorSpy = spyOnError()
    const { log } = await freshLog()

    log.error('m', undefined)

    const { line } = soleLine(errorSpy.mock.calls)
    expect('err' in line).toBe(false)
  })
})

describe('log stack policy', () => {
  it('includes a scrubbed stack by default', async () => {
    const errorSpy = spyOnError()
    const { log } = await freshLog()

    log.error('m', new Error('secret=s3'))

    const { raw, line } = soleLine(errorSpy.mock.calls)
    expect(objectAt(line, 'err').stack).toBeTypeOf('string')
    expect(raw).not.toContain('s3')
  })

  it('drops the stack when the installed policy says so', async () => {
    const errorSpy = spyOnError()
    const { log, installServerLogPolicy } = await freshLog()
    installServerLogPolicy({ includeStack: () => false })

    log.error('m', new Error('boom'))

    const { line } = soleLine(errorSpy.mock.calls)
    expect('stack' in objectAt(line, 'err')).toBe(false)
  })

  it('scrubs the cause chain', async () => {
    const errorSpy = spyOnError()
    const { log } = await freshLog()

    log.error(
      'm',
      new TypeError('fetch failed', { cause: new Error('token=abc') }),
    )

    const { raw, line } = soleLine(errorSpy.mock.calls)
    const cause = objectAt(objectAt(line, 'err'), 'cause')
    expect(cause.message).toContain('[REDACTED]')
    expect(raw).not.toContain('abc')
  })
})

describe('log in the browser', () => {
  it('passes msg, err and fields as separate console arguments', async () => {
    mockBrowser = true
    const errorSpy = spyOnError()
    const { log } = await freshLog()
    const err = new Error('token=abc')
    const fields = { did: 'did:plc:1' }

    log.error('msg', err, fields)

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const call = errorSpy.mock.calls[0] ?? []
    expect(call.length).toBe(3)
    expect(call[0]).toBe('msg')
    expect(call[0]).not.toMatch(/^\{/)
    // Deliberate: the browser gets the SAME Error object, unscrubbed, so
    // devtools can expand it and the stack stays clickable. Nothing here is
    // shipped to a log sink, and the user already holds their own secrets.
    expect(call[1]).toBe(err)
    expect(call[2]).toBe(fields)
  })

  it('passes only the message when there is no err or fields', async () => {
    mockBrowser = true
    const errorSpy = spyOnError()
    const { log } = await freshLog()

    log.error('msg')

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0]?.length).toBe(1)
    expect(errorSpy.mock.calls[0]?.[0]).toBe('msg')
  })
})

describe('log field rendering hostility', () => {
  it("never renders a function's source text", async () => {
    const errorSpy = spyOnError()
    const { log } = await freshLog()

    log.error('msg', undefined, { cb: () => 'password=hunter2' })

    const { raw, line } = soleLine(errorSpy.mock.calls)
    const fields = objectAt(line, 'fields')
    // A closure's source is the leak: String(fn) prints the body verbatim,
    // secrets and all, and no amount of value-scrubbing sees inside it.
    expect(String(fields.cb)).not.toContain('=>')
    expect(raw).not.toContain('hunter2')
  })

  it('does not leak a symbol description', async () => {
    const errorSpy = spyOnError()
    const { log } = await freshLog()

    // LogFields does not admit a symbol, but the type is only a promise: an
    // untyped caller, a widened `unknown`, or a plain .js module can still
    // hand one over, and the renderer has to hold.
    log.error('msg', undefined, {
      s: Symbol('token=abc'),
    } as unknown as LogFields)

    const { raw } = soleLine(errorSpy.mock.calls)
    expect(raw).not.toContain('abc')
  })

  it('scrubs secrets hiding in a nested object KEY name', async () => {
    const errorSpy = spyOnError()
    const { log } = await freshLog()

    log.error('msg', undefined, { cache: { 'token=abc': 1 } })

    const { raw } = soleLine(errorSpy.mock.calls)
    // Key names are printed by describeObject, so a key is as much a channel
    // for a secret as a value is.
    expect(raw).not.toContain('abc')
  })

  it('caps a pathologically wide object so one line stays shippable', async () => {
    const errorSpy = spyOnError()
    const { log } = await freshLog()
    const big = Object.fromEntries(
      Array.from({ length: 10000 }, (_, i) => [`k${i}`, 1]),
    )

    log.error('msg', undefined, { big })

    const { raw, line } = soleLine(errorSpy.mock.calls)
    // A shipper splits or drops an oversized line, which loses the record
    // entirely — worse than a truncated one.
    expect(raw.length).toBeLessThan(20000)
    const fields = objectAt(line, 'fields')
    expect(fields.big).toBeTypeOf('string')
    expect(fields.big as string).toContain('[truncated]')
  })
})

describe('log key-aware field redaction', () => {
  it('redacts a value whose KEY names a credential', async () => {
    const errorSpy = spyOnError()
    const { log } = await freshLog()

    log.error('msg', undefined, {
      authToken: 'abc123',
      password: 'hunter2',
      refresh_token: 'r1',
      sessionCookie: 'c1',
      safe: 'kept',
    })

    const { raw, line } = soleLine(errorSpy.mock.calls)
    const fields = objectAt(line, 'fields')
    // Value-shaped scrubbing only fires on `key=value` TEXT. A bare credential
    // sitting alone in a field looks like ordinary data, so the field NAME has
    // to be what condemns it — same vocabulary as scrub.ts SECRET_KEYS, matched
    // case-insensitively with the asymmetric boundary from keyBoundary().
    expect(fields.authToken).toBe('[REDACTED]')
    expect(fields.password).toBe('[REDACTED]')
    expect(fields.refresh_token).toBe('[REDACTED]')
    expect(fields.sessionCookie).toBe('[REDACTED]')
    expect(fields.safe).toBe('kept')
    expect(raw).not.toContain('abc123')
    expect(raw).not.toContain('hunter2')
  })

  it('redacts a header-named field regardless of casing', async () => {
    const errorSpy = spyOnError()
    const { log } = await freshLog()

    log.error('msg', undefined, { Authorization: 'Bearer abc123' })

    const { raw, line } = soleLine(errorSpy.mock.calls)
    expect(objectAt(line, 'fields').Authorization).toBe('[REDACTED]')
    expect(raw).not.toContain('abc123')
  })
})

describe('emit context precedence', () => {
  it('lets an explicit ctx override the ambient request event', async () => {
    const errorSpy = spyOnError()
    const { installRequestEventAccessor } = await freshRequestEvent()
    const { emit } = await freshLog()
    installRequestEventAccessor(() => eventFor('http://x/ambient', 'ambient'))

    emit('error', 'm', {
      ctx: { requestId: 'explicit', path: '/p?token=q' },
    })

    const { raw, line } = soleLine(errorSpy.mock.calls)
    // A caller holding the context in hand knows better than the accessor.
    expect(line.requestId).toBe('explicit')
    expect(line.path).toContain('[REDACTED]')
    expect(raw).not.toContain('token=q')
  })
})

describe('log ambient context typing', () => {
  it('drops non-string ambient values rather than casting them', async () => {
    const errorSpy = spyOnError()
    const { installRequestEventAccessor } = await freshRequestEvent()
    const { log } = await freshLog()
    installRequestEventAccessor(
      () =>
        ({
          locals: { requestId: 42 },
          request: { method: undefined },
          url: new URL('http://x/p'),
        }) as unknown as RequestEvent,
    )

    log.error('msg')

    const { line } = soleLine(errorSpy.mock.calls)
    // A number in `requestId` is a broken producer, not a correlation id; the
    // declared type says string, so anything else is dropped, not coerced.
    expect('requestId' in line).toBe(false)
    expect('method' in line).toBe(false)
    expect(line.path).toBe('/p')
  })
})

describe('log in the browser, continued', () => {
  it('omits the err slot entirely when only fields are passed', async () => {
    mockBrowser = true
    const errorSpy = spyOnError()
    const { log } = await freshLog()
    const fields = { a: 1 }

    log.error('m', undefined, fields)

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const call = errorSpy.mock.calls[0] ?? []
    expect(call.length).toBe(2)
    expect(call[0]).toBe('m')
    expect(call[1]).toBe(fields)
  })

  it('routes warn to console.warn in the browser too', async () => {
    mockBrowser = true
    const errorSpy = spyOnError()
    const warnSpy = spyOnWarn()
    const { log } = await freshLog()

    log.warn('m')

    expect(errorSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toBe('m')
  })
})
