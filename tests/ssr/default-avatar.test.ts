/**
 * The DID-keyed default avatar in server-rendered HTML (PRD_DEFAULT_AVATARS
 * §4.5): the navbar shows the signed-in reader's avatar, so the first HTML a
 * reader without an avatar gets already carries their tint and default
 * picture, served from the instance's own origin. (`/profile/*` is not
 * server-rendered, and the community feed hides post authors' avatars, so the
 * navbar is the server-rendered user avatar checked at this tier.)
 */
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import { UNKNOWN_PATHS_PATH } from './mock-upstream'

const baseUrl = inject('ssrBaseUrl')
const unknownPathsUrl = `${inject('mockUpstreamUrl')}${UNKNOWN_PATHS_PATH}`

/**
 * `Cookie: coves_session=c` signs the request in as `MOCK_ACCOUNTS.c`, which
 * has no avatar.
 */
const signedInWithoutAvatar = { Cookie: 'coves_session=c' }

/** The markup a reader sees, with `<script>` blocks removed. */
function stripScripts(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
}

function backgroundColor(element: Element | null | undefined): string {
  const match = /background-color:\s*([^;]+)/i.exec(
    element?.getAttribute('style') ?? '',
  )
  return (match?.[1] ?? '').trim().toUpperCase()
}

beforeEach(async () => {
  const res = await fetch(unknownPathsUrl, { method: 'DELETE' })
  expect(res.status).toBe(200)
})

afterEach(async () => {
  const res = await fetch(unknownPathsUrl)
  expect(((await res.json()) as { paths: string[] }).paths).toEqual([])
})

describe('default avatar in the server-rendered navbar', () => {
  it('draws ocean-wave on Seafoam from the instance origin for a signed-in reader without an avatar', async () => {
    const response = await fetch(`${baseUrl}/`, {
      headers: signedInWithoutAvatar,
    })
    const html = stripScripts(await response.text())

    expect(response.status).toBe(200)

    const document = new JSDOM(html).window.document
    const navbar = document.querySelector('nav.navbar')
    expect(navbar, 'the navbar').not.toBeNull()
    // The profile button took its signed-in branch, the reader's avatar rather
    // than the signed-out menu icon (holds on any base).
    const profileButton = navbar?.querySelector('button[title="Profile"]')
    expect(profileButton, 'the profile button').not.toBeNull()
    expect(profileButton?.querySelector('.lucide-menu')).toBeNull()

    // `did:plc:ewvi7nxzyoun6zhxrhs64oiz` -> ocean-wave on Seafoam (§4.2).
    const src = `${baseUrl}/img/default-avatars/v1/ocean-wave.webp`
    const sources = Array.from(
      profileButton?.querySelectorAll('img') ?? [],
      (image) => image.getAttribute('src'),
    )
    expect(sources).toContain(src)
    const image = profileButton?.querySelector(`img[src="${src}"]`)
    expect(image?.getAttribute('alt')).toBe('')
    expect(backgroundColor(image?.parentElement)).toBe('#D5E6E3')
  })
})
