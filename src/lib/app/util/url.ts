export const DOMAIN_REGEX =
  /^(http(s)?:\/\/)?((?!-)[A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,63}(:[0-9]{0,5})?$/g
export const DOMAIN_REGEX_FORMS =
  '(http(s)?://)?((?!-)[A-Za-z0-9]{1,63}.)+[A-Za-z]{2,63}(:[0-9]{0,5})?'

export const instanceToURL = (input: string): string =>
  input.startsWith('http://') || input.startsWith('https://')
    ? input
    : `https://${input}`

export function canParseUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

export const isImage = (url: string | undefined): boolean => {
  if (!url) return false
  return /\.(jpeg|jpg|gif|png|svg|bmp|webp|avif)/i.test(url)
}

export const isVideo = (url: string | undefined): boolean => {
  if (!url) return false
  return /\.(mp4|mov|webm|mkv|avi)/i.test(url)
}

/*
 * URL scheme policy for untrusted link targets.
 *
 * Post embed URIs, richtext link facets and markdown link targets are user
 * content and may have been written to a PDS by a client that never passed
 * through the AppView's validation. Sinks therefore decide safety here, at
 * render time, rather than trusting whatever produced the record. Any new
 * href/src sink fed from a record must go through this module too.
 *
 * Decisions go through the URL parser, never a regex: the parser normalizes
 * tricks a pattern blocklist misses (embedded tabs/newlines in "java\tscript:",
 * leading NULs, mixed case), so the protocol we compare is the one the browser
 * would actually dispatch on.
 */

/** Schemes a post or media URL may use. Absolute web links only. */
export const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:'])

/**
 * Schemes a markdown link may use. Markdown additionally allows `mailto:`
 * (support addresses on /legal) and relative paths, which resolve against the
 * site origin and so come out as `https:`.
 */
export const SAFE_PROTOCOLS: ReadonlySet<string> = new Set([
  ...WEB_PROTOCOLS,
  'mailto:',
])

/**
 * Parses `raw` as an absolute `http:`/`https:` URL. Returns `null` for
 * anything else — other schemes, relative paths, unparseable input.
 *
 * Use this for post embed URIs and media sources, where a link that is not a
 * plain web address has no legitimate meaning.
 */
export function parseWebUrl(raw: string): URL | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    return WEB_PROTOCOLS.has(url.protocol) ? url : null
  } catch {
    return null
  }
}

/** Whether `raw` is an absolute `http:`/`https:` URL. See {@link parseWebUrl}. */
export function isWebUrl(raw: string): boolean {
  return parseWebUrl(raw) !== null
}

/**
 * Whether a markdown link href is safe to render as an anchor. Relative links
 * resolve against a placeholder base and come out as `https:`, so they pass.
 */
export function isSafeHref(href: string): boolean {
  if (!href) return false
  try {
    return SAFE_PROTOCOLS.has(new URL(href, 'https://base.invalid').protocol)
  } catch {
    return false
  }
}
