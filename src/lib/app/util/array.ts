/**
 * Basic types only, don't use for anything more than basic equality
 */
export function recursiveEqual<T>(a: T, b: T): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object') return false

  if (a == null || b == null) {
    if (a == null && b == null) return true
    else return false
  }

  const keysA = Object.keys(a) as (keyof typeof a)[]
  const keysB = Object.keys(b) as (keyof typeof b)[]

  if (keysA.length != keysB.length) return false

  for (const key of keysA) {
    const valA = a[key]
    const valB = b[key]

    if (typeof valA == 'object' && typeof valB == 'object') {
      const result = recursiveEqual(valA!, valB!)
      if (!result) return false
    } else {
      if (valA != valB) return false
    }
  }

  return true
}
