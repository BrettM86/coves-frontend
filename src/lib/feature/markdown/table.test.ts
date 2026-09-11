import { describe, it, expect } from 'vitest'
import { render } from 'svelte/server'
import Markdown from './Markdown.svelte'

// ---------------------------------------------------------------------------
// Acceptance: a GFM table in a post or comment body renders as a real table.
//
// Observed from outside the component: given a pipe-table source, SSR must emit
// a <table> whose <thead> holds one header row of <th> cells and whose <tbody>
// holds the data rows as <td> cells, carrying the author's column alignment and
// inline formatting.
//
// The regression this guards: MdTree's top-level {:else} branch spreads every
// token field onto the recursive Self, so a table token's `header` field — an
// ARRAY of header cells — arrived as the boolean-ish `header` prop and coerced
// the node type to "tablecell". The whole table collapsed to one empty cell.
//
// The assertions below check nesting and cell counts rather than substrings:
// a fix that emitted the right tags in the wrong shape (header cells in the
// body, or a second stray row) would satisfy "contains <th>" and still be
// broken. There is no DOM implementation in this test tier (vitest runs with
// environment: 'node' and the repo has no jsdom/happy-dom), so the structure is
// read back with the small depth-aware tag scanner below.
// ---------------------------------------------------------------------------

const TABLE_SOURCE = '| h1 | h2 |\n| -- | -- |\n| a  | b  |\n'

/** Svelte's SSR hydration markers (<!--[-->, <!--]-->) are not content. */
const stripComments = (html: string): string =>
  html.replace(/<!--[\s\S]*?-->/g, '')

/**
 * Inner HTML of every top-level `<tag>` element in `html`, counting nesting of
 * that same tag so an outer element is not closed by an inner one's end tag.
 */
const elementsOf = (html: string, tag: string): string[] => {
  const boundary = new RegExp(`<${tag}(?=[\\s/>])[^>]*>|</${tag}\\s*>`, 'gi')
  const contents: string[] = []
  let depth = 0
  let openEnd = 0
  for (const match of html.matchAll(boundary)) {
    const token = match[0]
    const at = match.index ?? 0
    if (token.startsWith('</')) {
      depth -= 1
      if (depth === 0) contents.push(html.slice(openEnd, at))
    } else if (!token.endsWith('/>')) {
      if (depth === 0) openEnd = at + token.length
      depth += 1
    }
  }
  return contents
}

/** Visible text of an HTML fragment, whitespace collapsed. */
const textOf = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

interface Cell {
  /** "th" or "td". */
  readonly tag: string
  /** The align attribute value, or null when the attribute is absent. */
  readonly align: string | null
  readonly text: string
  readonly html: string
}

/**
 * Every cell of one row, in document order. Cells never nest, so a lazy pair
 * match is enough here.
 */
const cellsOf = (rowHtml: string): Cell[] =>
  [...rowHtml.matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)].map(
    (match) => {
      const attributes = match[2] ?? ''
      const align = /\balign\s*=\s*"([^"]*)"/i.exec(attributes)
      const inner = match[3] ?? ''
      return {
        tag: (match[1] ?? '').toLowerCase(),
        align: align === null ? null : (align[1] ?? ''),
        text: textOf(inner),
        html: inner,
      }
    },
  )

/**
 * Every `head` this file's renders produced, in render order.
 *
 * Svelte 5 reports `node_invalid_placement_ssr` twice: once on `console.error`
 * and once as a `<script>console.error(...)</script>` pushed into the render's
 * `head` (node_modules/svelte/src/internal/server/dev.js, `print_error`). The
 * head copy is what gets asserted on below, because the console copy is close
 * to untestable here: `render()` is lazy, emitting nothing until `.body` or
 * `.head` is read, so a console spy has to be installed around the *read* and
 * not around the `render()` call.
 *
 * Svelte also deduplicates each distinct message per process, so only the first
 * render that provokes a given message carries it. Collecting every head and
 * asserting on the whole list is what makes the check independent of which
 * render runs first: wherever the warning lands, it lands in this array.
 *
 * That dedupe is per Svelte module instance, so this check relies on vitest's
 * default per-file isolation: with isolation off, a render in another file
 * could take the one copy of the message and leave every head here clean.
 */
const renderedHeads: string[] = []

/** Render Markdown to SSR HTML, recording the render's `head` on the way. */
const renderMarkdown = (props: {
  source: string
  inline?: boolean
}): string => {
  const output = render(Markdown, { props })
  const body = stripComments(output.body)
  renderedHeads.push(output.head)
  return body
}

const renderTable = (source: string): string => renderMarkdown({ source })

/** The single <table> of a render, failing loudly when there is none. */
const tableOf = (html: string): string => {
  const tables = elementsOf(html, 'table')
  expect(tables, `no <table> in:\n${html}`).toHaveLength(1)
  return tables[0] ?? ''
}

/** Header rows then body rows of a table, each as a list of cells. */
const rowsOf = (
  table: string,
  section: 'thead' | 'tbody',
): readonly (readonly Cell[])[] => {
  const sections = elementsOf(table, section)
  return sections.flatMap((one) => elementsOf(one, 'tr').map(cellsOf))
}

