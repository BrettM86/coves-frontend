import type { CommentView, PostEmbed, PostView } from '$lib/api/coves/types'
import { parseWebUrl } from '$lib/app/util/url'
import { isSensitivePost } from '$lib/feature/post/content-labels'
import {
  commentLink,
  postLink,
  postTextFallback,
} from '$lib/feature/post/helpers'
import { hasFacets } from '$lib/feature/richtext/facets'
import {
  imageLayout,
  removePlacedText,
} from '$lib/feature/richtext/image-layout'
import type { RssItem } from './document'
import {
  escapeHtml,
  imageHtml,
  markdownToRssHtml,
  richTextToRssHtml,
} from './html'

function absoluteLink(path: string, origin: string): string {
  return new URL(path, origin).href
}

/**
 * Faceted content renders from its facets, with the embed's placed images in
 * the body; anything else renders as Markdown.
 */
function bodyHtml(
  content: string | undefined,
  facets: unknown,
  embed: PostEmbed | undefined,
  itemLink: string,
  origin: string,
): string {
  if (!content) return ''
  return hasFacets(facets)
    ? richTextToRssHtml(
        content,
        facets,
        origin,
        imageLayout(embed, content, facets).placed,
        itemLink,
      )
    : markdownToRssHtml(content, origin)
}

/** The images not placed in the body, in index order. */
function galleryHtml(
  embed: PostEmbed,
  content: string | undefined,
  facets: unknown,
  origin: string,
): string {
  return imageLayout(
    embed,
    content ?? '',
    hasFacets(facets) ? facets : undefined,
  )
    .gallery.map((image) => imageHtml(image, origin))
    .join('')
}

function externalHtml(fields: {
  uri: string
  title?: string
  description?: string
}): string {
  const href = parseWebUrl(fields.uri)?.href ?? null
  const label = escapeHtml(fields.title || (href ?? ''))
  const link =
    href === null
      ? label && `<p>${label}</p>`
      : `<p><a href="${escapeHtml(href)}">${label}</a></p>`
  return fields.description
    ? `${link}<p>${escapeHtml(fields.description)}</p>`
    : link
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** The external link of a raw imagesWithAttachment record, which arrives
 * untyped; nothing when it carries no external URI. */
function recordAttachmentHtml(embed: object): string {
  const attachment: unknown = Reflect.get(embed, 'attachment')
  if (typeof attachment !== 'object' || attachment === null) return ''
  const external: unknown = Reflect.get(attachment, 'external')
  if (typeof external !== 'object' || external === null) return ''
  const uri = optionalString(Reflect.get(external, 'uri'))
  if (!uri) return ''
  return externalHtml({
    uri,
    title: optionalString(Reflect.get(external, 'title')),
    description: optionalString(Reflect.get(external, 'description')),
  })
}

/**
 * The embed as HTML after the body. Media the feed cannot carry (video, an
 * embedded record) links to the item's page on the site instead.
 */
function embedHtml(
  embed: PostEmbed | undefined,
  content: string | undefined,
  facets: unknown,
  itemLink: string,
  origin: string,
): string {
  if (!embed) return ''
  // The backend sends the raw images and imagesWithAttachment records,
  // outside the PostEmbed union, when it cannot hydrate the blobs into URLs.
  const type: string = embed.$type
  const viewImages = `<p><a href="${escapeHtml(itemLink)}">View images</a></p>`
  if (type === 'social.coves.embed.images') return viewImages
  if (type === 'social.coves.embed.imagesWithAttachment') {
    return viewImages + recordAttachmentHtml(embed)
  }
  switch (embed.$type) {
    case 'social.coves.embed.images#view':
      return galleryHtml(embed, content, facets, origin)
    case 'social.coves.embed.imagesWithAttachment#view': {
      const { attachment } = embed
      // A post attachment is a record the feed cannot carry; it adds nothing.
      const attachmentHtml =
        attachment.$type === 'social.coves.embed.external#viewExternal'
          ? externalHtml(attachment)
          : ''
      return galleryHtml(embed, content, facets, origin) + attachmentHtml
    }
    case 'social.coves.embed.external':
    case 'social.coves.embed.external#view':
      return externalHtml(embed.external)
    case 'social.coves.embed.video':
    case 'social.coves.embed.video#view':
      return `<p><a href="${escapeHtml(itemLink)}">View video</a></p>`
    default:
      return `<p><a href="${escapeHtml(itemLink)}">View embedded post</a></p>`
  }
}

/** The title the post page shows: its own, its first line, or its author. */
// A sensitive post's body is withheld from the feed, so its excerpt
// cannot stand in for a missing title either.
function postTitle(post: PostView): string {
  const content = post.record?.content
  const facets = post.record?.facets
  // Text covered by a placed image is drawn as the image, not read as text.
  const text =
    content && hasFacets(facets)
      ? removePlacedText(post.embed, content, facets)
      : content
  const excerpt = isSensitivePost(post) ? '' : postTextFallback(text, 80)
  return post.record?.title || excerpt || `Post by @${post.author.handle}`
}

export function postToRssItem(post: PostView, origin: string): RssItem {
  const link = absoluteLink(postLink(post), origin)
  const item = {
    title: postTitle(post),
    link,
    guid: post.uri,
    publishedAt: post.createdAt,
    author: `@${post.author.handle}`,
  }
  // Same rule as the post page: a sensitive post's body and media stay
  // behind a link, since a feed reader shows no content warning.
  if (isSensitivePost(post)) {
    return {
      ...item,
      html: `<p><a href="${escapeHtml(link)}">This post is marked NSFW. View it on the site.</a></p>`,
      sensitive: true,
    }
  }
  return {
    ...item,
    html:
      bodyHtml(
        post.record?.content,
        post.record?.facets,
        post.embed,
        link,
        origin,
      ) +
      embedHtml(
        post.embed,
        post.record?.content,
        post.record?.facets,
        link,
        origin,
      ),
  }
}

/**
 * One item per comment, in order. Deleted comments (no record, no author, or
 * flagged) and comments whose parent post is not in `posts` are left out.
 */
export function commentsToRssItems(
  comments: CommentView[],
  posts: PostView[],
  origin: string,
): RssItem[] {
  const postsByUri = new Map(posts.map((post) => [post.uri, post]))
  const items: RssItem[] = []
  for (const comment of comments) {
    const { record, author } = comment
    const post = postsByUri.get(comment.post.uri)
    if (!record || !author || comment.isDeleted || !post) continue
    const link = absoluteLink(commentLink(post, comment.uri, author), origin)
    items.push({
      title: `Comment on "${postTitle(post)}"`,
      link,
      guid: comment.uri,
      publishedAt: comment.createdAt,
      author: `@${author.handle}`,
      html:
        bodyHtml(record.content, record.facets, comment.embed, link, origin) +
        embedHtml(comment.embed, record.content, record.facets, link, origin),
    })
  }
  return items
}
