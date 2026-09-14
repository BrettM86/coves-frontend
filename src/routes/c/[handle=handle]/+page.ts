import type { FeedPaginationParams } from '$lib/api/coves/types'
import { coves } from '$lib/api/client.svelte'
import { XrpcError } from '$lib/api/coves/xrpc'
import { settings } from '$lib/app/state/settings.svelte'
import { error, redirect } from '@sveltejs/kit'
import { resolveFeedSort } from '$lib/api/coves/sort'
import type { Handle } from '$lib/types/atproto'
import CommunityCard from '$lib/feature/community/CommunityCard.svelte'
import { feed } from '$lib/feature/feeds/feed.svelte'
import {
  canonicalCommunityParam,
  encodeCommunityParam,
} from '$lib/app/util/community'
import { LOCAL_INSTANCE_DOMAIN } from '$lib/app/state/instance/domain'

/**
 * Whether the requested route param already is the canonical one. SvelteKit
 * hands `params.handle` to load() fully decoded, so `/c/gaming%40lemmy.world`
 * arrives as `gaming@lemmy.world` and an exact comparison suffices. The
 * canonical form is lower-cased at the source ({@link canonicalCommunityParam}),
 * so `/c/Gaming` redirects to `/c/gaming` exactly once and never bounces.
 */
function sameCommunityParam(canonical: string, requested: string): boolean {
  return requested === canonical
}

export async function load({ params, fetch, url, route }) {
  const cursor = url.searchParams.get('cursor') as string | undefined

  // Sent verbatim: an origin-aware AppView (backend
  // `feat/community-origin-resolve` and later) resolves a DID, a DNS handle
  // (with or without the "c-" prefix), a `name@origin` address, or a bare
  // local name, so the param needs no rewriting here. Older AppViews reject
  // the last two with 400, which the catch below reports as "not found".
  const communityHandle = params.handle as Handle
  const mapped = resolveFeedSort(url, settings.defaultSort)

  let feedData
  try {
    feedData = await feed(route.id, async (p) => {
      const api = coves({ func: fetch })

      // Every community shares the route ID `/c/[handle=handle]`, so the cache
      // can hand this closure back on a later navigation to a *different*
      // community or sort. Read the identity of the request from `p` only —
      // anything captured from the enclosing load() run would be stale.
      // The route's `handle` matcher guarantees the slug is handle-shaped.
      const community = p.community as Handle

      const [feedResponse, communityData] = await Promise.all([
        api.getCommunityFeed({
          community,
          sort: p.sort,
          timeframe: p.timeframe,
          limit: p.limit,
          cursor: p.cursor,
        }),
        api.getCommunity({ community }),
      ])

      return {
        feed: feedResponse.feed ?? [],
        community: communityData,
        cursor: feedResponse.cursor,
        params: { ...p, cursor: feedResponse.cursor },
        virtualList: { itemHeights: [] },
      }
    }).load({
      community: communityHandle,
      sort: mapped.sort,
      timeframe: mapped.timeframe,
      limit: 20,
      cursor: cursor,
    })
  } catch (e) {
    // The matcher admits shapes the AppView may refuse to parse (400) as well
    // as ones it cannot find (404); to the visitor both are "no such
    // community", and the 500 page would be wrong for user-supplied input.
    if (e instanceof XrpcError && (e.status === 404 || e.status === 400)) {
      error(404, 'Community not found')
    }
    throw e
  }

  // Legacy forms (DNS handle, DID, `name@<local domain>`) keep resolving but
  // are not canonical: once the community is known, send the browser to its
  // Lemmy-style URL. Older AppViews omit `origin`, in which case there is no
  // canonical form to compute and the requested URL stands.
  //
  // 302, not 301: whether a community is "local" depends on the deployment's
  // `PUBLIC_INSTANCE_DOMAIN`, and browsers cache 301s permanently. A 301
  // issued under a misconfigured domain would keep bouncing users to the
  // wrong form (and, once the config is fixed, into a cached loop) with no
  // way to clear it server-side.
  const canonical = canonicalCommunityParam(
    feedData.community,
    LOCAL_INSTANCE_DOMAIN,
  )
  if (canonical && !sameCommunityParam(canonical, params.handle)) {
    redirect(302, `/c/${encodeCommunityParam(canonical)}${url.search}`)
  }

  return {
    ...feedData,
    loadFeed: async (params: FeedPaginationParams) => {
      const response = await coves({ func: fetch }).getCommunityFeed({
        ...params,
        community: communityHandle,
      })
      return { feed: response.feed ?? [], cursor: response.cursor }
    },
    slots: {
      sidebar: {
        component: CommunityCard,
        props: {
          community: feedData?.community,
        },
      },
    },
  }
}
