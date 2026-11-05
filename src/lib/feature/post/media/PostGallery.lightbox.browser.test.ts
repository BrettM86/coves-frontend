// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmbedImage } from '$lib/api/coves/types'

type PageState = Record<string, unknown>
const navigation = vi.hoisted(() => ({
  read: (): PageState => ({}),
  push: (_state: PageState) => {},
  replace: (_state: PageState) => {},
  back: () => {},
  index: (): number => 0,
}))

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/state', () => ({
  page: {
    get state() {
      return navigation.read()
    },
  },
}))
vi.mock('$app/navigation', () => ({
  pushState: (_url: string, state: PageState) => navigation.push(state),
  replaceState: (_url: string, state: PageState) => navigation.replace(state),
}))
vi.mock('svelte/transition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte/transition')>()),
  fade: () => ({ duration: 0 }),
  scale: () => ({ duration: 0 }),
  fly: () => ({ duration: 0 }),
  slide: () => ({ duration: 0 }),
}))

// Vitest resolves `svelte` with server conditions; the components were
// compiled for the DOM, so point both halves at the client runtime.
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

const PRE_OPEN: PageState = { marker: 'feed' }
const BIRDS = [
  'Kite',
  'Heron',
  'Wren',
  'Owl',
  'Finch',
  'Robin',
  'Swift',
  'Crane',
]
const UNAVAILABLE = 'Image unavailable'

/** Image `n` (1-based) with distinct proxy URLs and alt text. */
function photo(n: number): EmbedImage {
  return {
    thumb: `https://img.coves.test/img/content_preview/plain/did:plc:a/bafy${n}`,
    fullsize: `https://img.coves.test/img/content_full/plain/did:plc:a/bafy${n}`,
    alt: `${BIRDS[n - 1]} photo`,
  }
}

function photos(count: number): EmbedImage[] {
  return Array.from({ length: count }, (_, index) => photo(index + 1))
}

let client: typeof import('svelte')
let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

beforeEach(async () => {
  client = await import('svelte')
  const { SvelteMap } = await import('svelte/reactivity')
  const { settings } = await import('$lib/app/state/settings.svelte')
  settings.expandImages = true
  const current = new SvelteMap<string, PageState>([['state', PRE_OPEN]])
  const history: PageState[] = [PRE_OPEN]
  let index = 0
  navigation.read = () => current.get('state') ?? {}
  navigation.push = (state) => {
    history.splice(index + 1)
    history.push(state)
    index++
    current.set('state', state)
  }
  navigation.replace = (state) => {
    history[index] = state
    current.set('state', state)
  }
  navigation.back = () => {
    if (index > 0) index--
    current.set('state', history[index] ?? {})
  }
  navigation.index = () => index
  vi.spyOn(window.history, 'back').mockImplementation(() => navigation.back())
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
})

async function mountHarness(images: EmbedImage[]): Promise<void> {
  const Harness = (await import('./PostGalleryLightbox.test.svelte')).default
  mounted = client.mount(Harness, { target, props: { images }, intro: false })
  client.flushSync()
}

async function settle(): Promise<void> {
  await client.tick()
  client.flushSync()
}

function host(name: 'gallery' | 'lightbox'): HTMLElement {
  const found = target.querySelector<HTMLElement>(`[data-testid="${name}"]`)
  if (!found) throw new Error(`Harness has no ${name}`)
  return found
}

/** Each tile is the box that reserves its space with an inline aspect-ratio. */
function tiles(): HTMLElement[] {
  const found = [
    ...host('gallery').querySelectorAll<HTMLElement>('[style*="aspect-ratio"]'),
  ]
  if (found.length === 0) throw new Error('PostGallery rendered no tile')
  return found
}

function expandButton(tile: HTMLElement): HTMLButtonElement {
  const found = [...tile.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() !== 'ALT',
  )
  if (!found) throw new Error('Tile has no expand button')
  return found
}

async function openTile(position: number): Promise<HTMLButtonElement> {
  const button = expandButton(tiles()[position - 1])
  button.focus()
  button.click()
  await settle()
  return button
}

function lightboxImage(): HTMLImageElement {
  const found = [...host('lightbox').querySelectorAll('img')].find(
    (image) => (image.getAttribute('src') ?? '') !== '',
  )
  if (!found) throw new Error('The lightbox shows no image')
  return found
}

function accessibleName(button: HTMLButtonElement): string {
  return button.getAttribute('aria-label') ?? button.textContent?.trim() ?? ''
}

async function press(name: RegExp): Promise<void> {
  const button = [...host('lightbox').querySelectorAll('button')].find(
    (candidate) => name.test(accessibleName(candidate)),
  )
  if (!button) throw new Error(`The lightbox has no ${name} button`)
  button.click()
  await settle()
}

async function key(name: string): Promise<void> {
  ;(document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', {
      key: name,
      bubbles: true,
      cancelable: true,
    }),
  )
  await settle()
}

function expectShowing(fullsize: string, alt: string): void {
  const image = lightboxImage()
  expect(image.getAttribute('src')).toBe(fullsize)
  expect(image.getAttribute('alt')).toBe(alt)
  expect(host('lightbox').textContent).toContain(alt)
}

function renderedSources(): string[] {
  return [...target.querySelectorAll('[src], [srcset]')].flatMap((element) => [
    element.getAttribute('src') ?? '',
    element.getAttribute('srcset') ?? '',
  ])
}

