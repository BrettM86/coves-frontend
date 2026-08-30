import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Variable to control dev mode (default false: production behaviour)
let mockDev = false

// Variable to control the mocked LOG_STACKS private env var
let mockLogStacks: string | undefined = undefined

// Mock $app/environment
vi.mock('$app/environment', () => ({
  get dev() {
    return mockDev
  },
  browser: false,
  building: false,
  version: 'test',
}))

// Mock private environment variables
vi.mock('$env/dynamic/private', () => ({
  env: {
    get LOG_STACKS() {
      return mockLogStacks
    },
  },
}))

// Import after mocking so the module under test sees the mocked env
const { log, scrub } = await import('./log')

const TRUNCATED = '\u2026[truncated]'

/** Spies on both console channels; recreated per test so calls never leak. */
function spyOnConsole() {
  return {
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  }
}

/**
 * Asserts a spy received exactly one call with exactly one string argument,
 * and returns both the raw string (for leak assertions) and its parsed form.
 */
function singleLine(calls: unknown[][]): {
  raw: string
  line: Record<string, unknown>
} {
  expect(calls).toHaveLength(1)
  expect(calls[0]).toHaveLength(1)
  const raw = calls[0][0]
  expect(typeof raw).toBe('string')
  return {
    raw: raw as string,
    line: JSON.parse(raw as string) as Record<string, unknown>,
  }
}

/** Narrows the `err` member of a parsed line to an object. */
function errOf(line: Record<string, unknown>): Record<string, unknown> {
  expect(line.err).toBeTypeOf('object')
  expect(line.err).not.toBeNull()
  return line.err as Record<string, unknown>
}

