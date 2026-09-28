import { describe, expect, it, vi } from 'vitest'

vi.mock('$app/environment', () => ({
  browser: true,
  dev: false,
  building: false,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))

const { marked } = await import('marked')
const { render } = await import('svelte/server')
const { default: Markdown, lex } = await import('./Markdown.svelte')

/** Every token kind the renderers handle, block and inline. */
const EVERY_TOKEN = [
  '# Heading *em*',
  '',
  'Para **strong** _em_ ~~del~~ `code` ~sub~ ^sup^ [link](https://example.com) ![alt](https://example.com/a.png) https://example.org \\*escaped\\*',
  '',
  '> quote',
  '',
  '- item one',
  '- [ ] task',
  '',
  '1. first',
  '',
  '```js',
  'code()',
  '```',
  '',
  '---',
  '',
  '<b>html</b>',
  '',
  '| h1 | h2 |',
  '| :- | -: |',
  '| a  | b  |',
  '',
  '::: spoiler title',
  'hidden *text*',
  ':::',
].join('\n')

describe('Markdown lexing in the browser', () => {
  it('lexes a source once however often it is rendered', () => {
    const lexer = vi.spyOn(marked, 'lexer')

    const first = lex('**cached** title')
    const second = lex('**cached** title')

    expect(second).toBe(first)
    expect(lexer).toHaveBeenCalledTimes(1)
  })

  it('lexes a different source on its own', () => {
    expect(lex('one *source*')).not.toBe(lex('another *source*'))
  })

  it('does not keep long sources', () => {
    const long = `${'word '.repeat(1000)}*end*`
    expect(lex(long)).not.toBe(lex(long))
  })

  it('still strips javascript: links from a cached source', () => {
    const tokens = lex('[x](javascript:alert(1))')
    expect(JSON.stringify(tokens)).not.toContain('javascript:')
    expect(JSON.stringify(lex('[x](javascript:alert(1))'))).not.toContain(
      'javascript:',
    )
  })

  it('leaves the shared tokens as it found them after rendering', () => {
    // Every instance with the same source renders the one cached token list,
    // so a renderer that changed it would change what every other instance
    // renders.
    const tokens = lex(EVERY_TOKEN)
    const before = structuredClone(tokens)

    const renders = [false, true].flatMap((inline) =>
      [false, true].map(
        (noLinks) =>
          render(Markdown, { props: { source: EVERY_TOKEN, inline, noLinks } })
            .body,
      ),
    )
    const again = render(Markdown, { props: { source: EVERY_TOKEN } }).body

    expect(lex(EVERY_TOKEN)).toBe(tokens)
    expect(tokens).toEqual(before)
    expect(again).toBe(renders[0])
  })
})