describe('lightbox navigation', () => {
  it('steps through a 3-image gallery and closes back to the tile with one Escape', async () => {
    await mountHarness(photos(3))

    const opener = await openTile(2)
    expectShowing(
      'https://img.coves.test/img/content_full/plain/did:plc:a/bafy2',
      'Heron photo',
    )
    expect(host('lightbox').contains(document.activeElement)).toBe(true)

    await press(/next/i)
    expectShowing(
      'https://img.coves.test/img/content_full/plain/did:plc:a/bafy3',
      'Wren photo',
    )
    await key('ArrowLeft')
    expectShowing(
      'https://img.coves.test/img/content_full/plain/did:plc:a/bafy2',
      'Heron photo',
    )
    await key('ArrowRight')
    expectShowing(
      'https://img.coves.test/img/content_full/plain/did:plc:a/bafy3',
      'Wren photo',
    )
    await press(/previous/i)
    expectShowing(
      'https://img.coves.test/img/content_full/plain/did:plc:a/bafy2',
      'Heron photo',
    )

    await key('Escape')
    await settle()

    expect(host('lightbox').querySelector('img')).toBeNull()
    expect(navigation.index()).toBe(0)
    expect(navigation.read()).toEqual({ marker: 'feed' })
    expect(document.activeElement).toBe(opener)
    expect(document.activeElement).toBe(expandButton(tiles()[1]))
  })

  it('reaches the images past the fourth tile of an 8-image gallery', async () => {
    await mountHarness(photos(8))

    await openTile(4)
    expectShowing(
      'https://img.coves.test/img/content_full/plain/did:plc:a/bafy4',
      'Owl photo',
    )

    for (let step = 0; step < 4; step++) await press(/next/i)
    expectShowing(
      'https://img.coves.test/img/content_full/plain/did:plc:a/bafy8',
      'Crane photo',
    )
  })
})

describe('lightbox unavailable image', () => {
  it('shows the placeholder for a failed image and the next image after it', async () => {
    await mountHarness(photos(3))
    await openTile(2)

    lightboxImage().dispatchEvent(new Event('error'))
    await settle()

    const lightbox = host('lightbox')
    expect(lightbox.textContent).toContain(UNAVAILABLE)
    expect(lightbox.querySelector('img')).toBeNull()
    expect(
      [...lightbox.querySelectorAll('button')].filter((button) =>
        /retry|reload|try again/i.test(accessibleName(button)),
      ),
    ).toHaveLength(0)

    await press(/next/i)
    expectShowing(
      'https://img.coves.test/img/content_full/plain/did:plc:a/bafy3',
      'Wren photo',
    )
    expect(host('lightbox').textContent).not.toContain(UNAVAILABLE)
  })
})

describe('lightbox keyboard focus', () => {
  it('keeps keyboard focus inside after stepping onto an image with no usable URL', async () => {
    await mountHarness([
      photo(1),
      {
        thumb:
          'https://img.coves.test/img/content_preview/plain/did:plc:a/safe2',
        fullsize: 'javascript:alert(1)',
        alt: 'Unsafe full',
      },
    ])
    await openTile(1)
    expect(host('lightbox').contains(document.activeElement)).toBe(true)

    await key('ArrowRight')
    expect(host('lightbox').textContent).toContain('Unsafe full')
    expect(host('lightbox').contains(document.activeElement)).toBe(true)

    await key('Escape')
    expect(host('lightbox').textContent).not.toContain('Unsafe full')
    expect(navigation.index()).toBe(0)
  })
})

describe('lightbox URL gate', () => {
  it('never renders an unsafe URL in the gallery or the open lightbox', async () => {
    await mountHarness([
      {
        thumb:
          'https://img.coves.test/img/content_preview/plain/did:plc:a/safe1',
        fullsize: 'javascript:alert(1)',
        alt: 'Unsafe full',
      },
      {
        thumb: 'data:image/png;base64,AAAA',
        fullsize:
          'https://img.coves.test/img/content_full/plain/did:plc:a/safe2',
        alt: 'Unsafe thumb',
      },
    ])
    const expectNoUnsafeSource = () => {
      for (const source of renderedSources()) {
        expect(source).not.toContain('javascript:alert(1)')
        expect(source).not.toContain('data:image/png;base64,AAAA')
      }
    }

    await openTile(2)
    expect(lightboxImage().getAttribute('src')).toBe(
      'https://img.coves.test/img/content_full/plain/did:plc:a/safe2',
    )
    expectNoUnsafeSource()

    await press(/previous/i)
    expectNoUnsafeSource()
    expect(host('lightbox').textContent).toContain('Unsafe full')
  })
})

describe('lightbox position dots', () => {
  it('shows which image of the gallery is open', async () => {
    await mountHarness(photos(3))
    await openTile(2)

    const dots = host('lightbox').querySelector('[data-page-dots]')
    expect(dots?.getAttribute('aria-label')).toBe('Image 2 of 3')
    expect(dots?.querySelectorAll('[data-page-dot]')).toHaveLength(3)
  })
})

// A file taller than 1:2, such as a comic strip, fitted to the viewport height
// would shrink past reading, so it keeps only the width cap and the overlay
// scrolls. Anything squarer still fits the whole image on screen.
describe('lightbox tall image', () => {
  async function openMeasured(width: number, height: number) {
    await mountHarness(photos(1))
    await openTile(1)
    const image = lightboxImage()
    Object.defineProperty(image, 'naturalWidth', { value: width })
    Object.defineProperty(image, 'naturalHeight', { value: height })
    image.dispatchEvent(new Event('load'))
    await settle()
    return lightboxImage()
  }

  it('drops the height cap for a 400x1600 image', async () => {
    const image = await openMeasured(400, 1600)
    expect(image.className).not.toMatch(/(^|\s)max-h-/)
    expect(image.className).toMatch(/(^|\s)max-w-/)
  })

  it('keeps the height cap for a 1600x900 image', async () => {
    const image = await openMeasured(1600, 900)
    expect(image.className).toMatch(/(^|\s)max-h-/)
  })
})
