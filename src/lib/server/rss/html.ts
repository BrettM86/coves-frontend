/**
 * Post and comment bodies as plain semantic HTML for feed readers.
 *
 * Built from the same parse the site renders from (`lex()` for Markdown,
 * `buildRichText()` for faceted content), so linkify, link localization and
 * the href allowlist match what a visitor sees. The output carries no
 * classes, comments or UI chrome. Every text node and attribute value is
 * HTML-escaped and every href passes {@link resolveHref}; raw HTML in the
 * source is shown as text and Markdown images as their alt text, as on the
 * site.
 */
import type { Token, Tokens } from 'marked'
import { t } from '$lib/app/state/i18n'
import { isSafeHref, SAFE_PROTOCOLS } from '$lib/app/util/url'
import { lex } from '$lib/feature/markdown/Markdown.svelte'
import { localizeLink } from '$lib/feature/markdown/renderers/plugins'
import {
  buildRichText,
  type Block,
  type Inline,
  type LinkSpan,
  type TextSegment,
} from '$lib/feature/richtext/facets'

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Escapes `value` for an HTML text node or a quoted attribute value. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] ?? char)
}

/**
 * The absolute URL an anchor may point at, or null when `href` is not an
 * allowed link target (see `isSafeHref`). Relative paths resolve against
 * `origin`, since a feed reader has no page URL to resolve them from.
 */
