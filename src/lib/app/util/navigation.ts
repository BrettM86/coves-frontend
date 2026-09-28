import { goto } from '$app/navigation'
import { log } from '$lib/app/util/log'

/**
 * Navigates to `url` with `key=value` set (and `deleteKeys` dropped). Loads
 * that read the parameter re-run by themselves; a full `invalidateAll` would
 * add a root server-load round trip ahead of them for nothing.
 */
export const searchParam = async (
  url: URL,
  key: string,
  value: string,
  ...deleteKeys: string[]
): Promise<void> => {
  // A copy: callers pass `page.url`, which is the router's own current URL.
  // Changing it in place leaves the router nothing to compare against, so it
  // sees no search-param change and the loads never rerun.
  const next = new URL(url)
  next.searchParams.set(key, value)
  deleteKeys.forEach((k) => next.searchParams.delete(k))
  try {
    await goto(next)
  } catch (err) {
    log.error('[searchParam] Navigation failed', err)
  }
}
