import type { AtUri, CID, PostView } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'

export const LINK_URI = 'https://www.thegamer.com/tim-sweeney/'
export const THUMB = 'https://cdn.example.com/thumb.jpg'
export const BODY =
  'Sweeney spoke at length. Read [the interview](https://example.com/interview) for more.'

interface FixtureOptions {
  uri?: string
  thumb?: string | null
  embedTitle?: string
  body?: string
}

/** A link post in !cats@coves.social by @mayalin.coves.social. */
export function linkPost({
  uri = LINK_URI,
  thumb = THUMB,
  embedTitle = 'Tim Sweeney on the future of Epic',
  body = BODY,
}: FixtureOptions = {}): PostView {
  return {
    uri: 'at://did:plc:mayalin/social.coves.community.post/naptime' as AtUri,
    cid: 'bafyreinaptime' as CID,
    rkey: 'naptime',
    indexedAt: '2026-10-01T00:00:00Z',
    createdAt: '2026-10-01T00:00:00Z',
    author: {
      did: 'did:plc:mayalin' as DID,
      handle: 'mayalin.coves.social' as Handle,
    },
    community: {
      did: 'did:plc:cats' as DID,
      handle: 'c-cats.coves.social' as Handle,
      name: 'cats',
      avatar: 'https://cdn.example/cats.png',
    },
    stats: { upvotes: 40, downvotes: 4, score: 36, commentCount: 4 },
    viewer: { saved: false },
    record: {
      $type: 'social.coves.community.post',
      community: 'did:plc:cats',
      author: 'did:plc:mayalin',
      createdAt: '2026-10-01T00:00:00Z',
      title: 'nap time',
      content: body,
    },
    embed: {
      $type: 'social.coves.embed.external#view',
      external: {
        uri,
        title: embedTitle,
        ...(thumb === null ? {} : { thumb }),
      },
    },
  } satisfies PostView
}

export const IMAGE_THUMB = 'https://cdn.example.com/photo-thumb.jpg'
export const IMAGE_FULL = 'https://cdn.example.com/photo-full.jpg'

/** The same post with a native image embed in place of the link. */
export function imagePost(aspectRatio?: {
  width: number
  height: number
}): PostView {
  return {
    ...linkPost(),
    embed: {
      $type: 'social.coves.embed.images#view',
      images: [
        {
          thumb: IMAGE_THUMB,
          fullsize: IMAGE_FULL,
          alt: 'A cat',
          ...(aspectRatio ? { aspectRatio } : {}),
        },
      ],
    },
  }
}

export const GIF_CID = 'bafkreigifcat'
export const GIF_FULL = `https://img.coves.test/img/content_full/plain/did:plc:mayalin/${GIF_CID}`

/**
 * The image post served through the image proxy, with the record's blob for
 * that image typed `mimeType` (the view itself does not say which are GIFs).
 */
export function proxiedImagePost(mimeType: string): PostView {
  const post = linkPost()
  return {
    ...post,
    record: {
      $type: 'social.coves.community.post',
      community: 'did:plc:cats',
      author: 'did:plc:mayalin',
      createdAt: '2026-10-01T00:00:00Z',
      title: 'nap time',
      content: BODY,
      embed: {
        $type: 'social.coves.embed.images',
        images: [
          {
            image: {
              $type: 'blob',
              ref: { $link: GIF_CID },
              mimeType,
              size: 2048,
            },
            alt: 'A cat',
          },
        ],
      },
    },
    embed: {
      $type: 'social.coves.embed.images#view',
      images: [
        {
          thumb: `https://img.coves.test/img/content_preview/plain/did:plc:mayalin/${GIF_CID}`,
          fullsize: GIF_FULL,
          alt: 'A cat',
        },
      ],
    },
  } satisfies PostView
}
