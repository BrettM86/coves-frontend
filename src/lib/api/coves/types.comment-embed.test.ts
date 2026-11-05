/**
 * Type-level contract for comment embeds: checked by `pnpm check`, not by the
 * vitest run. The comment record admits images, images with a quoted-post
 * attachment, or a quoted post, so the embed is a union of those records, not
 * `unknown`.
 */
import { describe, expectTypeOf, it } from 'vitest'
import type {
  AtUri,
  CID,
  CommentRecord,
  ImagesEmbedRecord,
  UpdateCommentInput,
} from './types'

type UpdateEmbed = NonNullable<UpdateCommentInput['embed']>

const quotedPost = {
  uri: 'at://did:plc:author/social.coves.community.post/3kquoted' as AtUri,
  cid: 'bafyreiquoted' as CID,
}

describe('comment embed types', () => {
  it('types the update and record embeds as embed records', () => {
    expectTypeOf<UpdateCommentInput['embed']>().not.toBeUnknown()
    expectTypeOf<CommentRecord['embed']>().not.toBeUnknown()
  })

  it('accepts the stored record embed and an images embed on update', () => {
    expectTypeOf<NonNullable<CommentRecord['embed']>>().toExtend<UpdateEmbed>()
    expectTypeOf<ImagesEmbedRecord>().toExtend<UpdateEmbed>()
  })

  it('accepts images with a quoted-post attachment', () => {
    const wrapped: UpdateEmbed = {
      $type: 'social.coves.embed.imagesWithAttachment',
      images: { $type: 'social.coves.embed.images', images: [] },
      attachment: { $type: 'social.coves.embed.post', post: quotedPost },
    }
    expectTypeOf(wrapped).toExtend<UpdateEmbed>()
  })

  it('rejects an object that is not an embed record', () => {
    // @ts-expect-error -- not a comment embed record
    const arbitrary: UpdateEmbed = { foo: 1 }
    expectTypeOf(arbitrary).toExtend<UpdateEmbed>()
  })
})
