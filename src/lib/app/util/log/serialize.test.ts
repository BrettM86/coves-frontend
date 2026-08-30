import { describe, expect, it } from 'vitest'
import type { SerializedError } from './serialize'
import { serializeError } from './serialize'

/**
 * Hostile-input contract for the error serializer. Everything here is a value
 * a real failure can hand us — a library that builds an AggregateError from a
 * pool, a proxied array — and none of it may take the process down. A logger
 * that throws while reporting a failure destroys the only record of it.
 */

/** Serializes from a fresh top-level call, the way `emit` does. */
const serialize = (err: unknown): SerializedError =>
  serializeError(err, 0, new Set([err]), true)

/** Depth of the `errors` chain, with its own cap so a cycle cannot hang the test. */
function errorsDepth(node: SerializedError): number {
  let depth = 0
  let current: SerializedError | undefined = node
  while (current?.errors?.[0] !== undefined && depth < 1000) {
    current = current.errors[0]
    depth += 1
  }
  return depth
}

describe('serializeError on hostile aggregates', () => {
  it('survives an AggregateError that contains itself', () => {
    const aggregate = new AggregateError([], 'agg')
    // The constructor copies the iterable, so mutate the array it actually owns.
    ;(aggregate.errors as unknown[]).push(aggregate)

    const result = serialize(aggregate)

    expect(result.errorCount).toBe(1)
    // The `cause` walk is depth-capped but the `errors` walk is the same shape
    // of unbounded recursion, so it needs the same bound. The exact number is
    // the implementer's call; it only has to be small and finite.
    expect(errorsDepth(result)).toBeLessThanOrEqual(10)
    expect(() => JSON.stringify(result)).not.toThrow()
  })

  it('survives an AggregateError nested 50 deep', () => {
    let nested: unknown = new Error('leaf')
    for (let i = 0; i < 50; i += 1) {
      nested = new AggregateError([nested], `level ${i}`)
    }

    const result = serialize(nested)

    expect(result.name).toBe('AggregateError')
    expect(() => JSON.stringify(result)).not.toThrow()
  })

  it('survives an errors array whose length getter throws', () => {
    const error: Error & { errors?: unknown } = new Error('boom')
    error.errors = new Proxy([new Error('inner')], {
      get(target, prop, receiver): unknown {
        if (prop === 'length') throw new Error('no length for you')
        return Reflect.get(target, prop, receiver)
      },
    })

    const result = serialize(error)

    expect(result.message).toBe('boom')
    expect(result.errorCount ?? 0).toBe(0)
  })
})
