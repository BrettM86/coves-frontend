// @vitest-environment jsdom
/**
 * Image placements through the real PostForm: the body preview draws a placed
 * image where its token sits and the unplaced images as the gallery after the
 * body, and the attachment strip's Insert in text, Remove and Move buttons
 * write and renumber `![covered](image:N)` tokens in the body.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { DID, Handle } from '$lib/types/atproto'
import english from '$lib/app/state/i18n/en.json'
import {
  imageFile,
  pickFiles,
  stubImageDecoding,
  stubObjectUrls,
  uploadOutput,
} from '$lib/feature/image-upload/test-helpers'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/state', () => ({
  page: {
    url: new URL('http://localhost/create/post'),
    route: { id: '/create/post' },
    state: {},
  },
}))
vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  pushState: vi.fn(),
  replaceState: vi.fn(),
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
// jsdom has no Web Animations API. Keep the markup, without transitions.
vi.mock('svelte/transition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte/transition')>()),
  fade: () => ({ duration: 0 }),
  fly: () => ({ duration: 0 }),
  scale: () => ({ duration: 0 }),
  slide: () => ({ duration: 0 }),
}))

vi.mock('$lib/api/client.svelte', () => ({
  coves: () => ({
    uploadImage: async (file: File, contentType: string) =>
      uploadOutput(file, contentType),
    createPost: async () => ({
      uri: 'at://did:plc:viewer/social.coves.community.post/one',
      cid: 'bafytest',
    }),
  }),
}))

vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: {
    current: {
      type: 'authenticated',
      id: 'did:plc:viewer',
      did: 'did:plc:viewer',
      handle: 'viewer.test',
      jwt: 'authenticated',
    },
    isAuthenticated: true,
    meta: {},
    sessionExpired: false,
  },
}))

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')
let PostForm: (typeof import('./PostForm.svelte'))['default']
let PostFormState: (typeof import('./post-form.svelte'))['PostFormState']

beforeAll(async () => {
  client = await import('svelte')
  PostForm = (await import('./PostForm.svelte')).default
  PostFormState = (await import('./post-form.svelte')).PostFormState
}, 60_000)

beforeEach(() => {
  stubObjectUrls()
  stubImageDecoding()
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
  vi.unstubAllGlobals()
})

const FIRST = 'blob:http://localhost/first.png'
const SECOND = 'blob:http://localhost/second.png'

function mountForm(): void {
  mounted = client.mount(PostForm, {
    target,
    intro: false,
    props: {
      init: new PostFormState({
        title: 'A post',
        community: {
          did: 'did:plc:community' as DID,
          handle: 'community.test' as Handle,
          name: 'Community',
        },
      }),
    },
  })
  client.flushSync()
}

function fileInput(): HTMLInputElement {
  const input = target.querySelector<HTMLInputElement>('input[type="file"]')
  expect(input, 'the attachment strip’s file input').not.toBeNull()
  return input as HTMLInputElement
}

/** The body editor's textarea: the one under the "Body" heading. */
function bodyTextarea(): HTMLTextAreaElement {
  const heading = [...target.querySelectorAll('h3, label')].find(
    (element) => element.textContent?.trim() === 'Body',
  )
  const textarea = heading?.parentElement?.querySelector('textarea')
  if (!textarea) throw new Error('The form has no body textarea')
  return textarea
}

/** Each attachment tile is a list item showing its image. */
function tiles(): HTMLLIElement[] {
  return [...target.querySelectorAll('li')].filter(
    (item) => item.querySelector('img') !== null,
  )
}

function accessibleName(element: Element): string {
  return (
    element.getAttribute('aria-label') ??
    element.getAttribute('title') ??
    element.textContent ??
    ''
  ).trim()
}

function buttonNamed(root: ParentNode, name: RegExp): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find((candidate) =>
    name.test(accessibleName(candidate)),
  )
  if (!button) throw new Error(`Unable to find button named ${name}`)
  return button
}

function altInput(tile: Element): HTMLInputElement | HTMLTextAreaElement {
  const input = tile.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    'textarea, input:not([type]), input[type="text"]',
  )
  if (!input) throw new Error('The tile has no alt text input')
  return input
}

