import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { buildRssDocument, type RssChannel, type RssItem } from './document'

const DC_NS = 'http://purl.org/dc/elements/1.1/'
const ATOM_NS = 'http://www.w3.org/2005/Atom'

const { DOMParser } = new JSDOM('').window

/** Parses the feed as XML. A malformed document yields a `<parsererror>` root. */
function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml')
}

function parseErrors(doc: Document): number {
  return doc.getElementsByTagName('parsererror').length
}

/** Text of the first direct child of `parent` with the given tag name. */
function childText(parent: Element | null | undefined, tag: string) {
  const child = Array.from(parent?.children ?? []).find(
    (el) => el.tagName === tag,
  )
  return child?.textContent ?? undefined
}

function channelOf(doc: Document): Element | null {
  return doc.querySelector('rss > channel')
}

function itemsOf(doc: Document): Element[] {
  return Array.from(doc.getElementsByTagName('item'))
}

const channel = (overrides: Partial<RssChannel> = {}): RssChannel => ({
  title: 'gaming',
  link: 'https://coves.test/c/gaming',
  description: 'Posts in !gaming@coves.test',
  selfUrl: 'https://coves.test/c/gaming/rss',
  ...overrides,
})

const item = (overrides: Partial<RssItem> = {}): RssItem => ({
  title: 'First post',
  link: 'https://coves.test/c/gaming/post/alice.coves.test/3kabc',
  guid: 'at://did:plc:alice/social.coves.community.postv2/3kabc',
  publishedAt: '2026-03-04T05:06:07.000Z',
  author: '@alice.coves.test',
  html: '<p>Hello</p>',
  ...overrides,
})

