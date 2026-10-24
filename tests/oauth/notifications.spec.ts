import { readFile } from 'node:fs/promises'
import {
  expect,
  test,
  type Browser,
  type Frame,
  type Page,
  type Response,
} from '@playwright/test'

type LocalAccount = { handle: string; password: string; did: string }

// Bounds from the PRD's Testing section.
const ADMISSION_TIMEOUT = 60_000
const BADGE_TIMEOUT = 90_000
const UPDATE_SEEN_TIMEOUT = 30_000
const STEP_TIMEOUT = 30_000
// Reload polls stay sparse: every request from both browsers and the SSR
// server shares the local backend's per-IP rate limit (100 a minute).
const POLL_INTERVALS = [5_000, 10_000]

const NSID = {
  createPost: 'social.coves.community.post.create',
  createComment: 'social.coves.community.comment.create',
  createVote: 'social.coves.feed.vote.create',
  getPreferences: 'social.coves.notification.getPreferences',
  putPreferences: 'social.coves.notification.putPreferences',
  updateSeen: 'social.coves.notification.updateSeen',
} as const

const REASON_SETTINGS = [
  'Replies to your posts',
  'Replies to your comments',
  'Mentions',
  'Likes',
] as const

function hasStrings<K extends string>(
  data: unknown,
  keys: readonly K[],
): data is Record<K, string> {
  return (
    !!data &&
    typeof data === 'object' &&
    keys.every(
      (key) =>
        key in data &&
        typeof (data as Record<string, unknown>)[key] === 'string',
    )
  )
}

async function readAccountFile(
  variable: 'OAUTH_TEST_ACCOUNT_FILE' | 'OAUTH_SECOND_ACCOUNT_FILE',
): Promise<unknown> {
  const file = process.env[variable]
  if (!file) {
    throw new Error(
      `Set ${variable} to a private local account file from the coves dev seed; see docs/QA_LOOP.md.`,
    )
  }
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    throw new Error(`Could not read the private account file in ${variable}.`)
  }
}

async function accountB(): Promise<LocalAccount> {
  const data = await readAccountFile('OAUTH_TEST_ACCOUNT_FILE')
  if (!hasStrings(data, ['handle', 'password', 'did'])) {
    throw new Error(
      'OAUTH_TEST_ACCOUNT_FILE must contain handle, password, and did strings.',
    )
  }
  return { handle: data.handle, password: data.password, did: data.did }
}

async function accountA(): Promise<{ account: LocalAccount; run: string }> {
  const data = await readAccountFile('OAUTH_SECOND_ACCOUNT_FILE')
  const actor =
    data && typeof data === 'object' && 'actor' in data ? data.actor : undefined
  if (
    !hasStrings(actor, ['handle', 'password', 'did']) ||
    !hasStrings(data, ['run'])
  ) {
    throw new Error(
      'OAUTH_SECOND_ACCOUNT_FILE must be a dev-seed fixture post success file with run and actor.{handle, password, did}.',
    )
  }
  return {
    account: { handle: actor.handle, password: actor.password, did: actor.did },
    run: data.run,
  }
}

function notificationsCommunity(): string {
  const community = process.env.OAUTH_NOTIFICATIONS_COMMUNITY
  if (!community) {
    throw new Error(
      'Set OAUTH_NOTIFICATIONS_COMMUNITY to the seed community handle (c-science.coves.social).',
    )
  }
  return community
}

async function openHydrated(page: Page, path: string) {
  try {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
  } catch {
    throw new Error(
      'Local web app unavailable or did not hydrate; start the frontend/backend pair and configure OAUTH_WEB_BASE_URL.',
    )
  }
}

