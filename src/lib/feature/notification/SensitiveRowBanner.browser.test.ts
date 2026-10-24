// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { locale } from '$lib/app/state/i18n'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
const svelteClientEntry = async (subpath: string): Promise<unknown> => {
  const { createRequire } = await import('node:module')
  const require_ = createRequire(import.meta.url)
  return await import(
    /* @vite-ignore */ require_
      .resolve('svelte/package.json')
      .replace('package.json', subpath)
  )
}
vi.mock('svelte', () => svelteClientEntry('src/index-client.js'))
vi.mock('svelte/reactivity', () =>
  svelteClientEntry('src/reactivity/index-client.js'),
)
vi.mock('svelte/transition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte/transition')>()),
  fly: () => ({ duration: 0 }),
  fade: () => ({ duration: 0 }),
  scale: () => ({ duration: 0 }),
}))

interface BannerProps {
  expanded: boolean
  controls: string
  onshow: () => void
}

let target: HTMLDivElement
let client: typeof import('svelte')
let SensitiveRowBanner: typeof import('./SensitiveRowBanner.svelte').default
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

beforeAll(async () => {
  SensitiveRowBanner = (await import('./SensitiveRowBanner.svelte')).default
}, 30_000)

beforeEach(async () => {
  locale.set('en')
  client = await import('svelte')
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
})

function mountBanner(props: BannerProps): void {
  mounted = client.mount(SensitiveRowBanner, { target, intro: false, props })
  client.flushSync()
}

/** The banner's only button; fails the test when there is not exactly one. */
function onlyButton(): HTMLButtonElement {
  const buttons = target.querySelectorAll('button')
  expect(buttons).toHaveLength(1)
  const [button] = buttons
  if (!button) throw new Error('The banner has no button')
  return button
}

describe('SensitiveRowBanner', () => {
  it('renders one plain button reading "NSFW Content" and "Show", named "Show sensitive content", in the post banner style', () => {
    mountBanner({ expanded: false, controls: 'region-1', onshow: () => {} })

    const button = onlyButton()
    expect(button.getAttribute('type')).toBe('button')
    expect(button.textContent).toContain('NSFW Content')
    expect(button.textContent).toContain('Show')
    expect(button.getAttribute('aria-label')).toBe('Show sensitive content')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.hasAttribute('aria-disabled')).toBe(false)
    for (const className of [
      'bg-slate-100',
      'dark:bg-zinc-900',
      'w-full',
      'min-h-16',
      'hover:bg-slate-200',
    ]) {
      expect(button.classList.contains(className)).toBe(true)
    }
  })

  it('reads only "NSFW Content" while expanded, is marked aria-disabled, and does not call onshow when pressed', () => {
    const onshow = vi.fn()
    mountBanner({ expanded: true, controls: 'region-1', onshow })

    const button = onlyButton()
    expect(button.hasAttribute('aria-label')).toBe(false)
    expect(button.textContent).toContain('NSFW Content')
    expect(button.textContent).not.toContain('Show')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(button.classList.contains('hover:bg-slate-200')).toBe(false)

    button.click()
    client.flushSync()

    expect(onshow).not.toHaveBeenCalled()
  })
})