const RENDERED = renderTable(TABLE_SOURCE)

describe('Markdown - GFM table', () => {
  it('renders a header row of <th> and a body row of <td>', () => {
    const table = tableOf(RENDERED)

    const heads = elementsOf(table, 'thead')
    expect(heads, `no <thead> in:\n${table}`).toHaveLength(1)
    const headRows = elementsOf(heads[0] ?? '', 'tr')
    expect(headRows).toHaveLength(1)
    const headCells = cellsOf(headRows[0] ?? '')
    expect(headCells.map((cell) => cell.tag)).toEqual(['th', 'th'])
    expect(headCells.map((cell) => cell.text)).toEqual(['h1', 'h2'])

    const bodies = elementsOf(table, 'tbody')
    expect(bodies, `no <tbody> in:\n${table}`).toHaveLength(1)
    const bodyRows = elementsOf(bodies[0] ?? '', 'tr')
    expect(bodyRows).toHaveLength(1)
    const bodyCells = cellsOf(bodyRows[0] ?? '')
    expect(bodyCells.map((cell) => cell.tag)).toEqual(['td', 'td'])
    expect(bodyCells.map((cell) => cell.text)).toEqual(['a', 'b'])
  })

  // Every render in this file happens while the suite is being collected, so
  // by the time this test body runs `renderedHeads` already holds all of them.
  it('renders without an SSR node placement warning', () => {
    // Without this the check would also pass if `renderedHeads` were never
    // filled — "no warning" and "nothing looked at" must not read the same.
    expect(renderedHeads.length).toBeGreaterThan(0)
    const placement = renderedHeads.filter((head) =>
      head.includes('node_invalid_placement_ssr'),
    )
    expect(placement, placement.join('\n')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Column alignment
//
// The alignment row is the author's only control over how a column reads, and
// it applies to the header cell as well as every body cell of that column. A
// column with no alignment marker must carry no align attribute at all: an
// empty or comma-joined value is how the collapsed-table bug showed itself, so
// "absent" is asserted rather than "falsy".
// ---------------------------------------------------------------------------

const ALIGNED_SOURCE =
  '| l | c | r | n |\n|:--|:-:|--:|--|\n| 1 | 2 | 3 | 4 |\n'
const EXPECTED_ALIGNMENT: readonly (string | null)[] = [
  'left',
  'center',
  'right',
  null,
]

describe('Markdown - GFM table alignment', () => {
  const table = tableOf(renderTable(ALIGNED_SOURCE))
  const headRows = rowsOf(table, 'thead')
  const bodyRows = rowsOf(table, 'tbody')

  it('applies the column alignment to the header cells', () => {
    expect(headRows).toHaveLength(1)
    const cells = headRows[0] ?? []
    expect(cells.map((cell) => cell.tag)).toEqual(['th', 'th', 'th', 'th'])
    expect(cells.map((cell) => cell.align)).toEqual(EXPECTED_ALIGNMENT)
  })

  it('applies the column alignment to the body cells', () => {
    expect(bodyRows).toHaveLength(1)
    const cells = bodyRows[0] ?? []
    expect(cells.map((cell) => cell.tag)).toEqual(['td', 'td', 'td', 'td'])
    expect(cells.map((cell) => cell.align)).toEqual(EXPECTED_ALIGNMENT)
  })
})

// ---------------------------------------------------------------------------
// Inline formatting inside cells
//
// Cell content is a token subtree, not a string. If the table branch ever
// stringifies a cell (or drops its child tokens the way the inline renderer map
// once dropped headings), bold and links inside cells silently flatten to text.
// ---------------------------------------------------------------------------

const CELL_LINK = 'https://example.test/x'
const FORMATTED_SOURCE = `| **bold** | plain |\n| -- | -- |\n| [link](${CELL_LINK}) | b |\n`

describe('Markdown - GFM table cell content', () => {
  const table = tableOf(renderTable(FORMATTED_SOURCE))

  it('renders bold markup inside the header cell', () => {
    const cells = rowsOf(table, 'thead')[0] ?? []
    const first = cells[0]
    expect(first?.tag).toBe('th')
    const strong = elementsOf(first?.html ?? '', 'strong')
    expect(strong, `no <strong> in:\n${first?.html ?? ''}`).toHaveLength(1)
    expect(textOf(strong[0] ?? '')).toBe('bold')
  })

  it('renders a link inside the body cell', () => {
    const cells = rowsOf(table, 'tbody')[0] ?? []
    const first = cells[0]
    expect(first?.tag).toBe('td')
    const anchors = [
      ...(first?.html ?? '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi),
    ]
    expect(anchors, `no <a> in:\n${first?.html ?? ''}`).toHaveLength(1)
    expect(anchors[0]?.[1] ?? '').toContain(`href="${CELL_LINK}"`)
    expect(textOf(anchors[0]?.[2] ?? '')).toBe('link')
  })
})

// ---------------------------------------------------------------------------
// Ragged and empty cells
//
// GFM pads a short row out to the header's column count. A renderer that skips
// missing cells instead shifts every later column left, so the cell counts
// below matter as much as the text in them.
// ---------------------------------------------------------------------------

const RAGGED_SOURCE = '| h1 | h2 |\n| -- | -- |\n| a |\n| | b |\n'
const HEADER_ONLY_SOURCE = '| h1 | h2 |\n| -- | -- |\n'

describe('Markdown - GFM table ragged rows', () => {
  const raggedTable = tableOf(renderTable(RAGGED_SOURCE))
  const headerOnlyTable = tableOf(renderTable(HEADER_ONLY_SOURCE))

  it('pads a short row and keeps an empty cell in place', () => {
    const bodyRows = rowsOf(raggedTable, 'tbody')
    expect(bodyRows).toHaveLength(2)

    const firstRow = bodyRows[0] ?? []
    expect(firstRow.map((cell) => cell.tag)).toEqual(['td', 'td'])
    expect(firstRow.map((cell) => cell.text)).toEqual(['a', ''])

    const secondRow = bodyRows[1] ?? []
    expect(secondRow.map((cell) => cell.tag)).toEqual(['td', 'td'])
    expect(secondRow.map((cell) => cell.text)).toEqual(['', 'b'])
  })

  it('renders a header-only table with no body rows', () => {
    const headRows = rowsOf(headerOnlyTable, 'thead')
    expect(headRows).toHaveLength(1)
    const cells = headRows[0] ?? []
    expect(cells.map((cell) => cell.tag)).toEqual(['th', 'th'])
    expect(cells.map((cell) => cell.text)).toEqual(['h1', 'h2'])
    // Either no <tbody> at all or an empty one; what must not happen is a
    // phantom data row built from the header cells.
    expect(rowsOf(headerOnlyTable, 'tbody')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Inline mode
//
// PostMeta renders post titles with <Markdown inline>, whose renderer map has
// no table entry. A title made of pipes must degrade to its source text, not
// smuggle table markup into a feed row.
// ---------------------------------------------------------------------------

describe('Markdown - GFM table in inline mode', () => {
  const inline = renderMarkdown({ source: TABLE_SOURCE, inline: true })

  it('emits no table markup', () => {
    expect(elementsOf(inline, 'table')).toEqual([])
    expect(cellsOf(inline)).toEqual([])
  })

  it('still shows the author text', () => {
    expect(textOf(inline)).toContain('h1')
  })
})

// ---------------------------------------------------------------------------
// Table inside a spoiler
//
// Spoilers and tables are two separate block extensions that meet here: the
// spoiler tokenizer re-lexes its body and hands the resulting tokens to
// MdTree, which is exactly the recursion the collapsed-table bug lived in. A
// table that renders but escapes its spoiler is worse than one that does not
// render at all — the content the author chose to hide would be on screen —
// so placement is asserted, not just presence.
//
// The spoiler body is the Disclosure's `class="expand"` element (Svelte adds a
// scope class alongside it, hence the word-boundary class match).
// ---------------------------------------------------------------------------

const SPOILED_TABLE_SOURCE =
  ':::spoiler T\n| h1 | h2 |\n|---|---|\n| a | b |\n:::\n'

/**
 * Inner HTML of the first `<tag>` whose class list contains `className`,
 * counting nesting of that same tag so an inner element's end tag does not
 * close it. Returns null when no such element is present.
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

describe('Markdown - GFM table inside a spoiler', () => {
  const rendered = renderTable(SPOILED_TABLE_SOURCE)
  const spoilerBody = elementWithClass(rendered, 'div', 'expand')
  const outsideSpoiler =
    spoilerBody === null ? rendered : rendered.replace(spoilerBody, '')

  it('renders exactly one table', () => {
    expect(elementsOf(rendered, 'table'), rendered).toHaveLength(1)
  })

  it('puts the table inside the spoiler body', () => {
    expect(spoilerBody, `no .expand element in:\n${rendered}`).not.toBeNull()
    expect(
      elementsOf(spoilerBody ?? '', 'table'),
      `table is not inside the spoiler body:\n${spoilerBody ?? ''}`,
    ).toHaveLength(1)
    // The complement: nothing table-shaped escaped into the summary or into
    // the document around the spoiler.
    expect(elementsOf(outsideSpoiler, 'table'), outsideSpoiler).toEqual([])
  })

  it('renders the header and body cells of the spoiled table', () => {
    const table = tableOf(spoilerBody ?? '')

    const headRows = rowsOf(table, 'thead')
    expect(headRows).toHaveLength(1)
    const headCells = headRows[0] ?? []
    expect(headCells.map((cell) => cell.tag)).toEqual(['th', 'th'])
    expect(headCells.map((cell) => cell.text)).toEqual(['h1', 'h2'])

    const bodyRows = rowsOf(table, 'tbody')
    expect(bodyRows).toHaveLength(1)
    const bodyCells = bodyRows[0] ?? []
    expect(bodyCells.map((cell) => cell.tag)).toEqual(['td', 'td'])
    expect(bodyCells.map((cell) => cell.text)).toEqual(['a', 'b'])
  })
})
