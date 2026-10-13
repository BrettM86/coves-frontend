import { imageUrl } from '$lib/api/coves/image-proxy'
import type {
  CommentView,
  EmbedImage,
  PostEmbed,
  PostView,
} from '$lib/api/coves/types'
import { parseWebUrl } from '$lib/app/util/url'
import { isSensitivePost } from '$lib/feature/post/content-labels'
import {
  commentLink,
  postLink,
  postTextFallback,
} from '$lib/feature/post/helpers'
import { hasFacets } from '$lib/feature/richtext/facets'
import type { RssItem } from './document'
import { escapeHtml, markdownToRssHtml, richTextToRssHtml } from './html'

/** An absolute http(s) URL for `raw` resolved against `origin`, or null. */
function absoluteWebUrl(raw: string, origin: string): string | null {
  // An empty URL would resolve to the site root and pass as a web URL.
  if (!raw) return null
  try {
    return parseWebUrl(new URL(raw, origin).href)?.href ?? null
  } catch {
    return null
  }
}

function absoluteLink(path: string, origin: string): string {
  return new URL(path, origin).href
}

/** Faceted content renders from its facets, anything else as Markdown. */
function bodyHtml(
  content: string | undefined,
  facets: unknown,
  origin: string,
): string {
  if (!content) return ''
  return hasFacets(facets)
    ? richTextToRssHtml(content, facets, origin)
    : markdownToRssHtml(content, origin)
}

function imageHtml(image: EmbedImage, origin: string): string {
  const src = absoluteWebUrl(imageUrl(image, 'fullsize'), origin)
  if (src === null) return ''
  return `<p><img src="${escapeHtml(src)}" alt="${escapeHtml(image.alt ?? '')}"></p>`
}

/**
 * The embed as HTML after the body. Media the feed cannot carry (video, an
 * embedded record) links to the item's page on the site instead.
 */
function embedHtml(
  embed: PostEmbed | undefined,
  itemLink: string,
  origin: string,
): string {
  if (!embed) return ''
  // The backend sends the raw images record, outside the PostEmbed union,
  // when it cannot hydrate the blobs into URLs.
  const type: string = embed.$type
  if (type === 'social.coves.embed.images') {
    return `<p><a href="${escapeHtml(itemLink)}">View images</a></p>`
  }
  switch (embed.$type) {
    case 'social.coves.embed.images#view':
      return embed.images.map((image) => imageHtml(image, origin)).join('')
    case 'social.coves.embed.external':
    case 'social.coves.embed.external#view': {
      const { uri, title, description } = embed.external
      const href = parseWebUrl(uri)?.href ?? null
      const label = escapeHtml(title || (href ?? ''))
      const link =
        href === null
          ? label && `<p>${label}</p>`
          : `<p><a href="${escapeHtml(href)}">${label}</a></p>`
      return description ? `${link}<p>${escapeHtml(description)}</p>` : link
    }
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
  const excerpt = isSensitivePost(post)
    ? ''
    : postTextFallback(post.record?.content, 80)
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
      bodyHtml(post.record?.content, post.record?.facets, origin) +
      embedHtml(post.embed, link, origin),
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
        bodyHtml(record.content, record.facets, origin) +
        embedHtml(comment.embed, link, origin),
    })
  }
  return items
}
