/**
 * Colour scheme on the first paint, against the built node server.
 *
 * What only this tier can see: the `<html>` class the server writes from the
 * `colorScheme` cookie, and the boot script tag in the served `<head>` that
 * applies stored theme variables before the app hydrates.
 */
import { describe, expect, inject, it } from 'vitest'

const baseUrl = inject('ssrBaseUrl')

async function themePage(headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}/theme`, { headers })
  expect(response.status).toBe(200)
  return await response.text()
}

/** The class tokens of the opening `<html>` tag. */
function htmlClassTokens(html: string): string[] {
  const openingTag = /<html\b[^>]*>/i.exec(html)?.[0]
  if (!openingTag) throw new Error('Response has no <html> tag')
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
