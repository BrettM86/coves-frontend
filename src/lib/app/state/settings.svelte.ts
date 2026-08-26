import { browser } from '$app/environment'
import { env } from '$env/dynamic/public'
import { locale } from './i18n'
import { mergeDeep } from '../util/merge'
import {
  normalizeCommentSort,
  normalizeListing,
  normalizeSort,
  normalizeTimeframe,
  type CovesListingType,
  type CovesSortType,
  type CovesTimeframe,
} from '$lib/api/coves/sort'

export type View = 'cozy' | 'compact'

export const SSR_ENABLED = env.PUBLIC_SSR_ENABLED?.toLowerCase() == 'true'

// Returns a proper boolean or null.  Used to set boolean values from env var strings while allowing nullish coalescing to set default values.
const toBool = (str: string | undefined) => {
  if (!str) {
    return null
  }
  return str.toLowerCase() === 'true'
}

interface Preset {
  title?: string
  content: string
}

interface Settings {
  settingsVer: number
  expandableImages: boolean
  /** When true, read posts are visually faded in the feed. */
  markReadPosts: boolean

  view: View

  /**
   * Defaults applied when a feed URL carries no sort params. Every write path
   * runs these through {@link normalizeSettings}, so they always hold values
   * the Coves API accepts.
   */
  defaultSort: {
    sort: CovesSortType
    feed: CovesListingType
    comments: CovesSortType
    timeframe: CovesTimeframe
  }
  hidePosts: {
    deleted: boolean
    removed: boolean
  }
  expandSidebar: boolean
  expand: {
    communities: boolean
    moderates: boolean
    favorites: boolean
    about: boolean
    stats: boolean
    team: boolean
    accounts: boolean
  }
  nsfwBlur: boolean
  moderation: {
    presets: Preset[]
    defaultRemoveAction: 'comment' | 'message' | null
  }
  modlogCardView: boolean | undefined
  debugInfo: boolean
  expandImages: boolean

  font: 'inter' | 'system' | 'browser'
  leftAlign: boolean

  newWidth: boolean
  markPostsAsRead: boolean

  openLinksInNewTab: boolean
  crosspostOriginalLink: boolean

  embeds: {
    clickToView: boolean
    youtube: 'youtube' | 'invidious' | 'piped'
    invidious: string | undefined
    piped: string | undefined
  }
  dock: {
    paletteHotkey: string
    autoHide: boolean
  }
  posts: {
    deduplicateEmbed: boolean
    compactFeatured: boolean
    showHidden: boolean
    noVirtualize: boolean
    reverseActions: boolean
    titleOpensUrl: boolean
  }
  infiniteScroll: boolean
  language: string | null
  useRtl: boolean
  parseTags: boolean
  logoColorMonth: number | null

  absoluteDates: boolean
  messages: {
    fullMarkdown: boolean
  }
  voteRatioBar: boolean
}

export const defaultSettings: Settings = {
  settingsVer: 7,
  expandableImages: toBool(env.PUBLIC_EXPANDABLE_IMAGES) ?? true,
  markReadPosts: toBool(env.PUBLIC_MARK_READ_POSTS) ?? true,
  defaultSort: {
    sort: normalizeSort(env.PUBLIC_DEFAULT_FEED_SORT ?? 'hot'),
    feed: normalizeListing(env.PUBLIC_DEFAULT_FEED ?? 'discover'),
    comments: normalizeCommentSort(env.PUBLIC_DEFAULT_COMMENT_SORT ?? 'hot'),
    timeframe: normalizeTimeframe(env.PUBLIC_DEFAULT_FEED_TIMEFRAME ?? 'all'),
  },
  hidePosts: {
    deleted: toBool(env.PUBLIC_HIDE_DELETED) ?? false,
    removed: toBool(env.PUBLIC_HIDE_REMOVED) ?? false,
  },
  expandSidebar: toBool(env.PUBLIC_EXPAND_SIDEBAR) ?? true,
  expand: {
    communities: toBool(env.PUBLIC_EXPAND_COMMUNITIES) ?? true,
    favorites: toBool(env.PUBLIC_EXPAND_FAVORITES) ?? true,
    moderates: toBool(env.PUBLIC_EXPAND_MODERATES) ?? true,
    about: false,
    stats: false,
    team: false,
    accounts: true,
  },
  nsfwBlur: toBool(env.PUBLIC_NSFW_BLUR) ?? true,
  moderation: {
    presets: [
      {
        title: 'Preset 1',
        content: `Your submission in *"{{post}}"* was removed for {{reason}}.`,
      },
    ],
    defaultRemoveAction: null,
  },
  modlogCardView: toBool(env.PUBLIC_MODLOG_CARD_VIEW) ?? undefined,
  debugInfo: toBool(env.PUBLIC_DEBUG_INFO) ?? false,
  expandImages: toBool(env.PUBLIC_EXPAND_IMAGES) ?? true,
  view: (env.PUBLIC_VIEW as View) ?? 'compact',
  font: (env.PUBLIC_FONT as 'inter') ?? 'inter',
  leftAlign: toBool(env.PUBLIC_LEFT_ALIGN) ?? false,
  newWidth: toBool(env.PUBLIC_LIMIT_LAYOUT_WIDTH) ?? true,
  markPostsAsRead: toBool(env.PUBLIC_MARK_POSTS_AS_READ) ?? true,
  openLinksInNewTab: false,
  crosspostOriginalLink: true,
  embeds: {
    clickToView: true,
    youtube: 'youtube',
    invidious: undefined,
    piped: undefined,
  },
  dock: {
    paletteHotkey: '/',
    autoHide: true,
  },
  posts: {
    deduplicateEmbed: toBool(env.PUBLIC_DEDUPLICATE_EMBED) ?? true,
    compactFeatured: toBool(env.PUBLIC_COMPACT_FEATURED) ?? true,
    showHidden: false,
    noVirtualize: false,
    reverseActions: toBool(env.PUBLIC_REVERSE_ACTIONS) ?? false,
    titleOpensUrl: toBool(env.PUBLIC_TITLE_OPENS_URL) ?? false,
  },
  infiniteScroll: true,
  language: env.PUBLIC_LANGUAGE ?? null,
  useRtl: false,
  parseTags: true,
  logoColorMonth: null,
  absoluteDates: false,
  messages: {
    fullMarkdown: toBool(env.PUBLIC_FULL_MARKDOWN) ?? false,
  },
  voteRatioBar: false,
}

