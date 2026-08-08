import type { Lexer, MarkedExtension } from 'marked'
import markedLinkifyIt from 'marked-linkify-it'

// linkify-it 5 ships no type declarations and there is no @types package for
// it, so marked-linkify-it's `LinkifyIt.SchemaRules` parameter resolves to
// nothing useful. Declare the exact slice of linkify-it we touch instead of
// letting these callbacks fall back to implicit `any`.

/** The linkify-it instance handed to a schema's validate(). */
interface LinkifySelf {
  /** Compiled-pattern cache. The mention rules add their own entries to it. */
  re: Record<string, RegExp>
}

/** The match object handed to a schema's normalize(), rewritten in place. */
interface LinkifyMatch {
  url: string
}

// Both validators used to carry a `pos >= 2 && tail[pos - 2] === '!'` branch
// meant to reject a doubled prefix ("!!community", "@@mention"). It was
// removed because it corrupted ordinary mentions: `tail` is text.slice(pos),
// so tail[pos - 2] reads FORWARD of the prefix rather than back into `text`,
// and linkify-it calls validate() while pre-scanning longer slices where
// pos > 1. When the preceding text happened to be (mention body length + 2)
// characters and a '!' followed, the mention was rejected here and marked's
// GFM autolinker turned it into a mailto: link instead — the same handle
// resolving in one sentence and breaking in the next.
//
// It never rejected a doubled prefix either; "!!tech@x" and "@@alice@x" still
// link their inner mention, pinned under "linkify - doubled prefixes are not
// rejected". So the branch only ever cost correctness. Position-independence
// is now pinned under "linkify - mention position must not change the target",
// which sweeps prefix lengths for both handlers — if a doubled-prefix rule is
// ever wanted, it has to be written against `text`, not `tail`, and pass that
// sweep.
export const linkify: MarkedExtension = markedLinkifyIt(
  {
    '!': {
      validate: function (
        text: string,
        pos: number,
        self: LinkifySelf,
      ): number | false {
        const tail = text.slice(pos)

        if (!self.re.community) {
          self.re.community = new RegExp(
            /^([a-z0-9_.-]+)@([\da-z.-]+)\.([a-z]{2,63})/i,
          )
        }
        if (self.re.community.test(tail)) {
          return tail.match(self.re.community)?.[0]?.length ?? 0
        }
        return 0
      },
      normalize: function (match: LinkifyMatch): void {
        let prefix = match.url
        prefix = prefix.startsWith('c/') ? prefix.slice(2) : prefix.slice(1)

        match.url = `/c/${prefix}`
      },
    },
    '@': {
      validate: function (
        text: string,
        pos: number,
        self: LinkifySelf,
      ): number | false {
        const tail = text.slice(pos)

        if (!self.re.user) {
          self.re.user = new RegExp(
            /^([a-z0-9_.-]+)@([\da-z.-]+)\.([a-z]{2,63})/i,
          )
        }
        if (self.re.user.test(tail)) {
          return tail.match(self.re.user)?.[0]?.length ?? 0
        }
        return 0
      },
      normalize: function (match: LinkifyMatch): void {
        let prefix = match.url
        prefix = prefix.startsWith('u/') ? prefix.slice(2) : prefix.slice(1)

        match.url = `/profile/${prefix}`
      },
    },
  },
  {
    fuzzyEmail: false,
  },
)

const regexes = {
  user: /^https:\/\/([a-zA-Z0-9.-]+)(\/u\/)([a-zA-Z0-9.-_]+)$/i,
  community: /^https:\/\/([a-zA-Z0-9.-]+)(\/c\/)([a-zA-Z0-9.-_]+)$/i,
}

export { regexes as CONTENT_REGEXES }

/**
 * Convert links to local app links
 */
export const localizeLink = (link: string): string | undefined => {
  if (regexes.community.test(link)) {
    const match = link.match(regexes.community)
    if (!match) return

    // If the match[3] includes @, the URL included an instance already, so don't add one.
    if (match[3].includes('@')) return `/c/${match[3]}`
    else return `/c/${match[3]}@${match[1]}`
  }
  if (regexes.user.test(link)) {
    const match = link.match(regexes.user)
    if (!match) return

    // Same as above for the community.
    if (match[3].includes('@')) return `/profile/${match[3]}`
    else return `/profile/${match[3]}@${match[1]}`
  }
  // NOTE: mailto: links are deliberately left untouched. The old Lemmy-era
  // "implicit user mention" rewrite turned every real email link (e.g.
  // support@coves.social on /legal) into a dead /profile/ link.
}

// Markdown link targets are untrusted user content. Enforce a protocol
// allowlist here rather than relying on upstream regex stripping: the URL
// parser normalizes tricks like embedded tabs in "java\tscript:" that
// pattern-based blocklists miss. Relative links resolve against the base
// and come out as https:, so they pass.
export const SAFE_PROTOCOLS: ReadonlySet<string> = new Set([
  'http:',
  'https:',
  'mailto:',
])

/**
 * Whether a markdown link href is safe to render as an anchor.
 */
export const isSafeHref = (href: string): boolean => {
  if (!href) return false
  try {
    return SAFE_PROTOCOLS.has(new URL(href, 'https://base.invalid').protocol)
  } catch {
    return false
  }
}

/** What the sub/superscript tokenizer hands to its tokensExtractor. */
export interface SubSupParams {
  type: 'subscript' | 'superscript'
  content: string
  raw: string
  lexer: Lexer
}

/**
 * The token an extractor returns. Deliberately minimal: the caller owns the
 * token's real shape (it is what the Svelte renderer for that type receives),
 * so this pins down only the two fields marked itself requires.
 */
export interface SubSupToken {
  type: string
  raw: string
}

export type SubSupTokensExtractor = (
  params: SubSupParams,
) => SubSupToken | undefined

/** marked's TokenizerExtension, narrowed to this extension's token type. */
export interface SubSupExtension {
  name: string
  level: 'inline'
  start(src: string): number | undefined
  tokenizer(this: { lexer: Lexer }, src: string): SubSupToken | undefined
}

export function subSupscriptExtension(
  tokensExtractor: SubSupTokensExtractor,
): SubSupExtension {
  return {
    name: 'subscriptSuperscript',
    level: 'inline',
    start(src) {
      return src.match(/[~^]/)?.index
    },
    tokenizer(src) {
      const subscriptRule = /^~([^~\s](?:[^~]*[^~\s])?)~/
      const superscriptRule = /^\^([^^\s](?:[^^]*[^^\s])?)\^/

      let match

      if ((match = subscriptRule.exec(src))) {
        return tokensExtractor({
          type: 'subscript',
          content: match[1],
          raw: match[0],
          lexer: this.lexer,
        })
      }

      if ((match = superscriptRule.exec(src))) {
        return tokensExtractor({
          type: 'superscript',
          content: match[1],
          raw: match[0],
          lexer: this.lexer,
        })
      }
    },
  }
}
