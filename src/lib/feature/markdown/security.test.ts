import { describe, it, expect } from 'vitest'
import { render } from 'svelte/server'
import { isSafeHref } from '$lib/app/util/url'
import Markdown from './Markdown.svelte'

// ---------------------------------------------------------------------------
// Acceptance: markdown is this app's main untrusted-input rendering surface.
// No matter what a post or comment author writes, the HTML we emit must never
// carry a non-allowlisted URL scheme into a navigation or fetch sink
// (href=, src=, iframe src=). The allowlist lives in
// $lib/app/util/url as SAFE_PROTOCOLS / isSafeHref (re-exported from
// ./renderers/plugins.ts for renderer callers).
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
// with a control asserting the twin still renders. Without that control a
// hostile case proves nothing: a shape that silently stopped rendering would
// look identical to a shape whose payload was correctly refused.
//
// The control differs by token type, because the contracts differ. A link twin
// must still emit its URL. An image twin must emit NO URL and no media element
// at all: image syntax renders its alt text and nothing else, so there the
// surviving alt text is what proves the shape still renders.
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

/** Visible text of an HTML fragment: comments and tags out, entities resolved. */
const visibleText = (html: string): string =>
  decodeEntities(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

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

/**
 * A data: HTML document whose pathname genuinely ends in ".png". The extension
 * was chosen to defeat extension-based media classification, which is how this
 * payload used to reach an <img src>. Image syntax no longer routes on its
 * destination at all, so nothing classifies it now — it stays in the corpus
 * because the link cases below still carry it to MdLink, where isSafeHref is
 * the only thing refusing it, and because the image cases must keep proving it
 * reaches no sink by any route.
 */
const DATA_URL_PNG_TAIL = 'data:text/html;charset=utf-8,x.png'
/** The same shape wearing a video extension. */
const DATA_URL_MP4_TAIL = 'data:text/html;charset=utf-8,x.mp4'

const SAFE_PAGE = 'https://ok.test/p'
const SAFE_IMAGE = 'https://ok.test/x.png'

/**
 * Non-allowlisted schemes that markdown does tokenize, so they reach a renderer
 * and are refused there. These are the payloads that make the assertions below
 * mean something.
 */
const SINK_REACHING_URLS: readonly string[] = [
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
  'blob:https://x.test/abc',
  DATA_URL_PNG_TAIL,
  DATA_URL_MP4_TAIL,
  // The same schemes wearing an image extension. An opaque scheme puts its
  // whole body in `pathname`, so anything classifying a destination by its
  // extension calls these images — which is what made them the strongest
  // payloads for the old image sink, and why they stay. (javascript: is not
  // here: it is stripped upstream by preprocess() in this form and is covered
  // in the angle-bracket structural case below, where it does reach a
  // renderer.)
  'vbscript:msgbox(1).png',
  'file:///etc/passwd.png',
  'blob:https://x.test/abc.png',
]

interface CaseShape {
  readonly label: string
  /** Markdown carrying a non-allowlisted target. */
  readonly hostile: string
  /** The same markdown shape with a safe target. */
  readonly benign: string
}

/** A link twin must still emit its URL. */
interface LinkCase extends CaseShape {
  readonly kind: 'link'
}

/** An image twin must show its alt text and emit no URL and no media element. */
interface ImageCase extends CaseShape {
  readonly kind: 'image'
  readonly benignAlt: string
}

type HostileCase = LinkCase | ImageCase

const inlineCases: readonly HostileCase[] = SINK_REACHING_URLS.flatMap(
  (url) => [
    {
      kind: 'link',
      label: `link ${JSON.stringify(url)}`,
      hostile: `[t](${url})`,
      benign: `[t](${SAFE_PAGE})`,
    } satisfies LinkCase,
    {
      kind: 'image',
      label: `image ${JSON.stringify(url)}`,
      hostile: `![t](${url})`,
      benign: `![t](${SAFE_IMAGE})`,
      benignAlt: 't',
    } satisfies ImageCase,
  ],
)

/**
 * An image in a structural container. Every one of these is a place an author
 * ordinarily puts an image, and each reaches the renderer down a different
 * MdTree branch — table header cells and body cells, for one, are rendered by
 * separate branches, so a guard that held on one would say nothing about the
 * other.
 *
 * `containerTag` is where the benign twin's alt text must land. The shared
 * image control below only asks that the alt survives somewhere, which alt
 * text that escaped its table or its spoiler would still satisfy.
 */
interface ContainedImageCase extends ImageCase {
  readonly containerTag: string
  /** Set when the tag alone is ambiguous: the spoiler body is a nested <div>. */
  readonly containerClass?: string
}

const CONTAINED_IMAGE_CASES: readonly ContainedImageCase[] = [
  {
    kind: 'image',
    label: 'hostile target nested in a list item',
    hostile: `- ![t](${DATA_URL_PNG_TAIL})\n`,
    benign: `- ![t](${SAFE_IMAGE})\n`,
    benignAlt: 't',
    containerTag: 'li',
  },
  {
    kind: 'image',
    label: 'hostile target nested in a blockquote',
    hostile: `> ![t](${DATA_URL_PNG_TAIL})\n`,
    benign: `> ![t](${SAFE_IMAGE})\n`,
    benignAlt: 't',
    containerTag: 'blockquote',
  },
  {
    kind: 'image',
    label: 'hostile target inside a table body cell',
    hostile: `| h |\n| - |\n| ![t](${DATA_URL_PNG_TAIL}) |\n`,
    benign: `| h |\n| - |\n| ![t](${SAFE_IMAGE}) |\n`,
    benignAlt: 't',
    containerTag: 'td',
  },
  {
    kind: 'image',
    label: 'hostile target inside a table header cell',
    hostile: `| ![t](${DATA_URL_PNG_TAIL}) |\n| - |\n| x |\n`,
    benign: `| ![t](${SAFE_IMAGE}) |\n| - |\n| x |\n`,
    benignAlt: 't',
    containerTag: 'th',
  },
  {
    kind: 'image',
    label: 'hostile target inside a heading',
    hostile: `# ![t](${DATA_URL_PNG_TAIL})\n`,
    benign: `# ![t](${SAFE_IMAGE})\n`,
    benignAlt: 't',
    containerTag: 'h1',
  },
  {
    kind: 'image',
    label: 'reference-style image definition',
    hostile: `[a]: ${DATA_URL_PNG_TAIL}\n\n![a]\n`,
    benign: `[a]: ${SAFE_IMAGE}\n\n![a]\n`,
    benignAlt: 'a',
    containerTag: 'p',
  },
  {
    kind: 'image',
    label: 'hostile target inside a spoiler block',
    hostile: `::: spoiler s\n![t](${DATA_URL_PNG_TAIL})\n:::\n`,
    benign: `::: spoiler s\n![t](${SAFE_IMAGE})\n:::\n`,
    benignAlt: 't',
    containerTag: 'div',
    containerClass: 'expand',
  },
]

/** Inner HTML of every `<tag>`, for the containers here, which never nest. */
const elementContents = (html: string, tag: string): string[] => {
  const element = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'gi')
  return [...html.matchAll(element)].map((match) => match[1] ?? '')
}

