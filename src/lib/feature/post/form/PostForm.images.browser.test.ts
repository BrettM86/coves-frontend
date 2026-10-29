// @vitest-environment jsdom
/**
 * The post form's attachment strip, through the real PostForm: images come in
 * by pick, drop and paste, show as numbered tiles from their `blob:` previews,
 * upload on submit behind a locked submit button, and report upload and
 * record errors where the user can act on them.
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
import type { CreatePostInput, UploadImageOutput } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import english from '$lib/app/state/i18n/en.json'
import {
  dropFiles,
  imageFile,
  pasteFiles,
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

const api = vi.hoisted(() => ({ client: {} as Record<string, unknown> }))
vi.mock('$lib/api/client.svelte', () => ({ coves: () => api.client }))

// `buildFreshPostView` needs an authenticated viewer, and the real auth module
// touches browser storage at import time.
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
let XrpcError: (typeof import('$lib/api/coves/xrpc'))['XrpcError']
let CovesClient: (typeof import('$lib/api/coves/client'))['CovesClient']
let NSID: (typeof import('$lib/api/coves/client'))['NSID']
let imageUrl: (typeof import('$lib/api/coves/image-proxy'))['imageUrl']
let objectUrls: { revoked: string[] }

// Cold-loading PostForm and its tree takes seconds under full-suite load;
// pay it once, outside any per-test timeout.
beforeAll(async () => {
  client = await import('svelte')
  PostForm = (await import('./PostForm.svelte')).default
  PostFormState = (await import('./post-form.svelte')).PostFormState
  XrpcError = (await import('$lib/api/coves/xrpc')).XrpcError
  const covesClientModule = await import('$lib/api/coves/client')
  CovesClient = covesClientModule.CovesClient
  NSID = covesClientModule.NSID
  imageUrl = (await import('$lib/api/coves/image-proxy')).imageUrl
}, 60_000)

beforeEach(() => {
  objectUrls = stubObjectUrls()
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

const PICKED = 'blob:http://localhost/picked.png'
const DROPPED = 'blob:http://localhost/dropped.jpg'
const PASTED = 'blob:http://localhost/pasted.gif'

const CREATED = {
  uri: 'at://did:plc:viewer/social.coves.community.post/one',
  cid: 'bafytest',
}

interface PendingUpload {
  file: File
  resolve: () => void
  reject: (error: unknown) => void
}

/** A client whose uploads and create requests wait for the test to settle them. */
function deferredClient() {
  const uploads: PendingUpload[] = []
  const creates: {
    input: CreatePostInput
    resolve: () => void
    reject: (error: unknown) => void
  }[] = []
  api.client = {
    uploadImage: (file: File, contentType: string) =>
      new Promise<UploadImageOutput>((resolve, reject) => {
        uploads.push({
          file,
          resolve: () => resolve(uploadOutput(file, contentType)),
          reject,
        })
      }),
    createPost: (input: CreatePostInput) =>
      new Promise<typeof CREATED>((resolve, reject) => {
        creates.push({ input, resolve: () => resolve(CREATED), reject })
      }),
  }
  return { uploads, creates }
}

/** A client that answers every upload and create request at once. */
function immediateClient() {
  const creates: CreatePostInput[] = []
  api.client = {
    uploadImage: async (file: File, contentType: string) =>
      uploadOutput(file, contentType),
    createPost: async (input: CreatePostInput) => {
      creates.push(input)
      return CREATED
    },
  }
  return { creates }
}

/** The English string at a dotted en.json key, or a marker naming the missing key. */
function englishAt(key: string): string {
  let node: unknown = english
  for (const part of key.split('.')) {
    node =
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined
  }
  return typeof node === 'string' ? node : `missing en.json key ${key}`
}

/** Lets pending promise chains and queued work run, then renders. */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    client.flushSync()
  }
}

