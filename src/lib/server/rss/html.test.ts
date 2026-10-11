import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { FEATURE_TYPE } from '$lib/feature/richtext/facets'
import { facetOver } from '$lib/feature/richtext/test-helpers'
import { markdownToRssHtml, richTextToRssHtml } from './html'

// Pins the instance identity link localization reads: own origin
// https://coves.test, local community domain coves.test.
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.test' },
}))

const ORIGIN = 'https://coves.test'

/** Parses an HTML fragment the way a feed reader would. */
function parse(html: string): DocumentFragment {
  return JSDOM.fragment(html)
}

function anchors(html: string): HTMLAnchorElement[] {
  return Array.from(parse(html).querySelectorAll('a'))
}

/** Attribute names on an element, for "nothing broke out of href" checks. */
function attributeNames(el: Element): string[] {
  return Array.from(el.attributes, (attr) => attr.name)
}

const ALLOWED_ANCHOR_ATTRIBUTES = ['href', 'rel', 'title']

describe('markdownToRssHtml', () => {
  it.each([
    ['emphasis', 'some *soft* words', 'em', 'soft'],
    ['strong', 'some **loud** words', 'strong', 'loud'],
    ['strikethrough', 'some ~~gone~~ words', 'del', 'gone'],
    ['inline code', 'run `ls -la` now', 'code', 'ls -la'],
    [
      'code block',
      '```\nconst a = 1 < 2\n```',
      'pre > code',
      'const a = 1 < 2',
    ],
    ['unordered list', '- one\n- two', 'ul > li:nth-child(2)', 'two'],
    ['ordered list', '1. first\n2. second', 'ol > li:nth-child(1)', 'first'],
    ['blockquote', '> quoted words', 'blockquote', 'quoted words'],
    ['h1', '# Big title', 'h1', 'Big title'],
    ['h3', '### Small title', 'h3', 'Small title'],
    [
      'table header',
      '| a | b |\n|---|---|\n| 1 | 2 |',
      'table th:nth-child(2)',
      'b',
    ],
    [
      'table cell',
      '| a | b |\n|---|---|\n| 1 | 2 |',
      'table td:nth-child(1)',
      '1',
    ],
    ['subscript', 'H~2~O', 'sub', '2'],
    ['superscript', 'x^3^', 'sup', '3'],
    ['paragraph', 'just text', 'p', 'just text'],
  ])('renders %s as plain HTML', (_label, source, selector, text) => {
    const html = markdownToRssHtml(source, ORIGIN)

    expect(parse(html).querySelector(selector)?.textContent?.trim()).toBe(text)
  })

  it('renders a thematic break as <hr>', () => {
    const html = markdownToRssHtml('above\n\n---\n\nbelow', ORIGIN)

    expect(parse(html).querySelectorAll('hr')).toHaveLength(1)
  })

  it.each([
    ['two trailing spaces', 'line one  \nline two'],
    ['a trailing backslash', 'line one\\\nline two'],
  ])('turns a hard break written with %s into <br>', (_label, source) => {
    const fragment = parse(markdownToRssHtml(source, ORIGIN))

    expect(fragment.querySelectorAll('p br')).toHaveLength(1)
    expect(fragment.querySelector('p')?.textContent?.replace(/\n/g, '')).toBe(
      'line oneline two',
    )
  })

  it('renders a spoiler container as <details> with the title in <summary>', () => {
    const html = markdownToRssHtml(
      '::: spoiler Plot twist\nhidden *text*\n:::',
      ORIGIN,
    )
    const details = parse(html).querySelector('details')

    expect(details?.querySelector('summary')?.textContent?.trim()).toBe(
      'Plot twist',
    )
    expect(details?.querySelector('em')?.textContent).toBe('text')
    expect(details?.textContent).toContain('hidden')
  })

  it.each([
    ['a block script tag', '<script>alert(1)</script>', 'script'],
    [
      'an inline img with a handler',
      'hi <img src=x onerror=alert(1)> there',
      'img',
    ],
    ['an iframe', '<iframe src="https://evil.test"></iframe>', 'iframe'],
  ])('escapes %s in the source as text', (_label, source, tag) => {
    const html = markdownToRssHtml(source, ORIGIN)
    const fragment = parse(html)

    expect(fragment.querySelector(tag)).toBeNull()
    expect(fragment.textContent).toContain(`<${tag}`)
  })

  it('HTML-escapes text exactly once', () => {
    const html = markdownToRssHtml('Tom & Jerry <3', ORIGIN)

    expect(html).toContain('Tom &amp; Jerry &lt;3')
  })

  it.each([
    ['data:', '[click](data:text/html,hi)'],
    ['vbscript:', '[click](vbscript:y)'],
  ])('drops the href of a %s link and keeps its text', (_label, source) => {
    const html = markdownToRssHtml(source, ORIGIN)

    expect(anchors(html)).toHaveLength(0)
    expect(parse(html).textContent?.trim()).toBe('click')
  })

  it.each([
    ['double quote', `[x](https://example.com/a"onmouseover="alert(1))`],
    ['single quote', `[x](https://example.com/a'onmouseover='alert(1))`],
  ])(
    'keeps a URL containing a %s inside the href attribute',
    (_label, source) => {
      const links = anchors(markdownToRssHtml(source, ORIGIN))

      expect(links).toHaveLength(1)
      const [link] = links
      for (const name of attributeNames(link)) {
        expect(ALLOWED_ANCHOR_ATTRIBUTES).toContain(name)
      }
      expect(new URL(link.getAttribute('href') ?? '').host).toBe('example.com')
      expect(link.textContent).toBe('x')
    },
  )

  it.each([
    ['a relative path', '[tech](/c/tech)', 'https://coves.test/c/tech'],
    [
      'a remote community URL',
      '[g](https://lemmy.world/c/gaming)',
      'https://coves.test/c/gaming@lemmy.world',
    ],
    [
      'a linkified community mention',
      '!gaming@lemmy.world',
      'https://coves.test/c/gaming@lemmy.world',
    ],
    [
      'an own-instance profile URL',
      '[me](https://coves.test/u/alice.coves.test)',
      'https://coves.test/profile/alice.coves.test',
    ],
    [
      'an external link',
      '[ext](https://example.com/page?a=1&b=2)',
      'https://example.com/page?a=1&b=2',
    ],
    [
      'a bare external URL',
      'see https://example.com/x',
      'https://example.com/x',
    ],
    ['a mailto link', '[mail](mailto:a@example.com)', 'mailto:a@example.com'],
  ])('links %s to %s', (_label, source, href) => {
    const links = anchors(markdownToRssHtml(source, ORIGIN))

    expect(links.map((a) => a.getAttribute('href'))).toEqual([href])
  })

  it('renders a markdown image as its alt text only', () => {
    const html = markdownToRssHtml(
      'look ![a sleepy cat](https://img.example/cat.png "Cat")',
      ORIGIN,
    )

    expect(parse(html).querySelector('img')).toBeNull()
    expect(parse(html).textContent).toContain('a sleepy cat')
    expect(html).not.toContain('img.example')
  })

  it('emits no hydration comments, classes or UI chrome', () => {
    const html = markdownToRssHtml(
      [
        '# Title',
        '',
        'Some *text* with [a link](https://example.com) and `code`.',
        '',
        '::: spoiler Secret',
        'hidden',
        ':::',
        '',
        '| a | b |',
        '|---|---|',
        '| 1 | 2 |',
        '',
        '```js',
        'let x = 1',
        '```',
        '',
        '- [ ] task',
        '',
        '![alt](https://img.example/a.png)',
      ].join('\n'),
      ORIGIN,
    )

    expect(html).toContain('<h1')
    expect(html).not.toContain('<!--')
    expect(html).not.toContain('class=')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('<svg')
  })
})

