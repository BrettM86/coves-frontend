import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import ExternalLinkBar from './ExternalLinkBar.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

function renderBar(uri: string): HTMLElement {
  const html = render(ExternalLinkBar, { props: { uri } }).body
  return new JSDOM(`<main>${html}</main>`).window.document.body
}

describe('ExternalLinkBar', () => {
  it('renders an openable web URL as an external link with host and favicon', () => {
    const bar = renderBar('https://www.TheGamer.com/tim-sweeney/')

    const links = bar.querySelectorAll('a')
    expect(links).toHaveLength(1)
    const [link] = links
    expect(link.getAttribute('href')).toBe(
      'https://www.thegamer.com/tim-sweeney/',
    )
    expect(link.getAttribute('target')).toBe('_blank')
    const rel = (link.getAttribute('rel') ?? '').split(/\s+/)
    expect(rel).toContain('noopener')
    expect(rel).toContain('noreferrer')
    expect(link.getAttribute('aria-label')).toBe(
      'Open link to www.thegamer.com',
    )

    const favicon = link.querySelector('img')
    expect(favicon?.getAttribute('src')).toBe(
      'https://www.google.com/s2/favicons?domain=www.thegamer.com&sz=32',
    )
    expect(link.textContent?.trim()).toBe('www.thegamer.com')
    expect(link.querySelector('svg.lucide-external-link')).not.toBeNull()
  })

  it.each([
    ['javascript:alert(1)', 'javascript:alert(1)'],
    ['  ftp://files.example.com/a  ', 'ftp://files.example.com/a'],
  ])(
    'renders the unopenable uri %j as an inert bar labelled with the raw uri',
    (uri, label) => {
      const bar = renderBar(uri)

      expect(bar.querySelector('svg.lucide-globe')).not.toBeNull()
      expect(bar.textContent?.trim()).toBe(label)
      expect(bar.querySelector('a')).toBeNull()
      expect(bar.querySelector('img')).toBeNull()
      expect(bar.querySelector('svg.lucide-external-link')).toBeNull()
    },
  )
})
