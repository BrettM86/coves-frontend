// @vitest-environment jsdom
/**
 * Image placements through the real CommentForm: the comment preview draws a
 * placed image where its token sits and the unplaced images as the gallery
 * after the body, and a tile's Insert in text writes its token into the
 * comment body.
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
import type { AtUri, CID } from '$lib/api/coves/types'
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
    state: {},
    url: new URL('http://localhost/c/community.test/post/author.test/one'),
    route: { id: '/c/[handle=handle]/post/[owner=actor]/[rkey]' },
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
  slide: () => ({ duration: 0 }),
  fly: () => ({ duration: 0 }),
  fade: () => ({ duration: 0 }),
  scale: () => ({ duration: 0 }),
}))

const { profile } = vi.hoisted(() => ({
  profile: {
    isAuthenticated: true,
    meta: {},
    sessionExpired: false,
    current: {
      type: 'authenticated',
      did: 'did:plc:viewer',
      handle: 'viewer.test',
      jwt: 'authenticated',
    },
  },
}))
vi.mock('$lib/api/client.svelte', () => ({
  coves: () => ({
    createComment: async () => ({
      uri: 'at://did:plc:viewer/social.coves.community.comment/c1',
      cid: 'bafycomment',
    }),
    uploadImage: async (file: File, contentType: string) =>
      uploadOutput(file, contentType),
    resolveHandle: async () => ({ did: 'did:plc:mentioned' }),
    getCommunity: async () => ({ did: 'did:plc:community' }),
  }),
}))
vi.mock('$lib/app/state/auth.svelte', () => ({ profile }))

const postRef = {
  uri: 'at://did:plc:author/social.coves.community.post/one' as AtUri,
  cid: 'bafypost' as CID,
}

let target: HTMLDivElement
let client: typeof import('svelte')
let CommentForm: typeof import('./CommentForm.svelte').default
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

beforeAll(async () => {
  client = await import('svelte')
  CommentForm = (await import('./CommentForm.svelte')).default
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
  mounted = client.mount(CommentForm, {
    target,
    intro: false,
    props: { postRef },
  })
  client.flushSync()
}

function form(): HTMLFormElement {
  const found = target.querySelector('form')
  if (!found) throw new Error('Missing comment form')
  return found
}

function fileInput(): HTMLInputElement {
  const input = form().querySelector<HTMLInputElement>('input[type="file"]')
  expect(input, 'the comment form’s attachment file input').not.toBeNull()
  return input as HTMLInputElement
}

function bodyTextarea(): HTMLTextAreaElement {
  const textarea = form().querySelector('textarea')
  if (!textarea) throw new Error('The comment form has no textarea')
  return textarea
}

/** Each attachment tile is a list item showing its image. */
function tiles(): HTMLLIElement[] {
  return [...form().querySelectorAll('li')].filter(
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

/**
 * Switches the comment editor to its preview and returns the preview pane:
 * the editor box's child other than the Edit/Preview bar. The attachment strip
 * sits outside the editor box, so its thumbnails are never in this pane.
 */
function openPreview(): HTMLElement {
  const label = [...form().querySelectorAll('label')].find(
    (element) => element.textContent?.trim() === 'Preview',
  )
  if (!label) throw new Error('The comment editor has no Preview toggle')
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

describe('CommentForm preview with placed images', () => {
  it('draws image 1 between Intro and Outro and image 2 after the body, from their blob: URLs', async () => {
    mountForm()
    pickFiles(fileInput(), [
      imageFile('first.png', 'png'),
      imageFile('second.png', 'png'),
    ])
    await vi.waitFor(() => expect(tiles()).toHaveLength(2))
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

describe('CommentForm attachment strip and body tokens', () => {
  it('inserts image 1’s token with its alt text into the comment body', async () => {
    mountForm()
    pickFiles(fileInput(), [imageFile('first.png', 'png')])
    await vi.waitFor(() => expect(tiles()).toHaveLength(1))
    typeInto(altInput(tiles()[0]), 'A red kite')

    buttonNamed(tiles()[0], /^insert in text: image 1$/i).click()
    client.flushSync()

    expect(bodyTextarea().value).toBe('![A red kite](image:1)')
  })

  it('names the Insert button with its visible label followed by the image number', async () => {
    mountForm()
    pickFiles(fileInput(), [imageFile('first.png', 'png')])
    await vi.waitFor(() => expect(tiles()).toHaveLength(1))

    const insert = [...tiles()[0].querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === english.form.post.insertInText,
    )
    if (!insert) throw new Error('Missing Insert in text button')
    const name = accessibleName(insert)
    expect(name.startsWith(english.form.post.insertInText)).toBe(true)
    expect(name).toMatch(/\b1\b/)
  })

  it('removes image 1’s token and renumbers image 2’s token to 1 when image 1 is removed', async () => {
    mountForm()
    pickFiles(fileInput(), [
      imageFile('first.png', 'png'),
      imageFile('second.png', 'png'),
    ])
    await vi.waitFor(() => expect(tiles()).toHaveLength(2))
    typeInto(bodyTextarea(), '![a](image:1)\n![b](image:2)')

    buttonNamed(tiles()[0], /^remove image 1$/i).click()
    client.flushSync()

    expect(bodyTextarea().value).toBe('\n![b](image:1)')
  })
})