describe('richTextToRssHtml', () => {
  const link = (uri: string) => ({ $type: FEATURE_TYPE.link, uri })
  const mention = (did: string) => ({ $type: FEATURE_TYPE.mention, did })
  const mark = (type: string) => ({ $type: type })

  it.each([
    {
      label: 'link facet keeps its external href',
      content: 'read the docs',
      facets: [
        facetOver('read the docs', 'docs', link('https://example.com/d')),
      ],
      selector: 'a[href="https://example.com/d"]',
      text: 'docs',
    },
    {
      label: 'mention resolves against the origin',
      content: 'hi @alice.coves.test',
      facets: [
        facetOver(
          'hi @alice.coves.test',
          '@alice.coves.test',
          mention('did:plc:alice'),
        ),
      ],
      selector: 'a[href="https://coves.test/u/did%3Aplc%3Aalice"]',
      text: '@alice.coves.test',
    },
    {
      label: 'bold',
      content: 'a loud word',
      facets: [facetOver('a loud word', 'loud', mark(FEATURE_TYPE.bold))],
      selector: 'strong',
      text: 'loud',
    },
    {
      label: 'italic',
      content: 'a soft word',
      facets: [facetOver('a soft word', 'soft', mark(FEATURE_TYPE.italic))],
      selector: 'em',
      text: 'soft',
    },
    {
      label: 'strikethrough',
      content: 'a gone word',
      facets: [
        facetOver('a gone word', 'gone', mark(FEATURE_TYPE.strikethrough)),
      ],
      selector: 'del',
      text: 'gone',
    },
    {
      label: 'inline code',
      content: 'run ls now',
      facets: [facetOver('run ls now', 'ls', mark(FEATURE_TYPE.code))],
      selector: 'code',
      text: 'ls',
    },
    {
      label: 'heading',
      content: 'Title\nbody',
      facets: [
        facetOver('Title\nbody', 'Title', {
          $type: FEATURE_TYPE.heading,
          level: 2,
        }),
      ],
      selector: 'h2',
      text: 'Title',
    },
    {
      label: 'blockquote',
      content: 'quoted line\nafter',
      facets: [
        facetOver('quoted line\nafter', 'quoted line', {
          $type: FEATURE_TYPE.blockquote,
          level: 1,
        }),
      ],
      selector: 'blockquote',
      text: 'quoted line',
    },
    {
      label: 'code block',
      content: 'intro\nlet a = 1 < 2\noutro',
      facets: [
        facetOver('intro\nlet a = 1 < 2\noutro', 'let a = 1 < 2', {
          $type: FEATURE_TYPE.codeBlock,
        }),
      ],
      selector: 'pre > code',
      text: 'let a = 1 < 2',
    },
    {
      label: 'spoiler',
      content: 'the end: he lives',
      facets: [
        facetOver('the end: he lives', 'he lives', {
          $type: FEATURE_TYPE.spoiler,
          reason: 'ending',
        }),
      ],
      selector: 'details',
      text: undefined,
      contains: 'he lives',
    },
  ])('renders $label', ({ content, facets, selector, text, contains }) => {
    const element = parse(
      richTextToRssHtml(content, facets, ORIGIN),
    ).querySelector(selector)

    expect(element).not.toBeNull()
    if (text !== undefined) expect(element?.textContent?.trim()).toBe(text)
    if (contains !== undefined) expect(element?.textContent).toContain(contains)
  })

  it('drops a disallowed-scheme link facet and keeps its text', () => {
    const content = 'click me please'
    const html = richTextToRssHtml(
      content,
      [facetOver(content, 'me', link('javascript:alert(1)'))],
      ORIGIN,
    )

    expect(anchors(html)).toHaveLength(0)
    expect(parse(html).textContent?.trim()).toBe('click me please')
  })

  it('keeps a single newline inside a paragraph as <br>', () => {
    const content = 'line one\nline two'
    const html = richTextToRssHtml(
      content,
      [facetOver(content, 'one', mark(FEATURE_TYPE.bold))],
      ORIGIN,
    )
    const fragment = parse(html)

    expect(fragment.querySelectorAll('p br')).toHaveLength(1)
    expect(fragment.querySelector('p')?.textContent?.replace(/\n/g, '')).toBe(
      'line oneline two',
    )
  })

  it('HTML-escapes text and keeps quoted URLs inside the href', () => {
    const content = 'a <b> & "c" link'
    const html = richTextToRssHtml(
      content,
      [facetOver(content, 'link', link('https://example.com/?q="x"\'y\''))],
      ORIGIN,
    )
    const fragment = parse(html)

    expect(html).toContain('a &lt;b&gt; &amp;')
    expect(fragment.querySelector('b')).toBeNull()
    const [only] = anchors(html)
    expect(only).toBeDefined()
    for (const name of attributeNames(only)) {
      expect(ALLOWED_ANCHOR_ATTRIBUTES).toContain(name)
    }
    expect(new URL(only.getAttribute('href') ?? '').host).toBe('example.com')
  })
})

