// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { EmbedImage } from '$lib/api/coves/types'
import { shownModal } from '$lib/ui/kit/modal/modal'

const { showImage } = vi.hoisted(() => ({ showImage: vi.fn() }))

vi.mock('$lib/ui/generic/ExpandableImage.svelte', () => ({ showImage }))
vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))

// Vitest resolves `svelte` with server conditions; the component was compiled
// for the DOM, so point both halves at the client runtime (see
// VirtualFeed.test.ts).
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

interface SvelteClient {
  mount: (
    component: unknown,
    options: { target: Element; props: unknown },
  ) => unknown
  unmount: (component: unknown) => void
  flushSync: (fn?: () => void) => void
}

const lake: EmbedImage = {
  thumb: 'https://img.coves.test/img/content_preview/plain/did:plc:a/b',
  fullsize: 'https://img.coves.test/img/content_full/plain/did:plc:a/b',
  alt: 'A lake',
}

interface GalleryProps {
  images: EmbedImage[]
  blur?: boolean
  priority?: boolean
}

let client: SvelteClient
let mounted: unknown
let target: HTMLElement

beforeEach(async () => {
  client = (await import('svelte')) as unknown as SvelteClient
  const { settings } = await import('$lib/app/state/settings.svelte')
  settings.expandImages = true
  shownModal.set(undefined)
  showImage.mockClear()
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (mounted) client.unmount(mounted)
  mounted = undefined
  target.remove()
})

async function mountGallery(props: GalleryProps): Promise<void> {
  const PostGallery = (await import('./PostGallery.svelte')).default
  mounted = client.mount(PostGallery, { target, props })
  client.flushSync()
}

/** Mounts a one-image gallery with every image's `complete` reporting `complete`. */
async function mountImage(complete: boolean): Promise<HTMLImageElement> {
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(
    complete,
  )
  await mountGallery({ images: [lake] })

  const image = target.querySelector<HTMLImageElement>('img[alt="A lake"]')
  if (!image) throw new Error('PostGallery rendered no image')
  return image
}

describe('PostGallery fade-in', () => {
  it('shows an image that finished loading before hydration', async () => {
    // Its load event has already fired: waiting for one would hide it forever.
    const image = await mountImage(true)

    expect(image.classList).toContain('opacity-100')
  })

  it('hides a still-loading image until it loads', async () => {
    const image = await mountImage(false)

    expect(image.classList).toContain('opacity-0')

    image.dispatchEvent(new Event('load'))
    client.flushSync()

    expect(image.classList).toContain('opacity-100')
    expect(image.classList).not.toContain('opacity-0')
  })
})

const UNAVAILABLE = 'Image unavailable'

/** Image `n` of a gallery, with distinct proxy URLs and alt text. */
function photo(n: number, extra: Partial<EmbedImage> = {}): EmbedImage {
  return {
    thumb: `https://img.coves.test/img/content_preview/plain/did:plc:a/bafy${n}`,
    fullsize: `https://img.coves.test/img/content_full/plain/did:plc:a/bafy${n}`,
    alt: `Photo ${n}`,
    ...extra,
  }
}

function photos(count: number): EmbedImage[] {
  return Array.from({ length: count }, (_, index) => photo(index + 1))
}

/** Each tile is the box that reserves its space with an inline aspect-ratio. */
function tiles(): HTMLElement[] {
  const found = [
    ...target.querySelectorAll<HTMLElement>('[style*="aspect-ratio"]'),
  ]
  if (found.length === 0) throw new Error('PostGallery rendered no tile')
  return found
}

function aspectRatio(tile: HTMLElement): string {
  return tile.style.getPropertyValue('aspect-ratio').replace(/\s+/g, '')
}

/** The element laying the tiles out in two columns, if there is one. */
function twoColumnGrid(): HTMLElement | undefined {
  return [target, ...target.querySelectorAll<HTMLElement>('*')].find(
    (element) =>
      element.classList.contains('grid-cols-2') ||
      element.style
        .getPropertyValue('grid-template-columns')
        .replace(/\s+/g, '') === 'repeat(2,minmax(0,1fr))',
  )
}

