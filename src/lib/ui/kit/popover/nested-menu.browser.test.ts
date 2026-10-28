// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))

// Match the existing mounted-component suites: Vitest otherwise resolves the
// server Svelte entry despite the jsdom environment.
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
  scale: () => ({ duration: 0 }),
}))
vi.mock('svelte-floating-ui', () => ({
  createFloatingActions: () => [
    () => ({ destroy: () => {} }),
    () => ({ update: () => {}, destroy: () => {} }),
  ],
}))
vi.mock('trap-focus-svelte', () => ({
  trapFocus: () => ({ destroy: () => {} }),
}))

let target: HTMLDivElement
let client: typeof import('svelte')
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

beforeEach(async () => {
  client = await import('svelte')
  target = document.createElement('div')
  document.body.appendChild(target)
  const Fixture = (await import('./NestedMenu.fixture.svelte')).default
  mounted = client.mount(Fixture, { target, intro: false })
  client.flushSync()
}, 30_000)

afterEach(async () => {
  const component = mounted
  mounted = undefined
  if (component) await client.unmount(component, { outro: false })
  target.remove()
  document.body.replaceChildren()
})

function button(name: string): HTMLButtonElement {
  const found = [
    ...document.body.querySelectorAll<HTMLButtonElement>('button'),
  ].find((element) => element.textContent?.trim() === name)
  if (!found) throw new Error(`Missing button: ${name}`)
  return found
}

function openMenus(): number {
  return document.body.querySelectorAll('[role="menu"]').length
}

async function click(name: string): Promise<void> {
  button(name).click()
  client.flushSync()
  await Promise.resolve()
  client.flushSync()
}

describe('nested menus', () => {
  it('closes only the nested menu when one of its options is chosen', async () => {
    await click('Open profile menu')
    await click('Color scheme')
    expect(openMenus()).toBe(2)

    await click('Dark')

    expect(openMenus()).toBe(1)
    expect(button('Settings')).toBeDefined()
  })

  it('does not hold open a sibling nested menu', async () => {
    await click('Open profile menu')
    await click('Color scheme')
    await click('Text size')
    expect(openMenus()).toBe(3)

    await click('Large')

    // The colour-scheme menu does not own the text-size menu, so choosing
    // a size closes it; the profile menu that owns both stays open.
    expect(openMenus()).toBe(1)
  })

  it('still closes the outer menu on a click outside it', async () => {
    await click('Open profile menu')
    await click('Color scheme')
    await click('Dark')

    await click('Outside')

    expect(openMenus()).toBe(0)
  })
})
