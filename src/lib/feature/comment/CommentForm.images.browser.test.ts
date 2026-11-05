// @vitest-environment jsdom
/**
 * Image-only comments through the real CommentForm: a picked image lets the
 * form submit with no text, the create request waits for the upload and
 * carries the images embed, and the submit button stays locked from the first
 * upload until the create request settles.
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
import { get } from 'svelte/store'
import type {
  AtUri,
  CID,
  CreateCommentInput,
  StrongRef,
  UploadImageOutput,
} from '$lib/api/coves/types'
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

const { createComment, uploadImage, profile } = vi.hoisted(() => ({
  createComment: vi.fn(),
  uploadImage: vi.fn(),
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
    createComment,
    uploadImage,
    resolveHandle: async () => ({ did: 'did:plc:mentioned' }),
    getCommunity: async () => ({ did: 'did:plc:community' }),
  }),
}))
vi.mock('$lib/app/state/auth.svelte', () => ({ profile }))

const postRef = {
  uri: 'at://did:plc:author/social.coves.community.post/one' as AtUri,
  cid: 'bafypost' as CID,
}
const CREATED = {
  uri: 'at://did:plc:viewer/social.coves.community.comment/c1' as AtUri,
  cid: 'bafycomment' as CID,
}

let target: HTMLDivElement
let client: typeof import('svelte')
let CommentForm: typeof import('./CommentForm.svelte').default
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let toasts: (typeof import('$lib/ui/kit/toast/toasts'))['toasts']
let objectUrls: { revoked: string[] }

beforeAll(async () => {
  client = await import('svelte')
  CommentForm = (await import('./CommentForm.svelte')).default
  toasts = (await import('$lib/ui/kit/toast/toasts')).toasts
}, 60_000)

beforeEach(() => {
  createComment.mockReset()
  uploadImage.mockReset()
  toasts.set([])
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

interface Pending<T> {
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

/** Uploads that wait for the test to settle them, in request order. */
function deferUploads(): Pending<void>[] {
  const pending: Pending<void>[] = []
  uploadImage.mockImplementation(
    (file: File, contentType: string) =>
      new Promise<UploadImageOutput>((resolve, reject) => {
        pending.push({
          resolve: () => resolve(uploadOutput(file, contentType)),
          reject,
        })
      }),
  )
  return pending
}

/** Create requests that wait for the test to settle them, in request order. */
function deferCreates(): Pending<void>[] {
  const pending: Pending<void>[] = []
  createComment.mockImplementation(
    () =>
      new Promise<typeof CREATED>((resolve, reject) => {
        pending.push({ resolve: () => resolve(CREATED), reject })
      }),
  )
  return pending
}

/** Lets pending promise chains and queued work run, then renders. */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    client.flushSync()
  }
}

function mountForm(
  props: { editing?: boolean; parentRef?: StrongRef } = {},
): void {
  mounted = client.mount(CommentForm, {
    target,
    intro: false,
    props: { postRef, ...props },
  })
  client.flushSync()
}

function form(): HTMLFormElement {
  const found = target.querySelector('form')
  if (!found) throw new Error('Missing comment form')
  return found
}

/** The attachment strip's file input, inside the comment form. */
function fileInput(): HTMLInputElement {
  const input = form().querySelector<HTMLInputElement>('input[type="file"]')
  expect(input, 'the comment form’s attachment file input').not.toBeNull()
  return input as HTMLInputElement
}

/** Each attachment tile is a list item showing its image. */
function tiles(): HTMLLIElement[] {
  return [...form().querySelectorAll('li')].filter(
    (item) => item.querySelector('img') !== null,
  )
}

function submitButton(): HTMLButtonElement {
  const button = form().querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  )
  if (!button) throw new Error('The comment form has no submit button')
  return button
}

