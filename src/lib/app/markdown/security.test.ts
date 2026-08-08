import { describe, it, expect } from 'vitest'
import { render } from 'svelte/server'
import Markdown from './Markdown.svelte'

// ---------------------------------------------------------------------------
// Acceptance: markdown is this app's main untrusted-input rendering surface.
// No matter what a post or comment author writes, the HTML we emit must never
// carry a non-allowlisted URL scheme into a navigation or fetch sink
// (href=, src=, iframe src=). The allowlist lives in
// ./renderers/plugins.ts as SAFE_PROTOCOLS / isSafeHref.
//
// COVERAGE MAP — read before adding anything to the corpus below.
//
//   Scheme obfuscation (embedded tab/newline/NUL, case, leading whitespace)
//     -> UNIT-covered in renderers/plugins.test.ts against isSafeHref, which is
//        where URL-parser normalization is the thing under test. Deliberately
//        NOT in the corpus here: markdown does not tokenize those as a link
//        destination at all, so an end-to-end case would pass with every guard
//        removed and prove nothing.
//
//   Hostile schemes that survive tokenization (data:, vbscript:, file:, blob:,
//   and javascript: in the angle-bracket forms preprocess() does not match)
//     -> SINK-covered here. Every payload below was verified to reach a
//        renderer, so these assertions genuinely exercise isSafeHref.
//
//   javascript: in [t](...) / ![t](...) form
//     -> stopped upstream by preprocess(), never reaching a renderer. Covered
//        in the "upstream defenses" section, which asserts the layer that
//        actually stops it rather than implying the guard did.
//
// Every hostile case also carries a BENIGN TWIN of the same markdown shape,
// asserted to produce at least one URL attribute. Without that control a
// hostile case proves nothing: a shape that silently stopped rendering would
// look identical to a shape whose payload was correctly refused.
// ---------------------------------------------------------------------------

const SAFE_PROTOCOLS: ReadonlySet<string> = new Set([
  'http:',
  'https:',
  'mailto:',
])

/** Base used only to resolve relative URLs; never a real origin. */
const RESOLUTION_BASE = 'https://base.invalid'

/**
 * Undo the entity escaping Svelte applies to attribute values so we compare
 * the URL the browser would actually see, not its serialized form.
 */
const decodeEntities = (value: string): string =>
  value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')

/** Every href= / src= attribute value in an emitted HTML string. */
const extractUrlAttributes = (html: string): string[] => {
  const attribute = /\b(?:href|src|srcset|formaction|data)\s*=\s*"([^"]*)"/gi
  return [...html.matchAll(attribute)].map((match) =>
    decodeEntities(match[1] ?? ''),
  )
}

/**
 * Elements that load or navigate to a URL. A hostile document must produce none
 * of them — an `<iframe src="">` is still an emitted iframe, and a guard that
 * merely blanks the URL downstream leaves the decision outside the component
 * that owns the untrusted input.
 */
const findSinkElements = (html: string): string[] => {
  const sink = /<(img|video|source|iframe|embed|object)(?=[\s/>])/gi
  return [...html.matchAll(sink)].map((match) => match[1]?.toLowerCase() ?? '')
}

/**
 * Whether a rendered attribute value would resolve to an allowlisted scheme.
 * Relative and empty values resolve against the base and come out https:.
 */
const hasSafeScheme = (value: string): boolean => {
  try {
    return SAFE_PROTOCOLS.has(new URL(value, RESOLUTION_BASE).protocol)
  } catch {
    return false
  }
}

const renderMarkdown = (source: string): string =>
  render(Markdown, { props: { source } }).body

// ---------------------------------------------------------------------------
// Hostile corpus — every payload verified to reach a renderer
// ---------------------------------------------------------------------------

/** Reaches the <img src> path: isImage() substring-matches the ".png". */
const REACHES_IMG = 'data:text/html;base64,PHN2Zz48L3N2Zz4=#.png'
/** Reaches the <video><source src> path via the same trick on isVideo(). */
const REACHES_VIDEO = 'data:text/html;base64,PHN2Zz48L3N2Zz4=#.mp4'

const SAFE_PAGE = 'https://ok.test/p'
const SAFE_IMAGE = 'https://ok.test/x.png'