function typeInto(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  client.flushSync()
}

async function addTwoImages(): Promise<void> {
  pickFiles(fileInput(), [
    imageFile('first.png', 'png'),
    imageFile('second.png', 'png'),
  ])
  await vi.waitFor(() => expect(tiles()).toHaveLength(2))
}

/**
 * Switches the body editor to its preview and returns the preview pane: the
 * editor box's child other than the Edit/Preview bar. The attachment strip
 * sits outside the editor box, so its thumbnails are never in this pane.
 */
function openPreview(): HTMLElement {
  const label = [...target.querySelectorAll('label')].find(
    (element) => element.textContent?.trim() === 'Preview',
  )
  if (!label) throw new Error('The body editor has no Preview toggle')
  label.click()
  client.flushSync()
  const bar = label.closest('fieldset')?.parentElement
  const box = bar?.parentElement
  const pane = [...(box?.children ?? [])].find((child) => child !== bar)
  if (!(pane instanceof HTMLElement)) throw new Error('Missing preview pane')
  expect(pane.querySelector('textarea')).toBeNull()
  return pane
}

/** The first text node under root whose text contains the given text. */
function textNode(root: Node, text: string): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.includes(text)) return node as Text
  }
  throw new Error(`No text node containing ${text}`)
}

function imageWithSource(root: ParentNode, source: string): HTMLImageElement {
  const image = [...root.querySelectorAll('img')].find(
    (candidate) => candidate.getAttribute('src') === source,
  )
  if (!image) throw new Error(`Unable to find an image with src ${source}`)
  return image
}

function follows(later: Node, earlier: Node): boolean {
  return (
    (earlier.compareDocumentPosition(later) &
      Node.DOCUMENT_POSITION_FOLLOWING) !==
    0
  )
}

describe('PostForm body preview with placed images', () => {
  it('draws image 1 between Intro and Outro and image 2 after the body, from their blob: URLs', async () => {
    mountForm()
    await addTwoImages()
    typeInto(bodyTextarea(), 'Intro\n![first](image:1)\nOutro')

    const pane = openPreview()

    const intro = textNode(pane, 'Intro')
    const outro = textNode(pane, 'Outro')
    const placed = imageWithSource(pane, FIRST)
    const gallery = imageWithSource(pane, SECOND)
    expect(follows(placed, intro)).toBe(true)
    expect(follows(outro, placed)).toBe(true)
    expect(follows(gallery, outro)).toBe(true)
    expect(pane.textContent).not.toContain(english.common.imageUnavailable)
  })
})

describe('PostForm attachment strip and body tokens', () => {
  it('inserts image 2’s token with its alt text on its own line at the body caret', async () => {
    mountForm()
    await addTwoImages()
    typeInto(altInput(tiles()[0]), 'A red kite')
    typeInto(altInput(tiles()[1]), 'A grey heron')
    const textarea = bodyTextarea()
    typeInto(textarea, 'ab')
    textarea.selectionStart = 1
    textarea.selectionEnd = 1

    const insert = buttonNamed(tiles()[1], /^insert in text: image 2$/i)
    insert.focus()
    insert.click()
    client.flushSync()

    expect(bodyTextarea().value).toBe('a\n![A grey heron](image:2)\nb')
  })

  it('removes image 1’s token and renumbers image 2’s token to 1 when image 1 is removed', async () => {
    mountForm()
    await addTwoImages()
    typeInto(bodyTextarea(), '![one](image:1)\n![two](image:2)')

    buttonNamed(tiles()[0], /^remove image 1$/i).click()
    client.flushSync()

    expect(bodyTextarea().value).not.toContain('![one](image:1)')
    expect(bodyTextarea().value).toContain('![two](image:1)')
  })

  it('swaps the token numbers when image 1 moves later', async () => {
    mountForm()
    await addTwoImages()
    typeInto(bodyTextarea(), '![one](image:1)\n![two](image:2)')

    buttonNamed(tiles()[0], /^move image 1 later$/i).click()
    client.flushSync()

    expect(bodyTextarea().value).toBe('![one](image:2)\n![two](image:1)')
  })
})
