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
  StrongRef,
  UpdateCommentInput,
} from '$lib/api/coves/types'
import { parseMarkup, trimRichText } from '$lib/feature/richtext/compose'
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
 */
export function editorSourceFor(record: {
  content: string
  facets?: unknown[]
}): string {
  const markup = serializeMarkup(record.content, record.facets ?? [])
  if (parseMarkup(markup).content === record.content) return markup
  return serializeMarkup(record.content, [])
}

/** Wire input for a new comment, compiled from the editor source. */
export async function buildCommentCreate(args: {
  source: string
  postRef: StrongRef
  parentRef?: StrongRef
  resolver: MentionResolver
}): Promise<CreateCommentInput> {
  // Trimmed twice, for two different reasons: the source, so leading blank
  // lines cannot defeat a block construct on the first line, and then the
  // compiled content, which is what the backend trims and measures facets
  // against.
  const { content, facets } = trimRichText(
    await composeRichText(args.source.trim(), args.resolver),
  )
  const input: CreateCommentInput = {
    // A top-level comment replies to the post itself.
    reply: { root: args.postRef, parent: args.parentRef ?? args.postRef },
    content,
  }
  if (facets) input.facets = facets
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
    await composeRichText(args.source.trim(), args.resolver),
  )
  const input: UpdateCommentInput = { uri: args.uri, content }
  if (facets) input.facets = facets
  if (args.record.embed !== undefined) input.embed = args.record.embed
  if (args.record.langs !== undefined) input.langs = args.record.langs
  if (args.record.labels !== undefined) input.labels = args.record.labels
  return input
}