/**
 * Non-allowlisted schemes that markdown does tokenize, so they reach MdLink /
 * MdImage and are refused there. These are the payloads that make the
 * assertions below mean something.
 */
const SINK_REACHING_URLS: readonly string[] = [
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
  'blob:https://x.test/abc',
  REACHES_IMG,
  REACHES_VIDEO,
]

interface HostileCase {
  readonly label: string
  /** Markdown carrying a non-allowlisted target. */
  readonly hostile: string
  /** Same markdown shape with a safe target; must still emit a URL. */
  readonly benign: string
}

const inlineCases: readonly HostileCase[] = SINK_REACHING_URLS.flatMap(
  (url) => [
    {
      label: `link ${JSON.stringify(url)}`,
      hostile: `[t](${url})`,
      benign: `[t](${SAFE_PAGE})`,
    },
    {
      label: `image ${JSON.stringify(url)}`,
      hostile: `![t](${url})`,
      benign: `![t](${SAFE_IMAGE})`,
    },
  ],
)

const structuralCases: readonly HostileCase[] = [
  // preprocess() only matches javascript: directly after "](", so the
  // angle-bracket forms are how javascript: gets real end-to-end coverage.
  {
    label: 'angle-bracket autolink (javascript:)',
    hostile: '<javascript:alert(1)>',
    benign: `<${SAFE_PAGE}>`,
  },
  {
    label: 'angle-bracket link destination (javascript:)',
    hostile: '[t](<javascript:alert(1)>)',
    benign: `[t](<${SAFE_PAGE}>)`,
  },
  {
    label: 'angle-bracket autolink (vbscript:)',
    hostile: '<vbscript:msgbox(1)>',
    benign: `<${SAFE_PAGE}>`,
  },
  {
    label: 'reference-style image definition',
    hostile: `[a]: ${REACHES_IMG}\n\n![a]\n`,
    benign: `[a]: ${SAFE_IMAGE}\n\n![a]\n`,
  },
  {
    label: 'reference-style vbscript definition',
    hostile: '[a]: vbscript:msgbox(1)\n\n[a]\n',
    benign: `[a]: ${SAFE_PAGE}\n\n[a]\n`,
  },
  {
    label: 'hostile target nested in a list item',
    hostile: `- ![t](${REACHES_IMG})\n`,
    benign: `- ![t](${SAFE_IMAGE})\n`,
  },
  {
    label: 'hostile target nested in a blockquote',
    hostile: `> ![t](${REACHES_IMG})\n`,
    benign: `> ![t](${SAFE_IMAGE})\n`,
  },
  // KNOWN GAP — deliberately absent, not an oversight: there is no table-cell
  // case here because GFM tables do not currently render at all. MdTree spreads
  // {...token}, and a marked table token carries `header` as a truthy ARRAY, so
  // `if (header) type = 'tablecell'` hijacks the whole table into MdTableCell
  // and the `type == 'table'` branch is unreachable — a table collapses to one
  // empty <td> and cell content never reaches a renderer. A hostile case here
  // could therefore assert nothing, and its benign twin would fail the
  // scaffolding control below. Tracked separately; RE-ADD this case (hostile
  // plus benign twin, same shape as the list-item and blockquote entries above)
  // once tables render, because a table cell is otherwise an ordinary place for
  // an author to put an image.
  {
    label: 'hostile target inside a spoiler block',
    hostile: `::: spoiler s\n![t](${REACHES_IMG})\n:::\n`,
    benign: `::: spoiler s\n![t](${SAFE_IMAGE})\n:::\n`,
  },
]

const HOSTILE_CASES: readonly HostileCase[] = [
  ...inlineCases,
  ...structuralCases,
]

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