describe('escaping at every text and attribute sink', () => {
  const payload = '<img src=x onerror=alert(1)>'
  const codeFacet = { $type: FEATURE_TYPE.code }
  const richCode = `run ${payload} now`
  const richCodeBlock = `intro\n${payload}\noutro`
  const richSpoiler = 'the end: he lives'

  it.each([
    [
      'a markdown code block',
      () => markdownToRssHtml(`\`\`\`\n${payload}\n\`\`\``, ORIGIN),
    ],
    ['a markdown codespan', () => markdownToRssHtml(`\`${payload}\``, ORIGIN)],
    [
      'a markdown subscript',
      () => markdownToRssHtml('~<img/src=x/onerror=alert(1)>~', ORIGIN),
    ],
    [
      'a markdown superscript',
      () => markdownToRssHtml('^<img/src=x/onerror=alert(1)>^', ORIGIN),
    ],
    [
      'a markdown spoiler title',
      () => markdownToRssHtml(`::: spoiler ${payload}\nbody\n:::`, ORIGIN),
    ],
    [
      'markdown image alt text',
      () =>
        markdownToRssHtml(`![${payload}](https://img.example/a.png)`, ORIGIN),
    ],
    [
      'a rich-text code facet',
      () =>
        richTextToRssHtml(
          richCode,
          [facetOver(richCode, payload, codeFacet)],
          ORIGIN,
        ),
    ],
    [
      'a rich-text code block',
      () =>
        richTextToRssHtml(
          richCodeBlock,
          [
            facetOver(richCodeBlock, payload, {
              $type: FEATURE_TYPE.codeBlock,
            }),
          ],
          ORIGIN,
        ),
    ],
    [
      'a rich-text spoiler reason',
      () =>
        richTextToRssHtml(
          richSpoiler,
          [
            facetOver(richSpoiler, 'he lives', {
              $type: FEATURE_TYPE.spoiler,
              reason: payload,
            }),
          ],
          ORIGIN,
        ),
    ],
  ])('shows an img tag in %s as text', (_label, render) => {
    const fragment = parse(render())

    expect(fragment.querySelectorAll('img').length).toBe(0)
    expect(fragment.textContent).toContain('<img')
  })

  it('keeps a quote in a markdown link title inside the title attribute', () => {
    const html = markdownToRssHtml(
      `[x](https://example.com 'a" onmouseover="alert(1)')`,
      ORIGIN,
    )
    const links = anchors(html)

    expect(links.length).toBe(1)
    expect(
      links
        .flatMap(attributeNames)
        .filter((name) => !ALLOWED_ANCHOR_ATTRIBUTES.includes(name)),
    ).toEqual([])
    expect(links.map((a) => a.getAttribute('title'))).toEqual([
      'a" onmouseover="alert(1)',
    ])
  })
})