function mountForm(init: { url?: string } = {}): void {
  mounted = client.mount(PostForm, {
    target,
    intro: false,
    props: {
      init: new PostFormState({
        title: 'A post',
        url: init.url,
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

function submitButton(): HTMLButtonElement {
  const button = target.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  )
  if (!button) throw new Error('The form has no submit button')
  return button
}

/** Dispatches submit at the form itself, as Enter or requestSubmit can. */
function submitForm(): void {
  const form = target.querySelector('form')
  if (!form) throw new Error('Missing form')
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

/** Each attachment tile is a list item showing its image. */
function tiles(): HTMLLIElement[] {
  return [...target.querySelectorAll('li')].filter(
    (item) => item.querySelector('img') !== null,
  )
}

function tileSources(): (string | null)[] {
  return tiles().map(
    (tile) => tile.querySelector('img')?.getAttribute('src') ?? null,
  )
}

/** The tile's visible number: its leaf element whose whole text is digits. */
function tileNumber(tile: Element): string | undefined {
  return [...tile.querySelectorAll('*')]
    .find(
      (element) =>
        element.children.length === 0 &&
        /^\d+$/.test(element.textContent?.trim() ?? ''),
    )
    ?.textContent?.trim()
}

function accessibleName(element: Element): string {
  return (
    element.getAttribute('aria-label') ??
    element.getAttribute('title') ??
    element.textContent ??
    ''
  ).trim()
}

function tileButton(
  tile: Element,
  name: RegExp,
): HTMLButtonElement | undefined {
  return [...tile.querySelectorAll('button')].find((button) =>
    name.test(accessibleName(button)),
  )
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

/** Picks, drops and pastes one image each, waiting for each tile in turn. */
async function addThreeImages(): Promise<void> {
  pickFiles(fileInput(), [imageFile('picked.png', 'png')])
  await vi.waitFor(() => expect(tiles()).toHaveLength(1))
  dropFiles(bodyTextarea(), [imageFile('dropped.jpg', 'jpeg')])
  await vi.waitFor(() => expect(tiles()).toHaveLength(2))
  pasteFiles(bodyTextarea(), [imageFile('pasted.gif', 'gif')])
  await vi.waitFor(() => expect(tiles()).toHaveLength(3))
}

describe('PostForm attachment strip', () => {
  it('shows a picked, a dropped and a pasted image as tiles numbered 1, 2 and 3 from their blob: previews', async () => {
    immediateClient()
    mountForm()

    await addThreeImages()

    expect(tiles().map(tileNumber)).toEqual(['1', '2', '3'])
    expect(tileSources()).toEqual([PICKED, DROPPED, PASTED])
  })

  it('sends the alt text typed in a tile with that image', async () => {
    const { creates } = immediateClient()
    mountForm()
    await addThreeImages()

    typeInto(altInput(tiles()[0]), 'A red kite')
    submitForm()
    await vi.waitFor(() => expect(creates).toHaveLength(1))

    const embed = creates[0].embed as
      { images?: { alt?: string }[] } | undefined
    expect(embed?.images?.map((image) => image.alt)).toEqual([
      'A red kite',
      undefined,
      undefined,
    ])
  })

  it('removes a tile with its Remove button and renumbers the rest', async () => {
    immediateClient()
    mountForm()
    await addThreeImages()

    tileButton(tiles()[0], /remove/i)?.click()
    client.flushSync()

    expect(tileSources()).toEqual([DROPPED, PASTED])
    expect(tiles().map(tileNumber)).toEqual(['1', '2'])
  })

  it('moves a tile one place later, swapping its number with the next', async () => {
    immediateClient()
    mountForm()
    await addThreeImages()

    tileButton(tiles()[0], /later/i)?.click()
    client.flushSync()

    expect(tileSources()).toEqual([DROPPED, PICKED, PASTED])
    expect(tiles().map(tileNumber)).toEqual(['1', '2', '3'])
  })

  it('shows no alt text counter for a short alt, and shows one at 1000 graphemes', async () => {
    immediateClient()
    mountForm()
    await addThreeImages()

    typeInto(altInput(tiles()[0]), 'a cat')
    expect(tiles()[0].textContent).not.toMatch(/\d+\s*\/\s*1000/)

    typeInto(altInput(tiles()[0]), 'a'.repeat(1000))
    expect(tiles()[0].textContent).toMatch(/1000\s*\/\s*1000/)
  })

  it('revokes every preview URL when the form is unmounted without submitting', async () => {
    immediateClient()
    mountForm()
    await addThreeImages()
    for (const url of [PICKED, DROPPED, PASTED]) {
      expect(imageUrl({ thumb: url, fullsize: url })).toBe(url)
    }

    if (mounted) await client.unmount(mounted, { outro: false })
    mounted = undefined

    for (const url of [PICKED, DROPPED, PASTED]) {
      expect(imageUrl({ thumb: url, fullsize: url })).toBeUndefined()
    }
    expect([...objectUrls.revoked].sort()).toEqual([DROPPED, PASTED, PICKED])
  })
})

describe('PostForm image upload on submit', () => {
  it('keeps submit disabled and starts no new upload or create request while uploads and then the create request run', async () => {
    const { uploads, creates } = deferredClient()
    mountForm()
    await addThreeImages()

    submitButton().click()
    await settle()
    expect(uploads.map((upload) => upload.file.name)).toEqual([
      'picked.png',
      'dropped.jpg',
    ])
    expect(submitButton().disabled).toBe(true)

    submitButton().click()
    submitForm()
    await settle()
    expect(uploads).toHaveLength(2)
    expect(creates).toHaveLength(0)

    uploads[0].resolve()
    uploads[1].resolve()
    await settle()
    uploads[2].resolve()
    await settle()
    expect(creates).toHaveLength(1)
    expect(submitButton().disabled).toBe(true)

    submitButton().click()
    submitForm()
    await settle()
    expect(uploads).toHaveLength(3)
    expect(creates).toHaveLength(1)
  })

  it('shows a progress indicator on each uploading tile', async () => {
    const { uploads } = deferredClient()
    mountForm()
    await addThreeImages()

    submitForm()
    await settle()
    expect(uploads).toHaveLength(2)

    expect(
      tiles().map(
        (tile) => tile.querySelector('[role="progressbar"], progress') !== null,
      ),
    ).toEqual([true, true, false])
  })

  it('shows a failed upload’s mapped error and a Retry button on its tile, and Retry uploads only that image again', async () => {
    const { uploads, creates } = deferredClient()
    mountForm()
    await addThreeImages()

    submitForm()
    await settle()
    uploads[1].reject(
      new XrpcError(
        429,
        'UploadRateLimited',
        'Too many uploads',
        undefined,
        NSID.uploadImage,
      ),
    )
    uploads[0].resolve()
    await settle()
    uploads[2].resolve()
    await settle()

    const [first, failed, third] = tiles()
    expect(failed.textContent).toContain(englishAt('error.upload_rate_limited'))
    // On the tile only, not repeated as a form error.
    expect(
      target.textContent?.split(englishAt('error.upload_rate_limited')),
    ).toHaveLength(2)
    const retry = tileButton(failed, /^retry$/i)
    expect(retry).toBeDefined()
    expect(tileButton(first, /^retry$/i)).toBeUndefined()
    expect(tileButton(third, /^retry$/i)).toBeUndefined()
    expect(creates).toHaveLength(0)

    retry?.click()
    await settle()

    expect(uploads.map((upload) => upload.file.name)).toEqual([
      'picked.png',
      'dropped.jpg',
      'pasted.gif',
      'dropped.jpg',
    ])
  })

  it('does not create the post when the form is unmounted while its images upload', async () => {
    const { uploads, creates } = deferredClient()
    mountForm()
    await addThreeImages()

    submitForm()
    await settle()
    expect(uploads).toHaveLength(2)

    if (mounted) await client.unmount(mounted, { outro: false })
    mounted = undefined
    uploads[0].resolve()
    uploads[1].resolve()
    await settle()
    for (const upload of uploads.slice(2)) upload.resolve()
    await settle()

    expect(uploads).toHaveLength(2)
    expect(creates).toHaveLength(0)
  })

  it('shows the InvalidEmbed message in the form when createPost refuses the embed without a message', async () => {
    const backend = new CovesClient({
      fetchFn: (async () =>
        new Response(JSON.stringify({ error: 'InvalidEmbed' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch,
      baseUrl: 'https://api.coves.test',
    })
    api.client = {
      uploadImage: async (file: File, contentType: string) =>
        uploadOutput(file, contentType),
      createPost: (input: CreatePostInput) => backend.createPost(input),
    }
    mountForm({ url: 'https://example.com/story' })

    submitForm()
    await settle()

    expect(target.textContent).toContain(englishAt('error.invalid_embed'))
  })
})
