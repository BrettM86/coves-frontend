import {
  type AtUri,
  isValidAtUri,
  type ListNotificationsResponse,
  type NotificationActor,
  type NotificationRecord,
  type NotificationSubject,
  type NotificationView,
  parseAtUri,
} from '$lib/api/coves/types'
import { t } from '$lib/app/state/i18n'
import { communityMention } from '$lib/app/util/community'
import { hasNSFWLabel } from '$lib/feature/post/content-labels'
import {
  commentLink,
  postLink,
  type PostLinkRef,
} from '$lib/feature/post/helpers'
import { isValidDID, isValidHandle, usableHandle } from '$lib/types/atproto'
import { usableDate } from './timestamp'

export type ReplyNotificationRow = NotificationView & {
  reason: 'postReply' | 'commentReply' | 'mention'
  record: NotificationRecord
}

export type UpvoteNotificationRow = NotificationView & {
  reason: 'upvote'
  subject: NotificationSubject
  recentUpvoters: NotificationActor[]
}

export type NotificationRow = ReplyNotificationRow | UpvoteNotificationRow

const replyReasons: ReadonlySet<string> = new Set([
  'postReply',
  'commentReply',
  'mention',
])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether `value` has a full `at://<did>/<collection>/<rkey>` uri: the form
 * `parseAtUri` accepts. `isValidAtUri` alone also accepts authority-only and
 * collection-only URIs, which `parseAtUri` rejects.
 */
function hasRecordUri(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.uri === 'string' &&
    isValidAtUri(value.uri) &&
    // "at:", "", did, collection, rkey
    value.uri.split('/').length === 5
  )
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isNotificationActor(value: unknown): value is NotificationActor {
  return (
    isObject(value) &&
    typeof value.did === 'string' &&
    isOptionalString(value.handle) &&
    isOptionalString(value.displayName) &&
    isOptionalString(value.avatar)
  )
}

/**
 * Keeps the rows a notification list can render, in server order. Rows are
 * untrusted wire data: a row with an unknown reason or without the references
 * its reason needs is skipped. Kept rows are returned as received, except for
 * malformed parts: an invalid `author` is dropped (the row shows as "Unknown
 * user"), invalid `recentUpvoters` entries are removed, and malformed root
 * post `author`, `createdAt` and `stats` parts are dropped, in shallow copies.
 * An upvote group whose `recentUpvoters` was omitted gets an empty list.
 */
export function parseNotificationRows(
  response: ListNotificationsResponse,
): NotificationRow[] {
  const rows: unknown[] = Array.isArray(response.notifications)
    ? response.notifications
    : []
  const parsed: NotificationRow[] = []
  for (const row of rows) {
    const notification = parseNotificationRow(row)
    if (notification) parsed.push(notification)
  }
  return parsed
}

function parseNotificationRow(received: unknown): NotificationRow | undefined {
  if (
    !isObject(received) ||
    typeof received.reason !== 'string' ||
    typeof received.sortAt !== 'string' ||
    typeof received.isRead !== 'boolean' ||
    !isObject(received.rootPost) ||
    !hasRecordUri(received.rootPost)
  ) {
    return undefined
  }
  const { reason } = received
  const rootPost = withValidRootParts(received.rootPost)
  const row =
    rootPost === received.rootPost ? received : { ...received, rootPost }

  if (replyReasons.has(reason)) {
    if (!hasRecordUri(row.record)) return undefined
    if (row.author === undefined || isNotificationActor(row.author)) {
      return row as unknown as ReplyNotificationRow
    }
    const withoutAuthor = { ...row }
    delete withoutAuthor.author
    return withoutAuthor as unknown as ReplyNotificationRow
  }

  if (reason !== 'upvote' || !hasRecordUri(row.subject)) return undefined

  const { recentUpvoters, upvoteCount } = row
  if (recentUpvoters !== undefined && !Array.isArray(recentUpvoters)) {
    return undefined
  }
  const validUpvoters = recentUpvoters?.filter(isNotificationActor) ?? []
  // A group needs at least one upvoter to show: a valid recent upvoter, or a
  // positive count (bridged-only groups arrive with a count and no upvoters).
  const hasUpvoter =
    validUpvoters.length > 0 || usableUpvoteCount(upvoteCount) > 0
  if (!hasUpvoter) return undefined

  if (validUpvoters.length === recentUpvoters?.length) {
    return row as unknown as UpvoteNotificationRow
  }
  return {
    ...row,
    recentUpvoters: validUpvoters,
  } as unknown as UpvoteNotificationRow
}

