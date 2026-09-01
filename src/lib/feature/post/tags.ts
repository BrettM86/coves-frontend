import type { IconSource } from '$lib/ui/kit/icon'
export interface MetaTag {
  readonly content: string
  readonly color?: string
  readonly icon?: IconSource
  readonly textColor?: string
  readonly type: 'flair' | 'custom'
}

export const textToTag: ReadonlyMap<string, MetaTag> = new Map<string, MetaTag>(
  [
    ['OC', { content: 'OC', color: '#03A8F240', type: 'custom' }],
    ['NSFL', { content: 'NSFL', color: '#ff000040', type: 'custom' }],
    ['CW', { content: 'CW', color: '#ff000040', type: 'custom' }],
  ],
)

/**
 * Splits leading/trailing `[TAG, TAG]` groups off a post title.
 *
 * A group may hold several comma-separated tags (`[OC, NSFL] Title`). Tags
 * matching a {@link textToTag} key are returned as copies of that entry;
 * anything else becomes a plain `custom` tag with no color.
 *
 * Quirk: the `\[.[^\]]+\]` pattern requires at least two characters between
 * the brackets, so single-character groups like `[a]` are left in the title.
 *
 * The remaining title is trimmed, and is `undefined` when the tag groups
 * consumed the whole string.
 */
export const parseTags = (
  title?: string,
): { tags: readonly MetaTag[]; title: string | undefined } => {
  if (!title) return { tags: [], title: undefined }

  const extracted: MetaTag[] = []

  const newTitle = title
    .toString()
    .replace(/^(\[.[^\]]+\])|(\[.[^\]]+\])$/g, (match) => {
      match
        .split(',')
        .map((part) => part.trim().replaceAll(/[[\]]/g, ''))
        .forEach((content) => {
          const found = textToTag.get(content)
          extracted.push(found ? { ...found } : { content, type: 'custom' })
        })
      return ''
    })
    .trim()

  return { tags: extracted, title: newTitle || undefined }
}
