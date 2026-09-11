import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

type LocalAccount = { handle: string; password: string; did: string }
const destination = '/explore/communities?sort=new#latest'

async function localAccount(): Promise<LocalAccount> {
  const file = process.env.OAUTH_TEST_ACCOUNT_FILE
  if (!file) {
    throw new Error(
      'Set OAUTH_TEST_ACCOUNT_FILE to a disposable account on the configured local PDS; start infrastructure with make run-web in the backend repo.',
    )
  }
  let data: unknown
  try {
    data = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    throw new Error(
      'Could not read the private local OAuth test account fixture.',
    )
  }
  if (
    !data ||
    typeof data !== 'object' ||
    !('handle' in data) ||
    typeof data.handle !== 'string' ||
    !('password' in data) ||
    typeof data.password !== 'string' ||
    !('did' in data) ||
    typeof data.did !== 'string'
  ) {
    throw new Error(
      'OAuth test account fixture must contain handle, password, and did strings.',
    )
  }
  return { handle: data.handle, password: data.password, did: data.did }
}

async function openHydrated(page: Page, path: string) {
  try {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
  } catch {
    throw new Error(
      'Local web app unavailable or did not hydrate; run make run-web and configure OAUTH_WEB_BASE_URL for the matching frontend/backend origin.',
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
      'Local PDS login did not reach consent; verify the disposable account, configured PDS/PLC, and make run-web infrastructure.',
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

async function expectAuthenticatedReturn(page: Page, account: LocalAccount) {
  // Compare a boolean so a timeout on the provider cannot print its OAuth URL.
  await expect
    .poll(() => {
      const url = new URL(page.url())
      return url.pathname + url.search + url.hash === destination
    })
    .toBe(true)
  const result = await page.request.get('/api/me').catch(() => {
    // Playwright request errors can include the authenticated Cookie header.
    throw new Error(
      'Could not verify the browser session with the local backend.',
    )
  })
  expect(
    result.status(),
    'Returned browser must have an authenticated Go session',
  ).toBe(200)
  const body = await result.json().catch(() => {
    throw new Error('Local backend returned an unreadable session response.')
  })
  // Compare booleans so a failed assertion never prints local account identity.
  expect(
    body.did === account.did,
    'Session must belong to the consenting local account',
  ).toBe(true)
}

async function errorLines(page: Page) {
  return page.locator('form .material-error').evaluateAll((elements) =>
    elements.flatMap((element) =>
      (element as HTMLElement).innerText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  )
}

async function expectStableLoginError(page: Page, message: RegExp) {
  await expect
    .poll(async () => (await errorLines(page)).length, {
      message:
        'Login must show exactly one error, without a reactive error loop',
    })
    .toBe(1)
  // Same-route navigation can retain the previous single error until it completes.
  await expect.poll(async () => (await errorLines(page))[0]).toMatch(message)
  // User interaction and later browser frames must not append the same error.
  await page.getByLabel('Handle', { exact: true }).focus()
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
  expect(
    (await errorLines(page)).length,
    'Error must remain singular after rendering and interaction',
  ).toBe(1)
  expect(new URL(page.url()).searchParams.get('redirect')).toBe(destination)
}

test('guest sidebar login returns to the exact page after real local authorization', async ({
  page,
}) => {
  const account = await localAccount()
  await openHydrated(page, destination)
  await page.getByRole('link', { name: 'Log in', exact: true }).first().click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/login')
  expect(
    new URL(page.url()).searchParams.get('redirect'),
    'Login link must carry path, query, and fragment',
  ).toBe(destination)
  await reachConsent(page, account)
  await chooseConsent(page, 'Authorize')
  await expectAuthenticatedReturn(page, account)
})

test('real provider denial gives one cancellation message and retry returns to the saved page', async ({
  page,
}) => {
  const account = await localAccount()
  await openHydrated(
    page,
    '/login?' + new URLSearchParams({ redirect: destination }),
  )
  await reachConsent(page, account)
  await chooseConsent(page, 'Deny access')
  await expect.poll(() => new URL(page.url()).pathname).toBe('/login')
  await page.waitForLoadState('networkidle')
  await expectStableLoginError(
    page,
    /cancel|denied|not authorized|not approved/i,
  )
  const retry = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === '/api/auth/login' &&
      request.method() === 'POST',
  )
  await reachConsent(page, account)
  expect(
    (await retry).postDataJSON().redirect,
    'Retry must forward the original saved destination',
  ).toBe(destination)
  await chooseConsent(page, 'Authorize')
  await expectAuthenticatedReturn(page, account)
})

for (const entry of ['navbar', 'guest profile', 'command palette'] as const) {
  test(`${entry} login preserves current path query and fragment`, async ({
    page,
  }) => {
    await openHydrated(page, destination)
    if (entry === 'navbar') {
      await page.getByRole('button', { name: 'Profile', exact: true }).click()
      await page
        .getByRole('link', { name: 'Log in', exact: true })
        .last()
        .click()
    } else if (entry === 'command palette') {
      await page.keyboard.press('Control+k')
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      await dialog.getByRole('link', { name: 'Log in', exact: true }).click()
    } else {
      await page.getByRole('link', { name: 'Guest', exact: true }).click()
    }
    await expect.poll(() => new URL(page.url()).pathname).toBe('/login')
    expect(new URL(page.url()).searchParams.get('redirect')).toBe(destination)
  })
}

for (const code of ['server_error', 'temporarily_unavailable']) {
  test(`known OAuth failure ${code} gives retry-later guidance`, async ({
    page,
  }) => {
    await openHydrated(
      page,
      '/login?' + new URLSearchParams({ error: code, redirect: destination }),
    )
    await expectStableLoginError(page, /try again later/i)
  })
}

test('saved login destination survives real local authorization', async ({
  page,
}) => {
  const account = await localAccount()
  await openHydrated(
    page,
    '/login?' + new URLSearchParams({ redirect: destination }),
  )
  await reachConsent(page, account)
  await chooseConsent(page, 'Authorize')
  await expectAuthenticatedReturn(page, account)
})

for (const errorCode of [
  'constructor',
  '__proto__',
  'unknown_provider_error',
]) {
  test(`unrecognized OAuth error ${errorCode} shows one generic error and retains retry destination`, async ({
    page,
  }) => {
    await openHydrated(
      page,
      '/login?' +
        new URLSearchParams({ error: errorCode, redirect: destination }),
    )
    await expectStableLoginError(page, /login failed.*try again/i)
  })
}

test('invalid OAuth binding gives restart and cookie guidance', async ({
  page,
}) => {
  await openHydrated(
    page,
    '/login?' +
      new URLSearchParams({ error: 'invalid_request', redirect: destination }),
  )
  await expectStableLoginError(page, /expired|cookies/i)
  expect((await errorLines(page))[0]).toMatch(
    /start again|sign in again|try again/i,
  )
})

test('OAuth error arrival is consumed without losing other URL parameters or fragment', async ({
  page,
}) => {
  await openHydrated(
    page,
    '/login?' +
      new URLSearchParams({
        error: 'access_denied',
        redirect: destination,
        source: 'retry',
      }) +
      '#help',
  )
  await expectStableLoginError(
    page,
    /cancel|denied|not authorized|not approved/i,
  )
  await expect
    .poll(() => new URL(page.url()).searchParams.has('error'))
    .toBe(false)
  expect(new URL(page.url()).searchParams.get('source')).toBe('retry')
  expect(new URL(page.url()).hash).toBe('#help')
  await page.reload()
  await page.waitForLoadState('networkidle')
  expect(
    await errorLines(page),
    'Reload must not revive the consumed OAuth error',
  ).toEqual([])
})

test('back navigation does not resurrect a consumed OAuth error', async ({
  page,
}) => {
  await openHydrated(
    page,
    '/login?' +
      new URLSearchParams({ error: 'access_denied', redirect: destination }),
  )
  await expectStableLoginError(
    page,
    /cancel|denied|not authorized|not approved/i,
  )
  await page.goto('/explore/communities')
  await page.goBack()
  await page.waitForLoadState('networkidle')
  expect(
    await errorLines(page),
    'Back must not revive the consumed OAuth error',
  ).toEqual([])
  expect(new URL(page.url()).searchParams.get('redirect')).toBe(destination)
})

test('retry clears the prior inline OAuth error when real preflight rejects the handle', async ({
  page,
}) => {
  await openHydrated(
    page,
    '/login?' +
      new URLSearchParams({ error: 'access_denied', redirect: destination }),
  )
  await expectStableLoginError(
    page,
    /cancel|denied|not authorized|not approved/i,
  )
  await page.getByLabel('Handle', { exact: true }).fill('invalid-handle')
  const response = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/login',
  )
  await page
    .getByRole('button', { name: 'Continue to log in', exact: true })
    .click()
  expect((await response).status()).toBe(400)
  await expect.poll(() => errorLines(page)).toEqual([])
  expect(new URL(page.url()).searchParams.get('redirect')).toBe(destination)
})

test('same-component navigation consumes and displays a new OAuth error arrival', async ({
  page,
}) => {
  await openHydrated(
    page,
    '/login?' +
      new URLSearchParams({ error: 'access_denied', redirect: destination }),
  )
  await expectStableLoginError(
    page,
    /cancel|denied|not authorized|not approved/i,
  )
  // An ordinary same-origin anchor exercises SvelteKit's actual navigation
  // interception; keeping this node proves the login component was reused.
  await page.evaluate(
    (target) => {
      const link = document.createElement('a')
      link.href = target
      link.textContent = 'New OAuth error arrival'
      document.querySelector('form')?.append(link)
    },
    '/login?' +
      new URLSearchParams({ error: 'server_error', redirect: destination }),
  )
  await page
    .getByRole('link', { name: 'New OAuth error arrival', exact: true })
    .click()
  await expectStableLoginError(page, /try again later/i)
  await expect(
    page.getByRole('link', { name: 'New OAuth error arrival', exact: true }),
  ).toBeVisible()
  await expect
    .poll(() => new URL(page.url()).searchParams.has('error'))
    .toBe(false)
})

for (const requestedPage of [
  '/profile?tab=comments',
  '/create/post?community=orchids',
]) {
  test(`signed-out SvelteKit navigation to ${requestedPage} preserves path and query`, async ({
    page,
  }) => {
    await openHydrated(page, '/explore/communities')
    await page.evaluate((target) => {
      const link = document.createElement('a')
      link.href = target
      link.textContent = 'Open protected page'
      document.body.append(link)
    }, requestedPage + '#section')
    await page
      .getByRole('link', { name: 'Open protected page', exact: true })
      .click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/login')
    expect(new URL(page.url()).searchParams.get('redirect')).toBe(requestedPage)
    await expect(page.getByLabel('Handle', { exact: true })).toBeVisible()
  })
}