/**
 * Clones the defaults so callers can mutate the result freely.
 *
 * Must be `structuredClone`, never a JSON round-trip: JSON drops keys whose
 * value is `undefined` (`modlogCardView`, `embeds.invidious`, `embeds.piped`),
 * and mergeDeep only keeps keys the target defines — so a JSON clone would
 * make those settings unknown and silently discard the user's stored values.
 */
function cloneDefaults(defaultValue: Settings): Settings {
  return structuredClone(defaultValue)
}

function getInitialSettings(defaultValue: Settings): Settings {
  if (!browser) {
    return cloneDefaults(defaultValue)
  }
  try {
    const localSettings = JSON.parse(
      localStorage.getItem('settings') ?? '{}',
    ) as unknown
    const cloned = cloneDefaults(defaultValue) as unknown as Record<
      string,
      unknown
    >
    // Layering over the defaults also prunes settings removed in later
    // versions — mergeDeep keeps only keys the defaults still define.
    return mergeDeep(cloned, localSettings) as unknown as Settings
  } catch (err) {
    console.error(
      '[settings] Failed to parse settings from localStorage:',
      err instanceof Error ? err.message : String(err),
    )
    return cloneDefaults(defaultValue)
  }
}

/**
 * Coerces the feed defaults to values the Coves API accepts, in place.
 *
 * Legacy Lemmy-era values ('Hot', 'TopWeek', 'Subscribed', ...) persisted by
 * older versions of the app, and anything supplied by a hand-edited settings
 * import, would otherwise render blank in the settings selects and be rejected
 * by `mapSort`/`mapListing` on every feed load. Call this on any path that can
 * introduce foreign values.
 */
export function normalizeSettings(target: Settings): void {
  target.defaultSort.comments = normalizeCommentSort(
    target.defaultSort.comments,
  )
  target.defaultSort.sort = normalizeSort(target.defaultSort.sort)
  target.defaultSort.timeframe = normalizeTimeframe(
    target.defaultSort.timeframe,
  )
  target.defaultSort.feed = normalizeListing(target.defaultSort.feed)
}

/**
 * Restores every setting to its default.
 *
 * The clone matters: assigning `defaultSettings` directly would alias its
 * nested objects (`defaultSort`, `embeds`, ...) into the live state, so the
 * next settings edit would mutate the defaults singleton and leave the user
 * with nothing to reset to.
 */
export function resetSettings(): void {
  Object.assign(settings, cloneDefaults(defaultSettings))
}

/**
 * Replaces the live settings with a user-supplied JSON export.
 *
 * The payload is layered onto a *detached* clone of the defaults rather than
 * onto the live object: `mergeDeep` keeps only keys the current schema defines
 * and only values whose shape matches, which is also what drops a crafted
 * `__proto__` key — spreading the parsed JSON into `Object.assign` would hand
 * it the live settings object's prototype. Building the candidate first also
 * means a payload that fails partway leaves the live settings untouched
 * instead of half-written.
 *
 * @throws {SyntaxError} if the text is not JSON.
 * @throws {Error} if the JSON is not an object (`42`, `"oops"`, `[]`), which
 * would otherwise merge nothing and silently reset every setting.
 */
export function importSettings(json: string): void {
  const parsed: unknown = JSON.parse(json)

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Settings must be a JSON object')
  }

  const candidate = mergeDeep(
    cloneDefaults(defaultSettings) as unknown as Record<string, unknown>,
    parsed,
  ) as unknown as Settings
  normalizeSettings(candidate)

  Object.assign(settings, candidate)
}

function createSettingsState(initial: Settings): Settings {
  const loaded = getInitialSettings(initial)
  normalizeSettings(loaded)
  const settings = $state(loaded)
  return settings
}

export const settings = createSettingsState(defaultSettings)

$effect.root(() => {
  $effect(() => {
    try {
      localStorage.setItem('settings', JSON.stringify(settings))
    } catch (err) {
      // Storage can be unavailable or full (private browsing, blocked
      // cookies). Losing persistence must not take the reactive graph with it.
      console.error(
        '[settings] Failed to persist settings:',
        err instanceof Error ? err.message : String(err),
      )
    }

    if (settings.language) {
      locale.set(settings.language)
    } else {
      if (browser) locale.set(navigator?.language)
    }
  })

  return () => {}
})
