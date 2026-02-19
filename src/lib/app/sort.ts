// ---------------------------------------------------------------------------
// Sort and listing type mapping
// ---------------------------------------------------------------------------

export type CovesSortType = 'hot' | 'new' | 'top'
export type CovesTimeframe = 'day' | 'week' | 'month' | 'all'
export type CovesListingType = 'discover' | 'timeline'

/**
 * Maps legacy PascalCase sort names from the Photon fork (e.g. 'Hot', 'TopDay')
 * to Coves API sort + timeframe parameters.
 *
 * The Photon-era Sort filter component still emits PascalCase values like 'Hot',
 * 'New', 'TopDay', etc. This function translates them into the lowercase sort
 * and optional timeframe values the Coves XRPC API expects.
 */
export function mapSort(legacySort: string): {
  sort: CovesSortType
  timeframe?: CovesTimeframe
} {
  switch (legacySort) {
    case 'Hot':
    case 'Active':
    case 'Scaled':
      return { sort: 'hot' }
    case 'New':
      return { sort: 'new' }
    case 'Old':
      return { sort: 'new' } // Coves has no 'old'; fall back to 'new'
    case 'TopAll':
      return { sort: 'top', timeframe: 'all' }
    case 'TopDay':
      return { sort: 'top', timeframe: 'day' }
    case 'TopWeek':
      return { sort: 'top', timeframe: 'week' }
    case 'TopMonth':
      return { sort: 'top', timeframe: 'month' }
    case 'TopThreeMonths':
      return { sort: 'top', timeframe: 'all' }
    case 'TopSixMonths':
      return { sort: 'top', timeframe: 'all' }
    case 'TopNineMonths':
      return { sort: 'top', timeframe: 'all' }
    case 'TopHour':
    case 'TopSixHour':
    case 'TopTwelveHour':
      return { sort: 'top', timeframe: 'day' }
    case 'Controversial':
      return { sort: 'hot' } // Coves has no 'controversial'; fall back
    case 'MostComments':
    case 'NewComments':
      return { sort: 'hot' } // Coves has no comment-based sorts; fall back
    default:
      return { sort: 'hot' }
  }
}

/**
 * Maps legacy PascalCase listing type names from the Photon fork
 * (e.g. 'Subscribed', 'All', 'Local') to Coves listing identifiers.
 *
 * Used by the home feed page to choose between the authenticated user's
 * timeline and the public discover feed.
 */
export function mapListing(
  legacyListing: string,
  isAuthenticated: boolean,
): CovesListingType {
  switch (legacyListing) {
    case 'Subscribed':
      return isAuthenticated ? 'timeline' : 'discover'
    case 'All':
    case 'Local':
    case 'ModeratorView':
    default:
      return 'discover'
  }
}
