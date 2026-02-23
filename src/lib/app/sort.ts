// ---------------------------------------------------------------------------
// Sort and listing type validation
// ---------------------------------------------------------------------------

export type CovesSortType = 'hot' | 'new' | 'top'
export type CovesTimeframe = 'day' | 'week' | 'month' | 'all'
export type CovesListingType = 'discover' | 'timeline'

export type CovesSortParams =
  | { sort: 'hot'; timeframe?: undefined }
  | { sort: 'new'; timeframe?: undefined }
  | { sort: 'top'; timeframe: CovesTimeframe }

const VALID_SORTS: ReadonlySet<CovesSortType> = new Set<CovesSortType>([
  'hot',
  'new',
  'top',
])
const VALID_TIMEFRAMES: ReadonlySet<CovesTimeframe> = new Set<CovesTimeframe>([
  'day',
  'week',
  'month',
  'all',
])

function isValidSort(s: string): s is CovesSortType {
  return (VALID_SORTS as ReadonlySet<string>).has(s)
}

function isValidTimeframe(t: string): t is CovesTimeframe {
  return (VALID_TIMEFRAMES as ReadonlySet<string>).has(t)
}

/**
 * Validates and returns Coves API sort + timeframe parameters.
 * Falls back to `{ sort: 'hot' }` for invalid input.
 */
export function mapSort(sort: string, timeframe?: string): CovesSortParams {
  if (!isValidSort(sort)) {
    console.warn(`[sort] Invalid sort value "${sort}", falling back to "hot"`)
    return { sort: 'hot' }
  }
  if (sort === 'top') {
    if (timeframe && isValidTimeframe(timeframe)) {
      return { sort: 'top', timeframe }
    }
    if (timeframe) {
      console.warn(
        `[sort] Invalid timeframe "${timeframe}", falling back to "all"`,
      )
    }
    return { sort: 'top', timeframe: 'all' }
  }
  return { sort }
}

// ---------------------------------------------------------------------------
// Community sort validation
// ---------------------------------------------------------------------------

export type CommunitySortType = 'popular' | 'active' | 'new' | 'alphabetical'

const VALID_COMMUNITY_SORTS: ReadonlySet<CommunitySortType> =
  new Set<CommunitySortType>(['popular', 'active', 'new', 'alphabetical'])

export function isValidCommunitySort(s: string): s is CommunitySortType {
  return (VALID_COMMUNITY_SORTS as ReadonlySet<string>).has(s)
}

/**
 * Validates a community sort value.
 * Falls back to `'popular'` for invalid input.
 */
export function mapCommunitySort(sort: string): CommunitySortType {
  if (isValidCommunitySort(sort)) return sort
  console.warn(
    `[sort] Invalid community sort value "${sort}", falling back to "popular"`,
  )
  return 'popular'
}

/**
 * Validates and returns Coves listing type.
 * Falls back to `'discover'` for invalid input or unauthenticated timeline requests.
 */
export function mapListing(
  listing: string,
  isAuthenticated: boolean,
): CovesListingType {
  if (listing === 'timeline') return isAuthenticated ? 'timeline' : 'discover'
  if (listing !== 'discover') {
    console.warn(
      `[sort] Invalid listing type "${listing}", falling back to "discover"`,
    )
  }
  return 'discover'
}