// The postStats lexicon requires these nonnegative; `score` may be negative.
const rootPostStatsCounts = ['upvotes', 'downvotes', 'commentCount'] as const

function isRootPostAuthor(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.did === 'string' &&
    isValidDID(value.did) &&
    typeof value.handle === 'string' &&
    isOptionalString(value.displayName) &&
    isOptionalString(value.avatar)
  )
}

function isRootPostStats(value: unknown): boolean {
  return (
    isObject(value) &&
    Number.isSafeInteger(value.score) &&
    rootPostStatsCounts.every((count) => {
      const number = value[count]
      return (
        typeof number === 'number' &&
        Number.isSafeInteger(number) &&
        number >= 0
      )
    })
  )
}

/**
 * The root post with each malformed card part (`author`, `createdAt`,
 * `stats`) removed, in a shallow copy; the root itself when every present
 * part is valid.
 */
function withValidRootParts(
  rootPost: Record<string, unknown>,
): Record<string, unknown> {
  const malformed: string[] = []
  if (rootPost.author !== undefined && !isRootPostAuthor(rootPost.author)) {
    malformed.push('author')
  }
  if (rootPost.createdAt !== undefined && !usableDate(rootPost.createdAt)) {
    malformed.push('createdAt')
  }
  if (rootPost.stats !== undefined && !isRootPostStats(rootPost.stats)) {
    malformed.push('stats')
  }
  if (malformed.length === 0) return rootPost
  const sanitized = { ...rootPost }
  for (const part of malformed) delete sanitized[part]
  return sanitized
}

/**
 * The wire `upvoteCount` when it is a positive safe integer, else 0. Rejects
 * non-numbers, fractions, and JSON overflow such as `1e400` (Infinity).
 */
function usableUpvoteCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : 0
}

/** The actor's trimmed display name, else its usable handle, else "Unknown user". */
export function actorName(actor: NotificationActor): string {
  const displayName = actor.displayName?.trim()
  if (displayName) return displayName
  return usableHandle(actor.handle) ?? t.get('routes.notifications.unknownUser')
}

export interface NotificationAuthor {
  name: string
  handle?: string
  avatarUrl?: string
  avatarSeed: string
  /** The author's DID for the default avatar; `""` when none is known. */
  did: string
}

/**
 * Who wrote a reply or mention. Without an author the row is attributed to
 * "Unknown user", seeded by the record so each such row gets its own avatar,
 * and its DID is the record URI's authority when that is a DID.
 */
export function notificationAuthor(
  row: ReplyNotificationRow,
): NotificationAuthor {
  const { author } = row
  if (!author) {
    const authority = parseAtUri(row.record.uri).did
    return {
      name: t.get('routes.notifications.unknownUser'),
      avatarSeed: row.record.uri,
      did: isValidDID(authority) ? authority : '',
    }
  }
  const result: NotificationAuthor = {
    name: actorName(author),
    avatarSeed: author.did,
    did: author.did,
  }
  const handle = usableHandle(author.handle)
  if (handle) result.handle = handle
  if (author.avatar) result.avatarUrl = author.avatar
  return result
}

/** A stable key for a row: its reason and the record or upvoted subject URI. */
export function notificationIdentity(row: NotificationRow): string {
  return row.reason === 'upvote'
    ? `upvote|${row.subject.uri}`
    : `${row.reason}|${row.record.uri}`
}

