// @vitest-environment jsdom
/**
 * The attachment strip while an oversized pick is being re-encoded: a
 * processing tile stands in for the image until the re-encode settles.
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
import {
  imageFile,
  oversizedImageFile,
  pickFiles,
  stubObjectUrls,
} from './test-helpers'

vi.mock('$lib/app/state/i18n', () => {
  const translate = (key: string) => key
  return {
    t: {
      get: translate,
      subscribe: (run: (translator: typeof translate) => void) => {
        run(translate)
        return () => {}
      },
    },
  }
})
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

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')
let AttachmentStrip: (typeof import('./AttachmentStrip.svelte'))['default']
let Attachments: (typeof import('./attachments.svelte'))['Attachments']
let XrpcError: (typeof import('$lib/api/coves/xrpc'))['XrpcError']
let NSID: (typeof import('$lib/api/coves/client'))['NSID']

beforeAll(async () => {
  client = await import('svelte')
  AttachmentStrip = (await import('./AttachmentStrip.svelte')).default
  Attachments = (await import('./attachments.svelte')).Attachments
  XrpcError = (await import('$lib/api/coves/xrpc')).XrpcError
  NSID = (await import('$lib/api/coves/client')).NSID
}, 60_000)

beforeEach(() => {
  stubObjectUrls()
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
})

/** Lets pending promise chains and queued work run, then renders. */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    client.flushSync()
  }
}

/** A re-encoder whose single call waits for the test to settle it. */
function heldReencoder() {
  let settleWith:
    | { resolve: (blob: Blob) => void; reject: (error: unknown) => void }
    | undefined
  const reencode = () =>
    new Promise<Blob>((resolve, reject) => {
      settleWith = { resolve, reject }
    })
  return {
    reencode,
    resolve: (blob: Blob) => settleWith?.resolve(blob),
    reject: (error: unknown) => settleWith?.reject(error),
  }
}

function mountStrip(reencode: ReturnType<typeof heldReencoder>['reencode']) {
  const attachments = new Attachments({
    target: 'post',
    decodeDimensions: async () => ({ width: 640, height: 480 }),
    reencode,
  })
  mounted = client.mount(AttachmentStrip, {
    target,
    intro: false,
    props: { attachments },
  })
  client.flushSync()
  const input = target.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('The strip has no file input')
  return input
}

const processingTile = () => target.querySelector('[role="status"]')
const imageTiles = () =>
  [...target.querySelectorAll('li')].filter(
    (item) => item.querySelector('img') !== null,
  )

describe('AttachmentStrip while an oversized image is re-encoded', () => {
  it('shows a processing tile until the re-encode resolves, then the image tile', async () => {
    const held = heldReencoder()
    const input = mountStrip(held.reencode)

    pickFiles(input, [oversizedImageFile('big.png', 'png')])
    await settle()

    expect(processingTile()).not.toBeNull()
    expect(imageTiles()).toHaveLength(0)

    held.resolve(imageFile('small.jpg', 'jpeg'))
    await settle()

    expect(processingTile()).toBeNull()
    expect(imageTiles()).toHaveLength(1)
  })

  it('removes the processing tile when the re-encode fails, adding no image', async () => {
    const held = heldReencoder()
    const input = mountStrip(held.reencode)

    pickFiles(input, [oversizedImageFile('big.png', 'png')])
    await settle()

    expect(processingTile()).not.toBeNull()

    held.reject(new Error('The image could not be decoded'))
    await settle()

    expect(processingTile()).toBeNull()
    expect(imageTiles()).toHaveLength(0)
  })
})

/** Mounts a strip of two images whose uploads both failed with `error`. */
async function mountFailedStrip(error: unknown, onsignin?: () => void) {
  const attachments = new Attachments({
    target: 'post',
    decodeDimensions: async () => ({ width: 640, height: 480 }),
  })
  await attachments.add([
    imageFile('one.jpg', 'jpeg'),
    imageFile('two.jpg', 'jpeg'),
  ])
  await attachments
    .uploadMissing({
      uploadImage: () => Promise.reject(error),
    })
    .catch(() => {})
  mounted = client.mount(AttachmentStrip, {
    target,
    intro: false,
    props: { attachments, onretry: () => {}, onsignin },
  })
  await settle()
}

const retryButtons = () =>
  [...target.querySelectorAll('button')].filter((button) =>
    button.textContent?.includes('form.post.retryUpload'),
  )
const textCount = (text: string) =>
  [...target.querySelectorAll('p')].filter(
    (paragraph) => paragraph.textContent?.trim() === text,
  ).length

describe('AttachmentStrip failed tiles', () => {
  it.each([['MissingBlobScope'], ['PermissionDenied']])(
    'shows the %s sign-in message once and no Retry when sign-in is offered',
    async (code) => {
      await mountFailedStrip(
        new XrpcError(403, code, 'Refused', undefined, NSID.uploadImage),
        () => {},
      )

      expect(imageTiles()).toHaveLength(2)
      expect(textCount('error.upload_sign_in_again')).toBe(1)
      expect(retryButtons()).toHaveLength(0)
      expect(
        target.querySelector('[aria-label="form.post.removeImage"]'),
      ).not.toBeNull()
    },
  )

  it('keeps the message and Retry on each tile for other failures', async () => {
    await mountFailedStrip(
      new XrpcError(
        500,
        'InternalServerError',
        'Boom',
        undefined,
        NSID.uploadImage,
      ),
      () => {},
    )

    expect(imageTiles()).toHaveLength(2)
    expect(textCount('error.server_error')).toBe(2)
    expect(retryButtons()).toHaveLength(2)
  })

  it('keeps the message and Retry on each tile when sign-in is not offered', async () => {
    await mountFailedStrip(
      new XrpcError(
        403,
        'MissingBlobScope',
        'Refused',
        undefined,
        NSID.uploadImage,
      ),
    )

    expect(textCount('error.upload_sign_in_again')).toBe(2)
    expect(retryButtons()).toHaveLength(2)
  })
})
