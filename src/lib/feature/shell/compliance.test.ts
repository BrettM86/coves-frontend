import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import Sidebar from './Sidebar.svelte'
import Profile from './navbar/Profile.svelte'
import CovesSidebar from '$lib/feature/instance/CovesSidebar.svelte'

vi.stubGlobal('__VERSION__', 'test')

const renderOptions = () => ({
  context: new Map([
    ['__request__', { page: { url: new URL('http://localhost/') } }],
  ]),
})

describe('legal information is discoverable without signing in', () => {
  it('links the instance sidebar guidelines to their dedicated page', () => {
    const anchors =
      render(CovesSidebar, renderOptions()).body.match(
        /<a\b[^>]*>[\s\S]*?<\/a>/g,
      ) ?? []
    const guidelines = anchors.find((anchor) =>
      anchor.replace(/<[^>]+>/g, '').includes('Community Guidelines'),
    )
    expect(guidelines).toContain('href="/community-guidelines"')
  })

  it.each([
    ['desktop sidebar', () => render(Sidebar, renderOptions()).body],
    ['mobile profile menu', () => render(Profile, renderOptions()).body],
  ] as const)('%s links to legal and source information', (_, renderMenu) => {
    const anchors = renderMenu().match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? []
    const anchor = anchors.find((tag) => tag.includes('href="/legal"'))
    expect(anchor).toBeDefined()
    expect(anchor?.replace(/<[^>]+>/g, '')).toMatch(
      /Legal\s*(?:&amp;|&)\s*source/i,
    )
  })
})

describe('instance sidebar external icon links', () => {
  it.each([
    ['Coves source code on Tangled', 'https://tangled.org/bretton.dev/coves'],
    [
      'Get Coves on App Store',
      'https://apps.apple.com/app/coves-social/id6758530907',
    ],
    [
      'Get Coves on Google Play',
      'https://play.google.com/store/apps/details?id=social.coves',
    ],
  ])('links to %s in a new tab', (label, url) => {
    const anchors =
      render(CovesSidebar, renderOptions()).body.match(
        /<a\b[^>]*>[\s\S]*?<\/a>/g,
      ) ?? []
    const anchor = anchors.find((tag) => tag.includes(`href="${url}"`))
    expect(anchor).toBeDefined()
    expect(anchor).toContain('target="_blank"')
    expect(anchor).toContain('rel="noopener noreferrer"')
    expect(anchor).toContain(`aria-label="${label}"`)
  })
})