describe('scrub', () => {
  it('redacts a Bearer token but keeps the scheme', () => {
    expect(scrub('authorization: Bearer abc.def.ghi')).toBe(
      'authorization: Bearer [REDACTED]',
    )
  })

  it('matches the Bearer scheme case-insensitively', () => {
    expect(scrub('sent bearer eyJhbGciOi.payload.sig to upstream')).toBe(
      'sent bearer [REDACTED] to upstream',
    )
  })

  it('redacts password= values, case-insensitively, keeping the key', () => {
    expect(scrub('postgres connect password=hunter2 failed')).toBe(
      'postgres connect password=[REDACTED] failed',
    )
    expect(scrub('PASSWORD=hunter2')).toBe('PASSWORD=[REDACTED]')
  })

  it('redacts "password: value" and stops the value at a comma', () => {
    expect(scrub('{ password: hunter2, host: db }')).toBe(
      '{ password: [REDACTED], host: db }',
    )
  })

  it('redacts the JSON "password":"value" form, keeping the quotes', () => {
    expect(scrub('{"user":"mari","password":"hunter2"}')).toBe(
      '{"user":"mari","password":"[REDACTED]"}',
    )
  })

  it('redacts api key values in snake, camel and kebab spellings', () => {
    expect(scrub('api_key=sk-live-1234')).toBe('api_key=[REDACTED]')
    expect(scrub('apiKey: sk-live-1234')).toBe('apiKey: [REDACTED]')
    expect(scrub('api-key=sk-live-1234')).toBe('api-key=[REDACTED]')
  })

  it('redacts cookie header values in both spellings', () => {
    expect(scrub('cookie=opaquevalue123')).toBe('cookie=[REDACTED]')
    expect(scrub('Cookie: opaquevalue123')).toBe('Cookie: [REDACTED]')
  })

  it('redacts coves_session and stops the value at a semicolon', () => {
    expect(scrub('coves_session=SEALED123; Path=/; HttpOnly')).toBe(
      'coves_session=[REDACTED]; Path=/; HttpOnly',
    )
  })

  it('redacts kelp_pending_auth values', () => {
    expect(scrub('set kelp_pending_auth=PENDING456 on response')).toBe(
      'set kelp_pending_auth=[REDACTED] on response',
    )
  })

  it('redacts OAuth code/state query params while keeping other params', () => {
    expect(
      scrub(
        'GET https://coves.social/callback?code=AUTHCODE&state=STATEVAL&page=2',
      ),
    ).toBe(
      'GET https://coves.social/callback?code=[REDACTED]&state=[REDACTED]&page=2',
    )
  })

  it('redacts token, access_token and refresh_token query params', () => {
    expect(
      scrub(
        'https://pds.example.com/x?token=T1&access_token=T2&refresh_token=T3',
      ),
    ).toBe(
      'https://pds.example.com/x?token=[REDACTED]&access_token=[REDACTED]&refresh_token=[REDACTED]',
    )
  })

  it('redacts the sealedToken query param', () => {
    expect(scrub('/api/auth/callback?sealedToken=SEALED123&next=/feed')).toBe(
      '/api/auth/callback?sealedToken=[REDACTED]&next=/feed',
    )
  })

  it('redacts a value that runs to the end of the string', () => {
    expect(scrub('db failure, password=hunter2')).toBe(
      'db failure, password=[REDACTED]',
    )
  })

  it('does not throw on a Bearer scheme with no token', () => {
    expect(() => scrub('authorization: Bearer')).not.toThrow()
    expect(typeof scrub('authorization: Bearer')).toBe('string')
  })

  it('redacts every secret in a string containing several', () => {
    const scrubbed = scrub(
      'password=hunter2 Bearer abc.def.ghi coves_session=SEALED123 password=hunter2',
    )
    expect(scrubbed).not.toContain('hunter2')
    expect(scrubbed).not.toContain('abc.def.ghi')
    expect(scrubbed).not.toContain('SEALED123')
    expect(scrubbed).toBe(
      'password=[REDACTED] Bearer [REDACTED] coves_session=[REDACTED] password=[REDACTED]',
    )
  })

  it('is idempotent', () => {
    const input =
      'password=hunter2 Bearer abc.def.ghi ?code=AUTHCODE&state=STATEVAL coves_session=SEALED123'
    const once = scrub(input)
    expect(scrub(once)).toBe(once)
  })

  it('leaves secret-adjacent prose untouched', () => {
    const prose = [
      'the user forgot password',
      'reset-password page rendered',
      'decoded the state machine',
      'token bucket refilled',
    ]
    for (const text of prose) {
      expect(scrub(text)).toBe(text)
    }
  })

  it('returns an empty string unchanged', () => {
    expect(scrub('')).toBe('')
  })

  it('returns text with no secrets unchanged', () => {
    const text = 'GET /c/gardening 200 in 12ms (user did:plc:abc123)'
    expect(scrub(text)).toBe(text)
  })

  // ---- F1: review-fix coverage ----

  it('redacts an authorization credential whatever the scheme', () => {
    // The scheme word itself may or may not survive; what matters is that the
    // credential is gone and the key stays readable.
    const cases = [
      ['Authorization: Basic BASICCRED123', 'BASICCRED123', 'Authorization'],
      ['authorization: DPoP DPOPCRED456', 'DPOPCRED456', 'authorization'],
      ['authorization=EQCRED789', 'EQCRED789', 'authorization'],
      ['{"authorization":"JSONCRED012"}', 'JSONCRED012', 'authorization'],
    ] as const

    for (const [text, credential, key] of cases) {
      const scrubbed = scrub(text)
      expect(scrubbed).not.toContain(credential)
      expect(scrubbed).toContain(key)
      expect(scrubbed).toContain('[REDACTED]')
    }
  })

  it('redacts client_secret, secret, dpop and dpop_nonce in every form', () => {
    const keys = ['client_secret', 'secret', 'dpop', 'dpop_nonce'] as const

    for (const key of keys) {
      for (const text of [
        `${key}=SECRETVALUE9`,
        `${key}: SECRETVALUE9`,
        `{"${key}":"SECRETVALUE9"}`,
      ]) {
        const scrubbed = scrub(text)
        expect(scrubbed).not.toContain('SECRETVALUE9')
        expect(scrubbed).toContain('[REDACTED]')
      }
    }
  })

  it('redacts token-bearing keys in every form', () => {
    const keys = [
      'access_token',
      'refresh_token',
      'sealedToken',
      'token',
      'accessToken',
      'refreshToken',
    ] as const

    for (const key of keys) {
      for (const text of [
        `${key}=TOKVALUE9`,
        `${key}: TOKVALUE9`,
        `{"${key}":"TOKVALUE9"}`,
      ]) {
        const scrubbed = scrub(text)
        expect(scrubbed).not.toContain('TOKVALUE9')
        expect(scrubbed).toContain(key)
        expect(scrubbed).toContain('[REDACTED]')
      }
    }
  })

  it('redacts both a token and a state in one JSON payload', () => {
    const scrubbed = scrub('{"access_token":"S3CRETTOK","state":"STV"}')

    expect(scrubbed).not.toContain('S3CRETTOK')
    expect(scrubbed).not.toContain('"STV"')
    expect(scrubbed).toContain('access_token')
    expect(scrubbed).toContain('state')
  })

  it('redacts code and state in URL and JSON contexts', () => {
    expect(scrub('/cb?code=AUTHCODE&state=STATEVAL')).toBe(
      '/cb?code=[REDACTED]&state=[REDACTED]',
    )
    expect(scrub('{"code":"AUTHCODE","state":"STATEVAL"}')).toBe(
      '{"code":"[REDACTED]","state":"[REDACTED]"}',
    )
  })

  it('leaves code and state alone outside URL and JSON contexts', () => {
    // `code=` and `state=` are ordinary words in diagnostics; redacting them
    // there destroys the only useful part of the line.
    const prose = [
      'exit code=1',
      'upstream returned status code=503',
      'state=ready',
      'state: ready',
      'decoded the state machine',
    ]

    for (const text of prose) {
      expect(scrub(text)).toBe(text)
    }
  })

  it('redacts a quoted value that contains spaces', () => {
    expect(scrub('{"password":"my secret phrase"}')).toBe(
      '{"password":"[REDACTED]"}',
    )
    expect(scrub('password="hunter two"')).toBe('password="[REDACTED]"')
    expect(scrub("password='hunter two'")).toBe("password='[REDACTED]'")
  })

  it('still stops an unquoted value at whitespace', () => {
    expect(scrub('password=hunter2 and then some')).toBe(
      'password=[REDACTED] and then some',
    )
  })

  it('redacts a cookie header through to the end of the line', () => {
    expect(scrub('Cookie: a=b; c=d')).toBe('Cookie: [REDACTED]')
    expect(scrub('set-cookie: coves_session=X; Path=/; HttpOnly')).toBe(
      'set-cookie: [REDACTED]',
    )
    expect(scrub('Cookie: a=b; c=d\nnext line kept')).toBe(
      'Cookie: [REDACTED]\nnext line kept',
    )
  })

  it('keeps cookie attributes when the key is not a header', () => {
    expect(scrub('coves_session=SEALED123; Path=/')).toBe(
      'coves_session=[REDACTED]; Path=/',
    )
  })

  it('redacts values inside escaped JSON, keeping the escaping intact', () => {
    expect(scrub('{\\"password\\":\\"hunter2\\"}')).toBe(
      '{\\"password\\":\\"[REDACTED]\\"}',
    )
    expect(scrub('{\\"access_token\\":\\"T0KENVAL\\"}')).toBe(
      '{\\"access_token\\":\\"[REDACTED]\\"}',
    )
  })

  it('redacts a value behind a URL-encoded separator', () => {
    expect(scrub('password%3Dhunter2')).toBe('password%3D[REDACTED]')
    expect(scrub('password%3dhunter2')).toBe('password%3d[REDACTED]')

    const scrubbed = scrub('access_token%3Dabc123&next=/x')
    expect(scrubbed).not.toContain('abc123')
    expect(scrubbed).toContain('access_token')
    expect(scrubbed).toContain('next=/x')
  })

  it('is idempotent over the extended forms', () => {
    const input =
      'Authorization: Basic BASICCRED123 client_secret=CS1 {"access_token":"T0KENVAL"} password%3Dhunter2'
    const once = scrub(input)

    expect(scrub(once)).toBe(once)
  })

  // ---- Compound keys: a word boundary does not fire at `_`, so an
  // underscore-joined key slipped past the alternation entirely. ----

  it('redacts an underscore-joined compound key', () => {
    const cases = [
      ['DB_PASSWORD=hunter2', 'DB_PASSWORD=[REDACTED]'],
      ['JWT_SECRET=hunter2', 'JWT_SECRET=[REDACTED]'],
      ['SESSION_TOKEN=abc123', 'SESSION_TOKEN=[REDACTED]'],
      ['user_access_token=TOK1', 'user_access_token=[REDACTED]'],
      ['provider_refresh_token=TOK2', 'provider_refresh_token=[REDACTED]'],
      ['oauth_client_secret=CS1', 'oauth_client_secret=[REDACTED]'],
      ['github_api_key=sk-1', 'github_api_key=[REDACTED]'],
      ['STRIPE_SECRET_KEY=sk_live_1', 'STRIPE_SECRET_KEY=[REDACTED]'],
      ['AWS_SECRET_ACCESS_KEY=AKIA123', 'AWS_SECRET_ACCESS_KEY=[REDACTED]'],
      // No separator at all: the key name is simply prefixed.
      ['mypassword=hunter2', 'mypassword=[REDACTED]'],
    ] as const

    for (const [input, expected] of cases) {
      expect(scrub(input)).toBe(expected)
    }
  })

  it('redacts compound keys in JSON form', () => {
    expect(scrub('{"db_password":"hunter2","user_access_token":"T"}')).toBe(
      '{"db_password":"[REDACTED]","user_access_token":"[REDACTED]"}',
    )
  })

  it('redacts a compound key in colon form', () => {
    expect(scrub('DB_PASSWORD: hunter2')).toBe('DB_PASSWORD: [REDACTED]')
  })

  it('leaves a longer word that merely begins with a key name alone', () => {
    // `secretary` is not `secret`: widening the match must stay anchored to
    // `_`/`-` joins on the right, not swallow any trailing letters.
    const survivors = ['secretary=jane', 'exit code=1', 'state: ready']

    for (const text of survivors) {
      expect(scrub(text)).toBe(text)
    }
  })
})

