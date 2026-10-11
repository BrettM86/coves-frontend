import { escapeHtml } from './html'

export interface RssChannel {
  title: string
  link: string
  /**
   * Plain text. Readers decode a channel description as HTML, so the builder
   * HTML-escapes it before XML-escaping it.
   */
  description: string
  selfUrl: string
}

export interface RssItem {
  title: string
  link: string
  guid: string
  /** ISO 8601 timestamp. */
  publishedAt: string
  author: string
  html: string
  /** The post carries an NSFW self-label; its body and media are withheld. */
  sensitive?: boolean
}

export interface RssFeed {
  channel: RssChannel
  items: RssItem[]
}

/** Characters XML 1.0 forbids anywhere in a document, lone surrogates included. */
const XML_ILLEGAL = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu

const XML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

/** Escapes `value` for XML text or a quoted attribute, dropping illegal characters. */
function escapeXml(value: string): string {
  return value
    .replace(XML_ILLEGAL, '')
    .replace(/[&<>"']/g, (char) => XML_ENTITIES[char] ?? char)
}

/** RFC 822 date in UTC, or undefined when `iso` does not parse. */
function rfc822(iso: string): string | undefined {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? undefined : date.toUTCString()
}

function element(name: string, text: string): string {
  return `<${name}>${escapeXml(text)}</${name}>`
}

function itemXml(item: RssItem): string {
  const pubDate = rfc822(item.publishedAt)
  return [
    '<item>',
    element('title', item.title),
    element('link', item.link),
    `<guid isPermaLink="false">${escapeXml(item.guid)}</guid>`,
    pubDate ? element('pubDate', pubDate) : '',
    element('dc:creator', item.author),
    item.sensitive ? element('category', 'nsfw') : '',
    // The HTML travels as escaped text, which (unlike CDATA) survives a `]]>`
    // anywhere in the content.
    element('description', item.html),
    '</item>',
  ].join('')
}

/** Serializes an RSS 2.0 document with the Dublin Core and Atom namespaces. */
export function buildRssDocument(
  channel: RssChannel,
  items: RssItem[],
): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    element('title', channel.title),
    element('link', channel.link),
    element('description', escapeHtml(channel.description)),
    `<atom:link rel="self" type="application/rss+xml" href="${escapeXml(channel.selfUrl)}"/>`,
    ...items.map(itemXml),
    '</channel>',
    '</rss>',
  ].join('\n')
}
