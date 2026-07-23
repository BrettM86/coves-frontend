// @ts-nocheck
import { marked } from 'marked'
import markedLinkifyIt from 'marked-linkify-it'

export const spoilerPlugin = {
  name: 'spoiler',
  level: 'block',
  start(src) {
    return src.match(/:::/)?.index
  },
  // eslint-disable-next-line
  tokenizer(src, tokens) {
    const rule = /::: ?spoiler(?: ?(.*))\n([\s\S]*?)\n:::/
    const match = rule.exec(src)
    if (match) {
      return {
        type: 'spoiler',
        raw: match[0],
        title: match[1].trim(),
        text: match[2].trim(),
      }
    }
  },
  renderer(token) {
    return `
      <details>
        <summary>${marked.parseInline(token.title)}</summary>
        ${marked.parse(token.text)}
      </details>
    `
  },
}

export const linkify = markedLinkifyIt(
  {
    '!': {
      validate: function (text, pos, self) {
        var tail = text.slice(pos)

        if (!self.re.community) {
          self.re.community = new RegExp(
            /^([a-z0-9_.-]+)@([\da-z.-]+)\.([a-z]{2,63})/i,
          )
        }
        if (self.re.community.test(tail)) {
          // Linkifier allows punctuation chars before prefix,
          // but we additionally disable `@` ("@@mention" is invalid)
          if (pos >= 2 && tail[pos - 2] === '!') {
            return false
          }
          return tail.match(self.re.community)[0].length
        }
        return 0
      },
      normalize: function (match) {
        let prefix = match.url
        prefix = prefix.startsWith('c/') ? prefix.slice(2) : prefix.slice(1)

        match.url = `/c/${prefix}`
      },
    },
    '@': {
      validate: function (text, pos, self) {
        var tail = text.slice(pos)

        if (!self.re.user) {
          self.re.user = new RegExp(
            /^([a-z0-9_.-]+)@([\da-z.-]+)\.([a-z]{2,63})/i,
          )
        }
        if (self.re.user.test(tail)) {
          // Linkifier allows punctuation chars before prefix,
          // but we additionally disable `@` ("@@mention" is invalid)
          if (pos >= 2 && tail[pos - 2] === '!') {
            return false
          }
          return tail.match(self.re.user)[0].length
        }
        return 0
      },
      normalize: function (match) {
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
export const localizeLink = (link) => {
  if (regexes.community.test(link)) {
    const match = link.match(regexes.community)
    if (!match) return

    // If the match[3] includes @, the URL included an instance already, so don't add one.
    if (match?.[3].includes('@')) return `/c/${match?.[3]}`
    else return `/c/${match?.[3]}@${match?.[1]}`
  }
  if (regexes.user.test(link)) {
    const match = link.match(regexes.user)
    if (!match) return

    // Same as above for the community.
    if (match?.[3].includes('@')) return `/profile/${match?.[3]}`
    else return `/profile/${match?.[3]}@${match?.[1]}`
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
export const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/**
 * Whether a markdown link href is safe to render as an anchor.
 * @param {string} href
 * @returns {boolean}
 */
export const isSafeHref = (href) => {
  if (!href) return false
  try {
    return SAFE_PROTOCOLS.has(new URL(href, 'https://base.invalid').protocol)
  } catch {
    return false
  }
}

export function subSupscriptExtension(tokensExtractor) {
  return {
    name: 'subscriptSuperscript',
    level: 'inline',
    start(src) {
      return src.match(/[~^]/)?.index
    },
    // eslint-disable-next-line
    tokenizer(src, tokens) {
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
