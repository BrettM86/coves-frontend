// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accessibleName } from './notification-test-harness'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/navigation', () => ({
  invalidate: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
  goto: vi.fn(),
  afterNavigate: vi.fn(),
  beforeNavigate: vi.fn(),
}))
vi.mock('$app/state', () => ({
  page: {
    url: new URL('http://localhost/'),
    data: {},
    params: {},
    route: { id: null },
    status: 200,
    state: {},
  },
  navigating: { to: null },
}))
const svelteClientEntry = async (subpath: string): Promise<unknown> => {
  const { createRequire } = await import('node:module')
  const require_ = createRequire(import.meta.url)
  return await import(
    /* @vite-ignore */
    require_.resolve('svelte/package.json').replace('package.json', subpath)
  )
}
vi.mock('svelte', () => svelteClientEntry('src/index-client.js'))
vi.mock('svelte/reactivity', () =>
  svelteClientEntry('src/reactivity/index-client.js'),
)

let svelte: typeof import('svelte')
let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

beforeEach(async () => {
  svelte = await import('svelte')
  const { loadTranslations, locale } = await import('$lib/app/state/i18n')
  await loadTranslations('en')
  locale.set('en')
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await svelte.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
})

async function mountBell(count: number) {
  const NotificationBell = (await import('./NotificationBell.svelte')).default
  mounted = svelte.mount(NotificationBell, {
    target,
    intro: false,
    props: { count },
  })
  svelte.flushSync()
}

/** The bell link; throws when the bell renders none. */
function bellLink(): HTMLAnchorElement {
  const link = target.querySelector<HTMLAnchorElement>(
    'a[href="/notifications"]',
  )
  if (!link) throw new Error('No bell link to /notifications')
  return link
}

const badge = () => target.querySelector('[data-part="badge"]')

describe('notification bell badge', () => {
  it('shows no badge for a count of 0', async () => {
    await mountBell(0)
    expect(bellLink().getAttribute('href')).toBe('/notifications')
    expect(badge()).toBeNull()
  })

  it.each([
    { count: 1, shown: '1' },
    { count: 99, shown: '99' },
  ])('shows the number for a count of $count', async ({ count, shown }) => {
    await mountBell(count)
    expect(badge()?.textContent?.trim()).toBe(shown)
  })

  it.each([{ count: 100 }, { count: 101 }])(
    'shows 99+ for a count of $count',
    async ({ count }) => {
      await mountBell(count)
      expect(badge()?.textContent?.trim()).toBe('99+')
    },
  )

  it.each([
    { count: 7, name: 'Notifications, 7 unread' },
    { count: 100, name: 'Notifications, 99+ unread' },
  ])(
    'hides the badge from assistive tech and names the link $name for a count of $count',
    async ({ count, name }) => {
      await mountBell(count)
      expect(badge()?.getAttribute('aria-hidden')).toBe('true')
      expect(accessibleName(bellLink())).toBe(name)
    },
  )

  it('names the link "Notifications" when no badge shows', async () => {
    await mountBell(0)
    expect(accessibleName(bellLink())).toBe('Notifications')
  })
  it.each<[string, string[]]>([
    ['red', ['bg-red-600', 'text-white', 'dark:bg-red-500']],
    ['a 15px pill', ['h-[15px]', 'min-w-4']],
    ['its left edge at the bell centre', ['left-1/2', '-top-1']],
  ])('draws the badge with %s', async (_title, classes) => {
    await mountBell(7)
    expect(Array.from(badge()?.classList ?? [])).toEqual(
      expect.arrayContaining(classes),
    )
  })
})