function altButton(tile: HTMLElement): HTMLButtonElement | undefined {
  return [...tile.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'ALT',
  )
}

function expandButton(tile: HTMLElement): HTMLButtonElement {
  const found = [...tile.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() !== 'ALT',
  )
  if (!found) throw new Error('Tile has no expand button')
  return found
}

/** The innermost element holding the "Image unavailable" text. */
function placeholderIn(root: Element): Element | null {
  return (
    [...root.querySelectorAll('*')]
      .filter((element) => element.textContent?.includes(UNAVAILABLE))
      .at(-1) ?? null
  )
}

function retryButtons(root: Element): HTMLButtonElement[] {
  return [...root.querySelectorAll('button')].filter((button) =>
    /retry|reload|try again/i.test(
      `${button.getAttribute('aria-label') ?? ''} ${button.textContent ?? ''}`,
    ),
  )
}

describe('PostGallery layout', () => {
  it.each([
    {
      label: '1 image with an aspect ratio',
      images: [photo(1, { aspectRatio: { width: 1600, height: 900 } })],
      tileCount: 1,
      twoColumns: false,
      singleRatio: '1600/900',
      overlay: undefined,
    },
    {
      label: '1 image without an aspect ratio',
      images: [photo(1)],
      tileCount: 1,
      twoColumns: false,
      singleRatio: '4/3',
      overlay: undefined,
    },
    {
      label: '2 images',
      images: photos(2),
      tileCount: 2,
      twoColumns: true,
      singleRatio: undefined,
      overlay: undefined,
    },
    {
      label: '4 images',
      images: photos(4),
      tileCount: 4,
      twoColumns: true,
      singleRatio: undefined,
      overlay: undefined,
    },
    {
      label: '5 images',
      images: photos(5),
      tileCount: 4,
      twoColumns: true,
      singleRatio: undefined,
      overlay: '+1',
    },
    {
      label: '8 images',
      images: photos(8),
      tileCount: 4,
      twoColumns: true,
      singleRatio: undefined,
      overlay: '+4',
    },
  ])(
    'lays out $label',
    async ({ images, tileCount, twoColumns, singleRatio, overlay }) => {
      // No load event is dispatched: the space is reserved up front.
      await mountGallery({ images })

      const rendered = tiles()
      expect(rendered).toHaveLength(tileCount)

      const grid = twoColumnGrid()
      if (twoColumns) {
        expect(grid).toBeDefined()
        for (const tile of rendered) expect(grid?.contains(tile)).toBe(true)
      } else {
        expect(grid).toBeUndefined()
      }

      if (singleRatio) {
        const [tile] = rendered
        expect(aspectRatio(tile)).toBe(singleRatio)
        expect(
          tile.classList.contains('w-full') || tile.style.width === '100%',
        ).toBe(true)
      }

      if (overlay) {
        expect(rendered[3].textContent).toContain(overlay)
        for (const tile of rendered.slice(0, 3))
          expect(tile.textContent).not.toMatch(/\+\d/)
      } else {
        for (const tile of rendered)
          expect(tile.textContent).not.toMatch(/\+\d/)
      }
    },
  )
})

describe('PostGallery ALT badge', () => {
  it('opens the alt text modal from a badge beside the expand button, not the lightbox', async () => {
    await mountGallery({ images: [lake] })

    const [tile] = tiles()
    const alt = altButton(tile)
    expect(alt).toBeDefined()
    expect(expandButton(tile).contains(alt ?? null)).toBe(false)

    alt?.click()
    client.flushSync()

    expect(get(shownModal)?.body).toBe('A lake')
    expect(showImage).not.toHaveBeenCalled()
  })

  it('titles the alt text modal "Alt"', async () => {
    await mountGallery({ images: [lake] })

    altButton(tiles()[0])?.click()
    client.flushSync()

    expect(get(shownModal)?.title).toBe('Alt')
  })

  it('has no ALT badge for an image without alt text', async () => {
    await mountGallery({ images: [photo(1, { alt: undefined })] })

    const [tile] = tiles()
    expect(altButton(tile)).toBeUndefined()
    expect(target.textContent).not.toContain('ALT')
  })

  it('labels the expand button of an image without alt text "Image"', async () => {
    await mountGallery({ images: [photo(1, { alt: undefined })] })

    expect(expandButton(tiles()[0]).getAttribute('aria-label')).toBe('Image')
  })
})

