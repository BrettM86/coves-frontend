/**
 * Notification pages against the built node server.
 *
 * What only this tier can see: what a server render of a notification page
 * puts in the HTML and which upstream calls it made. Notification data is
 * loaded in the browser only, so a signed-in render must show no fetched
 * preference value and send no `social.coves.notification.*` request.
 */
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import {
  UNKNOWN_PATHS_PATH,
  XRPC_LOG_PATH,
  type XrpcRequest,
} from './mock-upstream'

const baseUrl = inject('ssrBaseUrl')
const mockUpstreamUrl = inject('mockUpstreamUrl')
const xrpcLogUrl = `${mockUpstreamUrl}${XRPC_LOG_PATH}`
const unknownPathsUrl = `${mockUpstreamUrl}${UNKNOWN_PATHS_PATH}`

/** `Cookie: coves_session=a` signs the request in as `MOCK_ACCOUNTS.a`. */
const signedIn = { Cookie: 'coves_session=a' }

/**
 * The markup a reader sees, with `<script>` blocks removed: Kit inlines the
 * load payload there, which is data the page was given, not what it rendered.
 */
function renderedMarkup(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
}

interface Rendered {
  readonly status: number
  readonly markup: string
}

async function render(
  path: string,
  headers: Record<string, string>,
): Promise<Rendered> {
  const response = await fetch(`${baseUrl}${path}`, { headers })
  return {
    status: response.status,
    markup: renderedMarkup(await response.text()),
  }
}

/** Which of `needles` the markup contains, in the order given. */
const present = (markup: string, needles: readonly string[]) =>
  needles.filter((needle) => markup.includes(needle))

/** Every upstream XRPC path requested since the last reset. */
async function upstreamPaths(): Promise<string[]> {
  const response = await fetch(xrpcLogUrl)
  expect(response.status).toBe(200)
  return ((await response.json()) as { requests: XrpcRequest[] }).requests.map(
    (request) => request.path,
  )
}

/** Upstream paths that are notification calls. */
const notificationPaths = (paths: string[]) =>
  paths.filter((path) => path.includes('social.coves.notification.'))

beforeEach(async () => {
  const [xrpc, unknown] = await Promise.all([
    fetch(xrpcLogUrl, { method: 'DELETE' }),
    fetch(unknownPathsUrl, { method: 'DELETE' }),
  ])
  expect([xrpc.status, unknown.status]).toEqual([200, 200])
})

afterEach(async () => {
  const response = await fetch(unknownPathsUrl)
  expect(response.status).toBe(200)
  expect(((await response.json()) as { paths: string[] }).paths).toEqual([])
})

describe('notification pages on the built server', () => {
  it('renders /settings/notifications for a signed-in reader with no preference value and no notification request', async () => {
    const { status, markup } = await render('/settings/notifications', signedIn)

    expect(status).toBe(200)
    // Anchor: the signed-in settings layout rendered, Notifications tab included.
    expect(present(markup, ['href="/settings/notifications"'])).toEqual([
      'href="/settings/notifications"',
    ])
    expect(
      present(markup, [
        'Replies to your posts',
        'Replies to your comments',
        'Mentions',
        'Likes',
        'type="checkbox"',
      ]),
    ).toEqual([])
    expect(notificationPaths(await upstreamPaths())).toEqual([])
  })

  it('serves /notifications to a signed-in reader as the client-only shell, with no layout, no settings link, no badge and no notification request', async () => {
    // Root-layout markers: the navbar and the main region. The settings page
    // renders inside the root layout, so both show there.
    const layoutMarkers = ['<nav', 'id="main"']
    const settingsPage = await render('/settings/notifications', signedIn)
    expect(
      present(settingsPage.markup, layoutMarkers),
      'precondition: the root layout renders on the server',
    ).toEqual(layoutMarkers)

    const { status, markup } = await render('/notifications', signedIn)

    expect(status).toBe(200)
    expect(present(markup, layoutMarkers)).toEqual([])
    expect(
      present(markup, [
        'Notification settings',
        'href="/settings/notifications"',
        ' unread',
      ]),
    ).toEqual([])
    expect(notificationPaths(await upstreamPaths())).toEqual([])
  })

  it('renders / for a signed-in reader with the bell in the navbar, no badge and no notification request', async () => {
    const { status, markup } = await render('/', signedIn)

    expect(status).toBe(200)
    const navbarStart = markup.indexOf('<nav class="navbar')
    expect(navbarStart, 'precondition: the navbar renders').toBeGreaterThan(-1)
    const navbar = markup.slice(
      navbarStart,
      markup.indexOf('</nav>', navbarStart),
    )
    expect(present(navbar, ['href="/notifications"'])).toEqual([
      'href="/notifications"',
    ])
    expect(present(markup, ['data-part="badge"'])).toEqual([])
    expect(notificationPaths(await upstreamPaths())).toEqual([])
  })
})
