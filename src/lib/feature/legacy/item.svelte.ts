import type {
  CommentView,
  CommunityView,
  PostView,
  ProfileViewDetailed,
} from '$lib/api/coves/types'
import { toast } from 'mono-svelte'

/**
 * Union of all result types that can appear in search results, feeds, etc.
 *
 * NOTE: These types lack a shared discriminant property. Type guards below use
 * structural checks (e.g., 'rkey' in item) which is fragile but correct for
 * the current Coves type shapes. If upstream types add a `$type` discriminant
 * to view types, prefer switching to that.
 *
 * Some consumers (search, moderation, profile) still pass Lemmy types
 * through @ts-nocheck files. These type guards are designed to work with both
 * Coves and legacy Lemmy shapes by checking for discriminating properties.
 */
export type Result =
  | PostView
  | CommentView
  | ProfileViewDetailed
  | CommunityView

/**
 * Extracts the published/created timestamp from any result type.
 *
 * Works with both Coves types (which have `createdAt`) and legacy Lemmy types
 * (which have nested `post.published`, `comment.published`, etc.) since some
 * consumers still pass Lemmy data through @ts-nocheck files.
 */
export function getItemPublished(item: Result): string {
  // Coves types all have a top-level `createdAt`
  if ('createdAt' in item && typeof item.createdAt === 'string') {
    return item.createdAt
  }

  // Legacy Lemmy fallbacks (for @ts-nocheck consumers)
  const legacy = item as unknown as Record<string, unknown>
  if (hasPublished(legacy, 'comment'))
    return (legacy.comment as Record<string, string>).published
  if (hasPublished(legacy, 'post'))
    return (legacy.post as Record<string, string>).published
  if (hasPublished(legacy, 'person'))
    return (legacy.person as Record<string, string>).published
  if (hasPublished(legacy, 'community'))
    return (legacy.community as Record<string, string>).published

  console.warn('[item] getItemPublished: unrecognized item type', item)
  return ''
}

/** Checks whether `obj[key]` is an object with a `published` string property. */
function hasPublished(obj: Record<string, unknown>, key: string): boolean {
  const nested = obj[key]
  return (
    typeof nested === 'object' &&
    nested !== null &&
    'published' in nested &&
    typeof (nested as Record<string, unknown>).published === 'string'
  )
}

/**
 * Type guard for Coves PostView.
 *
 * Discriminates by having `rkey` and `community` (both unique to PostView)
 * and NOT having `record` with a `$type` of comment.
 */
export const isPostView = (item: Result): item is PostView =>
  'rkey' in item && 'community' in item && !isCommentView(item)

/**
 * Type guard for Coves CommentView.
 *
 * Discriminates by having a `record` property whose `$type` is
 * `'social.coves.community.comment'`. Both PostRecord and CommentRecord
 * have a `$type` field, so checking existence alone is insufficient.
 */
export const isCommentView = (item: Result): item is CommentView =>
  'record' in item &&
  typeof item.record === 'object' &&
  item.record !== null &&
  '$type' in item.record &&
  (item.record as { $type: string }).$type === 'social.coves.community.comment'

/**
 * Type guard for Coves CommunityView.
 *
 * Discriminates by having `subscriberCount` (unique to CommunityView).
 */
export const isCommunityView = (item: Result): item is CommunityView =>
  'subscriberCount' in item

/**
 * Type guard for Coves ProfileViewDetailed (user).
 *
 * Discriminates by having `did` but NOT `rkey` (which PostView has)
 * and NOT `subscriberCount` (which CommunityView has)
 * and NOT `record` (which CommentView has).
 */
export const isUser = (item: Result): item is ProfileViewDetailed =>
  'did' in item &&
  !('rkey' in item) &&
  !('subscriberCount' in item) &&
  !('record' in item)

export interface ResumableItem {
  url: string
  uri?: string
  name: string
  avatar?: string
  type: 'community' | 'post'
  subdivision?: {
    avatar?: string
    name: string
  }
}

class ResumableStore {
  #items = $state<ResumableItem[]>([])
  private limit: number

  constructor(limit: number = 10) {
    this.limit = limit
  }

  get items(): readonly ResumableItem[] {
    return this.#items
  }

  add(item: ResumableItem) {
    if (this.#items.find((i) => JSON.stringify(i) === JSON.stringify(item)))
      return
    this.#items.unshift(item)
    if (this.#items.length > this.limit) this.#items.pop()
  }
}

export const resumables = new ResumableStore()

/**
 * @deprecated Legacy Lemmy code - needs Coves API replacement
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function addFavorite(_community: CommunityView, _add = true): void {
  toast({
    content: 'Favorites management is not yet available',
    type: 'warning',
  })
}
