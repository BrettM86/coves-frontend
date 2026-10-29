import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UploadImageOutput } from '$lib/api/coves/types'
import { imageUrl } from '$lib/api/coves/image-proxy'
import { Attachments } from './attachments.svelte'

// ---------------------------------------------------------------------------
// Fixtures. Each test file is identified by its byte length (101, 102, …), so
// an uploaded Blob, a preview URL and a blob ref can all be traced back to the
// file they came from without relying on object identity.
// ---------------------------------------------------------------------------

const ascii = (text: string): number[] =>
  [...text].map((character) => character.charCodeAt(0))

const MAGIC = {
  jpeg: [0xff, 0xd8, 0xff, 0xe0],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  webp: [...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('WEBP')],
  gif: ascii('GIF89a'),
}

/** An image of `size` bytes with real magic bytes and a lying declared type. */
function imageFile(
  size: number,
  format: keyof typeof MAGIC = 'jpeg',
  type = 'text/plain',
): Blob {
  const bytes = new Uint8Array(size)
  bytes.set(MAGIC[format])
  return new Blob([bytes], { type })
}

/** A plain-text file that claims to be a JPEG. */
function textFile(size: number): Blob {
  return new Blob(['x'.repeat(size)], { type: 'image/jpeg' })
}

const DECODED = { width: 640, height: 480 }
const decodeDimensions = async () => DECODED

/** Deliberately different from DECODED: embeds must use the upload's value. */
const UPLOAD_ASPECT_RATIO = { width: 300, height: 200 }

function uploadOutput(file: Blob, contentType: string): UploadImageOutput {
  return {
    blob: {
      $type: 'blob',
      ref: { $link: `bafy-${file.size}` },
      mimeType: contentType,
      size: file.size,
    },
    mimeType: contentType,
    size: file.size,
    aspectRatio: UPLOAD_ASPECT_RATIO,
  }
}

/** Upload client that answers every call at once. */
const immediateClient = {
  uploadImage: async (file: Blob, contentType: string) =>
    uploadOutput(file, contentType),
}

interface PendingUpload {
  file: Blob
  contentType: string
  resolve: () => void
  reject: (error: unknown) => void
}

/** Upload client whose calls stay in flight until the test settles them. */
function deferredClient() {
  const calls: PendingUpload[] = []
  let inFlight = 0
  let maximumInFlight = 0
  const client = {
    uploadImage(file: Blob, contentType: string) {
      inFlight += 1
      maximumInFlight = Math.max(maximumInFlight, inFlight)
      return new Promise<UploadImageOutput>((resolve, reject) => {
        calls.push({
          file,
          contentType,
          resolve: () => {
            inFlight -= 1
            resolve(uploadOutput(file, contentType))
          },
          reject: (error) => {
            inFlight -= 1
            reject(error)
          },
        })
      })
    },
  }
  return { client, calls, maximumInFlight: () => maximumInFlight }
}

