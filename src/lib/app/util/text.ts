export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function fuzzySearch(text: string, pattern: string): number {
  const textLower = text.toLowerCase()
  const patternLower = pattern.toLowerCase()
  let score = 0
  let lastIndex = -1
  let consecutiveBonus = 0

  for (let i = 0; i < patternLower.length; i++) {
    const index = textLower.indexOf(patternLower[i], lastIndex + 1)
    if (index === -1) return 0

    score += 1
    if (index === lastIndex + 1) {
      consecutiveBonus++
      score += consecutiveBonus
    } else {
      consecutiveBonus = 0
    }

    lastIndex = index
  }

  // Bonus for matching start of words
  if (textLower.startsWith(patternLower)) {
    score += 2
  } else if (textLower.includes(' ' + patternLower)) {
    score += 1
  }

  return score
}
