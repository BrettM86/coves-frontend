export function moveItem<T>(
  array: T[],
  currentIndex: number,
  newIndex: number,
): T[] {
  if (
    currentIndex < 0 ||
    currentIndex >= array.length ||
    newIndex < 0 ||
    newIndex >= array.length
  ) {
    throw new Error('Invalid index')
  }

  const newArray = [...array]

  // Remove the item from the current index
  const [item] = newArray.splice(currentIndex, 1)

  // Insert the item at the new index
  newArray.splice(newIndex, 0, item)

  return newArray
}

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
