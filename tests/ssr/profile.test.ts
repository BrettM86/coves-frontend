/**
 * The public user profile, `/profile/<handle-or-did>`, in server-rendered
 * HTML: the first response a visitor or crawler gets already carries the
 * profile's name and the active tab's posts or comments, whether or not a
 * session cookie came with it.
 *
 * The account pages under `/profile` (the bare own-profile redirect and
 * `/profile/settings`) keep today's behaviour: the server sends the client
 * shell and the browser decides where the visitor goes.
 */
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import { UNKNOWN_PATHS_PATH } from './mock-upstream'

const baseUrl = inject('ssrBaseUrl')
const unknownPathsUrl = `${inject('mockUpstreamUrl')}${UNKNOWN_PATHS_PATH}`

/** The markup a reader sees, with `<script>` blocks removed. */
function stripScripts(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
}

async function render(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; location: string | null; document: Document }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers,
    redirect: 'manual',
  })
  const html = stripScripts(await response.text())
  return {
    status: response.status,
    location: response.headers.get('location'),
    document: new JSDOM(html).window.document,
  }
}

beforeEach(async () => {
  const res = await fetch(unknownPathsUrl, { method: 'DELETE' })
  expect(res.status).toBe(200)
})

afterEach(async () => {
  const res = await fetch(unknownPathsUrl)
  expect(((await res.json()) as { paths: string[] }).paths).toEqual([])
})

describe('public profile in server-rendered HTML', () => {
  it.each<{ reader: string; headers: Record<string, string> }>([
    { reader: 'an anonymous visitor', headers: {} },
    { reader: 'a signed-in reader', headers: { Cookie: 'coves_session=a' } },
  ])('renders the name and the posts tab for $reader', async ({ headers }) => {
    const { status, document } = await render(
      '/profile/rss-author.test',
      headers,
    )

    expect(status).toBe(200)
    expect(document.title).toBe('RSS Author')
    expect(document.body.textContent).toContain('RSS fixture post')
  })

  it('renders a signed-in reader their own profile', async () => {
    const { status, document } = await render('/profile/mari.test', {
      Cookie: 'coves_session=a',
    })

    expect(status).toBe(200)
    expect(document.title).toBe('mari.test')
    expect(document.body.textContent).toContain('RSS fixture post')
  })

  it('renders the comments tab for an anonymous visitor', async () => {
    const { status, document } = await render(
      '/profile/rss-author.test?type=comments',
    )

    expect(status).toBe(200)
    expect(document.title).toBe('RSS Author')
    expect(document.body.textContent).toContain('An RSS fixture comment.')
  })
})

describe('account pages under /profile stay client-rendered', () => {
  it.each(['/profile', '/profile/settings'])(
    '%s sends an anonymous visitor the empty client shell',
    async (path) => {
      const { status, location, document } = await render(path)

      expect(status).toBe(200)
      expect(location).toBeNull()
      const shell = document.querySelector('div[data-sveltekit-preload-code]')
      expect(shell, 'the app mount point').not.toBeNull()
      expect(shell?.children.length).toBe(0)
    },
  )
})
