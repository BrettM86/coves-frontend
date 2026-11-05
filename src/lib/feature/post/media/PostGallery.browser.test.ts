// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { EmbedImage } from '$lib/api/coves/types'
import { shownModal } from '$lib/ui/kit/modal/modal'
import { touchDriver, useTouchEnvironment } from './touch-test-helpers'

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
  gifs?: ReadonlySet<string>
  feed?: boolean
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

/**
 * Each tile of the current page is the box that reserves its space with an
 * inline aspect-ratio. Neighbouring pages may be rendered too, but `inert`.
 */
function tiles(): HTMLElement[] {
  const found = [
    ...target.querySelectorAll<HTMLElement>('[style*="aspect-ratio"]'),
  ].filter((tile) => !tile.closest('[inert]'))
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
      // Pages of four replace the old "+N" tile.
      overlay: undefined,
    },
    {
      label: '8 images',
      images: photos(8),
      tileCount: 4,
      twoColumns: true,
      singleRatio: undefined,
      // Pages of four replace the old "+N" tile.
      overlay: undefined,
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

describe('PostGallery unavailable feed image', () => {
  it('drops the frame for the placeholder when a framed image fails', async () => {
    await mountGallery({
      images: [photo(1, { aspectRatio: { width: 4, height: 3 } })],
      feed: true,
    })
    const failing = target.querySelector('[data-feed-frame] img[alt="Photo 1"]')
    if (!failing) throw new Error('Feed frame has no foreground image')

    failing.dispatchEvent(new Event('error'))
    client.flushSync()

    expect(target.querySelector('[data-feed-frame]')).toBeNull()
    expect(target.textContent).toContain(UNAVAILABLE)
    expect(target.querySelector('img')).toBeNull()
  })
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

describe('PostGallery pages of four', () => {
  const seven = Array.from({ length: 7 }, (_, n) => ({
    ...lake,
    fullsize: `https://img.coves.test/img/content_full/plain/did:plc:a/i${n}`,
    alt: `Image ${n + 1}`,
  }))
  /** Every rendered tile's open button, on any page. */
  const allTileButtons = (): HTMLElement[] => [
    ...target.querySelectorAll<HTMLElement>(
      '[data-gallery-tile] [aria-label^="Image "]',
    ),
  ]
  /** The open buttons of the current page: the one page that is not inert. */
  const currentTileButtons = (): HTMLElement[] =>
    allTileButtons().filter((tile) => !tile.closest('[inert]'))
  const tileNames = (): string[] =>
    currentTileButtons().map((tile) => tile.getAttribute('aria-label') ?? '')
  const tileButton = (name: string): HTMLElement | undefined =>
    allTileButtons().find((tile) => tile.getAttribute('aria-label') === name)
  const button = (name: string): HTMLButtonElement | undefined =>
    [...target.querySelectorAll('button')].find(
      (element) => element.getAttribute('aria-label') === name,
    )
  const dots = (): Element | null => target.querySelector('[data-page-dots]')

  it('shows four tiles at a time, with dots and a next button', async () => {
    await mountGallery({ images: seven })

    expect(tileNames()).toEqual(['Image 1', 'Image 2', 'Image 3', 'Image 4'])
    expect(target.textContent).not.toContain('+3')
    expect(dots()?.getAttribute('aria-label')).toBe('Page 1 of 2')
    expect(dots()?.querySelectorAll('[data-page-dot]')).toHaveLength(2)
    expect(button('Previous images')).toBeUndefined()
    expect(button('Next images')).toBeDefined()
  })

  it('steps to the next four and back', async () => {
    await mountGallery({ images: seven })

    button('Next images')?.click()
    client.flushSync()
    expect(tileNames()).toEqual(['Image 5', 'Image 6', 'Image 7'])
    expect(dots()?.getAttribute('aria-label')).toBe('Page 2 of 2')
    expect(button('Next images')).toBeUndefined()

    button('Previous images')?.click()
    client.flushSync()
    expect(tileNames()).toEqual(['Image 1', 'Image 2', 'Image 3', 'Image 4'])
  })

  it('opens the lightbox on the tapped image of the current page', async () => {
    await mountGallery({ images: seven })

    button('Next images')?.click()
    client.flushSync()
    currentTileButtons()
      .find((tile) => tile.getAttribute('aria-label') === 'Image 6')
      ?.click()

    expect(showImage).toHaveBeenCalledWith(expect.any(Array), 5)
  })

  it('has no dots or arrows for four images or fewer', async () => {
    await mountGallery({ images: seven.slice(0, 4) })

    expect(dots()).toBeNull()
    expect(button('Next images')).toBeUndefined()
  })

  describe('touch swipe', () => {
    const six = seven.slice(0, 6)
    const PAGE_ONE = ['Image 1', 'Image 2', 'Image 3', 'Image 4']
    const PAGE_TWO = ['Image 5', 'Image 6']

    useTouchEnvironment()
    const { pointer, drag, swipe } = touchDriver(() => client.flushSync())

    // jsdom has no layout, so every width reads 0. The swipe commits past half
    // the gallery's width, so give every element a 400px width for the test.
    // The getters are stubbed on the prototypes, not on one element, so the
    // test does not depend on which element or which property (clientWidth,
    // offsetWidth or getBoundingClientRect().width) the gallery reads.
    const WIDTH = 400
    /**
     * The displayed width getBoundingClientRect() reports. Under CSS `zoom`
     * it differs from clientWidth: feed posts render at `zoom: 0.9`, where a
     * 400px gallery displays 360px wide and pointer clientX deltas are in
     * displayed px. A test may change it before mounting.
     */
    let rectWidth = WIDTH
    beforeEach(() => {
      rectWidth = WIDTH
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(
        WIDTH,
      )
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(
        WIDTH,
      )
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
        () => new DOMRect(0, 0, rectWidth, 300),
      )
    })
    afterEach(() => {
      vi.restoreAllMocks()
      rectWidth = WIDTH
    })

    /** The open button of the first tile now shown, where the finger lands. */
    function firstTile(): HTMLElement {
      const [found] = currentTileButtons()
      if (!found) throw new Error('PostGallery rendered no tile button')
      return found
    }

    /** Top-level parts of a CSS value, split on `separator` outside parentheses. */
    function topLevel(value: string, separator: RegExp): string[] {
      const parts: string[] = []
      let depth = 0
      let part = ''
      for (const char of value) {
        if (char === '(') depth++
        if (char === ')') depth--
        if (depth === 0 && separator.test(char)) {
          if (part.trim()) parts.push(part.trim())
          part = ''
        } else part += char
      }
      if (part.trim()) parts.push(part.trim())
      return parts
    }

    /**
     * A horizontal length such as `-120px`, `-100%` or
     * `calc(-100% - 120px)` in px, with % taken of one 400px page.
     */
    function toPixels(length: string): number {
      const terms = length
        .replace(/^calc\((.*)\)$/, '$1')
        .replace(/\s-\s/g, ' + -')
        .replace(/--/g, '')
        .split(/\s\+\s/)
      let total = 0
      for (const term of terms) {
        const match = /^(-?\d*\.?\d+)(px|%)?$/.exec(term.trim())
        if (!match) throw new Error(`Cannot read the length "${length}"`)
        const amount = Number(match[1])
        total += match[2] === '%' ? (amount / 100) * WIDTH : amount
      }
      return total
    }

    /**
     * The strip's horizontal offset in px: the inline transform or translate
     * of the innermost element holding every rendered tile. 0 is the first
     * page at rest, -400 the second.
     */
    function stripOffset(): number {
      const rendered = [...target.querySelectorAll('[data-gallery-tile]')]
      const strip = [...target.querySelectorAll<HTMLElement>('*')]
        .filter(
          (element) =>
            (element.style.transform || element.style.translate) &&
            rendered.every((tile) => element.contains(tile)),
        )
        .at(-1)
      if (!strip) throw new Error('No tile strip with an inline offset')
      const { transform, translate } = strip.style
      if (transform && transform !== 'none') {
        const call = /translate(?:X|3d)?\((.*)\)/.exec(transform)
        if (!call) throw new Error(`Cannot read the transform "${transform}"`)
        return toPixels(topLevel(call[1], /,/)[0])
      }
      if (translate && translate !== 'none')
        return toPixels(topLevel(translate, /\s/)[0])
      return 0
    }

    // 250px: past half the 400px width, so these page however slowly.
    const LEFT = { from: [350, 100], to: [100, 100] } as const
    const RIGHT = { from: [100, 100], to: [350, 100] } as const

    async function mountOnPage(page: 1 | 2): Promise<void> {
      await mountGallery({ images: six })
      if (page === 2) {
        button('Next images')?.click()
        client.flushSync()
      }
      expect(tileNames()).toEqual(page === 1 ? PAGE_ONE : PAGE_TWO)
    }

    it.each<{
      name: string
      page: 1 | 2
      from: readonly [number, number]
      to: readonly [number, number]
      pointerType?: string
      shown: string[]
      dots: string
    }>([
      // Change expected.
      {
        name: 'swipe left pages on',
        page: 1,
        ...LEFT,
        shown: PAGE_TWO,
        dots: 'Page 2 of 2',
      },
      {
        name: 'swipe right pages back',
        page: 2,
        ...RIGHT,
        shown: PAGE_ONE,
        dots: 'Page 1 of 2',
      },
      // Guard rows: no change expected.
      {
        name: 'swipe right on the first page stays',
        page: 1,
        ...RIGHT,
        shown: PAGE_ONE,
        dots: 'Page 1 of 2',
      },
      {
        name: 'swipe left on the last page stays',
        page: 2,
        ...LEFT,
        shown: PAGE_TWO,
        dots: 'Page 2 of 2',
      },
      {
        name: 'a vertical touch move does not page',
        page: 1,
        from: [150, 50],
        to: [150, 170],
        shown: PAGE_ONE,
        dots: 'Page 1 of 2',
      },
      {
        name: 'a mouse drag does not page',
        page: 1,
        ...LEFT,
        pointerType: 'mouse',
        shown: PAGE_ONE,
        dots: 'Page 1 of 2',
      },
    ])('$name', async ({ page, from, to, pointerType, shown, dots: label }) => {
      await mountOnPage(page)

      swipe(firstTile(), { from: [...from], to: [...to], pointerType })

      expect(tileNames()).toEqual(shown)
      expect(dots()?.getAttribute('aria-label')).toBe(label)
    })

    it('swallows the click after a swipe, but not a later tap', async () => {
      await mountOnPage(1)

      swipe(firstTile(), { from: [...LEFT.from], to: [...LEFT.to] })
      firstTile().click()
      client.flushSync()
      expect(showImage).not.toHaveBeenCalled()

      const tile = firstTile()
      pointer(tile, 'pointerdown', { at: [100, 100] })
      vi.advanceTimersByTime(80)
      pointer(tile, 'pointerup', { at: [100, 100] })
      tile.click()
      expect(showImage).toHaveBeenCalledWith(expect.any(Array), 4)
    })

    // A real browser usually sends no click after a moved touch, so the next
    // click may come from Enter or a screen reader, with no touch before it.
    it('opens on a later click with no touch before it, after a swipe that sent no click', async () => {
      await mountOnPage(1)

      swipe(firstTile(), { from: [...LEFT.from], to: [...LEFT.to] })
      expect(tileNames()).toEqual(PAGE_TWO)
      vi.advanceTimersByTime(1000)

      firstTile().click()
      client.flushSync()
      expect(showImage).toHaveBeenCalledWith(expect.any(Array), 4)
    })

    it('drops a swipe cancelled midway, and the next swipe still pages', async () => {
      await mountOnPage(1)

      const tile = firstTile()
      pointer(tile, 'pointerdown', { at: [200, 100] })
      vi.advanceTimersByTime(100)
      pointer(tile, 'pointermove', { at: [150, 100] })
      pointer(tile, 'pointercancel', { at: [150, 100] })
      pointer(tile, 'pointermove', { at: [100, 100] })
      pointer(tile, 'pointerup', { at: [100, 100] })
      expect(tileNames()).toEqual(PAGE_ONE)

      swipe(firstTile(), { from: [...LEFT.from], to: [...LEFT.to] })
      expect(tileNames()).toEqual(PAGE_TWO)
    })

    it('drops a swipe when a second finger lands, and the next swipe still pages', async () => {
      await mountOnPage(1)

      const tile = firstTile()
      pointer(tile, 'pointerdown', { at: [200, 100], pointerId: 1 })
      pointer(tile, 'pointerdown', { at: [250, 150], pointerId: 2 })
      vi.advanceTimersByTime(100)
      pointer(tile, 'pointermove', { at: [150, 100], pointerId: 1 })
      vi.advanceTimersByTime(100)
      pointer(tile, 'pointermove', { at: [100, 100], pointerId: 1 })
      pointer(tile, 'pointerup', { at: [100, 100], pointerId: 1 })
      pointer(tile, 'pointerup', { at: [250, 150], pointerId: 2 })
      expect(tileNames()).toEqual(PAGE_ONE)

      swipe(firstTile(), { from: [...LEFT.from], to: [...LEFT.to] })
      expect(tileNames()).toEqual(PAGE_TWO)
    })

    it('follows a held finger without paging, with the next page already rendered', async () => {
      await mountOnPage(1)

      // 120px over a second: slow, and short of half the width.
      drag(firstTile(), { from: [300, 100], to: [180, 100], ms: 1000 })

      expect(stripOffset()).toBe(-120)
      expect(tileNames()).toEqual(PAGE_ONE)
      expect(dots()?.getAttribute('aria-label')).toBe('Page 1 of 2')
      const next = tileButton('Image 5')
      expect(next).toBeDefined()
      expect(next?.closest('[inert]')).not.toBeNull()
    })

    it.each<{
      name: string
      from: [number, number]
      to: [number, number]
      ms: number
      shown: string[]
      dots: string
      rest: number
    }>([
      {
        name: 'a slow release short of half the width springs back',
        from: [300, 100],
        to: [180, 100],
        ms: 1000,
        shown: PAGE_ONE,
        dots: 'Page 1 of 2',
        rest: 0,
      },
      {
        name: 'a slow release past half the width pages on',
        from: [300, 100],
        to: [80, 100],
        ms: 1000,
        shown: PAGE_TWO,
        dots: 'Page 2 of 2',
        rest: -400,
      },
      {
        name: 'a short quick flick pages on',
        from: [300, 100],
        to: [240, 100],
        ms: 80,
        shown: PAGE_TWO,
        dots: 'Page 2 of 2',
        rest: -400,
      },
    ])('$name', async ({ from, to, ms, shown, dots: label, rest }) => {
      await mountOnPage(1)

      swipe(firstTile(), { from, to, ms })

      expect(tileNames()).toEqual(shown)
      expect(dots()?.getAttribute('aria-label')).toBe(label)
      expect(stripOffset()).toBe(rest)
    })

    it('follows the finger and pages past half the displayed width inside a zoomed feed', async () => {
      // zoom: 0.9 — displayed 360px, local 400px.
      rectWidth = 360
      await mountOnPage(1)

      // 190px of displayed movement over a second: slow, past half of 360
      // but short of half of 400.
      drag(firstTile(), { from: [300, 100], to: [110, 100], ms: 1000 })

      // 190 displayed px are 190 / 0.9 ≈ 211 local px.
      const offset = stripOffset()
      expect(offset).toBeGreaterThanOrEqual(-213)
      expect(offset).toBeLessThanOrEqual(-209)
      expect(tileNames()).toEqual(PAGE_ONE)

      pointer(firstTile(), 'pointerup', { at: [110, 100] })
      expect(tileNames()).toEqual(PAGE_TWO)
      expect(dots()?.getAttribute('aria-label')).toBe('Page 2 of 2')
    })

    it('resists a drag past the first page and stays on it', async () => {
      await mountOnPage(1)

      drag(firstTile(), { from: [50, 100], to: [350, 100], ms: 1500 })
      const offset = stripOffset()
      expect(offset).toBeGreaterThan(0)
      expect(offset).toBeLessThan(300)

      pointer(firstTile(), 'pointerup', { at: [350, 100] })
      expect(tileNames()).toEqual(PAGE_ONE)
      expect(dots()?.getAttribute('aria-label')).toBe('Page 1 of 2')
      expect(stripOffset()).toBe(0)
    })

    it.each<{ page: 1 | 2; current: string[]; neighbour: string[] }>([
      { page: 1, current: PAGE_ONE, neighbour: PAGE_TWO },
      { page: 2, current: PAGE_TWO, neighbour: PAGE_ONE },
    ])(
      'leaves only page $page out of inert, its neighbour hidden',
      async ({ page, current, neighbour }) => {
        await mountOnPage(page)

        for (const name of current)
          expect(tileButton(name)?.closest('[inert]')).toBeNull()
        for (const name of neighbour) {
          const tile = tileButton(name)
          expect(tile, `${name} is rendered`).toBeDefined()
          expect(tile?.closest('[inert]')).not.toBeNull()
          expect(tile?.closest('[aria-hidden="true"]')).not.toBeNull()
        }
      },
    )

    /**
     * A drag as timed pointer moves: lands at `start`, then each step moves
     * `dx` px over `ms`, in `moves` even pointermoves, then lifts.
     */
    function timedSwipe(
      element: Element,
      start: [number, number],
      steps: { dx: number; ms: number; moves: number }[],
    ): void {
      let [x] = start
      const y = start[1]
      pointer(element, 'pointerdown', { at: [x, y] })
      for (const { dx, ms, moves } of steps) {
        for (let move = 0; move < moves; move++) {
          vi.advanceTimersByTime(ms / moves)
          x += dx / moves
          pointer(element, 'pointermove', { at: [x, y] })
        }
      }
      pointer(element, 'pointerup', { at: [x, y] })
    }

    // Native carousels judge a flick by the speed and direction at release,
    // not by the average over the whole drag.
    it.each<{
      name: string
      steps: { dx: number; ms: number; moves: number }[]
      shown: string[]
      dots: string
    }>([
      {
        name: 'a slow 100px drag ending in a quick 60px flick pages on',
        steps: [
          { dx: -100, ms: 800, moves: 8 },
          { dx: -60, ms: 80, moves: 2 },
        ],
        shown: PAGE_TWO,
        dots: 'Page 2 of 2',
      },
      {
        name: 'a slow 150px drag flicked 50px back stays',
        steps: [
          { dx: -150, ms: 600, moves: 6 },
          { dx: 50, ms: 60, moves: 2 },
        ],
        shown: PAGE_ONE,
        dots: 'Page 1 of 2',
      },
      {
        name: 'a quick 160px drag flicked 50px back stays',
        steps: [
          { dx: -160, ms: 120, moves: 3 },
          { dx: 50, ms: 60, moves: 2 },
        ],
        shown: PAGE_ONE,
        dots: 'Page 1 of 2',
      },
    ])('$name', async ({ steps, shown, dots: label }) => {
      await mountOnPage(1)

      timedSwipe(firstTile(), [300, 100], steps)

      expect(tileNames()).toEqual(shown)
      expect(dots()?.getAttribute('aria-label')).toBe(label)
    })

    it('opens the tile on a sloppy tap that jiggles 14px sideways', async () => {
      await mountOnPage(1)

      const tile = firstTile()
      pointer(tile, 'pointerdown', { at: [100, 100] })
      vi.advanceTimersByTime(60)
      pointer(tile, 'pointermove', { at: [107, 100] })
      vi.advanceTimersByTime(60)
      pointer(tile, 'pointermove', { at: [114, 100] })
      pointer(tile, 'pointerup', { at: [114, 100] })
      tile.click()
      client.flushSync()

      expect(tileNames()).toEqual(PAGE_ONE)
      expect(showImage).toHaveBeenCalledWith(expect.any(Array), 0)
    })

    // A contact whose pointerup never reached the gallery (its target
    // re-rendered mid-gesture) must not make every later touch a second finger.
    it('pages on a fresh primary touch after a contact that never lifted', async () => {
      await mountOnPage(1)

      pointer(firstTile(), 'pointerdown', { at: [200, 100], pointerId: 1 })
      vi.advanceTimersByTime(1000)

      swipe(firstTile(), {
        from: [...LEFT.from],
        to: [...LEFT.to],
        pointerId: 2,
        isPrimary: true,
      })

      expect(tileNames()).toEqual(PAGE_TWO)
      expect(dots()?.getAttribute('aria-label')).toBe('Page 2 of 2')
    })

    it('keeps the strip still on a mostly vertical drag', async () => {
      await mountOnPage(1)

      drag(firstTile(), { from: [150, 50], to: [180, 170] })
      expect(stripOffset()).toBe(0)

      pointer(firstTile(), 'pointerup', { at: [180, 170] })
      expect(tileNames()).toEqual(PAGE_ONE)
      expect(dots()?.getAttribute('aria-label')).toBe('Page 1 of 2')
    })
  })
})

describe('PostGallery inside pre-wrap text', () => {
  // A comment body is white-space: pre-wrap; inherited, it would turn the
  // markup's line breaks inside <picture> into lines above the image.
  it('resets white-space on every tile', async () => {
    await mountGallery({ images: [lake] })

    const tile = target.querySelector('img')?.closest('.rounded-2xl')
    expect(tile?.classList.contains('whitespace-normal')).toBe(true)
  })
})

describe('PostGallery GIF controls', () => {
  // lake's fullsize URL names blob "b".
  const gifs = new Set(['b'])
  const button = (name: string): HTMLButtonElement | undefined =>
    [...target.querySelectorAll('button')].find(
      (element) => element.getAttribute('aria-label') === name,
    )
  const shownImages = (): HTMLImageElement[] =>
    [...target.querySelectorAll('img')].filter(
      (image) => image.getAttribute('aria-hidden') !== 'true',
    )
  const shownImage = (): HTMLImageElement => {
    const image = shownImages().at(-1)
    if (!image) throw new Error('PostGallery rendered no image')
    return image
  }
  /** Fires the shown image's load: the controls wait for a frame. */
  const loadImage = (): void => {
    shownImage().dispatchEvent(new Event('load'))
    client.flushSync()
  }

  beforeEach(() => {
    // jsdom loads no images: report every one as still loading on mount.
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(
      false,
    )
    // jsdom has no 2D canvas; the frame drawing is the browser's job.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })

  it.each([false, true])(
    'plays the full GIF with a pause button once it loads (feed %s)',
    async (feed) => {
      await mountGallery({
        images: [{ ...lake, aspectRatio: { width: 4, height: 3 } }],
        gifs,
        feed,
      })

      const image = shownImage()
      expect(image.getAttribute('src')).toBe(lake.fullsize)
      // No srcset: the smaller candidate is a still JPEG.
      expect(image.closest('picture')?.querySelector('source')).toBeNull()
      // Nothing to pause before the first frame arrives.
      expect(button('Pause GIF')).toBeUndefined()

      loadImage()
      expect(button('Pause GIF')).toBeDefined()
      expect(target.querySelector('canvas')).toBeNull()
    },
  )

  it('shows a framed GIF over its still preview, not a second playing copy', async () => {
    await mountGallery({
      images: [{ ...lake, aspectRatio: { width: 4, height: 3 } }],
      gifs,
      feed: true,
    })

    const backdrop = target.querySelector('[data-feed-frame] img')
    expect(backdrop?.getAttribute('aria-hidden')).toBe('true')
    expect(backdrop?.getAttribute('src')).toBe(lake.thumb)
  })

  it.each([
    { label: 'grid', feed: false, fit: 'object-contain' },
    { label: 'feed frame', feed: true, fit: 'object-contain' },
  ])(
    'freezes on a paused frame inside the image box and plays again ($label)',
    async ({ feed, fit }) => {
      await mountGallery({
        images: [{ ...lake, aspectRatio: { width: 4, height: 3 } }],
        gifs,
        feed,
      })
      loadImage()

      button('Pause GIF')?.click()
      client.flushSync()
      const canvas = target.querySelector('canvas')
      expect(canvas).not.toBeNull()
      // It shares the image's <picture>, so the frame's overflow clips it.
      expect(canvas?.parentElement).toBe(shownImage().closest('picture'))
      expect(canvas?.classList).toContain(fit)
      expect(canvas?.getAttribute('style') ?? '').not.toMatch(/px/)
      expect(shownImage().classList).toContain('invisible')
      expect(button('Play GIF')).toBeDefined()
      expect(button('Pause GIF')).toBeUndefined()
      expect(showImage).not.toHaveBeenCalled()

      button('Play GIF')?.click()
      client.flushSync()
      expect(target.querySelector('canvas')).toBeNull()
      expect(shownImage().classList).not.toContain('invisible')
      expect(button('Pause GIF')).toBeDefined()
      expect(showImage).not.toHaveBeenCalled()
    },
  )

  it('gives a blurred GIF no controls or frozen frame', async () => {
    await mountGallery({ images: [lake], gifs, blur: true })
    loadImage()

    expect(button('Pause GIF')).toBeUndefined()
    expect(button('Play GIF')).toBeUndefined()
    expect(target.querySelector('canvas')).toBeNull()
  })

  it('drops the frozen frame when a paused GIF is blurred', async () => {
    const { SvelteMap } = await import('svelte/reactivity')
    const values = new SvelteMap([['blur', false]])
    const PostGallery = (await import('./PostGallery.svelte')).default
    mounted = client.mount(PostGallery, {
      target,
      props: {
        images: [lake],
        gifs,
        get blur() {
          return values.get('blur') ?? false
        },
      },
    })
    client.flushSync()
    loadImage()
    button('Pause GIF')?.click()
    client.flushSync()
    expect(target.querySelector('canvas')).not.toBeNull()

    values.set('blur', true)
    client.flushSync()
    expect(target.querySelector('canvas')).toBeNull()
    expect(shownImage().classList).not.toContain('invisible')
  })

  it('plays the next image after a paused GIF is replaced', async () => {
    const { SvelteMap } = await import('svelte/reactivity')
    const other = photo(2)
    const nextGif = photo(3)
    const values = new SvelteMap<'images', EmbedImage[]>([['images', [lake]]])
    const PostGallery = (await import('./PostGallery.svelte')).default
    mounted = client.mount(PostGallery, {
      target,
      props: {
        get images() {
          return values.get('images') ?? []
        },
        // "b" is lake; "bafy3" is nextGif.
        gifs: new Set(['b', 'bafy3']),
      },
    })
    client.flushSync()
    loadImage()
    button('Pause GIF')?.click()
    client.flushSync()
    expect(shownImage().classList).toContain('invisible')

    values.set('images', [other])
    client.flushSync()
    expect(shownImage().getAttribute('alt')).toBe('Photo 2')
    expect(shownImage().classList).not.toContain('invisible')

    values.set('images', [nextGif])
    client.flushSync()
    expect(shownImage().getAttribute('alt')).toBe('Photo 3')
    expect(shownImage().classList).not.toContain('invisible')
    expect(target.querySelector('canvas')).toBeNull()
    expect(button('Pause GIF')).toBeDefined()
  })

  it('gives other images no GIF controls', async () => {
    await mountGallery({ images: [lake] })
    loadImage()

    expect(button('Pause GIF')).toBeUndefined()
  })
})