describe('buildRssDocument', () => {
  it('starts with an XML declaration', () => {
    const xml = buildRssDocument(channel(), [item()])

    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="utf-8"\?>/i)
  })

  it('emits an RSS 2.0 root declaring the dc and atom namespaces', () => {
    const doc = parseXml(buildRssDocument(channel(), [item()]))

    const root = doc.documentElement
    expect(root.tagName).toBe('rss')
    expect(parseErrors(doc)).toBe(0)
    expect(root.getAttribute('version')).toBe('2.0')
    expect(root.lookupNamespaceURI('dc')).toBe(DC_NS)
    expect(root.lookupNamespaceURI('atom')).toBe(ATOM_NS)
  })

  it('describes the channel and links to itself with atom:link rel=self', () => {
    const doc = parseXml(buildRssDocument(channel(), [item()]))
    const ch = channelOf(doc)

    expect(childText(ch, 'title')).toBe('gaming')
    expect(childText(ch, 'link')).toBe('https://coves.test/c/gaming')
    expect(childText(ch, 'description')).toBe('Posts in !gaming@coves.test')

    const selfLinks = Array.from(
      doc.getElementsByTagNameNS(ATOM_NS, 'link'),
    ).filter((el) => el.getAttribute('rel') === 'self')
    expect(selfLinks).toHaveLength(1)
    expect(selfLinks[0].getAttribute('type')).toBe('application/rss+xml')
    expect(selfLinks[0].getAttribute('href')).toBe(
      'https://coves.test/c/gaming/rss',
    )
  })

  it('writes each item with title, link, non-permalink guid, creator and description', () => {
    const doc = parseXml(
      buildRssDocument(channel(), [
        item(),
        item({
          title: 'Second post',
          link: 'https://coves.test/c/gaming/post/bob.coves.test/3kdef',
          guid: 'at://did:plc:bob/social.coves.community.postv2/3kdef',
          author: '@bob.coves.test',
          html: '<p>World</p>',
        }),
      ]),
    )
    const items = itemsOf(doc)

    expect(items).toHaveLength(2)
    const [first, second] = items
    expect(childText(first, 'title')).toBe('First post')
    expect(childText(first, 'link')).toBe(
      'https://coves.test/c/gaming/post/alice.coves.test/3kabc',
    )
    const guid = first.getElementsByTagName('guid')[0]
    expect(guid?.getAttribute('isPermaLink')).toBe('false')
    expect(guid?.textContent).toBe(
      'at://did:plc:alice/social.coves.community.postv2/3kabc',
    )
    expect(first.getElementsByTagNameNS(DC_NS, 'creator')[0]?.textContent).toBe(
      '@alice.coves.test',
    )
    expect(childText(first, 'description')).toBe('<p>Hello</p>')
    expect(childText(second, 'title')).toBe('Second post')
    expect(
      second.getElementsByTagNameNS(DC_NS, 'creator')[0]?.textContent,
    ).toBe('@bob.coves.test')
  })

  it.each([
    ['2026-03-04T05:06:07.000Z', 'Wed, 04 Mar 2026 05:06:07 GMT'],
    // An offset timestamp is converted to UTC, rolling over the year.
    ['2026-12-31T23:30:00-02:00', 'Fri, 01 Jan 2027 01:30:00 GMT'],
    ['2026-10-10T00:00:00Z', 'Sat, 10 Oct 2026 00:00:00 GMT'],
  ])('formats publishedAt %s as RFC 822 pubDate %s', (iso, expected) => {
    const doc = parseXml(
      buildRssDocument(channel(), [item({ publishedAt: iso })]),
    )

    expect(childText(itemsOf(doc)[0], 'pubDate')).toBe(expected)
  })

  it('omits pubDate when publishedAt does not parse', () => {
    const doc = parseXml(
      buildRssDocument(channel(), [item({ publishedAt: 'not-a-date' })]),
    )

    expect(parseErrors(doc)).toBe(0)
    expect(itemsOf(doc)[0].getElementsByTagName('pubDate')).toHaveLength(0)
  })

  it('HTML-escapes the channel description so a reader decodes it to text, not markup', () => {
    const doc = parseXml(
      buildRssDocument(
        channel({ description: '<img src=x onerror=alert(1)>' }),
        [],
      ),
    )

    expect(parseErrors(doc)).toBe(0)
    expect(childText(channelOf(doc), 'description')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    )
  })

  it.each([
    ['ampersand and angle brackets', '<p>Tom &amp; Jerry &lt;3</p>'],
    [
      'a CDATA terminator',
      '<p>before ]]> after</p><pre><code>a ]]]]>]]> b</code></pre>',
    ],
    [
      'attributes with entities',
      '<p><a href="https://x.test/?a=1&amp;b=2" title="&quot;q&quot;">link</a></p>',
    ],
  ])(
    'carries item html containing %s through the XML parser unchanged',
    (_label, html) => {
      const doc = parseXml(buildRssDocument(channel(), [item({ html })]))

      expect(childText(itemsOf(doc)[0], 'description')).toBe(html)
      expect(parseErrors(doc)).toBe(0)
    },
  )

  it('escapes markup-significant characters in every text field', () => {
    const hostile = `Cats & <Dogs> "quoted" 'single' ]]>`
    const url = 'https://coves.test/c/gaming?a=1&b="2"'
    const doc = parseXml(
      buildRssDocument(
        channel({
          title: hostile,
          description: hostile,
          link: url,
          selfUrl: url,
        }),
        [item({ title: hostile, author: hostile, link: url, guid: url })],
      ),
    )

    expect(parseErrors(doc)).toBe(0)
    const ch = channelOf(doc)
    expect(childText(ch, 'title')).toBe(hostile)
    // The channel description is plain text the builder HTML-escapes, since
    // readers decode it as HTML.
    expect(childText(ch, 'description')).toBe(
      'Cats &amp; &lt;Dogs&gt; &quot;quoted&quot; &#39;single&#39; ]]&gt;',
    )
    expect(childText(ch, 'link')).toBe(url)
    expect(
      doc.getElementsByTagNameNS(ATOM_NS, 'link')[0]?.getAttribute('href'),
    ).toBe(url)
    const [only] = itemsOf(doc)
    expect(childText(only, 'title')).toBe(hostile)
    expect(childText(only, 'link')).toBe(url)
    expect(childText(only, 'guid')).toBe(url)
    expect(only.getElementsByTagNameNS(DC_NS, 'creator')[0]?.textContent).toBe(
      hostile,
    )
  })

  it.each([
    ['U+0000', String.fromCharCode(0x0000)],
    ['U+0008', String.fromCharCode(0x0008)],
    ['U+FFFE', String.fromCharCode(0xfffe)],
  ])(
    'strips the XML-1.0-illegal character %s so the document still parses',
    (_label, bad) => {
      const doc = parseXml(
        buildRssDocument(channel({ title: `chan${bad}nel` }), [
          item({
            title: `ti${bad}tle`,
            author: `@al${bad}ice`,
            html: `<p>bo${bad}dy</p>`,
          }),
        ]),
      )

      expect(parseErrors(doc)).toBe(0)
      expect(childText(channelOf(doc), 'title')).toBe('channel')
      const [only] = itemsOf(doc)
      expect(childText(only, 'title')).toBe('title')
      expect(
        only.getElementsByTagNameNS(DC_NS, 'creator')[0]?.textContent,
      ).toBe('@alice')
      expect(childText(only, 'description')).toBe('<p>body</p>')
    },
  )

  it('keeps tab, newline and non-BMP characters', () => {
    const doc = parseXml(
      buildRssDocument(channel(), [item({ title: 'a\tb\nc 🌊 ö' })]),
    )

    expect(childText(itemsOf(doc)[0], 'title')).toBe('a\tb\nc 🌊 ö')
  })

  it('marks a sensitive item with <category>nsfw</category> and leaves others uncategorized', () => {
    const doc = parseXml(
      buildRssDocument(channel(), [item({ sensitive: true }), item()]),
    )
    const [sensitive, plain] = itemsOf(doc)

    expect(parseErrors(doc)).toBe(0)
    expect(
      Array.from(
        sensitive.getElementsByTagName('category'),
        (el) => el.textContent,
      ),
    ).toEqual(['nsfw'])
    expect(plain.getElementsByTagName('category')).toHaveLength(0)
  })

  it('builds a valid channel with no items from an empty list', () => {
    const doc = parseXml(buildRssDocument(channel(), []))

    expect(childText(channelOf(doc), 'title')).toBe('gaming')
    expect(itemsOf(doc)).toHaveLength(0)
    expect(parseErrors(doc)).toBe(0)
  })
})