async function reachConsent(page: Page, account: LocalAccount) {
  // Catch provider automation errors: Playwright's call log can print filled
  // credentials and callback URLs, which must never become test artifacts.
  try {
    await page.getByLabel('Handle', { exact: true }).fill(account.handle)
    await page
      .getByRole('button', { name: 'Continue to log in', exact: true })
      .click()
    await page.locator('input[name="password"]').waitFor()
    const providerOrigin = new URL(page.url()).origin
    const configuredProvider = new URL(
      process.env.PDS_URL ?? 'http://localhost:3001',
    )
    const provider = new URL(providerOrigin)
    const localAliases = new Set(['localhost', '127.0.0.1'])
    if (
      provider.port !== configuredProvider.port ||
      !(
        provider.hostname === configuredProvider.hostname ||
        (localAliases.has(provider.hostname) &&
          localAliases.has(configuredProvider.hostname))
      )
    ) {
      throw new Error('Unexpected provider origin')
    }
    await page.locator('input[name="password"]').fill(account.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('button', { name: 'Authorize', exact: true }).waitFor()
  } catch {
    throw new Error(
      'Local PDS login did not reach consent; verify the account, configured PDS/PLC, and the OAuth rate limit.',
    )
  }
}

async function chooseConsent(page: Page, choice: 'Authorize' | 'Deny access') {
  try {
    await page.getByRole('button', { name: choice, exact: true }).click()
  } catch {
    throw new Error(
      'Local PDS consent action failed; provider details omitted.',
    )
  }
}

function xrpcResponse(page: Page, nsid: string, timeout = STEP_TIMEOUT) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/proxy/xrpc/${nsid}` &&
      response.request().method() === 'POST',
    { timeout },
  )
}

async function responseUri(response: Response): Promise<string> {
  const body: unknown = await response.json()
  if (!hasStrings(body, ['uri'])) {
    throw new Error('Create response carried no record URI.')
  }
  return body.uri
}

/**
 * Signs one fresh browser context in through the web app's Log in link and the
 * real local provider, then returns to the configured web origin.
 */
async function signIn(
  browser: Browser,
  baseURL: string,
  account: LocalAccount,
): Promise<Page> {
  const context = await browser.newContext({ baseURL })
  context.setDefaultTimeout(STEP_TIMEOUT)
  const page = await context.newPage()
  await openHydrated(page, '/')
  await page.getByRole('link', { name: 'Log in', exact: true }).first().click()
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: STEP_TIMEOUT })
    .toBe('/login')
  await reachConsent(page, account)
  await chooseConsent(page, 'Authorize')
  // Compare a boolean so a timeout on the provider cannot print its OAuth URL.
  await expect
    .poll(
      () => {
        const url = new URL(page.url())
        return url.port === '8080' && url.pathname === '/'
      },
      {
        timeout: STEP_TIMEOUT,
        // Leave the :8080 landing as soon as it commits; its page load would
        // spend the shared per-IP rate limit for nothing.
        intervals: [100],
        message: 'OAuth must return to the backend public origin',
      },
    )
    .toBe(true)
  await openHydrated(page, '/')
  const me = await page.request.get('/api/me').catch(() => {
    // Playwright request errors can include the authenticated Cookie header.
    throw new Error(
      'Could not verify the browser session with the local backend.',
    )
  })
  expect(me.status(), 'Web origin must carry an authenticated session').toBe(
    200,
  )
  const body: unknown = await me.json().catch(() => {
    throw new Error('Local backend returned an unreadable session response.')
  })
  // Compare booleans so a failed assertion never prints local account identity.
  expect(
    hasStrings(body, ['did']) && body.did === account.did,
    'Session must belong to the consenting local account',
  ).toBe(true)
  // Confirm the session can write: put one preference back with its current
  // value through the app's own proxy, as the settings page saves.
  const statuses = await page.evaluate(
    async ({ get, put }) => {
      const read = await fetch(`/api/proxy/xrpc/${get}`)
      if (!read.ok) return { read: read.status, write: 0 }
      const preferences = (await read.json()) as { upvote?: unknown }
      if (typeof preferences.upvote !== 'boolean') {
        return { read: read.status, write: -1 }
      }
      const write = await fetch(`/api/proxy/xrpc/${put}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upvote: preferences.upvote }),
      })
      return { read: read.status, write: write.status }
    },
    { get: NSID.getPreferences, put: NSID.putPreferences },
  )
  expect(statuses, 'putPreferences with the current value must save').toEqual({
    read: 200,
    write: 200,
  })
  return page
}

