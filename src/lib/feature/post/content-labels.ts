import type { PostView } from '$lib/api/coves/types'

/** Read self-labels at the API boundary; federated records may be malformed. */
export function hasNSFWLabel(labels: unknown): boolean {
  if (!labels || typeof labels !== 'object' || !('values' in labels))
    return false
  if (!Array.isArray(labels.values)) return false

  return labels.values.some(
    (label: unknown) =>
      label !== null &&
      typeof label === 'object' &&
      'val' in label &&
      label.val === 'nsfw' &&
      (!('neg' in label) || label.neg === false),
  )
}

/**
 * Whether a post is concealed as sensitive: the author self-labelled it nsfw,
 * or a moderator applied an nsfw content label.
 */
export function isSensitivePost(
  post: Pick<PostView, 'record' | 'moderation'>,
): boolean {
  // Moderation data arrives unchecked, so tolerate malformed content labels.
  const contentLabels: unknown = post.moderation?.contentLabels
  return (
    hasNSFWLabel(post.record?.labels) ||
    (Array.isArray(contentLabels) &&
      contentLabels.some(
        (label: unknown) =>
          label !== null &&
          typeof label === 'object' &&
          'value' in label &&
          label.value === 'nsfw',
      ))
  )
}