describe('log.error / log.warn', () => {
  let spies: ReturnType<typeof spyOnConsole>

  beforeEach(() => {
    mockDev = false
    mockLogStacks = undefined
    spies = spyOnConsole()
  })

  afterEach(() => {
    spies.error.mockRestore()
    spies.warn.mockRestore()
  })

  it('exports a log object with error and warn functions', () => {
    expect(log).toBeDefined()
    expect(typeof log.error).toBe('function')
    expect(typeof log.warn).toBe('function')
  })

  it('writes exactly one JSON line to console.error with the full context', () => {
    log.error(
      'request failed',
      { requestId: 'req-1', method: 'GET', path: '/feed', status: 500 },
      new Error('kaput'),
    )

    expect(spies.warn).not.toHaveBeenCalled()
    const { line } = singleLine(spies.error.mock.calls)
    expect(line).toMatchObject({
      level: 'error',
      msg: 'request failed',
      requestId: 'req-1',
      method: 'GET',
      path: '/feed',
      status: 500,
      err: { name: 'Error', message: 'kaput' },
    })
  })

  it('stamps ts as an ISO timestamp', () => {
    log.error('tick')

    const { line } = singleLine(spies.error.mock.calls)
    expect(line.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(Number.isFinite(Date.parse(line.ts as string))).toBe(true)
  })

  it('writes warnings to console.warn with level warn', () => {
    log.warn('slow upstream', { requestId: 'req-2', path: '/api/me' })

    expect(spies.error).not.toHaveBeenCalled()
    const { line } = singleLine(spies.warn.mock.calls)
    expect(line).toMatchObject({
      level: 'warn',
      msg: 'slow upstream',
      requestId: 'req-2',
      path: '/api/me',
    })
  })

  it('omits context keys that were not supplied', () => {
    log.error('bare')

    const { line } = singleLine(spies.error.mock.calls)
    expect('requestId' in line).toBe(false)
    expect('method' in line).toBe(false)
    expect('path' in line).toBe(false)
    expect('status' in line).toBe(false)
  })

  it('preserves a status of 0 rather than dropping it as falsy', () => {
    log.error('upstream aborted', { status: 0 })

    const { line } = singleLine(spies.error.mock.calls)
    expect('status' in line).toBe(true)
    expect(line.status).toBe(0)
  })

  it('omits the err key when no error is supplied', () => {
    log.error('nothing thrown', { requestId: 'req-3' })

    const { line } = singleLine(spies.error.mock.calls)
    expect('err' in line).toBe(false)
  })

  it('scrubs secrets out of the error message', () => {
    log.error('login failed', {}, new Error('rejected password=hunter2'))

    const { raw, line } = singleLine(spies.error.mock.calls)
    expect(errOf(line).message).toBe('rejected password=[REDACTED]')
    expect(raw).not.toContain('hunter2')
  })

  it('scrubs secrets out of the message itself', () => {
    log.error('parse failed for Cookie: SECRETVALUE while handling')

    const { raw, line } = singleLine(spies.error.mock.calls)
    expect(line.msg).toBe('parse failed for Cookie: [REDACTED] while handling')
    expect(raw).not.toContain('SECRETVALUE')
  })

  it('normalizes a string error to name Error with a scrubbed message', () => {
    log.error('threw a string', {}, 'boom password=hunter2')

    const { raw, line } = singleLine(spies.error.mock.calls)
    expect(errOf(line)).toMatchObject({
      name: 'Error',
      message: 'boom password=[REDACTED]',
    })
    expect(raw).not.toContain('hunter2')
  })

  it('normalizes a number error via String()', () => {
    log.error('threw a number', {}, 42)

    const { line } = singleLine(spies.error.mock.calls)
    expect(errOf(line).message).toBe('42')
  })

  it('never dumps an arbitrary object thrown as an error', () => {
    log.error(
      'threw an object',
      {},
      {
        password: 'hunter2',
        marker: 'DUMP_ME_9',
      },
    )

    const { raw, line } = singleLine(spies.error.mock.calls)
    // Key NAMES are diagnostic; key VALUES are what leaks. Sorted so the line
    // is stable across engines' property ordering.
    expect(errOf(line).message).toBe('[object Object] keys: marker, password')
    expect(raw).not.toContain('DUMP_ME_9')
    expect(raw).not.toContain('hunter2')
  })

  it('names the keys of a thrown object without dumping their values', () => {
    log.error(
      'object throwable',
      {},
      {
        status: 502,
        message: 'x',
        password: 'hunter2',
      },
    )

    const { raw, line } = singleLine(spies.error.mock.calls)
    expect(errOf(line).message).toBe(
      '[object Object] keys: message, password, status',
    )
    expect(raw).not.toContain('hunter2')
  })

  it('identifies a thrown Response by its tag', () => {
    log.error('response throwable', {}, new Response('body', { status: 502 }))

    const { line } = singleLine(spies.error.mock.calls)
    expect(String(errOf(line).message)).toContain('Response')
  })

  it('does not throw when the error value cannot be stringified', () => {
    const hostile = {
      toString(): string {
        throw new Error('boom')
      },
    }

    expect(() => log.error('hostile value', {}, hostile)).not.toThrow()
    const { line } = singleLine(spies.error.mock.calls)
    expect(line.msg).toBe('hostile value')
    expect(line.level).toBe('error')
  })

  it('truncates an over-long error message', () => {
    log.error('long error', {}, new Error('x'.repeat(5000)))

    const { line } = singleLine(spies.error.mock.calls)
    const message = errOf(line).message as string
    expect(message.endsWith(TRUNCATED)).toBe(true)
    expect(message.length).toBeLessThanOrEqual(2000 + TRUNCATED.length)
  })

  it('truncates an over-long message', () => {
    log.error('y'.repeat(5000))

    const { line } = singleLine(spies.error.mock.calls)
    const msg = line.msg as string
    expect(msg.endsWith(TRUNCATED)).toBe(true)
    expect(msg.length).toBeLessThanOrEqual(2000 + TRUNCATED.length)
  })

  it('walks the cause chain, scrubbing each link', () => {
    const cause = Object.assign(
      new Error('connect ECONNREFUSED 127.0.0.1:8081 password=hunter2'),
      { code: 'ECONNREFUSED' },
    )

    log.error('wrapped failure', {}, new TypeError('fetch failed', { cause }))

    const { raw, line } = singleLine(spies.error.mock.calls)
    const err = errOf(line)
    expect(err.message).toBe('fetch failed')
    expect(err.cause).toMatchObject({
      name: 'Error',
      message: 'connect ECONNREFUSED 127.0.0.1:8081 password=[REDACTED]',
      code: 'ECONNREFUSED',
    })
    expect(raw).not.toContain('hunter2')
  })

  it('caps the cause chain at two levels', () => {
    const level4 = new Error('level4marker')
    const level3 = new Error('level3', { cause: level4 })
    const level2 = new Error('level2', { cause: level3 })
    const level1 = new Error('level1', { cause: level2 })

    log.error('deep chain', {}, level1)

    const { raw, line } = singleLine(spies.error.mock.calls)
    const cause = errOf(line).cause as Record<string, unknown>
    expect(cause.message).toBe('level2')
    const nested = cause.cause as Record<string, unknown>
    expect(nested.message).toBe('level3')
    expect('cause' in nested).toBe(false)
    expect(raw).not.toContain('level4marker')
  })

  it('normalizes a string cause', () => {
    log.error(
      'string cause',
      {},
      new Error('outer', { cause: 'boom password=hunter2' }),
    )

    const { raw, line } = singleLine(spies.error.mock.calls)
    expect(errOf(line).cause).toMatchObject({
      name: 'Error',
      message: 'boom password=[REDACTED]',
    })
    expect(raw).not.toContain('hunter2')
  })

  it('does not dump an object cause', () => {
    log.error(
      'object cause',
      {},
      new Error('outer', {
        cause: { password: 'hunter2', marker: 'CAUSE_DUMP_9' },
      }),
    )

    const { raw, line } = singleLine(spies.error.mock.calls)
    const cause = errOf(line).cause as Record<string, unknown>
    expect(cause.name).toBe('Error')
    expect(String(cause.message)).toContain('[object Object]')
    expect(raw).not.toContain('CAUSE_DUMP_9')
    expect(raw).not.toContain('hunter2')
  })

  it('terminates on a circular cause chain', () => {
    const error = new Error('self referential')
    Object.assign(error, { cause: error })

    expect(() => log.error('circular cause', {}, error)).not.toThrow()

    const { line } = singleLine(spies.error.mock.calls)
    expect(line.msg).toBe('circular cause')
  })

  it("includes the cause's code only when it is a string", () => {
    const cause = Object.assign(new Error('inner'), { code: 500 })

    log.error('numeric code', {}, new Error('outer', { cause }))

    const { line } = singleLine(spies.error.mock.calls)
    const causeLine = errOf(line).cause as Record<string, unknown>
    expect('code' in causeLine).toBe(false)
  })

  it('summarizes an AggregateError by count and first entry', () => {
    const error = new AggregateError(
      [
        new Error('first failure password=hunter2'),
        new Error('AGG_SECOND_9 also failed'),
      ],
      'all upstreams failed',
    )

    log.error('aggregate failure', {}, error)

    const { raw, line } = singleLine(spies.error.mock.calls)
    const err = errOf(line)
    expect(err.name).toBe('AggregateError')
    expect(err.message).toBe('all upstreams failed')
    expect(err.errorCount).toBe(2)
    expect(Array.isArray(err.errors)).toBe(true)
    const errors = err.errors as Record<string, unknown>[]
    // Only the first entry is carried: enough to diagnose, bounded in size.
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      name: 'Error',
      message: 'first failure password=[REDACTED]',
    })
    expect(raw).not.toContain('AGG_SECOND_9')
    expect(raw).not.toContain('hunter2')
  })

  it('includes the stack in production by default', () => {
    log.error('stack by default', {}, new Error('kaput'))

    const { line } = singleLine(spies.error.mock.calls)
    expect('stack' in errOf(line)).toBe(true)
    expect(typeof errOf(line).stack).toBe('string')
  })

  // ---- F2: review-fix coverage ----

  it('scrubs a secret hiding in the error name', () => {
    const error = Object.assign(new Error('boom'), {
      name: 'Bearer SECRETTOK',
    })

    log.error('named error', {}, error)

    const { raw } = singleLine(spies.error.mock.calls)
    expect(raw).not.toContain('SECRETTOK')
  })

  it('caps an over-long error name', () => {
    const error = Object.assign(new Error('boom'), { name: 'n'.repeat(5000) })

    log.error('long name', {}, error)

    const { line } = singleLine(spies.error.mock.calls)
    const name = errOf(line).name as string
    expect(name.endsWith(TRUNCATED)).toBe(true)
    expect(name.length).toBeLessThanOrEqual(200 + TRUNCATED.length)
  })

  it('scrubs string context fields but leaves numbers alone', () => {
    log.error('ctx scrub', {
      path: '/cb?code=AUTHCODE&state=STV',
      method: 'GET',
      requestId: 'r',
      status: 302,
    })

    const { raw, line } = singleLine(spies.error.mock.calls)
    expect(line.path).toContain('[REDACTED]')
    expect(raw).not.toContain('AUTHCODE')
    expect(line.method).toBe('GET')
    expect(line.requestId).toBe('r')
    expect(line.status).toBe(302)
  })

  it('does not throw when the stack getter throws in production', () => {
    mockLogStacks = '0'
    const error = new Error('boom')
    Object.defineProperty(error, 'stack', {
      get(): string {
        throw new Error('no stack for you')
      },
    })

    expect(() => log.error('hostile stack', {}, error)).not.toThrow()

    const { line } = singleLine(spies.error.mock.calls)
    expect(line.msg).toBe('hostile stack')
  })

  it('does not throw when the stack getter throws in dev', () => {
    mockDev = true
    const error = new Error('boom')
    Object.defineProperty(error, 'stack', {
      get(): string {
        throw new Error('no stack for you')
      },
    })

    expect(() => log.error('hostile stack dev', {}, error)).not.toThrow()

    const { line } = singleLine(spies.error.mock.calls)
    expect(line.msg).toBe('hostile stack dev')
  })

  it('does not throw for a proxy whose prototype trap throws', () => {
    // `err instanceof Error` alone would explode on this value.
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf(): never {
          throw new Error('no prototype for you')
        },
      },
    )

    expect(() => log.error('hostile proxy', {}, hostile)).not.toThrow()

    const { line } = singleLine(spies.error.mock.calls)
    expect(line.msg).toBe('hostile proxy')
  })

  it('scrubs before truncating, so a cut cannot expose a secret', () => {
    log.error(
      'scrub before truncate',
      {},
      new Error(`${'x'.repeat(1995)} password=hunter2`),
    )

    const { raw } = singleLine(spies.error.mock.calls)
    expect(raw).not.toContain('hunter2')
    expect(raw).not.toContain('hunt')
  })
})

