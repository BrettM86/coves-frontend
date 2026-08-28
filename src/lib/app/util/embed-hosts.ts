/**
 * The only hosts the app will ever put in an `<iframe>`.
 *
 * This list is the single source of truth for two things that must agree:
 * the YouTube-frontend chooser in `PostIframe.svelte` and the `frame-src`
 * directive the server emits in `Content-Security-Policy`
 * (`$lib/server/security-headers`). A host that is not listed here is blocked
 * by the browser, so users cannot supply their own instance — that is the
 * point: a user-typed iframe origin is an XSS-adjacent surface with no place
 * in a locked-to-instance product.
 */
export const YOUTUBE_EMBED_HOSTS = {
  youtube: 'www.youtube-nocookie.com',
  invidious: 'yewtu.be',
  piped: 'piped.video',
} as const

export type YouTubeFrontend = keyof typeof YOUTUBE_EMBED_HOSTS

/**
 * Where a Streamable link is framed from.
 *
 * Streamable takes the iframe route rather than hotlinking the underlying
 * `.mp4`: `media-src` is deliberately narrow (the instance and its configured
 * PDS hosts), while `frame-src` is a fixed list of origins we chose, so a new
 * provider costs one entry here instead of widening a directive that user
 * content can reach.
 */
export const STREAMABLE_EMBED_ORIGIN = 'https://streamable.com'

/** Every origin `frame-src` must allow, derived from the tables above. */
export const EMBED_FRAME_ORIGINS: readonly string[] = [
  ...Object.values(YOUTUBE_EMBED_HOSTS).map((host) => `https://${host}`),
  STREAMABLE_EMBED_ORIGIN,
]

/** Runtime membership check for values arriving from storage or import. */
export function isYouTubeFrontend(value: unknown): value is YouTubeFrontend {
  return typeof value === 'string' && Object.hasOwn(YOUTUBE_EMBED_HOSTS, value)
}
