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
