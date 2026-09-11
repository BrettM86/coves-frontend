import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import type { Component } from 'svelte'
import Markdown from '$lib/feature/markdown/Markdown.svelte'
import guidelinesSource from '$lib/assets/community-guidelines.md?raw'

const pages = import.meta.glob<{ default: Component }>('./+page.svelte')
const visibleText = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

describe('public community guidelines', () => {
  it('publishes the complete existing guidelines at their dedicated route', async () => {
    const loadPage = pages['./+page.svelte']
    expect(
      loadPage,
      '/community-guidelines must expose a public page',
    ).toBeTypeOf('function')
    if (!loadPage) throw new Error('Missing /community-guidelines page')
    const { default: Guidelines } = await loadPage()
    const html = render(Guidelines).body
    const expectedGuidelines = render(Markdown, {
      props: { source: guidelinesSource },
    }).body
    expect(visibleText(html)).toContain(visibleText(expectedGuidelines))
  })
})