function parseUri(uri: string): { did: string; rkey: string } {
  const match = /^at:\/\/([^/]+)\/[^/]+\/([^/]+)$/.exec(uri)
  if (!match) throw new Error('Captured record URI is not an AT-URI.')
  return { did: match[1], rkey: match[2] }
}

/**
 * The repo segment of a permalink: the author's handle when the ref names that
 * repo's account, else the URI authority DID.
 */
function repoSegment(uri: string, author?: LocalAccount): string {
  const { did } = parseUri(uri)
  return author?.did === did ? author.handle : did
}

function postPath(
  communityPath: string,
  postUri: string,
  author?: LocalAccount,
): string {
  return `${communityPath}/post/${encodeURIComponent(repoSegment(postUri, author))}/${encodeURIComponent(parseUri(postUri).rkey)}`
}

function commentPath(
  communityPath: string,
  postUri: string,
  commentUri: string,
  commenter?: LocalAccount,
  postAuthor?: LocalAccount,
): string {
  return `${postPath(communityPath, postUri, postAuthor)}/comment/${encodeURIComponent(repoSegment(commentUri, commenter))}/${encodeURIComponent(parseUri(commentUri).rkey)}`
}

/**
 * Creates a post in the community through the web app. Returns its URI and
 * the community's canonical path, as the app redirected to it.
 */
async function createPost(
  page: Page,
  communityRoute: string,
  title: string,
  body: string,
): Promise<{ uri: string; communityPath: string }> {
  await openHydrated(page, communityRoute)
  const communityPath = new URL(page.url()).pathname
  await page.getByRole('link', { name: 'Create', exact: true }).click()
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: STEP_TIMEOUT })
    .toBe('/create/post')
  await expect(
    page
      .getByRole('main')
      .getByText(decodeURIComponent(communityPath.slice('/c/'.length)), {
        exact: true,
      }),
    'Create post must preselect the community the author came from',
  ).toBeVisible({ timeout: STEP_TIMEOUT })
  const main = page.getByRole('main')
  await main.getByRole('textbox', { name: /^Title\b/ }).fill(title)
  // The editor's label renders as a heading, not a <label>.
  await main.locator('div:has(> h3:text-is("Body")) textarea').fill(body)
  // The post page drops its one-use ?uri= hint once loaded, so record the URL
  // the app opens as it navigates there.
  let opened: string | undefined
  const onNavigated = (frame: Frame) => {
    if (opened || frame !== page.mainFrame()) return
    const url = new URL(frame.url())
    const uri = url.searchParams.get('uri')
    if (url.pathname.startsWith(`${communityPath}/post/`) && uri) opened = uri
  }
  page.on('framenavigated', onNavigated)
  const created = xrpcResponse(page, NSID.createPost)
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  const response = await created
  expect(response.status(), 'createPost must succeed').toBe(200)
  await expect
    .poll(() => opened !== undefined, {
      timeout: STEP_TIMEOUT,
      message: 'The app must open the created post with its ?uri=',
    })
    .toBe(true)
  page.off('framenavigated', onNavigated)
  const uri = opened
  if (!uri) throw new Error('Created post page carried no ?uri=.')
  expect(
    uri === (await responseUri(response)),
    'The opened post must be the one created',
  ).toBe(true)
  await expect(page.getByRole('main').getByText(title).first()).toBeVisible({
    timeout: STEP_TIMEOUT,
  })
  return { uri, communityPath }
}

/** Waits until the post shows in the community's newest feed. */
async function expectInFeed(
  page: Page,
  communityPath: string,
  postUri: string,
  author: LocalAccount,
) {
  const link = page
    .getByRole('main')
    .locator(`a[href="${postPath(communityPath, postUri, author)}"]`)
    .first()
  await expect(async () => {
    await openHydrated(page, `${communityPath}?sort=new`)
    await expect(link).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: ADMISSION_TIMEOUT, intervals: POLL_INTERVALS })
}

