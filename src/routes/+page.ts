import { browser } from '$app/environment'
import type { FeedPaginationParams } from '$lib/api/coves/types'
import { coves } from '$lib/api/client.svelte'
import { profile } from '$lib/app/state/auth.svelte'
import { t } from '$lib/app/state/i18n'
import { defaultSettings, settings } from '$lib/app/state/settings.svelte'
import { mapListing, resolveFeedSort } from '$lib/api/coves/sort'
import { ReactiveState } from '$lib/app/util/reactive.svelte'
import { awaitIfServer, renderingServerMarkup } from '$lib/app/util/ssr'
import { feed } from '$lib/feature/feeds/feed.svelte'
import { ChevronsUp } from '$lib/ui/kit/icon'
import { XrpcError } from '$lib/api/coves/xrpc'

type FeedRequestParams = FeedPaginationParams & {
  listing?: string
}

type HomeFeedPaginationParams = FeedRequestParams & {
  listing?: 'discover' | 'timeline'
}

type RouteRetryTarget = 'page-one' | 'current-url'

interface RouteRecoveryState {
  target?: RouteRetryTarget
  retryDeadline?: number
}

function viewerIdentity(): string | undefined {
  const viewer = profile.current
  return viewer?.type === 'authenticated' ? viewer.did : undefined
}

export async function load({ url, fetch, route, parent }) {
  const cursor = url.searchParams.get('cursor') as string | undefined

  const listingType = url.searchParams.get('type') ?? settings.defaultSort.feed

  const mapped = resolveFeedSort(url, settings.defaultSort)
  const listing = mapListing(listingType, profile.isAuthenticated)
  const routeViewerIdentity = viewerIdentity()
  const params: HomeFeedPaginationParams = {
    cursor,
    sort: mapped.sort,
    timeframe: mapped.timeframe,
    listing,
    limit: 20,
  }
  const recovery = new ReactiveState<RouteRecoveryState>({})

  // Only the hydrating load has server markup to match. The server has no
  // saved settings, so it built its request from the defaults; a later hot
  // Discover page also falls back to the saved timeframe (see the loader
  // below). The server also took the reader from the session cookie, while
  // `profile` holds localStorage's until the layout syncs it after this load.
  // The layout's data is already in the page, so reading it costs no round
  // trip, and it is read before the request starts.
  let matchesServerRender = true
  if (browser && renderingServerMarkup()) {
    const { session } = await parent()
    const serverViewerIdentity = session?.authenticated
      ? session.account.did
      : undefined
    const serverSort = defaultSettings.defaultSort
    const serverMapped = resolveFeedSort(url, serverSort)
    const serverListingType = url.searchParams.get('type') ?? serverSort.feed
    matchesServerRender =
      routeViewerIdentity === serverViewerIdentity &&
      mapped.sort === serverMapped.sort &&
      mapped.timeframe === serverMapped.timeframe &&
      listing === mapListing(serverListingType, !!serverViewerIdentity) &&
      (settings.defaultSort.timeframe === serverSort.timeframe ||
        !(listing === 'discover' && mapped.sort === 'hot' && cursor))
  }

  const requestFeed = async (request: FeedRequestParams) => {
    const { listing, ...rest } = request
    const api = coves({ func: fetch })
    return listing === 'timeline'
      ? await api.getTimeline(rest)
      : await api.getDiscover(rest)
  }

  const recordRouteError = (
    loadError: unknown,
    target: RouteRetryTarget,
    expectedViewerIdentity: string | undefined,
  ): void => {
    if (viewerIdentity() !== expectedViewerIdentity) return

    const retryAfterSeconds =
      loadError instanceof XrpcError &&
      loadError.status === 503 &&
      loadError.errorName === 'DiscoverUnavailable'
        ? loadError.retryAfterSeconds
        : undefined
    recovery.value = {
      target,
      retryDeadline:
        retryAfterSeconds !== undefined &&
        Number.isFinite(retryAfterSeconds) &&
        retryAfterSeconds > 0
          ? Date.now() + retryAfterSeconds * 1000
          : undefined,
    }
  }

  const pageFromResponse = <Params extends FeedRequestParams>(
    request: Params,
    response: Awaited<ReturnType<typeof requestFeed>>,
  ) => ({
    feed: response.feed ?? [],
    cursor: response.cursor,
    params: { ...request, cursor: response.cursor },
    virtualList: { itemHeights: [] },
  })

  const feedData = feed(route.id, async (request) => {
    const { listing, ...rest } = request
    const requestParams =
      listing === 'discover' && request.sort === 'hot' && request.cursor
        ? {
            ...rest,
            timeframe: rest.timeframe ?? settings.defaultSort.timeframe,
          }
        : rest
    let response
    try {
      response = await requestFeed({ ...requestParams, listing })
    } catch (loadError) {
      if (viewerIdentity() !== routeViewerIdentity) throw loadError

      const shouldRecover =
        loadError instanceof XrpcError &&
        loadError.status === 400 &&
        loadError.errorName === 'InvalidCursor' &&
        listing === 'discover' &&
        request.sort === 'hot' &&
        !!request.cursor
      if (!shouldRecover) {
        recordRouteError(loadError, 'current-url', routeViewerIdentity)
        throw loadError
      }

      recovery.value = { target: 'page-one' }
      try {
        response = await requestFeed({
          ...requestParams,
          listing,
          cursor: undefined,
        })
      } catch (recoveryError) {
        recordRouteError(recoveryError, 'page-one', routeViewerIdentity)
        throw recoveryError
      }
    }

    if (viewerIdentity() !== routeViewerIdentity) {
      throw new Error('Viewer changed while loading the home feed')
    }
    return pageFromResponse(request, response)
  }).load(params)

  const loadPageOne = async (expectedViewerIdentity: string | undefined) => {
    const request = { ...params, cursor: undefined }
    recovery.value = { target: 'page-one' }
    try {
      const response = await requestFeed(request)
      if (viewerIdentity() !== expectedViewerIdentity) {
        throw new Error('Viewer changed while loading the home feed')
      }
      recovery.value = {}
      return pageFromResponse(request, response)
    } catch (loadError) {
      recordRouteError(loadError, 'page-one', expectedViewerIdentity)
      throw loadError
    }
  }

  const loadMore = async (request: FeedRequestParams) => {
    const response = await requestFeed(request)
    return { feed: response.feed ?? [], cursor: response.cursor }
  }

  const filters = new ReactiveState({
    sort: mapped.sort,
    timeframe: mapped.timeframe,
    type_: listing,
  })

  return {
    feed: new ReactiveState(
      (await awaitIfServer(feedData, matchesServerRender)).data,
    ),
    filters,
    loadFeed: loadMore,
    loadPageOne,
    recovery,
    viewerIdentity: routeViewerIdentity,
    contextual: {
      actions: [
        {
          // Lazy: load() can run before translations finish loading
          get name() {
            return t.get('routes.post.scrollToTop')
          },
          handle: () => window?.scrollTo({ top: 0, behavior: 'instant' }),
          icon: ChevronsUp,
        },
      ],
    },
  }
}
