// RFC 3339 with an explicit offset. Seconds and offset go through Date.parse;
// the fractional digits are kept as text because the server sends nanoseconds
// and a JavaScript Date holds only milliseconds.
const timestampPattern =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/

interface ParsedTimestamp {
  epochMilliseconds: number
  fractionDigits: string
}

function parseTimestamp(value: string): ParsedTimestamp | undefined {
  const match = timestampPattern.exec(value)
  if (!match) return undefined
  const [, wholeSeconds, fractionDigits = '', offset] = match
  const epochMilliseconds = Date.parse(`${wholeSeconds}${offset}`)
  if (!Number.isFinite(epochMilliseconds)) return undefined
  return { epochMilliseconds, fractionDigits }
}

function sign(difference: number): -1 | 0 | 1 {
  if (difference < 0) return -1
  if (difference > 0) return 1
  return 0
}

function compareParsed(a: ParsedTimestamp, b: ParsedTimestamp): -1 | 0 | 1 {
  const secondsOrder = sign(a.epochMilliseconds - b.epochMilliseconds)
  if (secondsOrder !== 0) return secondsOrder
  const width = Math.max(9, a.fractionDigits.length, b.fractionDigits.length)
  const fractionA = a.fractionDigits.padEnd(width, '0')
  const fractionB = b.fractionDigits.padEnd(width, '0')
  if (fractionA < fractionB) return -1
  if (fractionA > fractionB) return 1
  return 0
}

/** Orders two notification timestamps as instants at nanosecond precision. */
export function compareNotificationTimestamps(
  a: string,
  b: string,
): -1 | 0 | 1 {
  const parsedA = parseTimestamp(a)
  const parsedB = parseTimestamp(b)
  // The message leaves the input out so callers can log it safely.
  if (!parsedA || !parsedB) {
    throw new Error('Unparseable notification timestamp')
  }
  return compareParsed(parsedA, parsedB)
}

/** The largest parseable sortAt, returned exactly as the server sent it. */
export function pageOneWatermark(
  rows: readonly { sortAt: string }[],
): string | undefined {
  let largest: { sortAt: string; parsed: ParsedTimestamp } | undefined
  for (const row of rows) {
    const parsed = parseTimestamp(row.sortAt)
    if (!parsed) continue
    if (!largest || compareParsed(parsed, largest.parsed) > 0) {
      largest = { sortAt: row.sortAt, parsed }
    }
  }
  return largest?.sortAt
}

/**
 * Read state for a row on page two onwards, judged against page one's seenAt.
 * Without a seenAt every later row is read; if either timestamp is unparseable
 * the server's isRead stands.
 */
export function laterPageIsRead(
  row: { sortAt: string; isRead: boolean },
  seenAt: string | undefined,
): boolean {
  if (seenAt === undefined) return true
  try {
    return compareNotificationTimestamps(row.sortAt, seenAt) <= 0
  } catch {
    return row.isRead
  }
}

/**
 * The value as a Date, truncated to millisecond precision, when it is a strict
 * RFC 3339 string with an explicit offset; otherwise undefined.
 */
export function usableDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = parseTimestamp(value)
  if (!parsed) return undefined
  const milliseconds = Number(parsed.fractionDigits.slice(0, 3).padEnd(3, '0'))
  return new Date(parsed.epochMilliseconds + milliseconds)
}
