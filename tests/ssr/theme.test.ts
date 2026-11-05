/**
 * Colour scheme on the first paint, against the built node server.
 *
 * What only this tier can see: the `<html>` class the server writes from the
 * `colorScheme` cookie, and the boot script tag in the served `<head>` that
 * applies stored theme variables before the app hydrates.
 */
import { describe, expect, inject, it } from 'vitest'

const baseUrl = inject('ssrBaseUrl')
const instanceThemeBaseUrl = inject('ssrInstanceThemeBaseUrl')

async function themePage(
  headers: Record<string, string> = {},
  origin: string = baseUrl,
) {
  const response = await fetch(`${origin}/theme`, { headers })
  expect(response.status).toBe(200)
  return await response.text()
}

/** The opening `<html>` tag. */
function openingHtmlTag(html: string): string {
  const openingTag = /<html\b[^>]*>/i.exec(html)?.[0]
  if (!openingTag) throw new Error('Response has no <html> tag')
  return openingTag
}

/** The class tokens of the opening `<html>` tag. */
function htmlClassTokens(html: string): string[] {
  const openingTag = openingHtmlTag(html)
  const classValue = /\bclass="([^"]*)"/i.exec(openingTag)?.[1] ?? ''
  return classValue.split(/\s+/).filter(Boolean)
}

describe('GET /theme colour scheme', () => {
  it.each([
    { cookie: 'colorScheme=light', dark: false },
    { cookie: undefined, dark: true },
    { cookie: 'colorScheme=dark', dark: true },
  ])('cookie $cookie renders dark: $dark', async ({ cookie, dark }) => {
    const html = await themePage(cookie ? { Cookie: cookie } : {})

    expect(htmlClassTokens(html).includes('dark')).toBe(dark)
  })

  it('tells the boot script the configured default scheme', async () => {
    const html = await themePage()

    const openingTag = /<html\b[^>]*>/i.exec(html)?.[0] ?? ''
    expect(openingTag).toContain('data-default-color-scheme="system"')
  })

  it('loads the theme boot script inside <head>', async () => {
    const html = await themePage()

    const scriptIndex = html.indexOf('<script src="/theme-boot.js"></script>')
    expect(scriptIndex).toBeGreaterThan(-1)
    expect(scriptIndex).toBeLessThan(html.indexOf('</head>'))
  })
})

describe('GET /theme grain marker', () => {
  // global-setup runs the main server with PUBLIC_THEME removed and a second
  // one with a valid PUBLIC_THEME, so the host env can't decide either case.
  it.each([
    { server: 'no PUBLIC_THEME', origin: baseUrl, grain: true },
    {
      server: 'a valid PUBLIC_THEME',
      origin: instanceThemeBaseUrl,
      grain: false,
    },
  ])('with $server, <html> data-grain: $grain', async ({ origin, grain }) => {
    const html = await themePage({}, origin)

    expect(/\sdata-grain(\s|=|>)/.test(openingHtmlTag(html))).toBe(grain)
  })
})
