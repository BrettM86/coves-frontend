import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import Legal from './+page.svelte'

describe('public legal and source links', () => {
  it('identifies the software as Coves frontend', () => {
    const text = render(Legal).body.replace(/<[^>]+>/g, '')
    expect(text.includes('Coves frontend')).toBe(true)
    expect(text.includes('Coves (Kelp)')).toBe(false)
  })

  it('links to the separate community guidelines page', () => {
    const anchors = render(Legal).body.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? []
    const anchor = anchors.find((tag) =>
      tag.includes('href="/community-guidelines"'),
    )
    expect(anchor).toBeDefined()
    expect(anchor?.replace(/<[^>]+>/g, '')).toContain('Community Guidelines')
  })

  it('keeps the guidelines prose on its dedicated page', () => {
    expect(render(Legal).body.includes('Hey there! Welcome to Coves.')).toBe(
      false,
    )
  })

  it.each(['/privacy', '/delete-account', '/safety/child-safety'])(
    'navigates to the backend-owned %s page with a full document request',
    (path) => {
      const html = render(Legal).body
      const anchors = html.match(/<a\b[^>]*>/g) ?? []
      const anchor = anchors.find((tag) => tag.includes(`href="${path}"`))
      expect(anchor).toBeDefined()
      if (!anchor) throw new Error(`Missing policy link: ${path}`)
      expect(anchor).not.toMatch(/\bdata-sveltekit-reload="false"/)
      // SvelteKit inherits link options from ancestors. Markdown-authored
      // anchors therefore get full-document navigation from their article.
      const reloadAttribute = /\bdata-sveltekit-reload(?:=""|="true")?(?=[\s>])/
      const article = html.match(/<article\b[^>]*>[\s\S]*<\/article>/)?.[0]
      const articleTag = article?.match(/^<article\b[^>]*>/)?.[0] ?? ''
      expect(
        reloadAttribute.test(anchor) ||
          (reloadAttribute.test(articleTag) && article?.includes(anchor)),
      ).toBe(true)
    },
  )

  it('offers the public corresponding source and local licence', () => {
    const html = render(Legal).body
    expect(html).toContain('href="https://github.com/BrettM86/coves-frontend"')
    expect(html).toContain('href="/license"')
  })
})
