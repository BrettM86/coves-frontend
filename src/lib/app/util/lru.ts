/**
 * A bounded map that evicts the least recently used entry once full. Plain
 * and non-reactive on purpose: for caches of derived values that nothing
 * renders directly. Values are never null or undefined: `get` returns
 * undefined for a miss.
 */
export class LruCache<K, V extends NonNullable<unknown>> {
  readonly #entries = new Map<K, V>()
  readonly #capacity: number

  constructor(capacity: number) {
    // NaN would never evict, and less than one would keep nothing.
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(
        `LruCache capacity must be a positive integer, got ${capacity}`,
      )
    }
    this.#capacity = capacity
  }

  get(key: K): V | undefined {
    const value = this.#entries.get(key)
    if (value === undefined) return undefined
    // Re-inserted to mark it most recently used: a Map iterates in insertion
    // order, so the first key is always the least recently used one.
    this.#entries.delete(key)
    this.#entries.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    this.#entries.delete(key)
    this.#entries.set(key, value)
    if (this.#entries.size > this.#capacity) {
      const oldest = this.#entries.keys().next()
      if (!oldest.done) this.#entries.delete(oldest.value)
    }
  }

  get size(): number {
    return this.#entries.size
  }
}