export function resolveHref(href: string, origin: string): string | null {
  if (!isSafeHref(href)) return null
  try {
    const url = new URL(href, origin)
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function anchor(href: string | null, inner: string, title?: string): string {
  if (href === null) return inner
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ''
  return `<a href="${escapeHtml(href)}"${titleAttribute}>${inner}</a>`
}

function spoilerDetails(summary: string, inner: string): string {
  return `<details><summary>${escapeHtml(summary)}</summary>${inner}</details>`
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** The spoiler title as MdSpoiler extracts it from the container source. */
function spoilerTitle(raw: string): string {
  return (
    /^::: ?spoiler (.+)\n[\s\S]+?\n:::/m.exec(raw)?.[1] ??
    t.get('content.spoiler.show')
  )
}

/** A Markdown image renders as its alt text, as MdImageAltText does. */
function imageAltText(token: Tokens.Image): string {
  const label = token.text.trim() === '' ? t.get('common.image') : token.text
  return escapeHtml(label)
}

/** Same target rule as MdLink, then made absolute against `origin`. */
function markdownLink(token: Tokens.Link, origin: string): string {
  const inner = renderTokens(token.tokens, origin)
  if (!isSafeHref(token.href)) return inner
  const target = localizeLink(token.href) ?? token.href
  return anchor(resolveHref(target, origin), inner, token.title ?? undefined)
}

function list(token: Tokens.List, origin: string): string {
  const items = token.items
    .map((item) => `<li>${renderTokens(item.tokens, origin)}</li>`)
    .join('')
  if (!token.ordered) return `<ul>${items}</ul>`
  const start =
    typeof token.start === 'number' && token.start !== 1
      ? ` start="${token.start}"`
      : ''
  return `<ol${start}>${items}</ol>`
}

function table(token: Tokens.Table, origin: string): string {
  const cell = (tag: 'th' | 'td', content: Tokens.TableCell) => {
    const align = content.align ? ` align="${escapeHtml(content.align)}"` : ''
    return `<${tag}${align}>${renderTokens(content.tokens, origin)}</${tag}>`
  }
  const head = token.header.map((heading) => cell('th', heading)).join('')
  const rows = token.rows
    .map((row) => `<tr>${row.map((data) => cell('td', data)).join('')}</tr>`)
    .join('')
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
}

/** Children if the token has any, else its text, as MdTree renders it. */
function contents(token: Tokens.Generic, origin: string): string {
  return token.tokens && token.tokens.length > 0
    ? renderTokens(token.tokens, origin)
    : escapeHtml(token.text ?? '')
}

function renderToken(token: Token, origin: string): string {
  switch (token.type) {
    case 'space':
    case 'def':
      return ''
    case 'paragraph':
      return `<p>${contents(token, origin)}</p>`
    case 'heading': {
      const { depth } = token as Tokens.Heading
      return depth >= 1 && depth <= 6
        ? `<h${depth}>${contents(token, origin)}</h${depth}>`
        : escapeHtml(token.raw)
    }
    case 'blockquote':
      return `<blockquote>${contents(token, origin)}</blockquote>`
    case 'code':
      return `<pre><code>${escapeHtml((token as Tokens.Code).text)}</code></pre>`
    case 'hr':
      return '<hr>'
    case 'list':
      return list(token as Tokens.List, origin)
    case 'table':
      return table(token as Tokens.Table, origin)
    case 'html': {
      // Raw HTML is never markup here: it shows as the author's text.
      const html = token as Tokens.HTML
      return html.block
        ? `<p>${escapeHtml(html.text)}</p>`
        : escapeHtml(html.text)
    }
    case 'spoiler':
      return spoilerDetails(spoilerTitle(token.raw), contents(token, origin))
    case 'text':
    case 'escape':
      return contents(token, origin)
    case 'strong':
      return `<strong>${contents(token, origin)}</strong>`
    case 'em':
      return `<em>${contents(token, origin)}</em>`
    case 'del':
      return `<del>${contents(token, origin)}</del>`
    case 'codespan':
      return `<code>${escapeHtml((token as Tokens.Codespan).text)}</code>`
    case 'br':
      return '<br>'
    case 'subscript':
      return `<sub>${escapeHtml(token.text ?? '')}</sub>`
    case 'superscript':
      return `<sup>${escapeHtml(token.text ?? '')}</sup>`
    case 'link':
      return markdownLink(token as Tokens.Link, origin)
    case 'image':
      return imageAltText(token as Tokens.Image)
    default:
      // No mapping for this token: fall back to the author's source text, as
      // MdTree does.
      return escapeHtml(token.raw ?? '')
  }
}

function renderTokens(tokens: Token[] | undefined, origin: string): string {
  return (tokens ?? []).map((token) => renderToken(token, origin)).join('')
}

/** Renders a Markdown body as HTML with links absolute against `origin`. */
export function markdownToRssHtml(source: string, origin: string): string {
  return renderTokens(lex(source), origin)
}

// ---------------------------------------------------------------------------
// Rich text (facets)
// ---------------------------------------------------------------------------

/**
 * Escaped text with newlines as `<br>`: the site shows faceted paragraphs
 * with pre-wrap, so their line breaks are content.
 */
function textWithBreaks(text: string): string {
  return text.split('\n').map(escapeHtml).join('<br>')
}

function textSegment(segment: TextSegment): string {
  let html = segment.code
    ? `<code>${escapeHtml(segment.text)}</code>`
    : textWithBreaks(segment.text)
  if (segment.strikethrough) html = `<del>${html}</del>`
  if (segment.italic) html = `<em>${html}</em>`
  if (segment.bold) html = `<strong>${html}</strong>`
  return html
}

function richLink(node: LinkSpan, origin: string): string {
  return anchor(
    resolveHref(node.href, origin),
    node.children.map(textSegment).join(''),
  )
}

function linkOrText(node: TextSegment | LinkSpan, origin: string): string {
  return node.type === 'link' ? richLink(node, origin) : textSegment(node)
}

function richInlines(nodes: readonly Inline[], origin: string): string {
  return nodes
    .map((node) =>
      node.type === 'spoiler'
        ? spoilerDetails(
            node.reason ?? t.get('content.spoiler.show'),
            node.children.map((child) => linkOrText(child, origin)).join(''),
          )
        : linkOrText(node, origin),
    )
    .join('')
}

function richBlock(block: Block, origin: string): string {
  switch (block.type) {
    case 'paragraph':
      return `<p>${richInlines(block.children, origin)}</p>`
    case 'heading':
      return `<h${block.level}>${richInlines(block.children, origin)}</h${block.level}>`
    case 'codeBlock':
      return `<pre><code>${escapeHtml(block.code)}</code></pre>`
    case 'blockquote':
      return `<blockquote>${block.children.map((child) => richBlock(child, origin)).join('')}</blockquote>`
  }
}

/** Renders faceted content as HTML with links absolute against `origin`. */
export function richTextToRssHtml(
  content: string,
  facets: unknown[],
  origin: string,
): string {
  return buildRichText(content, facets)
    .map((block) => richBlock(block, origin))
    .join('')
}
