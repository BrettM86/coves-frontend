import type { RequestEvent } from '@sveltejs/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Each test needs its own copy of the module: the accessor is module-level
 * state, so a leaked install from one test would mask a failure in the next.
 */
const freshModule = async (): Promise<typeof import('./request-event')> =>
  import('./request-event')

const eventWithRequestId = (requestId: string): RequestEvent =>
  ({ locals: { requestId } }) as unknown as RequestEvent

beforeEach(() => {
  vi.resetModules()
})

describe('currentRequestEvent', () => {
  it('returns undefined when no accessor is installed', async () => {
    const { currentRequestEvent } = await freshModule()

    expect(currentRequestEvent()).toBeUndefined()
  })

  // This pair runs in order and only means something together: the first
  // installs, the second asserts the install did not survive into a fresh
  // module. Asserting `undefined` in a test that installed nothing would pass
  // whether or not the isolation actually works.
  it('installs an accessor the next test must not inherit', async () => {
    const { currentRequestEvent, installRequestEventAccessor } =
      await freshModule()
    installRequestEventAccessor(() => eventWithRequestId('leaked'))

    expect(currentRequestEvent()?.locals.requestId).toBe('leaked')
  })

  it('does not see the accessor the previous test installed', async () => {
    const { currentRequestEvent } = await freshModule()

    expect(currentRequestEvent()).toBeUndefined()
  })

  it('returns undefined when the installed accessor throws', async () => {
    const { currentRequestEvent, installRequestEventAccessor } =
      await freshModule()
    installRequestEventAccessor(() => {
      throw new Error('outside a request')
    })

    // Callers are log lines and diagnostics. A context lookup that throws
    // would convert a logged failure into an unlogged crash, so the absence of
    // context has to look the same as any other absence.
    expect(() => currentRequestEvent()).not.toThrow()
    expect(currentRequestEvent()).toBeUndefined()
  })
})

describe('installRequestEventAccessor', () => {
  it('makes currentRequestEvent return the installed accessor result', async () => {
    const { currentRequestEvent, installRequestEventAccessor } =
      await freshModule()
    const event = eventWithRequestId('r1')

    installRequestEventAccessor(() => event)

    expect(currentRequestEvent()).toBe(event)
  })

  it('calls the accessor on every read rather than caching the first value', async () => {
    const { currentRequestEvent, installRequestEventAccessor } =
      await freshModule()
    const first = eventWithRequestId('r1')
    const second = eventWithRequestId('r2')
    let next = first
    const accessor = vi.fn((): RequestEvent | undefined => next)

    installRequestEventAccessor(accessor)

    expect(currentRequestEvent()).toBe(first)
    next = second
    expect(currentRequestEvent()).toBe(second)
    expect(accessor).toHaveBeenCalledTimes(2)
  })

  it('replaces a previously installed accessor', async () => {
    const { currentRequestEvent, installRequestEventAccessor } =
      await freshModule()
    const first = eventWithRequestId('r1')
    const second = eventWithRequestId('r2')

    installRequestEventAccessor(() => first)
    installRequestEventAccessor(() => second)

    expect(currentRequestEvent()).toBe(second)
    expect(currentRequestEvent()?.locals.requestId).toBe('r2')
  })

  it('stops consulting the replaced accessor', async () => {
    const { currentRequestEvent, installRequestEventAccessor } =
      await freshModule()
    const replaced = vi.fn((): RequestEvent | undefined =>
      eventWithRequestId('r1'),
    )

    installRequestEventAccessor(replaced)
    installRequestEventAccessor(() => eventWithRequestId('r2'))
    currentRequestEvent()

    expect(replaced).not.toHaveBeenCalled()
  })

  it('yields undefined when the installed accessor returns undefined', async () => {
    const { currentRequestEvent, installRequestEventAccessor } =
      await freshModule()

    installRequestEventAccessor(() => undefined)

    expect(currentRequestEvent()).toBeUndefined()
  })

  it('can replace a working accessor with one that returns undefined', async () => {
    const { currentRequestEvent, installRequestEventAccessor } =
      await freshModule()

    installRequestEventAccessor(() => eventWithRequestId('r1'))
    installRequestEventAccessor(() => undefined)

    expect(currentRequestEvent()).toBeUndefined()
  })
})
