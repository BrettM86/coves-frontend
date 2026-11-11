import { NSID } from '$lib/api/coves/client'
import { log } from '$lib/app/util/log'
import { warnImportFailure } from './failure-log'

/**
 * Records that the user closed the automatic offer. Sent with keepalive so a
 * close by browser Back survives the page unloading. Best effort: on failure
 * the offer is simply shown again next session.
 */
export async function dismissBlueskyProfileImport(
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  try {
    const response = await fetchFn(
      `/api/proxy/xrpc/${NSID.dismissBlueskyProfileImport}`,
      { method: 'POST', keepalive: true, credentials: 'include' },
    )
    if (!response.ok) {
      log.warn('Bluesky import dismissal was not recorded', undefined, {
        status: response.status,
      })
    }
  } catch (error) {
    // Best effort; see above.
    warnImportFailure('Bluesky import dismissal request failed', error)
  }
}
