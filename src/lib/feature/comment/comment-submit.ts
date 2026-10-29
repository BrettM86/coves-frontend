/**
 * Pure comment write paths, kept out of the components so they can be tested
 * without a DOM: what the editor is seeded with when editing, and the wire
 * input a create or an update sends.
 *
 * Editing recompiles from the editor source rather than reusing the record's
 * facets. The old facets index the old text, so keeping them after an edit
 * would annotate the wrong bytes.
 */
import type {
  AtUri,
  CommentRecord,
  CreateCommentInput,
  ImagesEmbedRecord,
  StrongRef,
  UpdateCommentInput,
} from '$lib/api/coves/types'
import { parseMarkup, trimRichText } from '$lib/feature/richtext/compose'
import { placedImageIndexes } from '$lib/feature/richtext/image-layout'
import {
  composeRichText,
  type MentionResolver,
} from '$lib/feature/richtext/mentions'
import { serializeMarkup } from '$lib/feature/richtext/serialize'

/**
 * Markup to load into the editor for an existing comment.
 *
 * Always serialized, facets or not: the stored content is canonical text, so
 * any marker in it is a literal character the author typed. Seeding the box
 * with it raw would compile those markers into formatting on the next save and
 * delete the characters. Where the markup cannot reproduce the content — a
 * facet that has no markup form — the escaped content is used instead, because
 * the annotation may be lost but the author's characters may not.
 *
 * Placements of the comment's `imageCount` images come back as tokens.
 * `droppedPlacements` counts the ones the source could not keep, so the editor
 * can say so.
 */
export function editorSourceFor(
  record: {
    content: string
    facets?: unknown[]
  },
  imageCount: number,
): { source: string; droppedPlacements: number } {
  let droppedPlacements = 0
  const markup = serializeMarkup(record.content, record.facets ?? [], {
    imageCount,
    onDroppedPlacement: () => {
      droppedPlacements += 1
    },
  })
  if (parseMarkup(markup, { imageCount }).content === record.content)
    return { source: markup, droppedPlacements }
  // The escaped content keeps no annotation, so every placement is lost.
  return {
    source: serializeMarkup(record.content, []),
    droppedPlacements: placedImageIndexes(
      imageCount,
      record.content,
      record.facets,
    ).size,
  }
}

/** How many images a comment embed carries: the numbers its placement tokens
 * may name. A quoted post alone carries none. The embed is the record as the
 * AppView indexed it, so it is narrowed field by field: a malformed or
 * unknown-typed embed carries no images. */
export function commentImageCount(embed: unknown): number {
  if (typeof embed !== 'object' || embed === null || !('$type' in embed))
    return 0
  switch (embed.$type) {
    case 'social.coves.embed.images':
      return 'images' in embed && Array.isArray(embed.images)
        ? embed.images.length
        : 0
    case 'social.coves.embed.imagesWithAttachment':
      return 'images' in embed &&
        typeof embed.images === 'object' &&
        embed.images !== null &&
        'images' in embed.images &&
        Array.isArray(embed.images.images)
        ? embed.images.images.length
        : 0
    default:
      return 0
  }
}

/** A comment with no text and no images, which the backend refuses. */
export class CommentContentEmptyError extends Error {
  readonly code = 'ContentEmpty'

  constructor() {
    super('Comment cannot be empty.')
    this.name = 'CommentContentEmptyError'
  }
}

/**
 * Wire input for a new comment, compiled from the editor source. Empty content
 * is allowed only when the comment carries at least one image.
 */
export async function buildCommentCreate(args: {
  source: string
  postRef: StrongRef
  parentRef?: StrongRef
  resolver: MentionResolver
  embed?: ImagesEmbedRecord
}): Promise<CreateCommentInput> {
  // Trimmed twice, for two different reasons: the source, so leading blank
  // lines cannot defeat a block construct on the first line, and then the
  // compiled content, which is what the backend trims and measures facets
  // against.
  const embed = args.embed?.images.length ? args.embed : undefined
  const { content, facets } = trimRichText(
    await composeRichText(args.source.trim(), args.resolver, {
      imageCount: commentImageCount(embed),
    }),
  )
  if (content === '' && !embed) throw new CommentContentEmptyError()
  const input: CreateCommentInput = {
    // A top-level comment replies to the post itself.
    reply: { root: args.postRef, parent: args.parentRef ?? args.postRef },
    content,
  }
  if (facets) input.facets = facets
  if (embed) input.embed = embed
  return input
}

/**
 * Wire input for an edited comment, recompiled from the editor source.
 *
 * An update replaces the whole record, so everything the edit does not touch is
 * carried over: anything left out is cleared on the server.
 */
export async function buildCommentUpdate(args: {
  source: string
  uri: AtUri
  record: CommentRecord
  resolver: MentionResolver
}): Promise<UpdateCommentInput> {
  const { content, facets } = trimRichText(
    await composeRichText(args.source.trim(), args.resolver, {
      imageCount: commentImageCount(args.record.embed),
    }),
  )
  const input: UpdateCommentInput = { uri: args.uri, content }
  if (facets) input.facets = facets
  if (args.record.embed !== undefined) input.embed = args.record.embed
  if (args.record.langs !== undefined) input.langs = args.record.langs
  if (args.record.labels !== undefined) input.labels = args.record.labels
  return input
}
