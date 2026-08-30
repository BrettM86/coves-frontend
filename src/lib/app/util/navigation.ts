import { goto } from '$app/navigation'
import { log } from '$lib/app/util/log'

/**
 * Sets `key=value` on `url` (dropping `deleteKeys`) and navigates to it with
 * a full data reload.
 */
export const searchParam = async (
  url: URL,
  key: string,
  value: string,
  ...deleteKeys: string[]
): Promise<void> => {
  url.searchParams.set(key, value)
  deleteKeys.forEach((k) => url.searchParams.delete(k))
  try {
    await goto(url, {
      invalidateAll: true,
    })
  } catch (err) {
    log.error('[searchParam] Navigation failed', err)
  }
}
