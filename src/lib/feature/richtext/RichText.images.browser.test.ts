// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmbedImage, PostEmbed } from '$lib/api/coves/types'
import { facetOver } from './test-helpers'

type PageState = Record<string, unknown>
const navigation = vi.hoisted(() => ({
  read: (): PageState => ({}),
  push: (_state: PageState) => {},
  replace: (_state: PageState) => {},
  back: () => {},
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

const NS = 'social.coves.richtext.facet'
const image = (index: number) => ({ $type: `${NS}#image`, index })
const UNAVAILABLE = 'Image unavailable'
const COVERED = '[image]'

const SUNSET: EmbedImage = {
  thumb: 'https://img.coves.test/img/content_preview/plain/did:plc:a/sunset',
  fullsize: 'https://img.coves.test/img/content_full/plain/did:plc:a/sunset',
  alt: 'Sunset over the bay',
  aspectRatio: { width: 3, height: 2 },
}
const HARBOUR: EmbedImage = {
  thumb: 'https://img.coves.test/img/content_preview/plain/did:plc:a/harbour',
  fullsize: 'https://img.coves.test/img/content_full/plain/did:plc:a/harbour',
  alt: 'Harbour at dawn',
}

const embedOf = (...images: [EmbedImage, ...EmbedImage[]]): PostEmbed => ({
  $type: 'social.coves.embed.images#view',
  images,
})

let client: typeof import('svelte')
let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

beforeEach(async () => {
  client = await import('svelte')
  const { SvelteMap } = await import('svelte/reactivity')
  const { settings } = await import('$lib/app/state/settings.svelte')
  settings.expandImages = true
  const current = new SvelteMap<string, PageState>([['state', {}]])
  const history: PageState[] = [{}]
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
  vi.spyOn(window.history, 'back').mockImplementation(() => navigation.back())
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
  vi.restoreAllMocks()
})

async function mountBody(
  content: string,
  facets: unknown[],
  embed: PostEmbed,
): Promise<void> {
  const Harness = (await import('./RichTextLightbox.test.svelte')).default
  mounted = client.mount(Harness, {
    target,
    props: { content, facets, embed },
    intro: false,
  })
  client.flushSync()
}

async function settle(): Promise<void> {
  await client.tick()
  client.flushSync()
}

function host(name: 'body' | 'lightbox'): HTMLElement {
  const found = target.querySelector<HTMLElement>(`[data-testid="${name}"]`)
  if (!found) throw new Error(`Harness has no ${name}`)
  return found
}

function bodyImage(alt: string): HTMLImageElement | null {
  return (
    [...host('body').querySelectorAll('img')].find(
      (img) => img.getAttribute('alt') === alt,
    ) ?? null
  )
}

function placedImage(alt: string): HTMLImageElement {
  const found = bodyImage(alt)
  expect(found, `the body has an image with alt ${alt}`).not.toBeNull()
  if (!found) throw new Error(`The body has no image with alt ${alt}`)
  return found
}

function follows(first: Node, second: Node): boolean {
  return (
    (first.compareDocumentPosition(second) &
      Node.DOCUMENT_POSITION_FOLLOWING) !==
    0
  )
}

/** The box that reserves the image's space with an inline aspect-ratio. */
function reservedRatio(element: Element): string {
  const box = element.closest<HTMLElement>('[style*="aspect-ratio"]')
  expect(box && host('body').contains(box)).toBe(true)
  return (box?.style.getPropertyValue('aspect-ratio') ?? '').replace(/\s+/g, '')
}

/** The innermost element holding the "Image unavailable" text. */
function placeholderIn(root: Element): Element | null {
  return (
    [...root.querySelectorAll('*')]
      .filter((element) => element.textContent?.includes(UNAVAILABLE))
      .at(-1) ?? null
  )
}

function lightboxImage(): HTMLImageElement {
  const found = [...host('lightbox').querySelectorAll('img')].find(
    (img) => (img.getAttribute('src') ?? '') !== '',
  )
  if (!found) throw new Error('The lightbox shows no image')
  return found
}

describe('RichText placed image', () => {
  it('ends the paragraph and renders the image as a block between the text before and after', async () => {
    const content = `Before ${COVERED} after`
    await mountBody(
      content,
      [facetOver(content, COVERED, image(0))],
      embedOf(SUNSET),
    )

    const img = placedImage('Sunset over the bay')
    expect(img.getAttribute('src')).toBe(
      'https://img.coves.test/img/content_full/plain/did:plc:a/sunset',
    )
    expect(img.closest('p')).toBeNull()
    expect(host('body').textContent).not.toContain(COVERED)

    const paragraphs = [...host('body').querySelectorAll('p')]
    const before = paragraphs.find((p) => p.textContent?.trim() === 'Before')
    const after = paragraphs.find((p) => p.textContent?.trim() === 'after')
    if (!before || !after)
      throw new Error('The text around the image is not in two paragraphs')
    expect(follows(before, img)).toBe(true)
    expect(follows(img, after)).toBe(true)

    const constrained = [img, ...ancestorsWithin(img, host('body'))].some(
      (element) =>
        element.classList.contains('max-w-full') ||
        element.style.maxWidth === '100%',
    )
    expect(constrained).toBe(true)
  })

  it.each([
    { label: 'its aspect ratio', picture: SUNSET, ratio: '3/2' },
    { label: '4:3 without an aspect ratio', picture: HARBOUR, ratio: '4/3' },
  ])('reserves space from $label', async ({ picture, ratio }) => {
    const content = `Look ${COVERED}`
    await mountBody(
      content,
      [facetOver(content, COVERED, image(0))],
      embedOf(picture),
    )

    expect(reservedRatio(placedImage(picture.alt ?? ''))).toBe(ratio)
  })

  it('renders inside the blockquote whose range holds it', async () => {
    const content = `Quoted ${COVERED}\nAfter`
    await mountBody(
      content,
      [
        facetOver(content, `Quoted ${COVERED}`, {
          $type: `${NS}#blockquote`,
          level: 1,
        }),
        facetOver(content, COVERED, image(0)),
      ],
      embedOf(SUNSET),
    )

    expect(
      placedImage('Sunset over the bay').closest('blockquote'),
    ).not.toBeNull()
  })

  it('stays concealed inside a spoiler until it is revealed', async () => {
    const content = `Ending: secret ${COVERED} end`
    await mountBody(
      content,
      [
        facetOver(content, `secret ${COVERED} end`, { $type: `${NS}#spoiler` }),
        facetOver(content, COVERED, image(0)),
      ],
      embedOf(SUNSET),
    )

    for (const img of host('body').querySelectorAll('img'))
      expect(img.closest('[inert]')).not.toBeNull()

    const reveal = [...host('body').querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === 'Show spoiler',
    )
    if (!reveal) throw new Error('The spoiler has no reveal button')
    reveal.click()
    await settle()

    const img = placedImage('Sunset over the bay')
    expect(img.closest('[inert]')).toBeNull()
  })

  it('renders after the heading whose range holds it, not inside it', async () => {
    const content = `Title ${COVERED}\nBody`
    await mountBody(
      content,
      [
        facetOver(content, `Title ${COVERED}`, {
          $type: `${NS}#heading`,
          level: 2,
        }),
        facetOver(content, COVERED, image(0)),
      ],
      embedOf(SUNSET),
    )

    const img = placedImage('Sunset over the bay')
    expect(img.closest('h1, h2, h3, h4, h5, h6')).toBeNull()
    const heading = host('body').querySelector('h2')
    if (!heading) throw new Error('The heading did not render')
    expect(follows(heading, img)).toBe(true)
  })

  it('is not wrapped in the link whose range covers its text', async () => {
    const content = `See ${COVERED} now`
    await mountBody(
      content,
      [
        facetOver(content, COVERED, {
          $type: `${NS}#link`,
          uri: 'https://example.test/page',
        }),
        facetOver(content, COVERED, image(0)),
      ],
      embedOf(SUNSET),
    )

    expect(placedImage('Sunset over the bay').closest('a')).toBeNull()
  })

  it('shows the placeholder instead of an unsafe fullsize URL', async () => {
    const content = `Look ${COVERED}`
    await mountBody(
      content,
      [facetOver(content, COVERED, image(0))],
      embedOf({ ...SUNSET, fullsize: 'javascript:alert(1)' }),
    )

    for (const element of host('body').querySelectorAll('[src]'))
      expect(element.getAttribute('src')).not.toContain('javascript:alert(1)')
    expect(placeholderIn(host('body'))).not.toBeNull()
  })

  it('replaces a failed image with the placeholder at its reserved size', async () => {
    const content = `Look ${COVERED}`
    await mountBody(
      content,
      [facetOver(content, COVERED, image(0))],
      embedOf(SUNSET),
    )

    placedImage('Sunset over the bay').dispatchEvent(new Event('error'))
    client.flushSync()

    const placeholder = placeholderIn(host('body'))
    if (!placeholder) throw new Error('No placeholder after the image failed')
    expect(reservedRatio(placeholder)).toBe('3/2')
    expect(bodyImage('Sunset over the bay')).toBeNull()
  })

  it('opens the lightbox on the clicked image', async () => {
    const content = `First ${COVERED} then [two]`
    await mountBody(
      content,
      [
        facetOver(content, COVERED, image(0)),
        facetOver(content, '[two]', image(1)),
      ],
      embedOf(SUNSET, HARBOUR),
    )

    const img = placedImage('Harbour at dawn')
    ;(img.closest('button') ?? img).click()
    await settle()

    const shown = lightboxImage()
    expect(shown.getAttribute('src')).toBe(
      'https://img.coves.test/img/content_full/plain/did:plc:a/harbour',
    )
    expect(shown.getAttribute('alt')).toBe('Harbour at dawn')
  })

  it('opens the lightbox on the placed image after a non-image facet, then steps to the gallery', async () => {
    const content = `Intro ${COVERED} done`
    await mountBody(
      content,
      [
        facetOver(content, 'Intro', { $type: `${NS}#bold` }),
        facetOver(content, COVERED, image(0)),
      ],
      embedOf(SUNSET, HARBOUR),
    )

    const img = placedImage('Sunset over the bay')
    ;(img.closest('button') ?? img).click()
    await settle()

    expect(lightboxImage().getAttribute('src')).toBe(
      'https://img.coves.test/img/content_full/plain/did:plc:a/sunset',
    )

    const next = [...host('lightbox').querySelectorAll('button')].find(
      (button) => /next/i.test(button.getAttribute('aria-label') ?? ''),
    )
    expect(next, 'the lightbox has a next button').toBeDefined()
    next?.click()
    await settle()

    const shown = lightboxImage()
    expect(shown.getAttribute('src')).toBe(
      'https://img.coves.test/img/content_full/plain/did:plc:a/harbour',
    )
    expect(shown.getAttribute('alt')).toBe('Harbour at dawn')
  })
})

function ancestorsWithin(element: Element, root: Element): HTMLElement[] {
  const found: HTMLElement[] = []
  let current = element.parentElement
  while (current && current !== root) {
    found.push(current)
    current = current.parentElement
  }
  return found
}

describe('RichText placed image without alt text', () => {
  it('labels its button "Image"', async () => {
    const content = `Look ${COVERED}`
    await mountBody(
      content,
      [facetOver(content, COVERED, image(0))],
      embedOf({ ...SUNSET, alt: undefined }),
    )

    const button = placedImage('').closest('button')
    expect(button?.getAttribute('aria-label')).toBe('Image')
  })
})
