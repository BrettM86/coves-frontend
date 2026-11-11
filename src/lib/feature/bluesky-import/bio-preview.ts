/** Collapses runs of blank lines in a bio to one line break, for display only. */
export function collapseBlankLines(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n')
}
