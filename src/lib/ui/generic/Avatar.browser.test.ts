// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.social' },
}))
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

const { flushSync, mount, unmount } = await import('svelte')
const { default: Avatar } = await import('./Avatar.svelte')
const { default: AvatarDidSwitch } =
  await import('./AvatarDidSwitch.test.svelte')

const URL_ = 'https://img.coves.test/img/avatar/plain/did:plc:a/bafyavatar'
const SMALL =
  'https://img.coves.test/img/avatar_small/plain/did:plc:a/bafyavatar'

// PRD_DEFAULT_AVATARS §4.2 vector: ocean-wave on Seafoam.
const VECTOR_DID = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz'
const VECTOR_URL = 'https://coves.social/img/default-avatars/v1/ocean-wave.webp'

let component: ReturnType<typeof mount> | undefined
let target: HTMLElement

function mountAvatar(props: Record<string, unknown>): HTMLElement {
  target = document.createElement('div')
  document.body.appendChild(target)
  component = mount(Avatar, { target, props: props as never })
  flushSync()
  return target
}

function root(): Element {
  const element = target.firstElementChild
  if (!element) throw new Error('Avatar rendered nothing')
  return element
}

/**
 * The inline background colour as uppercase `#RRGGBB`. jsdom serialises a
 * mounted `background-color: #D5E6E3` as `rgb(213, 230, 227)`, so an `rgb()`
 * value is converted; a hex value is only uppercased.
 */
function backgroundColor(element: Element): string {
  const match = /background-color:\s*([^;]+)/i.exec(
    element.getAttribute('style') ?? '',
  )
  const value = (match?.[1] ?? '').trim()
  const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/i.exec(value)
  if (!rgb) return value.toUpperCase()
  return `#${rgb
    .slice(1)
    .map((channel) => Number(channel).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase()
}

function failImage(): void {
  const image = target.querySelector('img')
  expect(image, 'an <img> to fail').not.toBeNull()
  image?.dispatchEvent(new Event('error'))
  flushSync()
}

afterEach(() => {
  if (component) unmount(component)
  component = undefined
  target?.remove()
})

describe('Avatar with a DID and a real avatar (PRD §4.5)', () => {
  // Guard: a working real avatar renders exactly as before.
  it('renders the real avatar with the existing size rule', () => {
    mountAvatar({ did: VECTOR_DID, url: URL_, width: 160 })
    const image = root()
    expect(image.tagName).toBe('IMG')
    expect(image.getAttribute('src')).toBe(SMALL)
    expect(image.getAttribute('srcset')).toBe(`${SMALL} 1x, ${URL_} 2x`)
  })

  it('falls back to the default picture when the real avatar fails', () => {
    mountAvatar({ did: VECTOR_DID, url: URL_, width: 32 })
    failImage()
    const circle = root()
    expect(circle.tagName).toBe('DIV')
    expect(backgroundColor(circle)).toBe('#D5E6E3')
    expect(circle.querySelector('svg')).toBeNull()
    const picture = circle.querySelector('img')
    expect(picture?.getAttribute('src')).toBe(VECTOR_URL)
  })

  it('shows the tinted circle alone when the default picture fails too', () => {
    mountAvatar({ did: VECTOR_DID, url: URL_, width: 32 })
    failImage()
    failImage()
    const circle = root()
    expect(circle.tagName).toBe('DIV')
    expect(backgroundColor(circle)).toBe('#D5E6E3')
    expect(circle.querySelector('img')).toBeNull()
    expect(circle.querySelector('svg')).toBeNull()
    expect(circle.textContent?.trim()).toBe('')
  })

  it('shows the tinted circle alone when a default with no real avatar fails', () => {
    mountAvatar({ did: VECTOR_DID, url: undefined, width: 32 })
    failImage()
    const circle = root()
    expect(backgroundColor(circle)).toBe('#D5E6E3')
    expect(circle.querySelector('img')).toBeNull()
    expect(circle.querySelector('svg')).toBeNull()
    expect(circle.textContent?.trim()).toBe('')
  })
})

describe('Avatar with an empty DID and a failing real avatar (PRD D13)', () => {
  it('falls back to the plain Mist circle', () => {
    mountAvatar({ did: '', url: URL_, width: 32 })
    failImage()
    const circle = root()
    expect(circle.tagName).toBe('DIV')
    expect(backgroundColor(circle)).toBe('#DCE0EA')
    expect(circle.querySelector('img')).toBeNull()
    expect(circle.querySelector('svg')).toBeNull()
  })
})

describe('Avatar after its DID changes', () => {
  it('shows the new default picture after the previous one failed', () => {
    target = document.createElement('div')
    document.body.appendChild(target)
    const harness = mount(AvatarDidSwitch, {
      target,
      props: { initialDid: VECTOR_DID },
    })
    component = harness
    flushSync()
    failImage()
    expect(root().querySelector('img')).toBeNull()

    harness.setDid('did:plc:z72i7hdynmk6r22z27h6tvur')
    flushSync()

    const circle = root()
    expect(backgroundColor(circle)).toBe('#D8E8D4')
    expect(circle.querySelector('img')?.getAttribute('src')).toBe(
      'https://coves.social/img/default-avatars/v1/pufferfish.webp',
    )
  })

  it('tries the real avatar again after it failed', () => {
    target = document.createElement('div')
    document.body.appendChild(target)
    const harness = mount(AvatarDidSwitch, {
      target,
      props: { initialDid: VECTOR_DID, initialUrl: URL_ },
    })
    component = harness
    flushSync()
    failImage()
    expect(root().tagName).toBe('DIV')

    harness.setDid('did:plc:z72i7hdynmk6r22z27h6tvur')
    flushSync()

    const image = root()
    expect(image.tagName).toBe('IMG')
    expect(image.getAttribute('src')).toBe(SMALL)
  })
})

describe('Avatar after its URL changes', () => {
  it('shows the new real avatar after the previous one failed', () => {
    target = document.createElement('div')
    document.body.appendChild(target)
    const harness = mount(AvatarDidSwitch, {
      target,
      props: { initialDid: VECTOR_DID, initialUrl: URL_ },
    })
    component = harness
    flushSync()
    failImage()
    expect(root().tagName).toBe('DIV')

    harness.setUrl(
      'https://img.coves.test/img/avatar/plain/did:plc:a/bafynewavatar',
    )
    flushSync()

    const image = root()
    expect(image.tagName).toBe('IMG')
    expect(image.getAttribute('src')).toBe(
      'https://img.coves.test/img/avatar_small/plain/did:plc:a/bafynewavatar',
    )
  })
})
