export interface LoginErrorArrival {
  /** The `error` query value to display, or null when the URL has none. */
  errorCode: string | null
  /** The history URL to replace to, with only `error` removed; null when nothing to clear. */
  replaceUrl: URL | null
}

/**
 * Decides what the login page shows on arrival and which URL replaces the
 * current history entry so a reload or back navigation does not revive the
 * consumed error. Pure: the arrival URL is not mutated.
 */
export function consumeLoginError(arrival: URL): LoginErrorArrival {
  if (!arrival.searchParams.has('error')) {
    return { errorCode: null, replaceUrl: null }
  }
  const replaceUrl = new URL(arrival.href)
  replaceUrl.searchParams.delete('error')
  return { errorCode: arrival.searchParams.get('error'), replaceUrl }
}
