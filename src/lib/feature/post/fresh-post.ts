import {
  type CreatePostOutput,
  type EmbedImage,
  type ImageEmbed,
  type PostEmbed,
  type PostView,
  parseAtUri,
} from '$lib/api/coves/types'
import { profile } from '$lib/app/state/auth.svelte'
import { EMPTY_POST_STATS } from '$lib/feature/vote/subjects'
import type { DID, Handle } from '$lib/types/atproto'

/**
 * One-shot hand-off of a just-created post from the create flow to the post
 * page. The AppView indexer can lag behind the record write, so the post page
 * would otherwise show "Post unavailable" (or wait on its retry poll) for a
 * post the client already knows everything about.
 */
let fresh: PostView | undefined

/** Stash the optimistic view of a just-created post before navigating to it. */
export function stashFreshPost(post: PostView): void {
  fresh = post
}

/**
 * Take the stashed post if it matches `rkey`. Single-use: the stash is
 * cleared on a hit so later visits re-fetch real (indexed) data.
 */
export function takeFreshPost(rkey: string): PostView | undefined {
  if (fresh?.rkey !== rkey) return undefined
  const post = fresh
  fresh = undefined
  return post
}

/**
 * Assembles a PostView for a just-created post from the create output and the
 * form data. Stats start at zero — true for a brand-new post — and the next
 * real fetch replaces this view entirely. Returns undefined when the viewer
 * or community lacks the fields a PostView requires (e.g. no handle yet).
 */
export function buildFreshPostView(args: {
  output: CreatePostOutput
  community: {
    did: DID
    handle?: Handle
    name: string
    avatar?: string
    origin?: string
  }
  title?: string
  content?: string
  url?: string
  labels?: unknown
  facets?: unknown[]
  /** The attached images, shown from the composer's `blob:` preview URLs. */
  images?: {
    previewUrl: string
    alt?: string
    aspectRatio?: { width: number; height: number }
  }[]
}): PostView | undefined {
  const viewer = profile.current
  if (viewer.type !== 'authenticated') return undefined

  const { output, community } = args
  if (!community.handle) return undefined

  const createdAt = new Date().toISOString()

  return {
    uri: output.uri,
    cid: output.cid,
    rkey: parseAtUri(output.uri).rkey,
    indexedAt: createdAt,
    createdAt,
    author: {
      did: viewer.did,
      handle: viewer.handle,
      avatar: viewer.avatar,
    },
    community: {
      did: community.did,
      handle: community.handle,
      name: community.name,
      avatar: community.avatar,
      // The origin decides the community's canonical route param, so a view
      // that drops it is not addressed by the URL the create flow redirects to.
      origin: community.origin,
    },
    record: {
      $type: 'social.coves.community.post',
      community: community.did,
      author: viewer.did,
      createdAt,
      title: args.title,
      content: args.content,
      facets: args.facets,
      labels: args.labels,
    },
    embed: freshEmbed(args.url, args.images),
    stats: { ...EMPTY_POST_STATS },
    viewer: { saved: false },
  }
}

/**
 * The embed view a just-created post or comment renders until the indexed
 * copy loads.
 */
export function freshEmbed(
  url: string | undefined,
  images:
    | {
        previewUrl: string
        alt?: string
        aspectRatio?: { width: number; height: number }
      }[]
    | undefined,
): PostEmbed | undefined {
  const views: EmbedImage[] = (images ?? []).map((image) => ({
    thumb: image.previewUrl,
    fullsize: image.previewUrl,
    ...(image.alt ? { alt: image.alt } : {}),
    ...(image.aspectRatio ? { aspectRatio: image.aspectRatio } : {}),
  }))
  const [first, ...rest] = views
  if (!first) {
    return url
      ? { $type: 'social.coves.embed.external', external: { uri: url } }
      : undefined
  }
  const imagesView: ImageEmbed = {
    $type: 'social.coves.embed.images#view',
    images: [first, ...rest],
  }
  if (!url) return imagesView
  return {
    $type: 'social.coves.embed.imagesWithAttachment#view',
    images: imagesView,
    attachment: { $type: 'social.coves.embed.external#viewExternal', uri: url },
  }
}

/**
 * The composer's `blob:` preview URLs a just-created post or comment view
 * renders. The view showing it revokes them once it gives way to the server
 * copy.
 */
export function freshPostImageUrls(
  post: { embed?: PostEmbed } | undefined,
): string[] {
  const embed = post?.embed
  const images =
    embed?.$type === 'social.coves.embed.images#view'
      ? embed.images
      : embed?.$type === 'social.coves.embed.imagesWithAttachment#view'
        ? embed.images.images
        : []
  return [
    ...new Set(
      images
        .flatMap((image) => [image.thumb, image.fullsize])
        .filter((url): url is string => !!url?.startsWith('blob:')),
    ),
  ]
}
