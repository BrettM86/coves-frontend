function isObject(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === 'object' && !Array.isArray(item)
}

/**
 * Whether a stored value may replace a default of the same key.
 *
 * A `null` or `undefined` default states no type, so anything but an object
 * is allowed through (an object would have been merged, not assigned).
 * Otherwise the stored value must be the same kind as the default — array for
 * array, and the same `typeof` for primitives — so that storage written by an
 * older version, hand-edited, or corrupted cannot change a setting's shape and
 * break the code consuming it (e.g. `presets: false` reaching an `{#each}`).
 */
function shapeMatches(defaultValue: unknown, storedValue: unknown): boolean {
  if (defaultValue === null || defaultValue === undefined) {
    return !isObject(storedValue)
  }
  if (Array.isArray(defaultValue)) return Array.isArray(storedValue)
  if (Array.isArray(storedValue)) return false
  return typeof defaultValue === typeof storedValue
}

/**
 * Deep merge sources into a target, keeping only keys the target already
 * defines and only values whose shape matches the target's.
 *
 * Used to layer persisted settings over the current defaults. Because the
 * defaults describe the live schema, restricting the merge to their keys
 * prunes settings that a newer version retired (`showInstances`,
 * `displayNames`) instead of carrying them in every returning user's
 * localStorage forever, and it does so for future removals without a
 * migration per setting.
 *
 * Values are dropped rather than merged when the stored shape contradicts the
 * default's — see {@link shapeMatches} — since hand-edited or stale storage
 * would otherwise corrupt the settings object at runtime. Nested objects merge
 * key by key; arrays and primitives replace wholesale.
 *
 * Mutates and returns `target`.
 */
export function mergeDeep<T extends Record<string, unknown>>(
  target: T,
  ...sources: unknown[]
): T {
  if (!sources.length) return target
  const source = sources.shift()

  if (isObject(target) && isObject(source)) {
    for (const key of Object.keys(source)) {
      // Unknown keys are pruned here. This also drops `__proto__` from parsed
      // JSON, which is never an own key of the defaults, so a crafted
      // localStorage payload cannot reach Object.prototype.
      if (!Object.hasOwn(target, key)) continue

      const sourceValue = source[key]
      const targetValue = target[key]

      if (isObject(sourceValue)) {
        if (isObject(targetValue)) mergeDeep(targetValue, sourceValue)
      } else if (
        !isObject(targetValue) &&
        shapeMatches(targetValue, sourceValue)
      ) {
        Object.assign(target, { [key]: sourceValue })
      }
    }
  }

  return mergeDeep(target, ...sources)
}