/**
 * Follows the post's feed link (the page is on the feed that listed it) and
 * reloads until the given comment is listed.
 */
async function openPostWith(page: Page, path: string, commentUri: string) {
  await page.getByRole('main').locator(`a[href="${path}"]`).first().click()
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: STEP_TIMEOUT })
    .toBe(path)
  const comment = page.locator(`li#comment-${parseUri(commentUri).rkey}`)
  let first = true
  await expect(async () => {
    if (!first) await openHydrated(page, path)
    first = false
    await expect(comment).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: ADMISSION_TIMEOUT, intervals: POLL_INTERVALS })
}

/** Writes a top-level comment on the open post page; returns its URI. */
async function commentOnPost(page: Page, text: string): Promise<string> {
  const comments = page.locator('section#comments')
  await comments
    .getByRole('button', { name: 'Add a comment', exact: true })
    .click()
  const form = comments.locator('form').first()
  await form.locator('textarea').fill(text)
  const created = xrpcResponse(page, NSID.createComment)
  await form.getByRole('button', { name: 'Submit', exact: true }).click()
  const response = await created
  expect(response.status(), 'createComment must succeed').toBe(200)
  const uri = await responseUri(response)
  await expect(page.locator(`li#comment-${parseUri(uri).rkey}`)).toContainText(
    text,
    { timeout: STEP_TIMEOUT },
  )
  return uri
}

async function replyToComment(
  page: Page,
  parentUri: string,
  text: string,
): Promise<string> {
  const parent = page.locator(`li#comment-${parseUri(parentUri).rkey}`)
  await parent
    .getByRole('button', { name: 'Reply', exact: true })
    .first()
    .click()
  const form = parent.locator('form').first()
  await form.locator('textarea').fill(text)
  const created = xrpcResponse(page, NSID.createComment)
  await form.getByRole('button', { name: 'Submit', exact: true }).click()
  const response = await created
  expect(response.status(), 'createComment (reply) must succeed').toBe(200)
  const uri = await responseUri(response)
  await expect(page.locator(`li#comment-${parseUri(uri).rkey}`)).toContainText(
    text,
    { timeout: STEP_TIMEOUT },
  )
  return uri
}