function submitForm(): void {
  form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

async function pickOneImage(): Promise<void> {
  pickFiles(fileInput(), [imageFile('only.png', 'png')])
  await vi.waitFor(() => expect(tiles()).toHaveLength(1))
}

describe('CommentForm image-only submit', () => {
  it('sends an image with no text as one create request after its upload, with empty content and the images embed, then empties the strip', async () => {
    const uploads = deferUploads()
    createComment.mockResolvedValue(CREATED)
    mountForm()
    await pickOneImage()

    submitForm()
    await settle()
    expect(uploads).toHaveLength(1)
    expect(createComment).not.toHaveBeenCalled()

    uploads[0].resolve()
    await settle()

    expect(createComment).toHaveBeenCalledTimes(1)
    const input = createComment.mock.calls[0][0] as CreateCommentInput
    expect(input.content).toBe('')
    expect(input.embed).toEqual({
      $type: 'social.coves.embed.images',
      images: [
        {
          image: {
            $type: 'blob',
            ref: { $link: 'bafy-only.png' },
            mimeType: 'image/png',
            size: 64,
          },
          aspectRatio: { width: 300, height: 200 },
        },
      ],
    })
    expect(tiles()).toHaveLength(0)
  })

  it('sends nothing when there is neither text nor an image', async () => {
    mountForm()

    submitForm()
    await settle()

    expect(uploadImage).not.toHaveBeenCalled()
    expect(createComment).not.toHaveBeenCalled()
  })

  it('keeps submit disabled and starts nothing new while the upload and then the create request run', async () => {
    const uploads = deferUploads()
    const creates = deferCreates()
    mountForm()
    await pickOneImage()

    submitButton().click()
    await settle()
    expect(uploads).toHaveLength(1)
    expect(submitButton().disabled).toBe(true)

    submitButton().click()
    submitForm()
    await settle()
    expect(uploadImage).toHaveBeenCalledTimes(1)
    expect(createComment).not.toHaveBeenCalled()

    uploads[0].resolve()
    await settle()
    expect(creates).toHaveLength(1)
    expect(submitButton().disabled).toBe(true)

    submitButton().click()
    submitForm()
    await settle()
    expect(uploadImage).toHaveBeenCalledTimes(1)
    expect(createComment).toHaveBeenCalledTimes(1)
  })

  it('does not create the comment when the upload fails, and keeps the failed tile with its Retry button', async () => {
    const uploads = deferUploads()
    mountForm()
    await pickOneImage()

    submitForm()
    await settle()
    uploads[0].reject(new Error('Upload failed'))
    await settle()

    expect(createComment).not.toHaveBeenCalled()
    const [tile] = tiles()
    expect(tile, 'the failed tile').toBeDefined()
    expect(
      [...tile.querySelectorAll('button')].some(
        (button) => button.textContent?.trim() === 'Retry',
      ),
    ).toBe(true)
    expect(get(toasts), 'the error shows on the tile, not in a toast').toEqual(
      [],
    )
  })
})

describe('CommentForm closing', () => {
  it('revokes the previews of picked images when the composer closes without submitting', async () => {
    mountForm()
    pickFiles(fileInput(), [imageFile('cf-cancelled.png', 'png')])
    await vi.waitFor(() => expect(tiles()).toHaveLength(1))
    expect(objectUrls.revoked).toEqual([])

    if (mounted) await client.unmount(mounted, { outro: false })
    mounted = undefined

    expect(objectUrls.revoked).toContain(
      'blob:http://localhost/cf-cancelled.png',
    )
  })

  it('creates no comment and shows no toast when the composer closes while the upload runs', async () => {
    const uploads = deferUploads()
    createComment.mockResolvedValue(CREATED)
    mountForm()
    pickFiles(fileInput(), [imageFile('cf-closed-mid-upload.png', 'png')])
    await vi.waitFor(() => expect(tiles()).toHaveLength(1))
    const textarea = form().querySelector('textarea')
    if (!textarea) throw new Error('The comment form has no textarea')
    textarea.value = 'Closed mid-upload'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    client.flushSync()
    submitForm()
    await vi.waitFor(() => expect(uploads).toHaveLength(1))

    if (mounted) await client.unmount(mounted, { outro: false })
    mounted = undefined
    uploads[0].resolve()
    await settle()

    expect(createComment).not.toHaveBeenCalled()
    expect(get(toasts)).toEqual([])
  })
})

describe('CommentForm submit waiting on an image check', () => {
  it('locks the strip’s add button while submit waits for an image still being checked', async () => {
    // The picked image's decode stays pending until the test settles it.
    const decoded = Promise.withResolvers<{
      width: number
      height: number
      close: () => void
    }>()
    vi.stubGlobal('createImageBitmap', () => decoded.promise)
    createComment.mockResolvedValue(CREATED)
    uploadImage.mockImplementation((file: File, contentType: string) =>
      Promise.resolve(uploadOutput(file, contentType)),
    )
    mountForm()
    const addButton = fileInput().parentElement?.querySelector('button')
    if (!addButton) throw new Error('The strip has no add button')
    pickFiles(fileInput(), [imageFile('checking.png', 'png')])

    submitForm()
    await vi.waitFor(() => expect(addButton.disabled).toBe(true))

    decoded.resolve({ width: 640, height: 480, close: () => {} })
    await vi.waitFor(() => expect(createComment).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(addButton.disabled).toBe(false))
  })

  it('unlocks the form when the awaited check leaves nothing to send', async () => {
    mountForm()

    submitForm()
    await settle()

    expect(submitButton().disabled).toBe(false)
    expect(createComment).not.toHaveBeenCalled()
  })
})

describe('CommentForm drop and paste', () => {
  function textarea(): HTMLTextAreaElement {
    const found = form().querySelector('textarea')
    if (!found) throw new Error('The comment form has no textarea')
    return found
  }

  it('adds dropped and pasted images to the strip', async () => {
    mountForm()

    const dropped = dropFiles(textarea(), [imageFile('cf-dropped.jpg', 'jpeg')])
    await vi.waitFor(() => expect(tiles()).toHaveLength(1))
    const pasted = pasteFiles(textarea(), [imageFile('cf-pasted.gif', 'gif')])
    await vi.waitFor(() => expect(tiles()).toHaveLength(2))

    expect(dropped.defaultPrevented).toBe(true)
    expect(pasted.defaultPrevented).toBe(true)
    expect(tiles().map((tile) => tile.querySelector('img')?.src)).toEqual([
      'blob:http://localhost/cf-dropped.jpg',
      'blob:http://localhost/cf-pasted.gif',
    ])
  })

  it('ignores dropped and pasted images while a submit runs', async () => {
    const uploads = deferUploads()
    mountForm()
    pickFiles(fileInput(), [imageFile('cf-sending.png', 'png')])
    await vi.waitFor(() => expect(tiles()).toHaveLength(1))
    submitForm()
    await vi.waitFor(() => expect(uploads).toHaveLength(1))

    dropFiles(textarea(), [imageFile('cf-late-drop.jpg', 'jpeg')])
    pasteFiles(textarea(), [imageFile('cf-late-paste.gif', 'gif')])
    await settle()

    expect(tiles()).toHaveLength(1)
  })

  it('leaves drop and paste to the editor while editing', async () => {
    mountForm({ editing: true })

    const dropped = dropFiles(textarea(), [
      imageFile('cf-edit-drop.jpg', 'jpeg'),
    ])
    const pasted = pasteFiles(textarea(), [
      imageFile('cf-edit-paste.gif', 'gif'),
    ])
    await settle()

    expect(dropped.defaultPrevented).toBe(false)
    expect(pasted.defaultPrevented).toBe(false)
    expect(tiles()).toHaveLength(0)
  })
})

describe('CommentForm over-8 refusal', () => {
  const parentRef = {
    uri: 'at://did:plc:other/social.coves.community.comment/two' as AtUri,
    cid: 'bafyparent' as CID,
  }

  it.each([
    { name: 'a top-level comment form', props: {} },
    { name: 'a reply form', props: { parentRef } },
  ])(
    'says a comment can have at most 8 images when a ninth is picked in $name',
    async ({ props }) => {
      mountForm(props)
      pickFiles(
        fileInput(),
        [1, 2, 3, 4, 5, 6, 7, 8].map((index) =>
          imageFile(`cf-eight-${index}.png`, 'png'),
        ),
      )
      await vi.waitFor(() => expect(tiles()).toHaveLength(8))

      pickFiles(fileInput(), [imageFile('cf-ninth.png', 'png')])
      await settle()

      expect(tiles()).toHaveLength(8)
      expect(form().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
        'A comment can have at most 8 images.',
      )
    },
  )

  it('says a comment can have at most 8 images when a ninth is picked after a comment was sent from the same form', async () => {
    uploadImage.mockImplementation((file: File, contentType: string) =>
      Promise.resolve(uploadOutput(file, contentType)),
    )
    createComment.mockResolvedValue(CREATED)
    mountForm()
    await pickOneImage()
    submitForm()
    await vi.waitFor(() => expect(createComment).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(tiles()).toHaveLength(0))

    pickFiles(
      fileInput(),
      [1, 2, 3, 4, 5, 6, 7, 8].map((index) =>
        imageFile(`cf-after-send-${index}.png`, 'png'),
      ),
    )
    await vi.waitFor(() => expect(tiles()).toHaveLength(8))
    pickFiles(fileInput(), [imageFile('cf-after-send-ninth.png', 'png')])
    await settle()

    expect(tiles()).toHaveLength(8)
    expect(form().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'A comment can have at most 8 images.',
    )
  })
})
