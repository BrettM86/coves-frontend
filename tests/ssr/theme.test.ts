/**
 * Colour scheme on the first paint, against the built node server.
 *
 * What only this tier can see: the `<html>` class the server writes from the
 * `colorScheme` cookie, and the boot script inlined into the served `<head>`
 * that applies stored theme variables before the app hydrates.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, inject, it } from 'vitest'

/** The shipped boot script, read as text: this tier imports no app source. */
const themeBootPath = 'src/lib/app/state/theme/theme-boot.js'

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

  it('inlines the theme boot script in <head>, admitted by its CSP hash', async () => {
    const response = await fetch(`${baseUrl}/theme`)
    expect(response.status).toBe(200)
    const html = await response.text()
    const csp = response.headers.get('content-security-policy') ?? ''
    const scriptSrc = /(?:^|;)\s*script-src ([^;]*)/.exec(csp)?.[1] ?? ''

    const head = html.slice(0, html.indexOf('</head>'))
    const boot = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(
      ([, body]) => body.includes("localStorage.getItem('colorScheme')"),
    )
    expect(boot?.[1]).toBe(readFileSync(themeBootPath, 'utf8'))
    const hash = createHash('sha256')
      .update(boot?.[1] ?? '')
      .digest('base64')
    expect(scriptSrc).toContain(`'sha256-${hash}'`)
    expect(html).not.toContain('%coves.themeboot%')
    expect(html).not.toContain('/theme-boot.js')
  })

  it('serves the favicons from stable, unhashed URLs', async () => {
    const html = await themePage()

    // Google Search wants a favicon URL that does not change between
    // deploys, so the icons live in static/, not behind a content hash.
    const icons = [
      ...html.matchAll(/<link rel="(?:icon|apple-touch-icon)" href="([^"]+)"/g),
    ].map((m) => m[1])
    expect(icons).toEqual([
      '/favicon.ico',
      '/favicon.svg',
      '/favicon-96x96.png',
      '/apple-touch-icon.png',
    ])
    for (const icon of icons) {
      const asset = await fetch(`${baseUrl}${icon}`)
      expect(asset.status, icon).toBe(200)
      // sirv sends no Content-Type for .ico (Caddy sets it in prod), so
      // check the ICO magic bytes there instead.
      if (icon.endsWith('.ico')) {
        const head = new Uint8Array(await asset.arrayBuffer()).slice(0, 4)
        expect([...head], icon).toEqual([0, 0, 1, 0])
      } else {
        expect(asset.headers.get('content-type'), icon).toMatch(/^image\//)
      }
    }
  })

  it('points the splash logo at a hashed, immutable asset', async () => {
    const html = await themePage()

    const logo = /<img src="([^"]+)"/.exec(html)?.[1] ?? ''
    expect(logo).toMatch(/^\/_app\/immutable\/assets\/lil_dude\.[\w-]+\.svg$/)
    expect(html).not.toContain('%coves.favicon%')
    const asset = await fetch(`${baseUrl}${logo}`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('cache-control')).toContain('immutable')
  })

  it('serves every icon the web app manifest lists', async () => {
    const manifestUrl = `${baseUrl}/manifest.json`
    const manifest = await fetch(manifestUrl)
    expect(manifest.status).toBe(200)
    const { icons } = (await manifest.json()) as { icons: { src: string }[] }
    expect(icons.length).toBeGreaterThan(0)
    for (const { src } of icons) {
      const asset = await fetch(new URL(src, manifestUrl))
      expect(asset.status, src).toBe(200)
      expect(asset.headers.get('content-type'), src).toBe('image/png')
    }
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