async function upvote(page: Page, scope: ReturnType<Page['locator']>) {
  const button = scope
    .getByRole('group', { name: 'Voting controls', exact: true })
    .first()
    .getByRole('button', { name: 'Upvote', exact: true })
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  const voted = xrpcResponse(page, NSID.createVote)
  await button.click()
  expect((await voted).status(), 'createVote must succeed').toBe(200)
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

function bell(page: Page) {
  return page.locator('a[href="/notifications"]')
}

async function expectNoBadge(page: Page) {
  await expect(bell(page)).toHaveAccessibleName('Notifications', {
    timeout: UPDATE_SEEN_TIMEOUT,
  })
  await expect(bell(page).locator('[data-part="badge"]')).toHaveCount(0)
}

function notificationRows(page: Page) {
  return page.getByRole('main').locator('ol > li a[href]')
}

/**
 * Opens /notifications with the updateSeen wait armed first. Resolves to
 * 'empty' when page one has no rows (nothing is marked), else waits for the
 * mark to return 200.
 */
async function openNotifications(
  page: Page,
  open: () => Promise<unknown>,
): Promise<'empty' | 'seen'> {
  const seen = xrpcResponse(page, NSID.updateSeen, UPDATE_SEEN_TIMEOUT)
  // An empty page never marks; keep the unused wait from rejecting unhandled.
  seen.catch(() => undefined)
  await open()
  const empty = page
    .getByRole('main')
    .getByText('No notifications yet', { exact: true })
  await expect(notificationRows(page).first().or(empty)).toBeVisible({
    timeout: STEP_TIMEOUT,
  })
  if (await empty.isVisible()) return 'empty'
  expect((await seen).status(), 'updateSeen must succeed').toBe(200)
  return 'seen'
}

test('two accounts: real actions reach B as five notifications, counted, opened and marked seen', async ({
  browser,
}) => {
  test.setTimeout(300_000)
  const b = await accountB()
  const { account: a, run } = await accountA()
  const community = notificationsCommunity()
  const baseURL = test.info().project.use.baseURL
  if (!baseURL) throw new Error('Set OAUTH_WEB_BASE_URL.')
  const stamp = `${run}-${Date.now().toString(36)}`

  const pageA = await signIn(browser, baseURL, a)
  const pageB = await signIn(browser, baseURL, b)

  const communityRoute = `/c/${encodeURIComponent(community)}`

  // B turns every reason on.
  await openHydrated(pageB, '/settings/notifications')
  for (const name of REASON_SETTINGS) {
    const toggle = pageB.getByRole('checkbox', { name, exact: true })
    await expect(toggle).toBeVisible({ timeout: STEP_TIMEOUT })
    if (!(await toggle.isChecked())) {
      const saved = xrpcResponse(pageB, NSID.putPreferences)
      await toggle.check()
      expect((await saved).status(), `Saving "${name}" must succeed`).toBe(200)
    }
    await expect(toggle).toBeChecked()
  }

  // Real seen baseline for B.
  const first = await openNotifications(pageB, () => bell(pageB).click())
  if (first === 'empty') {
    const seedTitle = `Notification baseline ${stamp}`
    const seed = await createPost(
      pageB,
      communityRoute,
      seedTitle,
      `Baseline seed ${stamp}`,
    )
    const seedUri = seed.uri
    const communityPath = seed.communityPath
    await expectInFeed(pageA, communityPath, seedUri, b)
    await openHydrated(pageA, postPath(communityPath, seedUri, b))
    await commentOnPost(pageA, `Baseline comment ${stamp}`)
    await openHydrated(pageB, '/notifications')
    await expect(async () => {
      expect(
        await openNotifications(pageB, () => pageB.reload()),
        'The seeded notification must reach B',
      ).toBe('seen')
    }).toPass({ timeout: ADMISSION_TIMEOUT, intervals: POLL_INTERVALS })
  }
  await expectNoBadge(pageB)
  await openHydrated(pageB, '/')

  // B creates post P and comment C on it.
  const postTitle = `Notifications P ${stamp}`
  const { uri: postUri, communityPath } = await createPost(
    pageB,
    communityRoute,
    postTitle,
    `Body of P ${stamp}`,
  )
  const commentText = `B comment C ${stamp}`
  const commentUri = await commentOnPost(pageB, commentText)
  await expectInFeed(pageA, communityPath, postUri, b)

  // A acts on them through the web app.
  await openPostWith(pageA, postPath(communityPath, postUri, b), commentUri)
  const commentScope = pageA.locator(`li#comment-${parseUri(commentUri).rkey}`)
  await upvote(pageA, commentScope)
  const replyText = `A reply to C ${stamp}`
  const replyUri = await replyToComment(pageA, commentUri, replyText)
  const postCommentText = `A comment on P ${stamp}`
  const postCommentUri = await commentOnPost(pageA, postCommentText)
  await upvote(pageA, pageA.getByRole('main'))

  const mentionTitle = `Mention M ${stamp}`
  const { uri: mentionUri } = await createPost(
    pageA,
    communityPath,
    mentionTitle,
    `Hello @${b.handle} ${stamp}`,
  )
  // The mention row's root is M, so M itself must be admitted.
  await expectInFeed(pageA, communityPath, mentionUri, a)
  // A is done. Closing its context stops its unread polling, which shares the
  // local backend's per-IP rate limit with B's visits below.
  await pageA.context().close()

  // B's bell counts all five.
  await expect(bell(pageB)).toHaveAccessibleName('Notifications, 5 unread', {
    timeout: BADGE_TIMEOUT,
  })
  await expect(bell(pageB).locator('[data-part="badge"]')).toHaveText('5')

  // A comment row's page must show that comment.
  const commentRendered = (uri: string, text: string) => async () => {
    const item = pageB.locator(`li#comment-${parseUri(uri).rkey}`)
    await expect(item).toBeVisible({ timeout: STEP_TIMEOUT })
    await expect(item).toContainText(text, { timeout: STEP_TIMEOUT })
  }
  // A post row's page must be that post's page: only it has the comments
  // section, which the community feed and the comment permalink lack.
  const postRendered = (title: string) => async () => {
    const main = pageB.getByRole('main')
    await expect(main.locator('section#comments')).toBeVisible({
      timeout: STEP_TIMEOUT,
    })
    await expect(main.getByText(title).first()).toBeVisible({
      timeout: STEP_TIMEOUT,
    })
  }

  // Each row by its href, built from the captured identities, and by where it
  // lands: the post and comment loaders redirect a DID segment to the handle
  // form `postLink`/`commentLink` emit, so `canonical` is that form.
  const expected = [
    {
      reason: 'postReply',
      href: commentPath(communityPath, postUri, postCommentUri, a),
      canonical: commentPath(communityPath, postUri, postCommentUri, a, b),
      name: /replied to your post/,
      text: postCommentText,
      rendered: commentRendered(postCommentUri, postCommentText),
    },
    {
      reason: 'commentReply',
      href: commentPath(communityPath, postUri, replyUri, a),
      canonical: commentPath(communityPath, postUri, replyUri, a, b),
      name: /replied to your comment/,
      text: replyText,
      rendered: commentRendered(replyUri, replyText),
    },
    {
      reason: 'mention',
      href: postPath(communityPath, mentionUri, a),
      canonical: postPath(communityPath, mentionUri, a),
      name: /mentioned you/,
      text: undefined,
      rendered: postRendered(mentionTitle),
    },
    {
      reason: 'upvote post',
      href: postPath(communityPath, postUri),
      canonical: postPath(communityPath, postUri, b),
      name: /liked your post/,
      text: undefined,
      rendered: postRendered(postTitle),
    },
    {
      reason: 'upvote comment',
      href: commentPath(communityPath, postUri, commentUri),
      canonical: commentPath(communityPath, postUri, commentUri, b, b),
      name: /liked your comment/,
      text: commentText,
      rendered: commentRendered(commentUri, commentText),
    },
  ]

  const laterSeen: string[] = []
  const visit = await openNotifications(pageB, () => bell(pageB).click())
  expect(visit, 'The five notifications must be listed').toBe('seen')
  await expectNoBadge(pageB)
  pageB.on('request', (request) => {
    if (
      new URL(request.url()).pathname === `/api/proxy/xrpc/${NSID.updateSeen}`
    ) {
      laterSeen.push(request.method())
    }
  })

  for (const row of expected) {
    const link = notificationRows(pageB).and(
      pageB.locator(`a[href="${row.href}"]`),
    )
    await expect(link, `${row.reason} row must link to its target`).toHaveCount(
      1,
      { timeout: STEP_TIMEOUT },
    )
    await expect(link).toHaveAccessibleName(row.name)
    if (row.text) {
      await expect(link).toHaveAccessibleName(
        new RegExp(row.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      )
    }
    await link.click()
    await expect
      .poll(() => new URL(pageB.url()).pathname, {
        message: `${row.reason} row must open its target`,
        timeout: STEP_TIMEOUT,
      })
      .toBe(row.canonical)
    await row.rendered()
    await pageB.goBack()
    await expect
      .poll(() => new URL(pageB.url()).pathname, { timeout: STEP_TIMEOUT })
      .toBe('/notifications')
    await expect(link, 'Back must restore the list').toBeVisible({
      timeout: STEP_TIMEOUT,
    })
  }
  await expectNoBadge(pageB)
  expect(laterSeen, 'A restored list must send no updateSeen').toEqual([])
})
