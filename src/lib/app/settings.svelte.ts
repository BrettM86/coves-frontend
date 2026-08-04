import { browser } from '$app/environment'
import { env } from '$env/dynamic/public'
import { locale } from './i18n'
import { mergeDeep } from './merge'
import { normalizeCommentSort } from './sort'

/**
 * Sort type values for the Coves API.
 *
 * The `| (string & {})` fallback allows values from env vars and localStorage
 * that may not match these known literals.
 */
type SortType = 'hot' | 'new' | 'top' | (string & {})

type ListingType = 'discover' | 'timeline' | (string & {})

type CommentSortType = 'hot' | 'top' | 'new' | (string & {})

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

  defaultSort: {
    sort: SortType
    feed: ListingType
    comments: CommentSortType
    timeframe: string
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
    sort: (env.PUBLIC_DEFAULT_FEED_SORT ?? 'hot') as SortType,
    feed: (env.PUBLIC_DEFAULT_FEED ?? 'discover') as ListingType,
    comments: (env.PUBLIC_DEFAULT_COMMENT_SORT ?? 'hot') as CommentSortType,
    timeframe: env.PUBLIC_DEFAULT_FEED_TIMEFRAME ?? 'all',
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

function createSettingsState(initial: Settings): Settings {
  const loaded = getInitialSettings(initial)
  // Migrate legacy capitalized comment sort values ('Hot', 'Top', 'TopAll',
  // 'Old', ...) persisted by older app versions (or set via env) to valid
  // lowercase Coves values.
  loaded.defaultSort.comments = normalizeCommentSort(
    loaded.defaultSort.comments,
  )
  const settings = $state(loaded)
  return settings
}

export const settings = createSettingsState(defaultSettings)

$effect.root(() => {
  $effect(() => {
    localStorage.setItem('settings', JSON.stringify(settings))

    if (settings.language) {
      locale.set(settings.language)
    } else {
      if (browser) locale.set(navigator?.language)
    }
  })

  return () => {}
})