describe('Markdown - untrusted URL schemes', () => {
  it('never emits a non-allowlisted scheme into any href/src sink', () => {
    const violations: string[] = []

    for (const { label, hostile } of HOSTILE_CASES) {
      const html = renderMarkdown(hostile)
      for (const url of extractUrlAttributes(html)) {
        if (!hasSafeScheme(url)) {
          violations.push(`${label} -> ${JSON.stringify(url)}`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('emits no media sink element for any hostile document', () => {
    const violations: string[] = []

    for (const { label, hostile } of HOSTILE_CASES) {
      for (const element of findSinkElements(renderMarkdown(hostile))) {
        violations.push(`${label} -> <${element}>`)
      }
    }

    expect(violations).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Per-case scaffold controls
//
// If a benign twin emits no URL, the matching hostile case is vacuous: it would
// pass with every guard removed. These assertions are what stop this corpus
// from quietly rotting into a suite that proves nothing.
// ---------------------------------------------------------------------------

describe('Markdown - hostile corpus scaffolding', () => {
  it.each(HOSTILE_CASES)(
    'the benign twin of "$label" still emits a URL',
    ({ benign }: HostileCase) => {
      expect(
        extractUrlAttributes(renderMarkdown(benign)).length,
      ).toBeGreaterThan(0)
    },
  )
})

// ---------------------------------------------------------------------------
// Upstream defenses
//
// These payloads never reach a renderer, so they do NOT exercise isSafeHref.
// Asserting "no unsafe URL" on them would be vacuous, so each one instead
// asserts the layer that actually stops it. If one of these layers is ever
// removed the payload starts reaching MdLink/MdImage, where the guard takes
// over — but the change will not pass silently.
// ---------------------------------------------------------------------------

interface UpstreamCase {
  readonly label: string
  readonly source: string
}

/** Rewritten to "*link removed*" by preprocess() in Markdown.svelte. */
const PREPROCESS_STRIPPED: readonly UpstreamCase[] = [
  { label: 'lowercase link', source: '[t](javascript:alert(1))' },
  { label: 'lowercase image', source: '![t](javascript:alert(1))' },
  { label: 'mixed-case link', source: '[t](JavaScript:alert(1))' },
  { label: 'uppercase link', source: '[t](JAVASCRIPT:alert(1))' },
  { label: 'leading-whitespace link', source: '[t](   javascript:alert(1))' },
  {
    label: 'reference-style definition',
    source: '[a]: javascript:alert(1)\n\n[a]\n',
  },
]

/**
 * Never parsed as a link destination at all — markdown does not allow raw
 * control characters there, so the scheme-splitting tricks that defeat regex
 * blocklists never produce a link token. isSafeHref is unit-tested against
 * these same strings in renderers/plugins.test.ts.
 */
const NEVER_TOKENIZED: readonly UpstreamCase[] = [
  { label: 'embedded tab', source: '[t](java\tscript:alert(1))' },
  { label: 'embedded newline', source: '[t](java\nscript:alert(1))' },
  { label: 'NUL prefix', source: '[t](\x00javascript:alert(1))' },
  { label: 'embedded tab, image', source: '![t](java\tscript:alert(1))' },
  { label: 'NUL prefix, image', source: '![t](\x00javascript:alert(1))' },
]

describe('Markdown - upstream defenses', () => {
  it.each(PREPROCESS_STRIPPED)(
    'preprocess() strips the $label form of javascript:',
    ({ source }: UpstreamCase) => {
      const html = renderMarkdown(source)
      expect(html).toContain('link removed')
      expect(extractUrlAttributes(html)).toEqual([])
    },
  )

  it.each(NEVER_TOKENIZED)(
    'markdown never tokenizes the $label form as a link',
    ({ source }: UpstreamCase) => {
      const html = renderMarkdown(source)
      // The destination survives as literal text, which is the proof that no
      // link token was ever produced.
      expect(html).toContain('](')
      expect(extractUrlAttributes(html)).toEqual([])
    },
  )
})

// ---------------------------------------------------------------------------
// Positive controls
// ---------------------------------------------------------------------------

describe('Markdown - legitimate targets', () => {
  it('still renders legitimate targets', () => {
    const image = renderMarkdown(`![alt](${SAFE_IMAGE})`)
    expect(image).toContain(SAFE_IMAGE)

    const external = renderMarkdown('[t](https://ok.test/page)')
    expect(external).toContain('href="https://ok.test/page"')

    const relative = renderMarkdown('[t](/relative/path)')
    expect(relative).toContain('href="/relative/path"')

    const mail = renderMarkdown('[t](mailto:a@b.test)')
    expect(mail).toContain('href="mailto:a@b.test"')
  })
})