describe('log stack policy', () => {
  let spies: ReturnType<typeof spyOnConsole>

  beforeEach(() => {
    mockDev = false
    mockLogStacks = undefined
    spies = spyOnConsole()
  })

  afterEach(() => {
    spies.error.mockRestore()
    spies.warn.mockRestore()
  })

  /** An error whose stack carries a secret, to prove stacks are scrubbed. */
  function errorWithSecretStack(): Error {
    const error = new Error('kaput')
    error.stack = [
      'Error: kaput',
      '    at connect (src/lib/server/db.ts:10:5) password=hunter2',
      '    at handler (src/routes/+page.server.ts:3:1)',
    ].join('\n')
    return error
  }

  it('includes a scrubbed stack in dev', () => {
    mockDev = true

    log.error('dev failure', {}, errorWithSecretStack())

    const { raw, line } = singleLine(spies.error.mock.calls)
    const stack = errOf(line).stack as string
    expect(typeof stack).toBe('string')
    expect(stack).toContain('at connect (src/lib/server/db.ts:10:5)')
    expect(stack).toContain('[REDACTED]')
    expect(raw).not.toContain('hunter2')
  })

  it("includes a scrubbed stack in production when LOG_STACKS is '1'", () => {
    mockLogStacks = '1'

    log.error('opt-in failure', {}, errorWithSecretStack())

    const { raw, line } = singleLine(spies.error.mock.calls)
    const stack = errOf(line).stack as string
    expect(typeof stack).toBe('string')
    expect(stack).toContain('at connect (src/lib/server/db.ts:10:5)')
    expect(stack).toContain('[REDACTED]')
    expect(raw).not.toContain('hunter2')
  })

  it("omits the stack when LOG_STACKS is '0'", () => {
    mockLogStacks = '0'

    log.error('still no stack', {}, errorWithSecretStack())

    const { line } = singleLine(spies.error.mock.calls)
    expect('stack' in errOf(line)).toBe(false)
  })

  it("omits the stack in dev when LOG_STACKS is '0'", () => {
    // Explicit off beats dev: an operator who turns stacks off means it.
    mockDev = true
    mockLogStacks = '0'

    log.error('dev opted out', {}, errorWithSecretStack())

    const { line } = singleLine(spies.error.mock.calls)
    expect('stack' in errOf(line)).toBe(false)
  })

  it('includes a scrubbed stack in production by default', () => {
    log.error('prod default', {}, errorWithSecretStack())

    const { raw, line } = singleLine(spies.error.mock.calls)
    const stack = errOf(line).stack as string
    expect(typeof stack).toBe('string')
    expect(stack).toContain('at connect (src/lib/server/db.ts:10:5)')
    expect(stack).toContain('[REDACTED]')
    expect(raw).not.toContain('hunter2')
  })

  it('applies the stack policy to warnings too', () => {
    mockDev = true

    log.warn('dev warning', {}, errorWithSecretStack())

    const { raw, line } = singleLine(spies.warn.mock.calls)
    expect(typeof errOf(line).stack).toBe('string')
    expect(raw).not.toContain('hunter2')
  })

  it('truncates an over-long stack', () => {
    mockDev = true
    const error = new Error('kaput')
    error.stack = `Error: kaput\n${'z'.repeat(20000)}`

    log.error('huge stack', {}, error)

    const { line } = singleLine(spies.error.mock.calls)
    const stack = errOf(line).stack as string
    expect(stack.endsWith(TRUNCATED)).toBe(true)
    expect(stack.length).toBeLessThanOrEqual(8000 + TRUNCATED.length)
  })

  it("applies LOG_STACKS='0' to universal callers, not just server ones", async () => {
    mockLogStacks = '0'
    // The universal face of the same emitter, on the same module graph: this
    // file's top-level `await import('./log')` is what installed the policy.
    // A universal module never reads LOG_STACKS itself, so if the install did
    // not reach it, $lib/app/util/log would still be emitting stacks in
    // production — the setting would silently cover only half the callers.
    const { log: isoLog } = await import('$lib/app/util/log')

    isoLog.error('universal failure', new Error('kaput'))

    const { line } = singleLine(spies.error.mock.calls)
    expect('stack' in errOf(line)).toBe(false)
  })
})