/** The rows without repeats, in order: the first row with an identity wins. */
export function uniqueRows(
  rows: readonly NotificationRow[],
): NotificationRow[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const identity = notificationIdentity(row)
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

/**
 * The link ref for a row's root post. `rootPost.community` is unvalidated wire
 * data: it is used only when its `did` is a valid DID and its `name` a string,
 * keeping `handle` only when it is a valid handle and `origin` when a string.
 * Otherwise (placeholder roots, live roots the appview served without a
 * community) the community is named by the root post's repo DID, which the
 * community route accepts.
 */
export function notificationRootRef(row: NotificationRow): PostLinkRef {
  const { uri, community } = row.rootPost
  return { uri, community: rootCommunity(uri, community) }
}

function rootCommunity(
  rootUri: AtUri,
  community: unknown,
): PostLinkRef['community'] {
  if (
    !isObject(community) ||
    typeof community.did !== 'string' ||
    !isValidDID(community.did) ||
    typeof community.name !== 'string'
  ) {
    return { did: parseAtUri(rootUri).did, name: '' }
  }
  const result: PostLinkRef['community'] = {
    did: community.did,
    name: community.name,
  }
  if (typeof community.handle === 'string' && isValidHandle(community.handle)) {
    result.handle = community.handle
  }
  if (typeof community.origin === 'string') result.origin = community.origin
  return result
}

const commentCollection = 'social.coves.community.comment'

/** Whether `uri` names a comment record. */
export function isCommentUri(uri: AtUri): boolean {
  return parseAtUri(uri).collection === commentCollection
}

/**
 * Where a row leads: the reply or mention record, or the upvoted subject.
 * Reply and mention records are named by their author; an upvoted record is
 * named by its repo DID, never by an upvoter.
 */
export function notificationHref(row: NotificationRow): string {
  const rootRef = notificationRootRef(row)
  const isUpvote = row.reason === 'upvote'
  const uri = isUpvote ? row.subject.uri : row.record.uri
  const author = isUpvote || !row.author ? undefined : row.author
  if (isCommentUri(uri)) {
    return commentLink(rootRef, uri, author)
  }
  return postLink({ uri, community: rootRef.community, author })
}

export type PlaceholderCopyKey =
  | 'comment.placeholder.deletedByUser'
  | 'comment.placeholder.removedByModerator'
  | 'comment.placeholder.removedByAdmin'

/**
 * The i18n key for a removed or deleted reference's placeholder. A status this
 * client does not know yet reads as a moderator removal.
 */
export function placeholderCopyKey(status: string): PlaceholderCopyKey {
  switch (status) {
    case 'deleted':
      return 'comment.placeholder.deletedByUser'
    case 'removedByServerAdmin':
      return 'comment.placeholder.removedByAdmin'
    default:
      return 'comment.placeholder.removedByModerator'
  }
}

/**
 * Whether the root post, the row's subject (the upvoted record, or the replied-to
 * post or comment) or its record is labelled NSFW.
 */
export function isSensitiveRow(row: NotificationRow): boolean {
  return (
    hasNSFWLabel(row.rootPost.labels) ||
    hasNSFWLabel(row.subject?.labels) ||
    hasNSFWLabel(row.record?.labels)
  )
}

export interface UpvoteSentencePart {
  text: string
  bold: boolean
}

/**
 * "alice and 4 others liked your post": up to all recent upvoters by name,
 * or the first one and a count of the rest, or only a count when no upvoter is
 * known. Names and counts are the bold parts. `upvoteCount` is unvalidated
 * wire data; anything but a positive safe integer counts as 0, and the count
 * is never below the number of named upvoters.
 */
export function upvoteSentence(
  row: UpvoteNotificationRow,
): UpvoteSentencePart[] {
  return [
    ...upvoteNames(row),
    plain(
      t.get(
        isCommentUri(row.subject.uri)
          ? 'routes.notifications.upvote.yourComment'
          : 'routes.notifications.upvote.yourPost',
      ),
    ),
  ]
}

/**
 * The upvoters part of `upvoteSentence`, without the "liked your post" ending:
 * the line under an upvote row's title.
 */
export function upvoteNames(row: UpvoteNotificationRow): UpvoteSentencePart[] {
  const upvoters = row.recentUpvoters
  const reported = usableUpvoteCount(row.upvoteCount)
  const count = Math.max(reported, upvoters.length)
  const parts: UpvoteSentencePart[] = []
  const [firstUpvoter] = upvoters

  if (!firstUpvoter) {
    parts.push(bold(t.get('routes.notifications.upvote.people', { count })))
  } else if (count > upvoters.length) {
    parts.push(
      bold(actorName(firstUpvoter)),
      plain(t.get('routes.notifications.upvote.and')),
      bold(t.get('routes.notifications.upvote.others', { count: count - 1 })),
    )
  } else {
    upvoters.forEach((upvoter, index) => {
      if (index > 0) {
        const separator =
          index === upvoters.length - 1
            ? 'routes.notifications.upvote.and'
            : 'routes.notifications.upvote.listSeparator'
        parts.push(plain(t.get(separator)))
      }
      parts.push(bold(actorName(upvoter)))
    })
  }

  return parts
}

function bold(text: string): UpvoteSentencePart {
  return { text, bold: true }
}

function plain(text: string): UpvoteSentencePart {
  return { text, bold: false }
}

/**
 * The accessible name of a row's link: who did what (and, for replies and
 * mentions, in which community), then the row's text, then `time` verbatim;
 * an empty `time` leaves the time segment and its ". " separator out.
 * The text is the excerpt or preview, or the placeholder copy of a removed or
 * deleted record; it is left out when `concealed` (the caller's sensitive-
 * content decision). Never names the root post's title or any image alt.
 */
export function notificationLinkName(
  row: NotificationRow,
  options: { time: string; concealed: boolean },
): string {
  const head = linkNameHead(row)
  const text = options.concealed ? undefined : linkNameText(row)
  const withText = text
    ? t.get('routes.notifications.linkName.withText', { head, text })
    : head
  if (options.time === '') return withText
  return t.get('routes.notifications.linkName.withTime', {
    head: withText,
    time: options.time,
  })
}

function linkNameHead(row: NotificationRow): string {
  if (row.reason === 'upvote') {
    return upvoteSentence(row)
      .map((part) => part.text)
      .join('')
  }
  const head = t.get(`routes.notifications.linkName.${row.reason}`, {
    name: notificationAuthor(row).name,
  })
  const { community } = notificationRootRef(row)
  if (row.rootPost.status || community.name === '') return head
  return t.get('routes.notifications.linkName.inCommunity', {
    head,
    community: communityMention(community),
  })
}

function linkNameText(row: NotificationRow): string | undefined {
  return row.reason === 'upvote' ? upvoteSubjectText(row) : replyRecordText(row)
}

/**
 * The text an upvote row shows for its subject, shared by the row and the
 * link name: the placeholder copy of a removed or deleted subject, else its
 * preview.
 */
export function upvoteSubjectText(
  row: UpvoteNotificationRow,
): string | undefined {
  const { status, preview } = row.subject
  if (status) return t.get(placeholderCopyKey(status))
  return preview
}

export interface RepliedToComment {
  text: string
  /** Whether `text` is the placeholder copy of a removed or deleted comment. */
  placeholder: boolean
}

/**
 * The viewer's comment a `commentReply` row answers, from the row's subject:
 * the placeholder copy when it is removed or deleted, else its preview.
 * Undefined for other reasons, and for a subject that is not a comment or has
 * neither a status nor a preview. On reply rows `subject` is unvalidated wire
 * data, so its shape is checked here.
 */
export function repliedToComment(
  row: ReplyNotificationRow,
): RepliedToComment | undefined {
  if (row.reason !== 'commentReply') return undefined
  const subject: unknown = row.subject
  if (!isObject(subject) || !hasRecordUri(subject)) return undefined
  if (!isCommentUri(subject.uri as AtUri)) return undefined
  if (typeof subject.status === 'string' && subject.status !== '') {
    return {
      text: t.get(placeholderCopyKey(subject.status)),
      placeholder: true,
    }
  }
  if (typeof subject.preview === 'string' && subject.preview.trim() !== '') {
    return { text: subject.preview, placeholder: false }
  }
  return undefined
}

/**
 * The text a reply or mention row shows for its record, shared by the card
 * and the link name: the placeholder copy of a removed or deleted record, else
 * its excerpt. A post mention's excerpt is the backend's 140-grapheme cut of
 * the post's own title (no ellipsis), which the root title already shows, so
 * it is left out when the title equals or starts with it.
 */
export function replyRecordText(row: ReplyNotificationRow): string | undefined {
  const { status, excerpt, uri } = row.record
  if (status) return t.get(placeholderCopyKey(status))
  const { title } = row.rootPost
  if (
    row.reason === 'mention' &&
    !isCommentUri(uri) &&
    excerpt &&
    title?.startsWith(excerpt)
  ) {
    return undefined
  }
  return excerpt
}