/**
 * Inner HTML of the first `<tag>` whose class list contains `className`,
 * counting nesting of that same tag so an inner element's end tag does not
 * close it. The spoiler body is a <div> wrapped in, and wrapping, other
 * <div>s, so the lazy match above cannot find it.
 */
const elementWithClass = (
  html: string,
  tag: string,
  className: string,
): string | null => {
  const boundary = new RegExp(`<${tag}(?=[\\s/>])[^>]*>|</${tag}\\s*>`, 'gi')
  const carriesClass = new RegExp(
    `\\bclass\\s*=\\s*"[^"]*\\b${className}\\b[^"]*"`,
    'i',
  )
  let depth = 0
  let openDepth = -1
  let contentStart = 0
  for (const match of html.matchAll(boundary)) {
    const token = match[0]
    const at = match.index ?? 0
    if (token.startsWith('</')) {
      depth -= 1
      if (depth === openDepth) return html.slice(contentStart, at)
    } else if (!token.endsWith('/>')) {
      if (openDepth === -1 && carriesClass.test(token)) {
        openDepth = depth
        contentStart = at + token.length
      }
      depth += 1
    }
  }
  return null
}

/** Every candidate container of one case, in document order. */
const containersOf = (html: string, one: ContainedImageCase): string[] => {
  if (one.containerClass === undefined) {
    return elementContents(html, one.containerTag)
  }
  const found = elementWithClass(html, one.containerTag, one.containerClass)
  return found === null ? [] : [found]
}

