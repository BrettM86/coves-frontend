import { CovesClient } from '$lib/api/coves'
import type { CommunityView } from '$lib/api/coves/types'
import { normalizeInstanceUrl } from '$lib/app/state/instance/resolve'
import {
  upstreamInstanceUrl,
  upstreamSchemeAllowed,
} from '$lib/server/instance'
import { log } from '$lib/server/log'
import type { SiteStats } from '$lib/types/site-stats'

/**
 * Site-wide community totals, computed here once for every visitor.
 *
 * The AppView has no stats endpoint, so the totals are sums over
 * `community.list`. Each browser used to page that list itself — up to a
 * hundred full community records on every fresh page load, just to add up
 * four numbers — and it never got past the first page, because the AppView
 * caps `limit` at 100. This process now walks the list at most once per TTL
 * and hands browsers the four numbers.
 */

/** How long one computation is served before the next one starts. */
export const SITE_STATS_TTL_MS = 5 * 60_000
/** How long a failed refresh waits before the next attempt. */
const RETRY_BACKOFF_MS = 30_000
/** Totals older than this many TTLs are dropped rather than served stale. */
const MAX_STALE_TTLS = 6
/** The AppView's own cap on `community.list`'s `limit`. */
const PAGE_SIZE = 100
/** Bounds the walk (and the numbers) at this many communities. */
const MAX_PAGES = 50
const REQUEST_TIMEOUT_MS = 10_000

type ListPage = (cursor: string | undefined) => Promise<{
  communities: readonly Pick<
    CommunityView,
    'subscriberCount' | 'memberCount' | 'postCount'
  >[]
  cursor?: string
}>

/** Sums every page `listPage` hands back, following cursors. */
export async function aggregateSiteStats(
  listPage: ListPage,
): Promise<SiteStats> {
  let communities = 0
  let subscribers = 0
  let members = 0
  let posts = 0
  let cursor: string | undefined
  let reachedEnd = false
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await listPage(cursor)
    for (const community of response.communities) {
      communities++
      subscribers += community.subscriberCount
      members += community.memberCount
      posts += community.postCount
    }
    if (!response.cursor || response.communities.length === 0) {
      reachedEnd = true
      break
    }
    cursor = response.cursor
  }
  if (!reachedEnd) {
    log.warn(
      `[site-stats] stopped at ${MAX_PAGES * PAGE_SIZE} communities; totals undercount`,
    )
  }
  return { communities, subscribers, members, posts }
}

/**
 * A TTL cache around `load` with one computation in flight at a time. A
 * failed refresh serves the previous value while there is one and it is
 * younger than `MAX_STALE_TTLS` TTLs: stale totals beat none for a sidebar.
 * Any failure, with or without totals to serve, holds the next attempt off for
 * `RETRY_BACKOFF_MS`, and calls in that window that have nothing to serve
 * reject with the same error, so an upstream outage costs one walk per
 * backoff rather than one per request.
 */
export function createSiteStatsCache(
  load: () => Promise<SiteStats>,
  now: () => number = Date.now,
  ttlMs: number = SITE_STATS_TTL_MS,
): () => Promise<SiteStats> {
  const maxStaleMs = MAX_STALE_TTLS * ttlMs
  let cached:
    { stats: SiteStats; computedAt: number; expires: number } | undefined
  let inflight: Promise<SiteStats> | undefined
  let retryAfter = 0
  let lastFailure: unknown

  return () => {
    if (cached && now() < cached.expires) return Promise.resolve(cached.stats)
    if (now() < retryAfter) return Promise.reject(lastFailure)
    inflight ??= load()
      .then((stats) => {
        const computedAt = now()
        cached = { stats, computedAt, expires: computedAt + ttlMs }
        retryAfter = 0
        lastFailure = undefined
        return stats
      })
      .catch((error: unknown) => {
        retryAfter = now() + RETRY_BACKOFF_MS
        lastFailure = error
        const staleUntil = cached ? cached.computedAt + maxStaleMs : 0
        if (!cached || now() >= staleUntil) throw error
        log.warn(
          '[site-stats] refresh failed; serving the previous totals',
          undefined,
          error,
        )
        cached.expires = Math.min(retryAfter, staleUntil)
        return cached.stats
      })
      .finally(() => {
        inflight = undefined
      })
    return inflight
  }
}

async function loadFromUpstream(): Promise<SiteStats> {
  const baseUrl = normalizeInstanceUrl(upstreamInstanceUrl())
  if (!baseUrl) throw new Error('[site-stats] no upstream instance configured')
  if (import.meta.env.PROD && !upstreamSchemeAllowed(baseUrl)) {
    throw new Error('[site-stats] plaintext upstream not allowed')
  }
  // Anonymous on purpose: the totals are the same for everyone.
  const client = new CovesClient({
    baseUrl,
    fetchFn: (input, init) =>
      globalThis.fetch(input, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
  })
  return aggregateSiteStats((cursor) =>
    client.listCommunities({ limit: PAGE_SIZE, sort: 'new', cursor }),
  )
}

/** The current totals, from cache when fresh. */
export const getSiteStats = createSiteStatsCache(loadFromUpstream)