describe('PostGallery unavailable image', () => {
  it.each([
    { label: 'foreground image', selector: 'img[alt="Photo 1"]' },
    { label: 'backdrop image', selector: 'img[alt=""]' },
  ])(
    'replaces the tile image with the placeholder when its $label fails',
    async ({ selector }) => {
      await mountGallery({
        images: [photo(1, { aspectRatio: { width: 1600, height: 900 } })],
      })
      const failing = tiles()[0].querySelector(selector)
      if (!failing) throw new Error(`Tile has no ${selector}`)

      failing.dispatchEvent(new Event('error'))
      client.flushSync()

      const [tile] = tiles()
      expect(tile.textContent).toContain(UNAVAILABLE)
      expect(tile.querySelector('img')).toBeNull()
      expect(aspectRatio(tile)).toBe('1600/900')
      expect(placeholderIn(tile)?.querySelector('button')).toBeNull()
      expect(retryButtons(tile)).toHaveLength(0)
    },
  )
})

describe('PostGallery URL gate', () => {
  it('never renders an unsafe thumb or fullsize URL', async () => {
    await mountGallery({
      images: [
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
      ],
    })
    expect(tiles()).toHaveLength(2)

    const sources = [...target.querySelectorAll('[src], [srcset]')].flatMap(
      (element) => [
        element.getAttribute('src') ?? '',
        element.getAttribute('srcset') ?? '',
      ],
    )
    for (const source of sources) {
      expect(source).not.toContain('javascript:alert(1)')
      expect(source).not.toContain('data:image/png;base64,AAAA')
    }
    expect(sources.join(' ')).toContain(
      'https://img.coves.test/img/content_preview/plain/did:plc:a/safe1',
    )
    expect(sources.join(' ')).toContain(
      'https://img.coves.test/img/content_full/plain/did:plc:a/safe2',
    )
  })
})

describe('PostGallery blurred image', () => {
  it('reveals the full size image after an image error while blurred', async () => {
    const { SvelteMap } = await import('svelte/reactivity')
    const values = new SvelteMap([['blur', true]])
    const PostGallery = (await import('./PostGallery.svelte')).default
    mounted = client.mount(PostGallery, {
      target,
      props: {
        images: [photo(1)],
        get blur() {
          return values.get('blur') ?? false
        },
      },
    })
    client.flushSync()

    const image = target.querySelector('img[alt="Photo 1"]')
    if (!image) throw new Error('Tile has no foreground image')
    expect(image.getAttribute('src')).toBe('')

    // A blurred `<img src="">` fires error in a real browser.
    image.dispatchEvent(new Event('error'))
    client.flushSync()

    expect(target.textContent).not.toContain(UNAVAILABLE)

    values.set('blur', false)
    client.flushSync()

    expect(target.textContent).not.toContain(UNAVAILABLE)
    expect(
      target.querySelector('img[alt="Photo 1"]')?.getAttribute('src'),
    ).toBe(photo(1).fullsize)
  })
})

describe('PostGallery lightbox payload', () => {
  it('passes the lightbox only gated fullsize URLs', async () => {
    await mountGallery({
      images: [
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
      ],
    })

    expandButton(tiles()[0]).click()
    client.flushSync()

    expect(showImage).toHaveBeenCalledExactlyOnceWith(
      [
        { url: '', alt: 'Unsafe full' },
        {
          url: 'https://img.coves.test/img/content_full/plain/did:plc:a/safe2',
          alt: 'Unsafe thumb',
        },
      ],
      0,
    )
  })
})
