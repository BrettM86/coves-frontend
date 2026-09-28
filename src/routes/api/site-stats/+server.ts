import { json } from '@sveltejs/kit'
import { getSiteStats, SITE_STATS_TTL_MS } from '$lib/server/site-stats'
import { log } from '$lib/server/log'
import type { RequestHandler } from './$types'

/**
 * The sidebar's instance totals. Identical for every visitor and computed at
 * most once per TTL, so browsers may keep them that long too.
 */
export const GET: RequestHandler = async ({ locals }) => {
  try {
    return json(await getSiteStats(), {
      headers: {
        'cache-control': `public, max-age=${SITE_STATS_TTL_MS / 1000}`,
      },
    })
  } catch (error) {
    log.warn(
      '[site-stats] could not compute totals',
      { requestId: locals.requestId },
      error,
    )
    return json(
      { error: 'SiteStatsUnavailable' },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    )
  }
}