const structuralCases: readonly HostileCase[] = [
  // preprocess() only matches javascript: directly after "](", so the
  // angle-bracket forms are how javascript: gets real end-to-end coverage.
  {
    kind: 'link',
    label: 'angle-bracket autolink (javascript:)',
    hostile: '<javascript:alert(1)>',
    benign: `<${SAFE_PAGE}>`,
  },
  {
    kind: 'link',
    label: 'angle-bracket link destination (javascript:)',
    hostile: '[t](<javascript:alert(1)>)',
    benign: `[t](<${SAFE_PAGE}>)`,
  },
  {
    kind: 'link',
    label: 'angle-bracket autolink (vbscript:)',
    hostile: '<vbscript:msgbox(1)>',
    benign: `<${SAFE_PAGE}>`,
  },
  // preprocess() matches "](javascript:" literally, so "](<javascript:" slips
  // past it and reaches the image renderer with its destination intact. It is
  // the only javascript: payload in the corpus that gets that far, which is
  // what makes it worth keeping now that the destination is dropped rather
  // than guarded.
  {
    kind: 'image',
    label: 'angle-bracket image destination (javascript: disguised as .png)',
    hostile: '![t](<javascript:alert(1)//x.png>)',
    benign: `![t](<${SAFE_IMAGE}>)`,
    benignAlt: 't',
  },
  {
    kind: 'link',
    label: 'reference-style vbscript definition',
    hostile: '[a]: vbscript:msgbox(1)\n\n[a]\n',
    benign: `[a]: ${SAFE_PAGE}\n\n[a]\n`,
  },
  ...CONTAINED_IMAGE_CASES,
]

const HOSTILE_CASES: readonly HostileCase[] = [
  ...inlineCases,
  ...structuralCases,
]

const LINK_CASES: readonly LinkCase[] = HOSTILE_CASES.filter(
  (one: HostileCase): one is LinkCase => one.kind === 'link',
)

const IMAGE_CASES: readonly ImageCase[] = HOSTILE_CASES.filter(
  (one: HostileCase): one is ImageCase => one.kind === 'image',
)

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

// ---------------------------------------------------------------------------
// Corpus preconditions
//
// The benign twins above prove each markdown SHAPE still renders. They cannot
// prove each PAYLOAD is still one the app has to refuse: a destination that
// isSafeHref quietly started accepting would leave its hostile link case
// passing while asserting nothing.
//
// The media-classification preconditions that used to live here are gone with
// the image renderer's media branches — image syntax no longer looks at its
// destination, so there is no branch left for a payload to be steered into.
// ---------------------------------------------------------------------------

describe('Markdown - hostile corpus preconditions', () => {
  it.each([...SINK_REACHING_URLS, 'javascript:alert(1)//x.png'])(
    '%j is a scheme isSafeHref refuses',
    (url: string) => {
      expect(isSafeHref(url)).toBe(false)
    },
  )
})

describe('Markdown - hostile corpus scaffolding', () => {
  it.each(LINK_CASES)(
    'the benign twin of "$label" still emits a URL',
    ({ benign }: LinkCase) => {
      expect(
        extractUrlAttributes(renderMarkdown(benign)).length,
      ).toBeGreaterThan(0)
    },
  )

  it.each(IMAGE_CASES)(
    'the benign twin of "$label" keeps its alt text and emits no media',
    ({ benign, benignAlt }: ImageCase) => {
      const html = renderMarkdown(benign)
      expect(visibleText(html), html).toContain(benignAlt)
      expect(extractUrlAttributes(html), html).toEqual([])
      expect(findSinkElements(html), html).toEqual([])
    },
  )

  it.each(CONTAINED_IMAGE_CASES)(
    'the benign twin of "$label" puts its alt text inside a <$containerTag>',
    (one: ContainedImageCase) => {
      const html = renderMarkdown(one.benign)
      const holding = containersOf(html, one).filter((content) =>
        visibleText(content).includes(one.benignAlt),
      )
      expect(holding.length, html).toBeGreaterThan(0)
    },
  )
})

// ---------------------------------------------------------------------------
// Upstream defenses
//
// These payloads never reach a renderer, so they do NOT exercise isSafeHref.
// Asserting "no unsafe URL" on them would be vacuous, so each one instead
// asserts the layer that actually stops it. If one of these layers is ever
// removed the payload starts reaching MdLink, where the guard takes over —
// but the change will not pass silently.
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
  // A legitimate image is not a positive control for URL emission any more:
  // the contract is that its destination goes nowhere, safe or not, and only
  // the alt text remains.
  it('renders a legitimate image as its alt text alone', () => {
    const image = renderMarkdown(`![alt](${SAFE_IMAGE})`)
    expect(visibleText(image)).toBe('alt')
    expect(image, image).not.toContain('ok.test')
    expect(findSinkElements(image), image).toEqual([])
    expect(extractUrlAttributes(image), image).toEqual([])
  })

  it('still renders legitimate link targets', () => {
    const external = renderMarkdown('[t](https://ok.test/page)')
    expect(external).toContain('href="https://ok.test/page"')

    const relative = renderMarkdown('[t](/relative/path)')
    expect(relative).toContain('href="/relative/path"')

    const mail = renderMarkdown('[t](mailto:a@b.test)')
    expect(mail).toContain('href="mailto:a@b.test"')
  })
})
