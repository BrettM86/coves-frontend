/**
 * Test-only helpers for the `parseMarkup` suites. Not imported by any shipped
 * code: it lives here rather than in a `.test.ts` file so both compose suites
 * can share it (vitest only collects `*.test.ts`, so this file is never run as
 * a suite of its own).
 */
import { expect } from 'vitest'
import { parseMarkup } from './compose'
import { buildRichText, type Block } from './facets'

const encoder = new TextEncoder()

export function byteLength(value: string): number {
  return encoder.encode(value).length
}

/**
 * UTF-8 byte range of `needle` inside `content`, measured rather than counted
 * by hand: "ö" and "🌊" are wider in bytes than in characters, and every later
 * offset depends on that.
 */
export function byteRange(
  content: string,
  needle: string,
): { byteStart: number; byteEnd: number } {
  const index = content.indexOf(needle)
  expect(
    index,
    `${JSON.stringify(needle)} is not in ${JSON.stringify(content)}`,
  ).toBeGreaterThan(-1)
  const byteStart = byteLength(content.slice(0, index))
  return { byteStart, byteEnd: byteStart + byteLength(needle) }
}

/** A facet covering `needle` within `content`. */
export function facetOver(
  content: string,
  needle: string,
  ...features: Record<string, unknown>[]
): { index: { byteStart: number; byteEnd: number }; features: unknown[] } {
  return { index: byteRange(content, needle), features }
}

/**
 * Parse `source`, check the invariants every parse owes the reader, and return
 * the tree the reader builds from the result. A facet that survives
 * `parseMarkup` but not `buildRichText` is a bug in the writer, not the reader,
 * so the two are asserted together.
 */
export function readerTree(source: string): readonly Block[] {
  const parsed = parseMarkup(source)
  const limit = byteLength(parsed.content)
  let previousStart = -1
  for (const facet of parsed.facets) {
    expect(facet.index.byteStart).toBeGreaterThanOrEqual(previousStart)
    // No zero-length facets: an empty construct annotates nothing.
    expect(facet.index.byteStart).toBeLessThan(facet.index.byteEnd)
    expect(facet.index.byteEnd).toBeLessThanOrEqual(limit)
    previousStart = facet.index.byteStart
  }
  return buildRichText(parsed.content, parsed.facets)
}
