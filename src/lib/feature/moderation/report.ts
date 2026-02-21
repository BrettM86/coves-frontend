import type { AuthorView, CommentView, PostView } from '$lib/api/coves/types'

/**
 * Report types for the Coves moderation system.
 *
 * NOTE: Coves does not yet have a report API. These types are placeholder
 * definitions to maintain compilation for the moderation UI routes.
 *
 * The generalize* functions below ARE called from the moderation/+page.ts
 * load function (which uses @ts-nocheck and the legacy Lemmy client).
 * They receive raw Lemmy report objects and must not crash on property access.
 */

/** Raw Lemmy report object passed from @ts-nocheck consumers. */
type LegacyReportInput = Record<string, unknown>

interface CommentReport {
  type: 'comment'
  item: CommentView
}

interface PostReport {
  type: 'post'
  item: PostView
}

interface MessageReport {
  type: 'message'
  item: Record<string, unknown>
}

interface BaseReport {
  creator: AuthorView
  reason: string
  reportee?: AuthorView
  timestamp: Date
  resolved: boolean
  id: string
  resolver?: AuthorView
}

export type ReportView = BaseReport &
  (CommentReport | PostReport | MessageReport)

/** Configuration for extracting a specific report type from a legacy Lemmy report object. */
interface LegacyReportConfig {
  /** The discriminant value for the ReportView union (e.g. 'comment', 'post', 'message'). */
  type: ReportView['type']
  /** The key on the raw object that holds the nested report data (e.g. 'comment_report'). */
  reportKey: string
  /** Keys to try (in order) when extracting the reported item from the raw object. */
  itemKeys: string[]
}

const EMPTY_AUTHOR: AuthorView = { did: '', handle: '[unknown]' } as AuthorView

/**
 * Shared helper that extracts a ReportView from a raw Lemmy report object.
 * All three generalize* functions delegate to this.
 *
 * The caller is responsible for passing the correct `type` discriminant and
 * `itemKeys`; the return is typed as `ReportView` (the full union) since
 * TypeScript cannot narrow a generic discriminant inside an object literal.
 */
function generalizeLegacyReport(
  report: LegacyReportInput,
  config: LegacyReportConfig,
): ReportView | null {
  const { type, reportKey, itemKeys } = config

  try {
    const nested = (report[reportKey] ?? {}) as Record<string, unknown>

    let item: unknown = report
    for (const key of itemKeys) {
      if (report[key] != null) {
        item = report[key]
        break
      }
    }

    // The cast is safe: each caller passes a literal `type` that matches its
    // item extraction keys, so the constructed object satisfies the union.
    return {
      type,
      item,
      creator: (report.creator ?? EMPTY_AUTHOR) as AuthorView,
      reason: String(nested.reason ?? ''),
      reportee: undefined,
      timestamp:
        typeof nested.published === 'string'
          ? new Date(nested.published)
          : new Date(),
      resolved: Boolean(nested.resolved),
      id: String(nested.id ?? ''),
      resolver: report.resolver ? (report.resolver as AuthorView) : undefined,
    } as ReportView
  } catch (err) {
    console.error(`[report] generalize ${type} report failed:`, err)
    return null
  }
}

/**
 * Generalizes a legacy Lemmy CommentReportView into a ReportView.
 *
 * @deprecated Uses legacy Lemmy data shape. Will be replaced when Coves report API is available.
 */
export function generalizeCommentReport(
  report: LegacyReportInput,
): ReportView | null {
  return generalizeLegacyReport(report, {
    type: 'comment',
    reportKey: 'comment_report',
    itemKeys: ['comment_view', 'comment'],
  })
}

/**
 * Generalizes a legacy Lemmy PostReportView into a ReportView.
 *
 * @deprecated Uses legacy Lemmy data shape. Will be replaced when Coves report API is available.
 */
export function generalizePostReport(
  report: LegacyReportInput,
): ReportView | null {
  return generalizeLegacyReport(report, {
    type: 'post',
    reportKey: 'post_report',
    itemKeys: ['post_view', 'post'],
  })
}

/**
 * Generalizes a legacy Lemmy PrivateMessageReportView into a ReportView.
 *
 * @deprecated Uses legacy Lemmy data shape. Will be replaced when Coves report API is available.
 */
export function generalizePrivateMessageReport(
  report: LegacyReportInput,
): ReportView | null {
  return generalizeLegacyReport(report, {
    type: 'message',
    reportKey: 'private_message_report',
    itemKeys: ['private_message'],
  })
}
