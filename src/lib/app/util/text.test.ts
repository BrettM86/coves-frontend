import { describe, it, expect } from 'vitest'
import { escapeHtml } from './text'

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    )
  })

  it('escapes ampersands and quotes', () => {
    expect(escapeHtml('rock & roll\'s "best"')).toBe(
      'rock &amp; roll&#39;s &quot;best&quot;',
    )
  })
})
