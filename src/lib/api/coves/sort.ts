// ---------------------------------------------------------------------------
// Sort and listing type validation
// ---------------------------------------------------------------------------

export type CovesSortType = 'hot' | 'new' | 'top'
export type CovesListingType = 'discover' | 'timeline'

/**
 * The timeframes `sort=top` accepts, ascending, each with its label key.
 *
 * Single source of truth for every place a viewer picks a timeframe — the sort
 * menu, the settings default, the noscript form, the command palette — so the
 * lists cannot drift apart. {@link CovesTimeframe} is derived from it, which
 * is why a timeframe added here needs no other type change.
 */
export const TIMEFRAME_OPTIONS = [
  { value: 'hour', labelKey: 'filter.sort.top.time.hour' },
  { value: 'day', labelKey: 'filter.sort.top.time.day' },
  { value: 'week', labelKey: 'filter.sort.top.time.week' },
  { value: 'month', labelKey: 'filter.sort.top.time.month' },
  { value: 'year', labelKey: 'filter.sort.top.time.year' },
  { value: 'all', labelKey: 'filter.sort.top.time.all' },
] as const

export type CovesTimeframe = (typeof TIMEFRAME_OPTIONS)[number]['value']

export type CovesSortParams =
  | { sort: 'hot'; timeframe?: undefined }
  | { sort: 'new'; timeframe?: undefined }
  | { sort: 'top'; timeframe: CovesTimeframe }

const VALID_SORTS: ReadonlySet<CovesSortType> = new Set<CovesSortType>([
  'hot',
  'new',
  'top',
])
const VALID_TIMEFRAMES: ReadonlySet<CovesTimeframe> = new Set<CovesTimeframe>(
  TIMEFRAME_OPTIONS.map((option) => option.value),
)

/**
 * Lowercases anything for validation, mapping non-strings to `''`.
 *
 * The normalizers below run on hand-edited imports and corrupted localStorage,
 * where a leaf can be any JSON value; they must coerce rather than throw, since
 * one of their callers runs during app boot.
 */
function normalizeCase(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : ''
}

export function isValidSort(s: string): s is CovesSortType {
  return (VALID_SORTS as ReadonlySet<string>).has(s)
}

export function isValidTimeframe(t: string): t is CovesTimeframe {
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

/**
 * Normalizes a persisted or env-provided sort value to a valid Coves sort.
 * Handles legacy capitalized values ('Hot', 'Top', 'TopAll', 'New', ...)
 * written by older versions of the app; anything unrecognized (e.g. 'Old',
 * 'Controversial') or not a string at all falls back to `'hot'`.
 */
export function normalizeSort(sort: unknown): CovesSortType {
  const value = normalizeCase(sort)
  if (isValidSort(value)) return value
  if (value.startsWith('top')) return 'top'
  return 'hot'
}

/**
 * Normalizes a persisted or env-provided timeframe to a valid Coves timeframe.
 * Falls back to `'all'`.
 */
export function normalizeTimeframe(timeframe: unknown): CovesTimeframe {
  const value = normalizeCase(timeframe)
  return isValidTimeframe(value) ? value : 'all'
}

/**
 * Resolves the sort params for a feed load from the URL, falling back to the
 * viewer's saved defaults.
 *
 * The saved timeframe only applies when the sort itself came from settings. A
 * URL that names a sort explicitly (`?sort=top`, a shared link, the command
 * palette) gets `mapSort`'s `'all'` fallback instead, so a link means the same
 * thing to everyone who opens it rather than inheriting the reader's settings.
 *
 * A sort the API doesn't accept is graced through {@link normalizeSort} rather
 * than dropped: bookmarks from the Lemmy-era UI carry `?sort=TopWeek`, and
 * salvaging the intent ('top') beats silently showing them 'hot'.
 */
export function resolveFeedSort(
  url: URL,
  defaults: { sort: string; timeframe: string },
): CovesSortParams {
  const urlSort = url.searchParams.get('sort')
  const urlTimeframe = url.searchParams.get('timeframe') ?? undefined

  const sort = urlSort ?? defaults.sort
  const timeframe =
    urlTimeframe ?? (urlSort === null ? defaults.timeframe : undefined)

  if (isValidSort(sort)) return mapSort(sort, timeframe)

  const salvaged = normalizeSort(sort)
  console.warn(`[sort] Legacy sort value "${sort}", mapping to "${salvaged}"`)
  return mapSort(salvaged, timeframe)
}

// ---------------------------------------------------------------------------
// Comment sort normalization and legacy (Lemmy) mapping
// ---------------------------------------------------------------------------

/** @see {@link normalizeSort} — comment sorts share the same value space. */
export function normalizeCommentSort(sort: unknown): CovesSortType {
  return normalizeSort(sort)
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
 * Normalizes a persisted or env-provided listing type to a valid Coves
 * listing. Legacy Lemmy 'Subscribed' becomes 'timeline', the feed of the
 * communities you follow; every other legacy value ('All', 'Local',
 * 'ModeratorView'), and anything that isn't a string, falls back to
 * 'discover'.
 *
 * Auth state is deliberately not considered: this only guarantees the stored
 * value is one the app can render. {@link mapListing} still downgrades
 * 'timeline' to 'discover' for signed-out requests when a feed is loaded.
 */
export function normalizeListing(listing: unknown): CovesListingType {
  const value = normalizeCase(listing)
  return value === 'timeline' || value === 'subscribed'
    ? 'timeline'
    : 'discover'
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