/** Lets pending promise chains and queued work run. */
async function settle() {
  for (let round = 0; round < 5; round++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const idAt = (attachments: Attachments, index: number): string =>
  attachments.items[index]?.id ?? ''

const imageOf = (url: string) => ({ thumb: url, fullsize: url })

let revokedUrls: string[]

beforeEach(() => {
  revokedUrls = []
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: (blob: Blob) => `blob:http://localhost/${blob.size}`,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: (url: string) => {
      revokedUrls.push(url)
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// B7: add, remove, replace, reorder
// ---------------------------------------------------------------------------

describe('Attachments add, remove, replace and reorder', () => {
  const summary = (attachments: Attachments) =>
    attachments.items.map((item) => ({
      size: item.file.size,
      alt: item.alt,
      previewUrl: item.previewUrl,
      blob: item.blob?.ref.$link,
    }))

  it('reorders with moveEarlier and moveLater, each image keeping its own alt, preview URL and blob', async () => {
    const attachments = new Attachments({ decodeDimensions })
    await attachments.add([imageFile(101), imageFile(102), imageFile(103)])
    attachments.setAlt(idAt(attachments, 0), 'first')
    attachments.setAlt(idAt(attachments, 1), 'second')
    attachments.setAlt(idAt(attachments, 2), 'third')
    await attachments.uploadMissing(immediateClient)

    attachments.moveEarlier(idAt(attachments, 2))

    expect(summary(attachments)).toEqual([
      {
        size: 101,
        alt: 'first',
        previewUrl: 'blob:http://localhost/101',
        blob: 'bafy-101',
      },
      {
        size: 103,
        alt: 'third',
        previewUrl: 'blob:http://localhost/103',
        blob: 'bafy-103',
      },
      {
        size: 102,
        alt: 'second',
        previewUrl: 'blob:http://localhost/102',
        blob: 'bafy-102',
      },
    ])

    attachments.moveLater(idAt(attachments, 0))

    expect(summary(attachments)).toEqual([
      {
        size: 103,
        alt: 'third',
        previewUrl: 'blob:http://localhost/103',
        blob: 'bafy-103',
      },
      {
        size: 101,
        alt: 'first',
        previewUrl: 'blob:http://localhost/101',
        blob: 'bafy-101',
      },
      {
        size: 102,
        alt: 'second',
        previewUrl: 'blob:http://localhost/102',
        blob: 'bafy-102',
      },
    ])
  })

  it('leaves the order alone when the first image is moved earlier or the last moved later', async () => {
    const attachments = new Attachments({ decodeDimensions })
    await attachments.add([imageFile(101), imageFile(102), imageFile(103)])

    attachments.moveEarlier(idAt(attachments, 0))
    attachments.moveLater(idAt(attachments, 2))

    expect(attachments.items.map((item) => item.file.size)).toEqual([
      101, 102, 103,
    ])
  })

  it('adds only the first picked image past 7 and says at most 8 are allowed', async () => {
    const attachments = new Attachments({ decodeDimensions })
    await attachments.add(
      [101, 102, 103, 104, 105, 106, 107].map((size) => imageFile(size)),
    )

    await attachments.add([imageFile(108), imageFile(109), imageFile(110)])

    expect(attachments.items.map((item) => item.file.size)).toEqual([
      101, 102, 103, 104, 105, 106, 107, 108,
    ])
    expect(attachments.message).toMatch(/\b8\b/)
  })

  it('does not add a file that is not a supported image, and says which formats are', async () => {
    const attachments = new Attachments({ decodeDimensions })

    await attachments.add([
      imageFile(101),
      textFile(102),
      imageFile(103, 'png'),
    ])

    expect(attachments.items.map((item) => item.file.size)).toEqual([101, 103])
    expect(attachments.message).toContain('Use a JPEG, PNG, WebP or GIF image.')
  })

  it('drops a removed image with its blob ref and revokes its preview URL', async () => {
    const attachments = new Attachments({ decodeDimensions })
    await attachments.add([imageFile(101), imageFile(102)])
    await attachments.uploadMissing(immediateClient)

    attachments.remove(idAt(attachments, 0))

    expect(summary(attachments)).toEqual([
      {
        size: 102,
        alt: '',
        previewUrl: 'blob:http://localhost/102',
        blob: 'bafy-102',
      },
    ])
    // The kept image's preview still passes the local URL gate; the dropped one no longer does.
    expect(imageUrl(imageOf('blob:http://localhost/102'))).toBe(
      'blob:http://localhost/102',
    )
    expect(imageUrl(imageOf('blob:http://localhost/101'))).toBeUndefined()
    expect(revokedUrls).toEqual(['blob:http://localhost/101'])
  })

  it('replaces an uploaded image in place with a pending one that has no blob ref, revoking the old preview URL', async () => {
    const attachments = new Attachments({ decodeDimensions })
    await attachments.add([imageFile(101), imageFile(102)])
    await attachments.uploadMissing(immediateClient)

    await attachments.replace(idAt(attachments, 0), imageFile(111, 'gif'))

    expect(
      attachments.items.map((item) => ({
        size: item.file.size,
        contentType: item.contentType,
        previewUrl: item.previewUrl,
        status: item.status,
        blob: item.blob,
      })),
    ).toEqual([
      {
        size: 111,
        contentType: 'image/gif',
        previewUrl: 'blob:http://localhost/111',
        status: 'pending',
        blob: undefined,
      },
      {
        size: 102,
        contentType: 'image/jpeg',
        previewUrl: 'blob:http://localhost/102',
        status: 'uploaded',
        blob: {
          $type: 'blob',
          ref: { $link: 'bafy-102' },
          mimeType: 'image/jpeg',
          size: 102,
        },
      },
    ])
    // The kept image's preview still passes the local URL gate; the dropped one no longer does.
    expect(imageUrl(imageOf('blob:http://localhost/102'))).toBe(
      'blob:http://localhost/102',
    )
    expect(imageUrl(imageOf('blob:http://localhost/101'))).toBeUndefined()
    expect(revokedUrls).toEqual(['blob:http://localhost/101'])
  })
})

// ---------------------------------------------------------------------------
// B8: upload queue
// ---------------------------------------------------------------------------

describe('Attachments.uploadMissing', () => {
  /**
   * Five images of mixed formats, every one with a lying declared type, then
   * the first moved one place later: strip order is 102, 101, 103, 104, 105.
   */
  async function fiveReorderedImages() {
    const attachments = new Attachments({ decodeDimensions })
    await attachments.add([
      imageFile(101, 'jpeg'),
      imageFile(102, 'png', 'image/jpeg'),
      imageFile(103, 'gif'),
      imageFile(104, 'webp', 'image/png'),
      imageFile(105, 'jpeg', ''),
    ])
    attachments.moveLater(idAt(attachments, 0))
    return attachments
  }

  it('keeps at most 2 uploads in flight, starting them in strip order with the sniffed content type', async () => {
    const attachments = await fiveReorderedImages()
    const { client, calls, maximumInFlight } = deferredClient()

    const done = attachments.uploadMissing(client)
    await settle()

    expect(calls.map((call) => call.file.size)).toEqual([102, 101])

    calls[0].resolve()
    await settle()
    expect(calls.map((call) => call.file.size)).toEqual([102, 101, 103])

    calls[1].resolve()
    await settle()
    calls[2].resolve()
    await settle()
    calls[3].resolve()
    await settle()
    calls[4].resolve()
    await done

    expect(maximumInFlight()).toBe(2)
    expect(calls.map((call) => [call.file.size, call.contentType])).toEqual([
      [102, 'image/png'],
      [101, 'image/jpeg'],
      [103, 'image/gif'],
      [104, 'image/webp'],
      [105, 'image/jpeg'],
    ])
    expect(attachments.items.map((item) => item.status)).toEqual([
      'uploaded',
      'uploaded',
      'uploaded',
      'uploaded',
      'uploaded',
    ])
  })

  it('rejects when image 3 fails, marking it failed with its error while the others upload', async () => {
    const attachments = await fiveReorderedImages()
    const { client, calls } = deferredClient()
    const failure = new Error('upload failed')

    const outcome = attachments.uploadMissing(client).then(
      () => 'resolved',
      (error: unknown) => error,
    )
    await settle()
    expect(calls.map((call) => call.file.size)).toEqual([102, 101])

    calls[0].resolve()
    calls[1].resolve()
    await settle()
    calls[2].reject(failure)
    calls[3].resolve()
    await settle()
    calls[4].resolve()

    expect(await outcome).toBe(failure)
    expect(
      attachments.items.map((item) => ({
        size: item.file.size,
        status: item.status,
        blob: item.blob?.ref.$link,
      })),
    ).toEqual([
      { size: 102, status: 'uploaded', blob: 'bafy-102' },
      { size: 101, status: 'uploaded', blob: 'bafy-101' },
      { size: 103, status: 'failed', blob: undefined },
      { size: 104, status: 'uploaded', blob: 'bafy-104' },
      { size: 105, status: 'uploaded', blob: 'bafy-105' },
    ])
    expect(attachments.items[2]?.error).toBe(failure)
  })

  it('uploads only the failed image on a second call, and resolves', async () => {
    const attachments = await fiveReorderedImages()
    const first = deferredClient()
    const firstRun = attachments.uploadMissing(first.client).catch(() => {})
    await settle()
    expect(first.calls.map((call) => call.file.size)).toEqual([102, 101])
    first.calls[0].resolve()
    first.calls[1].resolve()
    await settle()
    first.calls[2].reject(new Error('upload failed'))
    first.calls[3].resolve()
    await settle()
    first.calls[4].resolve()
    await firstRun

    const second = deferredClient()
    const secondRun = attachments.uploadMissing(second.client)
    await settle()

    expect(second.calls.map((call) => call.file.size)).toEqual([103])
    second.calls[0].resolve()
    await expect(secondRun).resolves.toBeUndefined()
    expect(
      attachments.items.map((item) => [item.status, item.blob?.ref.$link]),
    ).toEqual([
      ['uploaded', 'bafy-102'],
      ['uploaded', 'bafy-101'],
      ['uploaded', 'bafy-103'],
      ['uploaded', 'bafy-104'],
      ['uploaded', 'bafy-105'],
    ])
  })
})

// ---------------------------------------------------------------------------
// B9: embed construction (PRD §3.4)
// ---------------------------------------------------------------------------

describe('Attachments.embedFor', () => {
  const URL_UNDER_TEST = 'https://example.com/story'

  /** Two uploaded images: alt '  a cat  ' and an all-space alt. */
  async function twoUploadedImages() {
    const attachments = new Attachments({ decodeDimensions })
    await attachments.add([imageFile(101), imageFile(102, 'png')])
    attachments.setAlt(idAt(attachments, 0), '  a cat  ')
    attachments.setAlt(idAt(attachments, 1), '   ')
    await attachments.uploadMissing(immediateClient)
    return attachments
  }

  const EXPECTED_IMAGES = [
    {
      image: {
        $type: 'blob',
        ref: { $link: 'bafy-101' },
        mimeType: 'image/jpeg',
        size: 101,
      },
      alt: 'a cat',
      aspectRatio: { width: 300, height: 200 },
    },
    {
      image: {
        $type: 'blob',
        ref: { $link: 'bafy-102' },
        mimeType: 'image/png',
        size: 102,
      },
      aspectRatio: { width: 300, height: 200 },
    },
  ]

  it('is undefined when there are no images and no URL', () => {
    const attachments = new Attachments({ decodeDimensions })

    expect(attachments.embedFor()).toBeUndefined()
  })

  it('is the external embed when there are no images and a URL', () => {
    const attachments = new Attachments({ decodeDimensions })

    expect(attachments.embedFor(URL_UNDER_TEST)).toEqual({
      $type: 'social.coves.embed.external',
      external: { uri: 'https://example.com/story' },
    })
  })

  it('is an images embed with trimmed alt (omitted when blank) and the upload aspect ratio when there are images and no URL', async () => {
    const attachments = await twoUploadedImages()

    expect(attachments.embedFor()).toEqual({
      $type: 'social.coves.embed.images',
      images: EXPECTED_IMAGES,
    })
  })

  it('is an imagesWithAttachment embed with that image list and the external attachment when there are images and a URL', async () => {
    const attachments = await twoUploadedImages()

    const embed = attachments.embedFor(URL_UNDER_TEST) as
      | {
          $type?: string
          images?: { images?: unknown }
          attachment?: unknown
        }
      | undefined

    expect(embed?.$type).toBe('social.coves.embed.imagesWithAttachment')
    expect(embed?.images?.images).toEqual(EXPECTED_IMAGES)
    expect(embed?.attachment).toEqual({
      $type: 'social.coves.embed.external',
      external: { uri: 'https://example.com/story' },
    })
  })
})

// ---------------------------------------------------------------------------
// Overlapping adds, cancelled uploads and a composer that closes mid-check
// ---------------------------------------------------------------------------

/**
 * A decoder that answers at once until `hold()` is called; from then on each
 * decode waits until `release()` lets every waiting decode finish.
 */
function holdableDecoder() {
  let held = false
  let waiting: (() => void)[] = []
  return {
    decodeDimensions: () =>
      held
        ? new Promise<typeof DECODED>((resolve) => {
            waiting.push(() => resolve(DECODED))
          })
        : Promise.resolve(DECODED),
    hold: () => {
      held = true
    },
    release: () => {
      held = false
      const finishing = waiting
      waiting = []
      for (const finish of finishing) finish()
    },
  }
}

/** Upload client whose calls stay in flight until their signal aborts. */
function abortableClient() {
  const started: number[] = []
  const client = {
    uploadImage: (
      file: Blob,
      _contentType: string,
      options?: { signal?: AbortSignal },
    ) => {
      started.push(file.size)
      return new Promise<UploadImageOutput>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject(options.signal?.reason),
        )
      })
    },
  }
  return { client, started }
}

describe('Attachments with overlapping adds', () => {
  it('keeps the strip at 8 when two adds overlap at 7, adding the first and refusing the second', async () => {
    const decoder = holdableDecoder()
    const attachments = new Attachments({
      decodeDimensions: decoder.decodeDimensions,
    })
    await attachments.add(
      [101, 102, 103, 104, 105, 106, 107].map((size) => imageFile(size)),
    )

    decoder.hold()
    const picked = attachments.add([imageFile(108)])
    const dropped = attachments.add([imageFile(109)])
    await settle()
    decoder.release()
    await settle()
    decoder.release()
    await Promise.all([picked, dropped])

    expect(attachments.items.map((item) => item.file.size)).toEqual([
      101, 102, 103, 104, 105, 106, 107, 108,
    ])
    expect(attachments.message).toMatch(/\b8\b/)
  })
})

describe('Attachments.uploadMissing with an abort signal', () => {
  it('rejects without uploading when the signal is already aborted, leaving every image pending', async () => {
    const attachments = new Attachments({ decodeDimensions })
    await attachments.add([imageFile(101), imageFile(102)])
    const { client, started } = abortableClient()
    const controller = new AbortController()
    controller.abort()

    await expect(
      attachments.uploadMissing(client, controller.signal),
    ).rejects.toBe(controller.signal.reason)

    expect(started).toEqual([])
    expect(attachments.items.map((item) => item.status)).toEqual([
      'pending',
      'pending',
    ])
  })

  it('puts an image whose upload is aborted back to pending with no error, and rejects with the abort reason', async () => {
    const attachments = new Attachments({ decodeDimensions })
    await attachments.add([imageFile(101), imageFile(102), imageFile(103)])
    const { client, started } = abortableClient()
    const controller = new AbortController()

    const outcome = attachments.uploadMissing(client, controller.signal).then(
      () => 'resolved',
      (error: unknown) => error,
    )
    await settle()
    expect(started).toEqual([101, 102])
    controller.abort()

    expect(await outcome).toBe(controller.signal.reason)
    expect(started).toEqual([101, 102])
    expect(
      attachments.items.map((item) => ({
        status: item.status,
        error: item.error,
      })),
    ).toEqual([
      { status: 'pending', error: undefined },
      { status: 'pending', error: undefined },
      { status: 'pending', error: undefined },
    ])
  })
})

describe('Attachments.releasePreviews during a pick-time check', () => {
  it('adds no image and leaves no preview URL unrevoked when a check finishes after the strip is released', async () => {
    const created: string[] = []
    URL.createObjectURL = (blob: Blob) => {
      const url = `blob:http://localhost/${blob.size}`
      created.push(url)
      return url
    }
    const decoder = holdableDecoder()
    const attachments = new Attachments({
      decodeDimensions: decoder.decodeDimensions,
    })
    decoder.hold()

    const adding = attachments.add([imageFile(101)])
    await settle()
    attachments.releasePreviews()
    decoder.release()
    await adding

    expect(attachments.items).toEqual([])
    expect(created.filter((url) => !revokedUrls.includes(url))).toEqual([])
  })
})
