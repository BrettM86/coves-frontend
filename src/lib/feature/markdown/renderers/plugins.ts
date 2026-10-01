import type { Lexer, MarkedExtension } from 'marked'
import markedLinkifyIt from 'marked-linkify-it'
import { PUBLIC_INSTANCE_ORIGIN } from '$lib/app/state/instance/domain'
import { instanceOrigin } from '$lib/app/state/instance/resolve'
import {
  isValidCommunityAddress,
  isValidDID,
  isValidHandle,
} from '$lib/types/atproto'

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
  user: /^https:\/\/([a-zA-Z0-9.-]+)(\/u\/)([a-zA-Z0-9._@-]+)$/i,
  community: /^https:\/\/([a-zA-Z0-9.-]+)(\/c\/)([a-zA-Z0-9._@-]+)$/i,
}

export { regexes as CONTENT_REGEXES }

/**
 * A profile link on some origin: `scheme://host[:port]/(u|profile)/<id>` with
 * nothing after the id. The host class excludes `@`, so userinfo never
 * matches. The id class omits `%`: the actor route decodes `%2F` to `/` and
 * would 404.
 */
const profileLinkPattern =
  /^(https?:\/\/[a-zA-Z0-9.-]+(?::\d+)?)\/(?:u|profile)\/([a-zA-Z0-9._:-]+)$/

/**
 * Convert links to local app links. `ownInstanceOrigin` is the origin this
 * app is served at; a profile link on exactly that origin opens in-app.
 */
export const localizeLink = (
  link: string,
  ownInstanceOrigin: string | null = PUBLIC_INSTANCE_ORIGIN,
): string | undefined => {
  const profileMatch = link.match(profileLinkPattern)
  if (
    profileMatch &&
    ownInstanceOrigin !== null &&
    instanceOrigin(profileMatch[1]) === ownInstanceOrigin &&
    (isValidHandle(profileMatch[2]) || isValidDID(profileMatch[2]))
  ) {
    return `/profile/${profileMatch[2]}`
  }
  const communityMatch = link.match(regexes.community)
  if (communityMatch) {
    // A name without @ belongs to the linked host, so append that host.
    const address = communityMatch[3].includes('@')
      ? communityMatch[3]
      : `${communityMatch[3]}@${communityMatch[1]}`
    // Of the forms `/c/[handle]` (src/params/handle.ts) routes, only a valid
    // community address can contain @; an unroutable path would replace a
    // working external link with a 404, so anything else keeps its href.
    return isValidCommunityAddress(address) ? `/c/${address}` : undefined
  }
  const userMatch = link.match(regexes.user)
  if (userMatch) {
    const identifier = userMatch[3].includes('@')
      ? userMatch[3]
      : `${userMatch[3]}@${userMatch[1]}`
    // `/profile/[handle=actor]` (src/params/actor.ts) only routes a DID or a DNS
    // handle, which `name@instance` never is; an unroutable path would replace
    // a working external link with a 404, so the original href is kept.
    return isValidHandle(identifier) || isValidDID(identifier)
      ? `/profile/${identifier}`
      : undefined
  }
  // NOTE: mailto: links are deliberately left untouched. The old Lemmy-era
  // "implicit user mention" rewrite turned every real email link (e.g.
  // support@coves.social on /legal) into a dead /profile/ link.
}

// Markdown link targets are untrusted user content; the protocol allowlist
// lives in $lib/app/util/url alongside the stricter web-only policy used by post
// sinks. Re-exported here so renderer callers keep a single import.
export { SAFE_PROTOCOLS, isSafeHref } from '$lib/app/util/url'

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
